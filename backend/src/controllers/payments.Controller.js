/*
 * Payment gateways and customer wallet top-ups.
 *
 * Two audiences share this file because they share one invariant, and keeping
 * them together makes that invariant hard to break by accident:
 *
 *   The number of coins credited is derived from the `topup_orders` row the
 *   server wrote before the customer ever reached the gateway, and is credited
 *   only after the provider — not the customer's browser — confirms payment.
 *
 * Everything else follows from that. The client picks an amount; it does not
 * get to state one. The station receives a publishable key; it never receives
 * a secret. A callback is a hint that something happened; the signature is
 * what makes it true.
 */
import crypto from 'crypto';
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import {
  encryptSecret, decryptSecret, secretHint, canEncrypt
} from '../modules/payments/payments.crypto.js';
import { getProvider, listProviders, PROVIDER_IDS } from '../modules/payments/payments.providers.js';
import { renderCheckout, renderMessage } from '../modules/payments/payments.checkout.js';
import { getSettings } from '../config/settings.js';

/* ==========================================================================
   HELPERS
   ========================================================================== */

/*
 * Settings that govern self-service top-ups, with safe fallbacks.
 *
 * Café-scoped through getSettings, the same accessor every other per-café
 * setting in the codebase goes through (session grace, warn minutes, and so
 * on) — this used to read every `topup.%` row across every café with a plain
 * LIKE query and no cafe_id filter, which meant whichever café's row the
 * database happened to return last silently won for everyone. Never
 * surfaced because most installs only have one café to begin with.
 */
const loadTopupSettings = async (cafeId) => {
  const map = await getSettings([
    'topup.enabled', 'topup.cash_enabled', 'topup.min_amount', 'topup.max_amount',
    'topup.coin_rate', 'topup.presets', 'topup.bonus_tiers'
  ], cafeId);

  const num = (key, fallback) => {
    const v = Number(map[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  return {
    enabled: map['topup.enabled'] !== false,
    // Cash needs no gateway, so it defaults on: a café that has configured
    // nothing can still take money for coins.
    cashEnabled: map['topup.cash_enabled'] !== false,
    min: num('topup.min_amount', 50),
    max: num('topup.max_amount', 10000),
    rate: num('topup.coin_rate', 1),
    presets: String(map['topup.presets'] || '100,250,500,1000')
      .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
    // e.g. [{ pay_amount: 1000, credit_amount: 1100 }] — "pay 1000, get 1100
    // XP" instead of the flat rate, for whatever amounts the café picks.
    bonusTiers: (Array.isArray(map['topup.bonus_tiers']) ? map['topup.bonus_tiers'] : [])
      .map((t) => ({ pay_amount: Number(t?.pay_amount), credit_amount: Number(t?.credit_amount) }))
      .filter((t) => Number.isFinite(t.pay_amount) && t.pay_amount > 0 &&
        Number.isFinite(t.credit_amount) && t.credit_amount > 0)
  };
};

/*
 * What a top-up of this exact amount actually credits.
 *
 * An amount matching a configured bonus tier gets that tier's fixed payout —
 * "pay 1000, get 1100" — rather than the flat rate; everything else still
 * uses the standard coin_rate exactly as before. Tiers apply to the whole
 * amount, not as a top-up-then-bonus split, so there is one number to reason
 * about rather than a rate plus an add-on.
 */
const resolveTopupCoins = (charge, settings) => {
  const tier = (settings.bonusTiers || []).find((t) => t.pay_amount === charge);
  if (tier) return tier.credit_amount;
  return Number((charge * settings.rate).toFixed(2));
};

/**
 * The café a request belongs to.
 *
 * Staff carry it in the token. A customer does not: the `customers` table has
 * no cafe_id, so their café has to be derived from where they physically are —
 * the station running their session. That is also the correct answer, since
 * the payment should land in the merchant account of the café they are sitting
 * in.
 *
 * Deliberately not taken from the request body. A café id supplied by the
 * client would let a customer direct their payment at another café's gateway.
 */
const resolveCafeId = async (client, actor) => {
  if (actor?.customer_id && !actor?.isStaff) {
    const { rows } = await client.query(
      // The session carries a cafe_id, but historically not always; the
      // station it ran on is the reliable fallback.
      `SELECT COALESCE(s.cafe_id, p.cafe_id) AS cafe_id
       FROM sessions s
       LEFT JOIN pcs p ON p.pc_id = s.pc_id
       WHERE s.customer_id = $1
         AND COALESCE(s.cafe_id, p.cafe_id) IS NOT NULL
       ORDER BY s.started_at DESC NULLS LAST
       LIMIT 1`,
      [actor.customer_id]
    );
    if (rows[0]?.cafe_id != null) return rows[0].cafe_id;

    /* No session on record. On a single-café install there is exactly one
       right answer, so use it; with several cafés there is no way to guess and
       the caller gets null, which every gateway lookup treats as unconfigured
       rather than as "any café". */
    const only = await client.query('SELECT cafe_id FROM cafes LIMIT 2');
    return only.rows.length === 1 ? only.rows[0].cafe_id : null;
  }

  /* ---- staff ---- */
  if (actor?.cafe_id != null) return actor.cafe_id;

  /*
   * The token had no café. That is not the same as "this actor has no café",
   * and treating it that way is how a signed-in owner ends up staring at an
   * empty approvals queue while a customer waits at the counter: the scope
   * silently becomes "cafés with no id", which matches nothing, and every
   * screen reports success with zero rows.
   *
   * The claim was added to the token later than the login flow, so any session
   * predating it lacks the field — and a token stays valid for days. Worse, a
   * write like saveGateway would have stored its row against a null café,
   * where a correctly-scoped session could never find it again.
   *
   * So the token is treated as a fast path, not as the authority: fall back to
   * the database, which knows which café this user owns regardless of when
   * they signed in.
   */
  if (actor?.id != null) {
    const owned = await client.query(
      'SELECT cafe_id FROM cafes WHERE user_id = $1 ORDER BY cafe_id LIMIT 1',
      [actor.id]
    );
    if (owned.rows[0]?.cafe_id != null) return owned.rows[0].cafe_id;
  }

  // A staff member belongs to a café through their staff record.
  if (actor?.staff_id != null) {
    const staff = await client.query(
      'SELECT cafe_id FROM staff WHERE staff_id = $1', [actor.staff_id]
    );
    if (staff.rows[0]?.cafe_id != null) return staff.rows[0].cafe_id;
  }

  // Single-café install: there is only one answer it could be.
  const only = await client.query('SELECT cafe_id FROM cafes LIMIT 2');
  return only.rows.length === 1 ? only.rows[0].cafe_id : null;
};

/** The customer columns this module needs, under the names it uses. */
const CUSTOMER_COLUMNS =
  'customer_id, customer_name AS name, email, phone_number AS phone';

/** Strip every secret before a gateway row leaves the server. */
const shapeGateway = (row) => ({
  gateway_id: row.gateway_id,
  provider: row.provider,
  display_name: row.display_name,
  is_enabled: row.is_enabled,
  mode: row.mode,
  key_id: row.key_id,
  // The operator needs to recognise which key is saved, not read it back.
  key_secret_hint: row.key_secret_enc ? secretHint(decryptSecret(row.key_secret_enc)) : null,
  has_key_secret: !!row.key_secret_enc,
  has_webhook_secret: !!row.webhook_secret_enc,
  config: row.config || {},
  last_verified_at: row.last_verified_at,
  last_error: row.last_error,
  updated_at: row.updated_at
});

const shapeTopup = (row) => ({
  topup_id: row.topup_id,
  customer_id: row.customer_id,
  customer_name: row.customer_name || null,
  provider: row.provider,
  mode: row.mode,
  amount: Number(row.amount),
  coins: Number(row.coins),
  currency: row.currency,
  status: row.status,
  provider_order_id: row.provider_order_id,
  provider_payment_id: row.provider_payment_id,
  failure_reason: row.failure_reason,
  source: row.source,
  created_at: row.created_at,
  paid_at: row.paid_at,
  credited_at: row.credited_at
});

/** Load a gateway with its secrets decrypted. Never returned to a client. */
const loadGatewaySecrets = async (client, cafeId, provider) => {
  const { rows } = await client.query(
    `SELECT * FROM payment_gateways
     WHERE provider = $1 AND (cafe_id = $2 OR ($2::int IS NULL AND cafe_id IS NULL))`,
    [provider, cafeId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    row,
    keyId: row.key_id,
    keySecret: decryptSecret(row.key_secret_enc),
    webhookSecret: decryptSecret(row.webhook_secret_enc),
    mode: row.mode
  };
};

/**
 * Persist a refusal reason after the crediting transaction has been rolled
 * back. Runs on its own so it survives that rollback — the whole point is that
 * a payment we declined to credit leaves a record saying why.
 */
const markTopupFailed = async (client, topupId, reason) => {
  if (!reason) return;
  await client.query(
    `UPDATE topup_orders
     SET status = 'failed', failure_reason = $2, updated_at = CURRENT_TIMESTAMP
     WHERE topup_id = $1 AND status <> 'credited'`,
    [topupId, String(reason).slice(0, 255)]
  ).catch((err) => console.error('[payments] could not record failure:', err.message));
};

/* ==========================================================================
   THE CREDIT PATH

   Called from two places that can race each other: the customer's browser
   coming back from the gateway, and the gateway's own webhook. Both are
   funnelled through here so the idempotency lives in one place.
   ========================================================================== */
const creditTopup = async (client, { order, paymentId, confirmedAmount }) => {
  // Lock the top-up row first. A concurrent caller now waits here rather than
  // reading the same 'pending' status and crediting a second time.
  const locked = await client.query(
    'SELECT * FROM topup_orders WHERE topup_id = $1 FOR UPDATE', [order.topup_id]
  );
  const current = locked.rows[0];
  if (!current) return { ok: false, reason: 'Top-up not found' };

  // Already done. Report success — the caller asked for this payment to be
  // credited, and it is.
  if (current.status === 'credited') {
    return { ok: true, alreadyCredited: true, order: current };
  }
  if (current.status === 'failed' || current.status === 'expired') {
    return { ok: false, reason: 'This top-up was already closed' };
  }

  /*
   * The provider's amount must match what we recorded. If they disagree, the
   * safe move is to stop and let a human look: crediting the larger of the two
   * is a gift, crediting the smaller is a theft, and guessing which the café
   * would prefer is not this function's decision to make.
   *
   * The failure is reported rather than written. Every caller rolls this
   * transaction back on a refusal, so an UPDATE here would be discarded along
   * with it — the mismatch would be caught and then silently forgotten,
   * leaving the order sitting at 'pending' with nothing to investigate.
   * `recordFailure` carries the reason out so the caller can persist it after
   * the rollback.
   */
  if (confirmedAmount != null) {
    const expected = Number(current.amount);
    if (Math.abs(Number(confirmedAmount) - expected) > 0.01) {
      return {
        ok: false,
        reason: 'The amount paid does not match this top-up',
        recordFailure: `Amount mismatch: provider ${confirmedAmount}, expected ${expected}`
      };
    }
  }

  const coins = Number(current.coins);

  // Wallet row, locked for the same reason.
  let wallet = await client.query(
    'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE', [current.customer_id]
  );
  if (wallet.rows.length === 0) {
    wallet = await client.query(
      `INSERT INTO wallets (customer_id, balance) VALUES ($1, 0)
       ON CONFLICT (customer_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [current.customer_id]
    );
  }
  const walletRow = wallet.rows[0];
  if (walletRow.is_active === false) {
    return { ok: false, reason: 'This wallet is inactive' };
  }

  const next = Number((Number(walletRow.balance) + coins).toFixed(2));

  await client.query(
    'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
    [next, walletRow.wallet_id]
  );

  const ledger = await client.query(
    `INSERT INTO wallet_transactions
       (wallet_id, customer_id, direction, amount, balance_after, category, method, note, performed_by)
     VALUES ($1, $2, 'credit', $3, $4, 'topup', $5, $6, $7)
     RETURNING *`,
    [walletRow.wallet_id, current.customer_id, coins, next, current.provider,
     `Online top-up · ${current.provider} · ${current.currency} ${Number(current.amount).toFixed(2)}`,
     `gateway:${current.provider}`]
  );

  const updated = await client.query(
    `UPDATE topup_orders
     SET status = 'credited',
         provider_payment_id = COALESCE(provider_payment_id, $2),
         wallet_transaction_id = $3,
         paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
         credited_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE topup_id = $1
     RETURNING *`,
    [current.topup_id, paymentId || null, ledger.rows[0].transaction_id]
  );

  return {
    ok: true,
    order: updated.rows[0],
    balance: next,
    transaction_id: ledger.rows[0].transaction_id
  };
};

/* ==========================================================================
   ADMIN — GATEWAY CONFIGURATION
   ========================================================================== */

// GET /api/payments/providers
export const getProviderCatalogue = (req, res) => {
  res.json({ success: true, data: listProviders() });
};

// GET /api/payments/gateways
export const listGateways = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = await resolveCafeId(client, req.actor);
    const { rows } = await client.query(
      `SELECT * FROM payment_gateways
       WHERE cafe_id = $1 OR ($1::int IS NULL AND cafe_id IS NULL)
       ORDER BY provider`,
      [cafeId]
    );

    res.json({
      success: true,
      data: {
        gateways: rows.map(shapeGateway),
        catalogue: listProviders(),
        // An operator staring at "could not save" deserves to know the server
        // is missing its encryption key rather than guessing at their input.
        encryption_ready: canEncrypt()
      }
    });
  } catch (error) {
    console.error('Error listing gateways:', error);
    res.status(500).json({ success: false, message: 'Error loading payment gateways' });
  } finally {
    client.release();
  }
};

// PUT /api/payments/gateways/:provider
export const saveGateway = async (req, res) => {
  const client = await pool.connect();
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    if (!PROVIDER_IDS.includes(provider)) {
      return res.status(400).json({ success: false, message: 'Unknown payment provider' });
    }
    if (!canEncrypt()) {
      return res.status(503).json({
        success: false,
        message: 'The server has no encryption key configured, so gateway credentials cannot be stored securely. Set PAYMENTS_ENC_KEY and restart.'
      });
    }

    const cafeId = await resolveCafeId(client, req.actor);
    const { key_id, key_secret, webhook_secret, is_enabled, mode, display_name } = req.body || {};

    const nextMode = mode === 'live' ? 'live' : 'test';
    const existing = await client.query(
      `SELECT * FROM payment_gateways
       WHERE provider = $1 AND (cafe_id = $2 OR ($2::int IS NULL AND cafe_id IS NULL))`,
      [provider, cafeId]
    );
    const prior = existing.rows[0];

    /* A blank secret field means "leave it alone", not "erase it" — the UI
       cannot show the stored value, so it cannot send it back. */
    const keySecretEnc = key_secret
      ? encryptSecret(String(key_secret).trim())
      : (prior?.key_secret_enc ?? null);
    const webhookSecretEnc = webhook_secret
      ? encryptSecret(String(webhook_secret).trim())
      : (prior?.webhook_secret_enc ?? null);

    const nextKeyId = key_id !== undefined && key_id !== null && String(key_id).trim() !== ''
      ? String(key_id).trim()
      : (prior?.key_id ?? null);

    // Enabling a gateway with no credentials would fail on the customer's
    // screen, at the worst possible moment. Refuse it here instead.
    const wantsEnabled = is_enabled === true || is_enabled === 'true';
    if (wantsEnabled && (!nextKeyId || !keySecretEnc)) {
      return res.status(400).json({
        success: false,
        message: 'Add both the key and the secret before enabling this gateway'
      });
    }

    const saved = await client.query(
      `INSERT INTO payment_gateways
         (cafe_id, provider, display_name, is_enabled, mode, key_id, key_secret_enc, webhook_secret_enc, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CURRENT_TIMESTAMP)
       ON CONFLICT (cafe_id, provider) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         is_enabled = EXCLUDED.is_enabled,
         mode = EXCLUDED.mode,
         key_id = EXCLUDED.key_id,
         key_secret_enc = EXCLUDED.key_secret_enc,
         webhook_secret_enc = EXCLUDED.webhook_secret_enc,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [cafeId, provider, display_name || getProvider(provider).label, wantsEnabled,
       nextMode, nextKeyId, keySecretEnc, webhookSecretEnc]
    );

    await recordAudit(req, {
      action: 'payments.gateway.save',
      category: 'system',
      entity: 'payment_gateway',
      entity_id: saved.rows[0].gateway_id,
      sensitive: true,
      // The audit trail records that credentials changed, never what they are.
      summary: `${wantsEnabled ? 'Enabled' : 'Saved'} ${provider} gateway in ${nextMode} mode`,
      meta: {
        provider,
        mode: nextMode,
        enabled: wantsEnabled,
        key_rotated: !!key_secret,
        webhook_rotated: !!webhook_secret
      }
    });

    res.json({
      success: true,
      message: `${getProvider(provider).label} saved`,
      data: shapeGateway(saved.rows[0])
    });
  } catch (error) {
    console.error('Error saving gateway:', error);
    res.status(500).json({ success: false, message: 'Error saving the payment gateway' });
  } finally {
    client.release();
  }
};

// POST /api/payments/gateways/:provider/test
export const testGateway = async (req, res) => {
  const client = await pool.connect();
  try {
    const providerId = String(req.params.provider || '').toLowerCase();
    const provider = getProvider(providerId);
    if (!provider) return res.status(400).json({ success: false, message: 'Unknown payment provider' });

    const cafeId = await resolveCafeId(client, req.actor);
    const found = await loadGatewaySecrets(client, cafeId, providerId);
    if (!found || !found.keyId || !found.keySecret) {
      return res.status(400).json({ success: false, message: 'Add the key and secret first' });
    }

    /* The test creates a real order for the smallest allowed amount and then
       abandons it. No money moves — an unpaid order simply expires — but it
       exercises the exact credential path a customer would hit, which a
       format check on the key never would. */
    let ok = true;
    let detail = 'Credentials accepted';
    try {
      const result = await provider.createOrder({
        keyId: found.keyId,
        keySecret: found.keySecret,
        amount: 1,
        currency: 'INR',
        receipt: `cxtest_${Date.now()}`,
        mode: found.mode,
        notes: { purpose: 'CafeXP credential check' },
        customer: { id: 'test', name: 'CafeXP Test', email: 'test@cafexp.local', phone: '9999999999' },
        returnUrl: 'https://localhost/cafexp/return'
      });
      detail = result.orderId
        ? `Connected — test order ${result.orderId} created and abandoned`
        : 'Credentials accepted';
    } catch (err) {
      ok = false;
      // The provider's own words are useful here and contain no secret.
      detail = err.message || 'The provider rejected these credentials';
    }

    await client.query(
      `UPDATE payment_gateways
       SET last_verified_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE last_verified_at END,
           last_error = CASE WHEN $3 THEN NULL ELSE $2 END,
           updated_at = CURRENT_TIMESTAMP
       WHERE gateway_id = $1`,
      [found.row.gateway_id, String(detail).slice(0, 255), ok]
    );

    res.status(ok ? 200 : 400).json({ success: ok, message: detail });
  } catch (error) {
    console.error('Error testing gateway:', error);
    res.status(500).json({ success: false, message: 'Error testing the payment gateway' });
  } finally {
    client.release();
  }
};

// DELETE /api/payments/gateways/:provider
export const deleteGateway = async (req, res) => {
  const client = await pool.connect();
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    const cafeId = await resolveCafeId(client, req.actor);

    const { rowCount } = await client.query(
      `DELETE FROM payment_gateways
       WHERE provider = $1 AND (cafe_id = $2 OR ($2::int IS NULL AND cafe_id IS NULL))`,
      [provider, cafeId]
    );
    if (!rowCount) return res.status(404).json({ success: false, message: 'Gateway not configured' });

    await recordAudit(req, {
      action: 'payments.gateway.delete',
      category: 'system',
      entity: 'payment_gateway',
      sensitive: true,
      summary: `Removed the ${provider} gateway and its stored credentials`,
      meta: { provider }
    });

    res.json({ success: true, message: 'Gateway removed' });
  } catch (error) {
    console.error('Error deleting gateway:', error);
    res.status(500).json({ success: false, message: 'Error removing the payment gateway' });
  } finally {
    client.release();
  }
};

// GET /api/payments/topups
export const listTopups = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = await resolveCafeId(client, req.actor);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const { rows } = await client.query(
      `SELECT t.*, c.customer_name
       FROM topup_orders t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
       WHERE t.cafe_id = $1 OR ($1::int IS NULL AND t.cafe_id IS NULL)
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [cafeId, limit]
    );

    const totals = await client.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE status = 'credited'), 0) AS collected,
         COUNT(*) FILTER (WHERE status = 'credited') AS credited_count,
         COUNT(*) FILTER (WHERE status IN ('created','pending')) AS pending_count,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
       FROM topup_orders
       WHERE (cafe_id = $1 OR ($1::int IS NULL AND cafe_id IS NULL))
         AND created_at >= CURRENT_DATE - INTERVAL '30 days'`,
      [cafeId]
    );

    res.json({
      success: true,
      data: {
        topups: rows.map(shapeTopup),
        summary: {
          collected_30d: Number(totals.rows[0].collected),
          credited_30d: Number(totals.rows[0].credited_count),
          pending: Number(totals.rows[0].pending_count),
          failed_30d: Number(totals.rows[0].failed_count)
        }
      }
    });
  } catch (error) {
    console.error('Error listing top-ups:', error);
    res.status(500).json({ success: false, message: 'Error loading top-ups' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CUSTOMER — SELF-SERVICE TOP-UP
   ========================================================================== */

// GET /api/payments/topup/options
export const getTopupOptions = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = await resolveCafeId(client, req.actor);
    const settings = await loadTopupSettings(cafeId);

    const { rows } = await client.query(
      `SELECT * FROM payment_gateways
       WHERE is_enabled = TRUE
         AND (cafe_id = $1 OR ($1::int IS NULL AND cafe_id IS NULL))`,
      [cafeId]
    );

    /* Only the publishable half of each gateway crosses this line. The secret
       is not omitted by the serialiser — it is never read from the row. */
    const methods = rows.map((row) => {
      const provider = getProvider(row.provider);
      return {
        provider: row.provider,
        label: row.display_name || provider?.label || row.provider,
        mode: row.mode,
        kind: 'gateway',
        instant: true,
        ...(provider ? provider.publicConfig(row) : {})
      };
    }).filter((m) => m.key_id);

    /*
     * Cash is offered alongside the gateways rather than as a fallback for
     * when they are missing. Plenty of customers at a café counter are paying
     * with notes by choice, and a café that has configured no gateway at all
     * still gets a working top-up rather than a dead panel.
     */
    if (settings.cashEnabled) {
      methods.push({
        provider: 'cash',
        label: 'Cash at the counter',
        kind: 'cash',
        instant: false,
        needs_approval: true,
        note: 'Staff add the coins once you hand over the cash.'
      });
    }

    // A request already waiting, so the station can show its status instead of
    // inviting a duplicate.
    let pending = null;
    if (req.actor?.customer_id) {
      const open = await client.query(
        `SELECT topup_id, amount, coins, created_at FROM topup_orders
         WHERE customer_id = $1 AND provider = 'cash' AND status = 'awaiting_approval'
         ORDER BY created_at DESC LIMIT 1`,
        [req.actor.customer_id]
      );
      if (open.rows[0]) {
        pending = {
          topup_id: open.rows[0].topup_id,
          amount: Number(open.rows[0].amount),
          coins: Number(open.rows[0].coins),
          created_at: open.rows[0].created_at
        };
      }
    }

    res.json({
      success: true,
      data: {
        enabled: settings.enabled && methods.length > 0,
        // Say why, so the station shows a reason instead of an empty panel.
        reason: !settings.enabled
          ? 'Self-service top-up is switched off for this café.'
          : (methods.length === 0
            ? 'No payment method has been set up yet. Ask the counter to add coins.'
            : null),
        min_amount: settings.min,
        max_amount: settings.max,
        coin_rate: settings.rate,
        presets: settings.presets,
        // "Pay 1000, get 1100 XP" — shown ahead of the flat rate wherever a
        // tier exists, since it is strictly the better deal by design.
        bonus_tiers: settings.bonusTiers,
        currency: 'INR',
        methods,
        pending_cash_request: pending
      }
    });
  } catch (error) {
    console.error('Error loading top-up options:', error);
    res.status(500).json({ success: false, message: 'Error loading top-up options' });
  } finally {
    client.release();
  }
};

// POST /api/payments/topup/order
export const createTopupOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    /*
     * The customer is the token, not the body. A body-supplied customer_id
     * would let any signed-in customer create an order that credits someone
     * else — or, with a staff token, anyone at all.
     */
    const customerId = Number(req.actor?.customer_id);
    if (!Number.isInteger(customerId)) {
      return res.status(403).json({
        success: false,
        message: 'Sign in as a customer to top up a wallet'
      });
    }

    const providerId = String(req.body?.provider || '').toLowerCase();
    const provider = getProvider(providerId);
    if (!provider) return res.status(400).json({ success: false, message: 'Choose a payment method' });

    const cafeId = await resolveCafeId(client, req.actor);
    const settings = await loadTopupSettings(cafeId);
    if (!settings.enabled) {
      return res.status(403).json({ success: false, message: 'Self-service top-up is switched off' });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter an amount' });
    }
    if (amount < settings.min || amount > settings.max) {
      return res.status(400).json({
        success: false,
        message: `Top-ups must be between ${settings.min} and ${settings.max}`
      });
    }
    // Two decimal places; a fractional paisa is not a real amount.
    const charge = Number(amount.toFixed(2));
    const coins = resolveTopupCoins(charge, settings);

    const customer = await client.query(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    if (customer.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const gateway = await loadGatewaySecrets(client, cafeId, providerId);
    if (!gateway || !gateway.row.is_enabled || !gateway.keyId || !gateway.keySecret) {
      return res.status(400).json({ success: false, message: 'That payment method is not available' });
    }

    /*
     * The row is written first, in 'created'. If the provider call then fails
     * we have a record of the attempt; if it succeeds, the callback has
     * something to verify against. Creating the provider order first and the
     * row second would leave a paid order with nothing to credit.
     */
    const draft = await client.query(
      `INSERT INTO topup_orders
         (cafe_id, customer_id, provider, mode, amount, coins, currency, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,'INR','created',$7)
       RETURNING *`,
      [cafeId, customerId, providerId, gateway.mode, charge, coins, req.body?.source === 'admin' ? 'admin' : 'client']
    );
    const order = draft.rows[0];

    let created;
    try {
      created = await provider.createOrder({
        keyId: gateway.keyId,
        keySecret: gateway.keySecret,
        amount: charge,
        currency: 'INR',
        receipt: `cx_${order.topup_id}_${Date.now().toString(36)}`,
        mode: gateway.mode,
        notes: { topup_id: String(order.topup_id), customer_id: String(customerId) },
        customer: {
          id: customerId,
          name: customer.rows[0].name,
          email: customer.rows[0].email,
          phone: customer.rows[0].phone
        },
        returnUrl: req.body?.return_url || `${req.protocol}://${req.get('host')}/api/payments/topup/return`
      });
    } catch (err) {
      await client.query(
        `UPDATE topup_orders SET status = 'failed', failure_reason = $2, updated_at = CURRENT_TIMESTAMP
         WHERE topup_id = $1`,
        [order.topup_id, String(err.message || 'Provider rejected the order').slice(0, 255)]
      );
      // The provider's message can name an expired key; that belongs to the
      // café, not to the customer standing at the station.
      console.error(`[payments] ${providerId} createOrder failed:`, err.message);
      return res.status(502).json({
        success: false,
        message: 'The payment provider could not start this payment. Please try again or ask the counter.'
      });
    }

    /*
     * The checkout capability. 32 random bytes, so it cannot be guessed or
     * enumerated, and a short life so an abandoned window stops being a way
     * back in. Cashfree's session id and PayU's signed form are stashed on the
     * row because the checkout page is rendered later, in a separate request
     * that has no access to the provider secret used to produce them.
     */
    const nonce = crypto.randomBytes(24).toString('base64url');

    await client.query(
      `UPDATE topup_orders
       SET provider_order_id = $2,
           status = 'pending',
           checkout_nonce = $3,
           checkout_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes',
           config = $4::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE topup_id = $1`,
      [order.topup_id, created.orderId, nonce,
       JSON.stringify({ session_id: created.sessionId || null, form: created.form || null })]
    );

    res.status(201).json({
      success: true,
      data: {
        topup_id: order.topup_id,
        provider: providerId,
        mode: gateway.mode,
        amount: charge,
        coins,
        currency: 'INR',
        order_id: created.orderId,
        /*
         * The station gets a URL, not credentials. Everything the provider's
         * SDK needs stays on the server and is rendered into the checkout page,
         * so a compromised station renderer has nothing worth taking.
         */
        checkout_url: `/api/payments/checkout/${nonce}`,
        expires_in_seconds: 30 * 60
      }
    });
  } catch (error) {
    console.error('Error creating top-up order:', error);
    res.status(500).json({ success: false, message: 'Error starting the payment' });
  } finally {
    client.release();
  }
};

// POST /api/payments/topup/verify
export const verifyTopup = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = Number(req.actor?.customer_id);
    const topupId = Number(req.body?.topup_id);
    if (!Number.isInteger(topupId)) {
      return res.status(400).json({ success: false, message: 'Missing top-up reference' });
    }

    const found = await client.query('SELECT * FROM topup_orders WHERE topup_id = $1', [topupId]);
    const order = found.rows[0];
    if (!order) return res.status(404).json({ success: false, message: 'Top-up not found' });

    // A customer may only settle their own top-up.
    if (!req.actor?.isStaff && order.customer_id !== customerId) {
      return res.status(403).json({ success: false, message: 'This top-up is not yours' });
    }

    if (order.status === 'credited') {
      const wallet = await client.query('SELECT balance FROM wallets WHERE customer_id = $1', [order.customer_id]);
      return res.json({
        success: true,
        message: 'Already credited',
        data: { status: 'credited', coins: Number(order.coins), balance: Number(wallet.rows[0]?.balance ?? 0) }
      });
    }

    const provider = getProvider(order.provider);
    const gateway = await loadGatewaySecrets(client, order.cafe_id, order.provider);
    if (!provider || !gateway) {
      return res.status(400).json({ success: false, message: 'That payment method is no longer available' });
    }

    const verdict = await provider.verifyReturn({
      keyId: gateway.keyId,
      keySecret: gateway.keySecret,
      mode: gateway.mode,
      order,
      payload: req.body?.payload || req.body
    });

    if (!verdict.ok) {
      await client.query(
        `UPDATE topup_orders SET status = 'failed', failure_reason = $2, updated_at = CURRENT_TIMESTAMP
         WHERE topup_id = $1 AND status NOT IN ('credited')`,
        [order.topup_id, String(verdict.reason).slice(0, 255)]
      );
      return res.status(400).json({ success: false, message: verdict.reason });
    }

    await client.query('BEGIN');
    const result = await creditTopup(client, {
      order,
      paymentId: verdict.paymentId,
      confirmedAmount: verdict.amount ?? null
    });

    if (!result.ok) {
      await client.query('ROLLBACK');
      await markTopupFailed(client, order.topup_id, result.recordFailure);
      return res.status(409).json({ success: false, message: result.reason });
    }
    await client.query('COMMIT');

    const balance = await client.query('SELECT balance FROM wallets WHERE customer_id = $1', [order.customer_id]);

    res.json({
      success: true,
      message: result.alreadyCredited ? 'Already credited' : 'Coins added',
      data: {
        status: 'credited',
        coins: Number(order.coins),
        amount: Number(order.amount),
        balance: Number(balance.rows[0]?.balance ?? 0)
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error verifying top-up:', error);
    res.status(500).json({ success: false, message: 'Error confirming the payment' });
  } finally {
    client.release();
  }
};

// GET /api/payments/topup/mine
export const myTopups = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = Number(req.actor?.customer_id);
    if (!Number.isInteger(customerId)) {
      return res.status(403).json({ success: false, message: 'Customer sign-in required' });
    }
    const { rows } = await client.query(
      `SELECT * FROM topup_orders WHERE customer_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [customerId]
    );
    res.json({ success: true, data: rows.map(shapeTopup) });
  } catch (error) {
    console.error('Error loading customer top-ups:', error);
    res.status(500).json({ success: false, message: 'Error loading your top-ups' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CASH TOP-UPS

   The customer asks; a member of staff confirms the notes arrived. The
   approval is the payment proof, so it carries the same weight here that a
   provider signature does on the gateway path — and goes through the very
   same creditTopup(), so the idempotency and locking are not reimplemented.
   ========================================================================== */

// POST /api/payments/topup/cash
export const requestCashTopup = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = Number(req.actor?.customer_id);
    if (!Number.isInteger(customerId)) {
      return res.status(403).json({ success: false, message: 'Sign in as a customer to request coins' });
    }

    /*
     * Which café approves this request, resolved before settings so the
     * right café's coin rate and bonus tiers apply — not whichever café the
     * database happened to answer with.
     *
     * resolveCafeId's session-history guess is a proxy for "where is this
     * customer physically sitting" — useful when the request carries nothing
     * better, wrong the moment something better is available. A brand-new
     * customer who registers at a station and asks to top up cash before
     * staff has ever started a session for them has no session history at
     * all: on an install with more than one café, resolveCafeId then returns
     * null, and the request lands nowhere any café's console can see it —
     * exactly the gap this closes. The station they are physically standing
     * at is the actual ground truth and takes priority over the guess.
     */
    let cafeId = null;
    const pcName = req.body?.pc_name ? String(req.body.pc_name).trim() : '';
    if (pcName) {
      const pc = await client.query(
        `SELECT cafe_id FROM pcs WHERE name = $1 AND cafe_id IS NOT NULL LIMIT 1`, [pcName]);
      cafeId = pc.rows[0]?.cafe_id ?? null;
    }
    if (cafeId == null) cafeId = await resolveCafeId(client, req.actor);

    if (cafeId == null) {
      return res.status(409).json({
        success: false,
        message: "Couldn't tell which café to send this to. Ask a staff member to add the coins directly."
      });
    }

    const settings = await loadTopupSettings(cafeId);
    if (!settings.enabled || !settings.cashEnabled) {
      return res.status(403).json({ success: false, message: 'Cash top-ups are not available here' });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < settings.min || amount > settings.max) {
      return res.status(400).json({
        success: false,
        message: `Top-ups must be between ${settings.min} and ${settings.max}`
      });
    }

    /*
     * One open request at a time. Without this a customer could queue up a
     * dozen requests and a distracted cashier could approve several for one
     * handful of notes.
     */
    const open = await client.query(
      `SELECT topup_id, amount FROM topup_orders
       WHERE customer_id = $1 AND provider = 'cash' AND status = 'awaiting_approval'`,
      [customerId]
    );
    if (open.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `You already have a request for ${Number(open.rows[0].amount).toFixed(2)} waiting at the counter.`,
        data: { topup_id: open.rows[0].topup_id }
      });
    }

    const charge = Number(amount.toFixed(2));
    const coins = resolveTopupCoins(charge, settings);

    const created = await client.query(
      `INSERT INTO topup_orders
         (cafe_id, customer_id, provider, mode, amount, coins, currency, status, source, customer_note)
       VALUES ($1,$2,'cash','live',$3,$4,'INR','awaiting_approval','client',$5)
       RETURNING *`,
      [cafeId, customerId, charge, coins,
       req.body?.note ? String(req.body.note).slice(0, 255) : null]
    );

    res.status(201).json({
      success: true,
      message: 'Take the cash to the counter',
      data: shapeTopup(created.rows[0])
    });
  } catch (error) {
    console.error('Error requesting cash top-up:', error);
    res.status(500).json({ success: false, message: 'Error creating the request' });
  } finally {
    client.release();
  }
};

// POST /api/payments/topups/:id/approve
export const approveCashTopup = async (req, res) => {
  const client = await pool.connect();
  try {
    const topupId = Number(req.params.id);
    if (!Number.isInteger(topupId)) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const found = await client.query('SELECT * FROM topup_orders WHERE topup_id = $1', [topupId]);
    const order = found.rows[0];
    if (!order) return res.status(404).json({ success: false, message: 'Request not found' });

    /* Only a cash request can be approved by hand. A gateway top-up is
       credited by a verified signature, and letting staff wave one through
       would make the whole verification path optional. */
    if (order.provider !== 'cash') {
      return res.status(400).json({
        success: false,
        message: 'Only cash requests are approved by hand; card payments are confirmed by the provider'
      });
    }
    if (order.status !== 'awaiting_approval') {
      return res.status(409).json({
        success: false,
        message: order.status === 'credited'
          ? 'This request was already approved'
          : `This request is ${order.status}`
      });
    }

    // A café's staff may only approve their own café's requests.
    const actorCafe = req.actor?.cafe_id ?? null;
    if (actorCafe != null && order.cafe_id != null && Number(actorCafe) !== Number(order.cafe_id)) {
      return res.status(403).json({ success: false, message: 'This request belongs to another café' });
    }

    await client.query('BEGIN');
    const result = await creditTopup(client, {
      order,
      paymentId: `cash_${order.topup_id}`,
      // Cash has no third party to disagree about the figure.
      confirmedAmount: null
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      await markTopupFailed(client, order.topup_id, result.recordFailure);
      return res.status(409).json({ success: false, message: result.reason });
    }

    await client.query(
      `UPDATE topup_orders
       SET approved_by = $2, approved_at = CURRENT_TIMESTAMP
       WHERE topup_id = $1`,
      [order.topup_id, req.actor?.label || 'staff']
    );
    await client.query('COMMIT');

    // Cash crossing a counter with no card trail is exactly what an audit log
    // is for.
    await recordAudit(req, {
      action: 'payments.topup.approve',
      category: 'wallet',
      entity: 'topup',
      entity_id: order.topup_id,
      amount: Number(order.amount),
      sensitive: true,
      summary: `Approved a cash top-up of ${Number(order.amount).toFixed(2)} for customer ${order.customer_id}`,
      meta: { coins: Number(order.coins), balance_after: result.balance }
    });

    res.json({
      success: true,
      message: `${Number(order.coins).toFixed(2)} coins added`,
      data: { topup_id: order.topup_id, coins: Number(order.coins), balance: result.balance }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error approving cash top-up:', error);
    res.status(500).json({ success: false, message: 'Error approving the request' });
  } finally {
    client.release();
  }
};

// POST /api/payments/topups/:id/reject
export const rejectCashTopup = async (req, res) => {
  const client = await pool.connect();
  try {
    const topupId = Number(req.params.id);
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : 'Declined at the counter';

    const { rows } = await client.query(
      `UPDATE topup_orders
       SET status = 'rejected', failure_reason = $2,
           approved_by = $3, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE topup_id = $1 AND provider = 'cash' AND status = 'awaiting_approval'
       RETURNING *`,
      [topupId, reason, req.actor?.label || 'staff']
    );
    if (rows.length === 0) {
      return res.status(409).json({ success: false, message: 'That request is no longer waiting' });
    }

    await recordAudit(req, {
      action: 'payments.topup.reject',
      category: 'wallet',
      entity: 'topup',
      entity_id: topupId,
      amount: Number(rows[0].amount),
      summary: `Rejected a cash top-up of ${Number(rows[0].amount).toFixed(2)} — ${reason}`,
      meta: { reason }
    });

    res.json({ success: true, message: 'Request declined', data: shapeTopup(rows[0]) });
  } catch (error) {
    console.error('Error rejecting cash top-up:', error);
    res.status(500).json({ success: false, message: 'Error declining the request' });
  } finally {
    client.release();
  }
};

// GET /api/payments/topups/pending
export const listPendingTopups = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = await resolveCafeId(client, req.actor);
    const { rows } = await client.query(
      `SELECT t.*, c.customer_name,
              w.balance AS current_balance
       FROM topup_orders t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
       LEFT JOIN wallets w ON w.customer_id = t.customer_id
       WHERE t.status = 'awaiting_approval'
         AND (t.cafe_id = $1 OR ($1::int IS NULL AND t.cafe_id IS NULL))
       ORDER BY t.created_at ASC`,
      [cafeId]
    );

    res.json({
      success: true,
      data: rows.map((row) => ({
        ...shapeTopup(row),
        customer_note: row.customer_note,
        // Shown next to the request so staff can see what they are adding to.
        current_balance: row.current_balance != null ? Number(row.current_balance) : null
      }))
    });
  } catch (error) {
    console.error('Error listing pending top-ups:', error);
    res.status(500).json({ success: false, message: 'Error loading requests' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   HOSTED CHECKOUT

   Reached from the station's payment window. Authenticated by an unguessable
   single-use nonce in the path rather than a bearer token, because a JWT in a
   URL leaks into logs, history and referrers.
   ========================================================================== */

const loadByNonce = async (client, nonce) => {
  if (!nonce || !/^[A-Za-z0-9_-]{20,64}$/.test(nonce)) return null;
  const { rows } = await client.query(
    `SELECT * FROM topup_orders
     WHERE checkout_nonce = $1
       AND checkout_expires_at > CURRENT_TIMESTAMP`,
    [nonce]
  );
  return rows[0] || null;
};

// GET /api/payments/checkout/:nonce
export const renderCheckoutPage = async (req, res) => {
  const client = await pool.connect();
  try {
    const order = await loadByNonce(client, req.params.nonce);
    res.set('Content-Type', 'text/html; charset=utf-8');
    // The page loads a provider SDK and nothing else; no framing, no sniffing.
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');

    if (!order) {
      return res.status(404).send(renderMessage({
        title: 'This payment link has expired',
        message: 'Start the top-up again from your station.'
      }));
    }
    if (order.status === 'credited') {
      return res.send(renderMessage({
        title: 'Already paid',
        message: `${Number(order.coins).toFixed(2)} coins are already in your wallet.`,
        tone: 'ok'
      }));
    }

    const gateway = await loadGatewaySecrets(client, order.cafe_id, order.provider);
    if (!gateway) {
      return res.status(400).send(renderMessage({
        title: 'Payment unavailable',
        message: 'This payment method is no longer set up. Please ask the counter.'
      }));
    }

    const customer = await client.query(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE customer_id = $1`, [order.customer_id]
    );

    res.send(renderCheckout({
      order: {
        ...order,
        // Carried on the row only for the life of this render.
        session_id: order.config?.session_id || req.query.sid || null,
        form: order.config?.form || null
      },
      gateway: {
        // Publishable half only — the decrypted secret stays in this function.
        key_id: gateway.keyId,
        label: getProvider(order.provider)?.label || order.provider
      },
      customer: customer.rows[0] || { name: '', email: '', phone: '' },
      completeUrl: `/api/payments/checkout/${encodeURIComponent(req.params.nonce)}/complete`
    }));
  } catch (error) {
    console.error('Error rendering checkout:', error);
    res.status(500).set('Content-Type', 'text/html').send(renderMessage({
      title: 'Something went wrong',
      message: 'Please try again from your station.'
    }));
  } finally {
    client.release();
  }
};

// POST /api/payments/checkout/:nonce/complete
export const completeCheckout = async (req, res) => {
  const client = await pool.connect();
  try {
    const order = await loadByNonce(client, req.params.nonce);
    if (!order) return res.status(404).json({ success: false, message: 'This payment link has expired' });

    if (order.status === 'credited') {
      return res.json({
        success: true,
        message: 'Already credited',
        data: { status: 'credited', coins: Number(order.coins) }
      });
    }

    const provider = getProvider(order.provider);
    const gateway = await loadGatewaySecrets(client, order.cafe_id, order.provider);
    if (!provider || !gateway) {
      return res.status(400).json({ success: false, message: 'This payment method is no longer available' });
    }

    /* The page's payload is evidence, not a verdict. Whatever it claims, the
       signature is recomputed here from the café's own secret. */
    const verdict = await provider.verifyReturn({
      keyId: gateway.keyId,
      keySecret: gateway.keySecret,
      mode: gateway.mode,
      order,
      payload: req.body?.payload || {}
    });

    if (!verdict.ok) {
      return res.status(400).json({ success: false, message: verdict.reason });
    }

    await client.query('BEGIN');
    const result = await creditTopup(client, {
      order,
      paymentId: verdict.paymentId,
      confirmedAmount: verdict.amount ?? null
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      await markTopupFailed(client, order.topup_id, result.recordFailure);
      return res.status(409).json({ success: false, message: result.reason });
    }

    // The nonce is spent. Replaying this URL now finds nothing.
    await client.query(
      'UPDATE topup_orders SET checkout_nonce = NULL WHERE topup_id = $1', [order.topup_id]
    );
    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Coins added',
      data: {
        status: 'credited',
        coins: Number(order.coins),
        balance: result.balance
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error completing checkout:', error);
    res.status(500).json({ success: false, message: 'Error confirming the payment' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   WEBHOOK

   The authoritative path. A customer whose browser died mid-payment still
   gets their coins, because the provider tells the server directly.
   ========================================================================== */
export const handleWebhook = async (req, res) => {
  const client = await pool.connect();
  try {
    const providerId = String(req.params.provider || '').toLowerCase();
    const provider = getProvider(providerId);
    if (!provider) return res.status(404).json({ success: false });

    // express.raw leaves a Buffer; anything else means the route is misconfigured
    // and the signature could not be trusted anyway.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

    /*
     * The webhook arrives with no session, so the café is unknown until the
     * order is found — but the signature must be checked before trusting any
     * field in the body. Resolved by verifying against each configured
     * gateway for this provider: exactly one holds the secret that produced
     * this signature, and a forged body matches none of them.
     */
    const candidates = await client.query(
      `SELECT * FROM payment_gateways WHERE provider = $1 AND is_enabled = TRUE`,
      [providerId]
    );

    let parsed = null;
    for (const row of candidates.rows) {
      const webhookSecret = decryptSecret(row.webhook_secret_enc);
      const keySecret = decryptSecret(row.key_secret_enc);
      if (!webhookSecret && !keySecret) continue;

      const verdict = provider.verifyWebhook({
        webhookSecret: webhookSecret || keySecret,
        keySecret,
        rawBody,
        headers: req.headers
      });
      if (verdict.ok) { parsed = verdict; break; }
    }

    if (!parsed) {
      // Deliberately terse. A detailed rejection is a free oracle for anyone
      // probing the endpoint with guessed signatures.
      console.warn(`[payments] rejected ${providerId} webhook: no matching signature`);
      return res.status(401).json({ success: false });
    }

    if (!parsed.captured) {
      if (parsed.failed && parsed.orderId) {
        await client.query(
          `UPDATE topup_orders SET status = 'failed', failure_reason = 'Payment failed at the gateway',
                 updated_at = CURRENT_TIMESTAMP
           WHERE provider = $1 AND provider_order_id = $2 AND status NOT IN ('credited')`,
          [providerId, parsed.orderId]
        );
      }
      // 200 regardless: the event was understood. A non-2xx makes the provider
      // retry an event we have already handled correctly.
      return res.json({ success: true });
    }

    const found = await client.query(
      `SELECT * FROM topup_orders WHERE provider = $1 AND provider_order_id = $2`,
      [providerId, parsed.orderId]
    );
    const order = found.rows[0];
    if (!order) {
      console.warn(`[payments] ${providerId} webhook for unknown order ${parsed.orderId}`);
      return res.json({ success: true });
    }

    await client.query('BEGIN');
    const result = await creditTopup(client, {
      order,
      paymentId: parsed.paymentId,
      confirmedAmount: parsed.amount
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      await markTopupFailed(client, order.topup_id, result.recordFailure);
      // A mismatch is the interesting case: the signature was genuine but the
      // figures were not, which is worth a loud line in the log.
      console.warn(`[payments] webhook could not credit top-up ${order.topup_id}: ${result.reason}`);
      return res.json({ success: true });
    }
    await client.query('COMMIT');

    console.log(`[payments] credited top-up ${order.topup_id} via ${providerId} webhook`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Webhook error:', error);
    // Non-2xx so the provider retries — the payment is real and must land.
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }
};
