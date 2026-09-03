/*
 * ManagerXP's own payment gateway, and the payment links it issues.
 *
 * The merchant account here is the vendor's, not a café's. It lives in the
 * same `payment_gateways` table as every café's credentials, distinguished by
 * having no café attached — which is how `platformGateway()` has always found
 * it, and why this file never touches a row with a cafe_id.
 *
 * Secrets are written but never read back. The API returns a masked tail so an
 * operator can confirm which key is installed without the value ever leaving
 * the database in the clear. That asymmetry is deliberate and is the reason
 * there is no "show secret" endpoint to add later.
 */
import crypto from 'crypto';
import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import { listProviders, getProvider } from '../modules/payments/payments.providers.js';
import { encryptSecret, decryptSecret } from '../modules/payments/payments.crypto.js';
import { sendMail, mailConfigured, invoicePaymentLinkEmail } from '../modules/mail/mailer.js';

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Last four characters only — enough to identify a key, useless to steal. */
const mask = (value) => {
  if (!value) return null;
  const s = String(value);
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
};

/* ==========================================================================
   GATEWAY CONFIGURATION
   ========================================================================== */

/** GET /api/admin/gateways */
export const listGateways = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT gateway_id, provider, display_name, is_enabled, mode, key_id,
             (key_secret_enc IS NOT NULL) AS has_secret,
             (webhook_secret_enc IS NOT NULL) AS has_webhook_secret,
             last_verified_at, last_error, updated_at
      FROM payment_gateways WHERE cafe_id IS NULL ORDER BY provider
    `);

    const configured = new Map(rows.map((r) => [r.provider, r]));

    /* Every provider the code can talk to, whether or not it is set up, so
       the console offers the full choice rather than only what exists. */
    const providers = listProviders().map((p) => {
      const row = configured.get(p.id);
      return {
        provider: p.id,
        label: p.label,
        fields: p.fields,
        currencies: p.currencies,
        docs: p.docs,
        configured: !!row,
        gateway_id: row?.gateway_id || null,
        is_enabled: row?.is_enabled || false,
        mode: row?.mode || 'test',
        key_id: row?.key_id || null,
        key_secret_masked: row?.has_secret ? '••••••••' : null,
        has_webhook_secret: row?.has_webhook_secret || false,
        last_verified_at: row?.last_verified_at || null,
        last_error: row?.last_error || null
      };
    });

    res.json({
      success: true,
      data: {
        providers,
        /* Only one platform gateway may be enabled at a time — the payer is
           sent to whichever is live, and two would make that a coin toss. */
        active: providers.find((p) => p.is_enabled)?.provider || null,
        mail_configured: await mailConfigured(),
        pay_base_url: await getSetting('platform.pay_base_url', '')
      }
    });
  } catch (error) {
    console.error('Gateway list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load payment gateways' });
  }
};

/** PUT /api/admin/gateways/:provider */
export const saveGateway = async (req, res) => {
  const client = await pool.connect();
  try {
    const provider = String(req.params.provider).toLowerCase();
    if (!getProvider(provider)) {
      return res.status(400).json({ success: false, message: 'Unknown payment provider' });
    }

    const mode = req.body?.mode === 'live' ? 'live' : 'test';
    const enable = req.body?.is_enabled === true;
    const keyId = req.body?.key_id !== undefined ? String(req.body.key_id).trim() : undefined;

    const existing = (await client.query(
      'SELECT * FROM payment_gateways WHERE cafe_id IS NULL AND provider = $1', [provider])).rows[0];

    /* A blank secret means "leave the stored one alone", not "erase it".
       Re-saving a form that shows a masked value must not silently wipe the
       key, which is the commonest way a working gateway gets broken. */
    const secret = req.body?.key_secret ? String(req.body.key_secret) : null;
    const webhookSecret = req.body?.webhook_secret ? String(req.body.webhook_secret) : null;

    if (!existing && !secret) {
      return res.status(400).json({ success: false, message: 'A key secret is required to set this up' });
    }

    await client.query('BEGIN');

    let row;
    if (existing) {
      row = (await client.query(`
        UPDATE payment_gateways
        SET mode = $2, is_enabled = $3,
            key_id = COALESCE($4, key_id),
            key_secret_enc = COALESCE($5, key_secret_enc),
            webhook_secret_enc = COALESCE($6, webhook_secret_enc),
            display_name = COALESCE($7, display_name),
            updated_at = CURRENT_TIMESTAMP
        WHERE gateway_id = $1 RETURNING *
      `, [existing.gateway_id, mode, enable, keyId ?? null,
          secret ? encryptSecret(secret) : null,
          webhookSecret ? encryptSecret(webhookSecret) : null,
          req.body?.display_name || null])).rows[0];
    } else {
      row = (await client.query(`
        INSERT INTO payment_gateways
          (cafe_id, provider, display_name, is_enabled, mode, key_id,
           key_secret_enc, webhook_secret_enc)
        VALUES (NULL,$1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [provider, req.body?.display_name || null, enable, mode, keyId || null,
          encryptSecret(secret), webhookSecret ? encryptSecret(webhookSecret) : null])).rows[0];
    }

    /* Exactly one live gateway. Enabling this one stands the others down
       rather than leaving the choice to whichever row sorts first. */
    if (enable) {
      await client.query(`
        UPDATE payment_gateways SET is_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE cafe_id IS NULL AND gateway_id <> $1
      `, [row.gateway_id]);
    }

    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'gateway.saved', resource_type: 'gateway', resource_id: row.gateway_id,
      /* The secret itself is never in the audit trail — only that it changed. */
      new_value: { provider, mode, enabled: enable, secret_changed: !!secret }
    });

    res.json({
      success: true,
      message: enable ? `${provider} is now the live gateway` : `${provider} saved`,
      data: { gateway_id: row.gateway_id, provider, mode, is_enabled: row.is_enabled,
              key_id: row.key_id, key_secret_masked: mask(secret) }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Gateway save failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that gateway' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/gateways/:provider/verify
 *
 * Proves the credentials work by creating a real order of the smallest
 * permitted amount and never capturing it. A "saved" gateway that has never
 * spoken to the provider is a customer-facing failure waiting for the worst
 * possible moment.
 */
export const verifyGateway = async (req, res) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const row = (await pool.query(
      'SELECT * FROM payment_gateways WHERE cafe_id IS NULL AND provider = $1', [provider])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'That gateway is not set up' });

    const impl = getProvider(provider);
    let ok = false;
    let detail = '';
    try {
      const order = await impl.createOrder({
        keyId: row.key_id,
        keySecret: decryptSecret(row.key_secret_enc),
        mode: row.mode,
        amount: 1,
        currency: 'INR',
        receipt: `verify-${Date.now()}`,
        notes: { purpose: 'credential check' }
      });
      ok = !!order && !order.error;
      detail = ok ? 'Credentials accepted' : (order?.error || 'The provider refused the request');
    } catch (e) {
      detail = e.message;
    }

    await pool.query(`
      UPDATE payment_gateways
      SET last_verified_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_verified_at END,
          last_error = CASE WHEN $2 THEN NULL ELSE $3 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE gateway_id = $1
    `, [row.gateway_id, ok, String(detail).slice(0, 255)]);

    await recordAdminAudit(req, {
      action: 'gateway.verified', resource_type: 'gateway', resource_id: row.gateway_id,
      new_value: { provider, ok, detail }
    });

    res.status(ok ? 200 : 400).json({ success: ok, message: detail });
  } catch (error) {
    console.error('Gateway verify failed:', error);
    res.status(500).json({ success: false, message: 'Could not check those credentials' });
  }
};

/* ==========================================================================
   PAYMENT LINKS
   ========================================================================== */

/**
 * POST /api/admin/invoices/:id/payment-link   { send_email, email }
 *
 * Raises a link for exactly the invoice's outstanding balance and, when asked,
 * emails it. The amount is taken from the invoice, never from the request — a
 * link is a demand for money and the figure on it must not be something a
 * browser could set.
 */
export const createInvoicePaymentLink = async (req, res) => {
  const client = await pool.connect();
  try {
    const invoiceId = Number(req.params.id);
    const invoice = (await client.query(`
      SELECT i.*, o.name AS organization_name, o.email AS organization_email
      FROM subscription_invoices i
      LEFT JOIN organizations o ON o.organization_id = i.organization_id
      WHERE i.invoice_id = $1
    `, [invoiceId])).rows[0];
    if (!invoice) return res.status(404).json({ success: false, message: 'Not found' });
    if (invoice.status === 'VOID') {
      return res.status(409).json({ success: false, message: 'That invoice has been voided' });
    }

    const outstanding = money(Number(invoice.total) - Number(invoice.amount_paid));
    if (outstanding <= 0) {
      return res.status(409).json({
        success: false,
        message: `${invoice.invoice_no} is already settled — there is nothing to collect.`
      });
    }

    /* Reuse an open link for the same invoice and amount rather than issuing a
       second one. Two live links for one invoice is how an invoice gets paid
       twice. */
    const open = (await client.query(`
      SELECT * FROM payment_links
      WHERE invoice_id = $1 AND status = 'open'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY link_id DESC LIMIT 1
    `, [invoiceId])).rows[0];

    let link = open;
    if (!link || money(link.amount) !== outstanding) {
      if (link) {
        /* The balance moved since the link was made — a part payment arrived.
           The stale link is cancelled rather than left open for the old,
           now-wrong amount. */
        await client.query(
          `UPDATE payment_links SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
           WHERE link_id = $1`, [link.link_id]);
      }
      const days = Number(await getSetting('platform.link_expiry_days', 14));
      link = (await client.query(`
        INSERT INTO payment_links
          (token, cafe_id, subscription_id, invoice_id, organization_id,
           customer_name, customer_email, purpose, description, amount, currency,
           status, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'subscription',$8,$9,$10,'open',
                NOW() + ($11::int || ' days')::interval)
        RETURNING *
      `, [crypto.randomBytes(24).toString('hex'), invoice.cafe_id, invoice.subscription_id,
          invoiceId, invoice.organization_id, invoice.organization_name,
          invoice.organization_email, `Invoice ${invoice.invoice_no}`,
          outstanding, invoice.currency, days])).rows[0];
    }

    const base = String(await getSetting('platform.pay_base_url', '')).replace(/\/$/, '');
    const url = `${base}/pay/${link.token}`;

    let mail = null;
    if (req.body?.send_email !== false) {
      const to = String(req.body?.email || invoice.organization_email || '').trim();
      if (!to) {
        mail = { sent: false, reason: 'no_address',
                 message: 'This customer has no email address on file, so nothing was sent.' };
      } else {
        const tpl = invoicePaymentLinkEmail({
          invoice, link, url, organizationName: invoice.organization_name
        });
        mail = await sendMail({
          to, toName: invoice.organization_name, ...tpl,
          kind: 'invoice_link', relatedType: 'invoice', relatedId: String(invoiceId),
          organizationId: invoice.organization_id
        });
      }
    }

    await recordAdminAudit(req, {
      action: 'invoice.payment_link', resource_type: 'invoice', resource_id: invoiceId,
      organization_id: invoice.organization_id,
      new_value: { invoice_no: invoice.invoice_no, amount: outstanding,
                   emailed: mail?.sent === true, to: req.body?.email || invoice.organization_email }
    });

    res.status(201).json({
      success: true,
      /* The link is always returned, even when the email went. If the message
         is filtered or the address is stale, the operator still has something
         to paste into a chat window. */
      message: mail
        ? (mail.sent ? mail.message : `Link created. ${mail.message}`)
        : 'Payment link created',
      data: {
        url, token: link.token, amount: outstanding, currency: link.currency,
        expires_at: link.expires_at, email: mail
      }
    });
  } catch (error) {
    console.error('Payment link creation failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that payment link' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   STANDALONE PAYMENT LINKS

   Not every payment answers an invoice. A renewal quoted over the phone, a
   deposit from a prospect who is not set up yet, an upgrade agreed mid-cycle —
   all of these are a bill before there is anything to bill against.

   The old console could raise these but never send them; the admin copied a
   URL out of a table. These do the whole job.
   ========================================================================== */

const linkUrl = async (token) => {
  const base = String(await getSetting('platform.pay_base_url', '')).replace(/\/$/, '');
  return `${base}/pay/${token}`;
};

/** Build and optionally send the email for a link. Never throws. */
const deliver = async (link, { to, invoice = null, organizationName }) => {
  if (!to) {
    return { sent: false, reason: 'no_address',
             message: 'No email address, so nothing was sent. Copy the link to the customer.' };
  }
  const url = await linkUrl(link.token);
  const tpl = invoicePaymentLinkEmail({ invoice, link, url, organizationName });
  return sendMail({
    to, toName: organizationName, ...tpl,
    kind: invoice ? 'invoice_link' : 'payment_link',
    relatedType: 'payment_link', relatedId: String(link.link_id),
    organizationId: link.organization_id || null
  });
};

/** GET /api/admin/payment-links?status=&organization_id= */
export const listPaymentLinks = async (req, res) => {
  try {
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];

    if (req.query.status) {
      params.push(String(req.query.status).toLowerCase());
      where.push(`l.status = $${params.length}`);
    }
    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`l.organization_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(o.name,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(l.customer_email,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(l.description,'')) LIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(size);

    const { rows } = await pool.query(`
      SELECT l.link_id, l.token, l.amount, l.currency, l.status, l.purpose,
             l.description, l.customer_name, l.customer_email, l.expires_at,
             l.paid_at, l.created_at, l.last_sent_at, l.send_count,
             l.organization_id, o.name AS organization_name,
             l.invoice_id, i.invoice_no,
             au.email AS created_by_email,
             (l.status = 'open' AND (l.expires_at IS NULL OR l.expires_at > NOW())) AS payable
      FROM payment_links l
      LEFT JOIN organizations o ON o.organization_id = l.organization_id
      LEFT JOIN subscription_invoices i ON i.invoice_id = l.invoice_id
      LEFT JOIN admin_users au ON au.admin_user_id = l.created_by_admin
      ${clause}
      ORDER BY l.created_at DESC LIMIT $${params.length}
    `, params);

    const base = String(await getSetting('platform.pay_base_url', '')).replace(/\/$/, '');
    res.json({
      success: true,
      data: {
        items: rows.map((r) => ({ ...r, url: `${base}/pay/${r.token}` })),
        mail_configured: await mailConfigured()
      }
    });
  } catch (error) {
    console.error('Payment link list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load payment links' });
  }
};

/**
 * POST /api/admin/payment-links
 *
 * { organization_id?, plan_id?, amount?, currency?, purpose, description,
 *   customer_email?, expires_in_days?, send_email }
 *
 * A plan's price and entitlements are COPIED onto the link, never referenced.
 * A link is a quote the customer may pay days later; if the price list moved in
 * between they must still get what they were quoted, and must not be charged a
 * figure they never saw.
 */
export const createStandaloneLink = async (req, res) => {
  const client = await pool.connect();
  try {
    const orgId = req.body?.organization_id ? Number(req.body.organization_id) : null;

    let organization = null;
    let cafeId = null;
    if (orgId) {
      organization = (await client.query(`
        SELECT o.*, (SELECT cafe_id FROM cafes WHERE organization_id = o.organization_id
                     ORDER BY cafe_id LIMIT 1) AS cafe_id
        FROM organizations o WHERE o.organization_id = $1
      `, [orgId])).rows[0];
      if (!organization) return res.status(404).json({ success: false, message: 'No such customer' });
      cafeId = organization.cafe_id;
    }

    let amount = Number(req.body?.amount);
    let currency = req.body?.currency || organization?.currency || 'INR';
    let grantsDays = req.body?.grants_days ? Number(req.body.grants_days) : null;
    let grantsMaxPcs = null;
    let plan = null;

    if (req.body?.plan_id) {
      plan = (await client.query(
        'SELECT * FROM subscription_plans WHERE sub_id = $1', [Number(req.body.plan_id)])).rows[0];
      if (!plan) return res.status(404).json({ success: false, message: 'No such package' });

      if (!Number.isFinite(amount) || amount <= 0) {
        /* The cycle price if one is configured, else the headline. Read once,
           here, and written onto the link. */
        const period = req.body?.billing_period || 'monthly';
        const priced = (await client.query(`
          SELECT price FROM plan_prices WHERE plan_id = $1 AND billing_period = $2 AND is_active
          ORDER BY plan_price_id LIMIT 1
        `, [plan.sub_id, period])).rows[0];
        amount = money(priced ? priced.price : plan.price);
      }
      currency = plan.currency || currency;
      if (!grantsDays) grantsDays = Number(plan.no_of_days) || 30;
      grantsMaxPcs = plan.max_pcs;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter an amount, or choose a package' });
    }

    const to = String(
      req.body?.customer_email || organization?.email || ''
    ).trim() || null;

    const days = Number(req.body?.expires_in_days) > 0 ? Number(req.body.expires_in_days)
      : Number(await getSetting('platform.link_expiry_days', 14));

    const purpose = ['subscription', 'renewal', 'upgrade', 'addon', 'other']
      .includes(req.body?.purpose) ? req.body.purpose : 'subscription';

    const link = (await client.query(`
      INSERT INTO payment_links
        (token, cafe_id, organization_id, sub_id, customer_name, customer_email,
         purpose, description, amount, currency, grants_days, grants_max_pcs,
         created_by_admin, status, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',
              NOW() + ($14::int || ' days')::interval)
      RETURNING *
    `, [crypto.randomBytes(24).toString('hex'), cafeId, orgId, plan?.sub_id || null,
        organization?.name || req.body?.customer_name || null, to, purpose,
        req.body?.description ? String(req.body.description).slice(0, 255)
          : (plan ? `${plan.name} — ${grantsDays} days` : null),
        money(amount), currency, grantsDays, grantsMaxPcs,
        req.admin?.admin_user_id || null, days])).rows[0];

    let mail = null;
    if (req.body?.send_email !== false) {
      mail = await deliver(link, { to, organizationName: organization?.name });
      if (mail.sent) {
        await client.query(`
          UPDATE payment_links SET last_sent_at = CURRENT_TIMESTAMP, send_count = send_count + 1
          WHERE link_id = $1
        `, [link.link_id]);
      }
    }

    await recordAdminAudit(req, {
      action: 'paylink.created', resource_type: 'payment_link', resource_id: link.link_id,
      organization_id: orgId,
      new_value: { amount: money(amount), currency, purpose, emailed: mail?.sent === true, to }
    });

    res.status(201).json({
      success: true,
      message: mail
        ? (mail.sent ? `Payment link sent to ${to}` : `Link created. ${mail.message}`)
        : 'Payment link created',
      data: {
        link_id: link.link_id, token: link.token, url: await linkUrl(link.token),
        amount: money(amount), currency, expires_at: link.expires_at, email: mail
      }
    });
  } catch (error) {
    console.error('Payment link creation failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that payment link' });
  } finally {
    client.release();
  }
};

/** POST /api/admin/payment-links/:id/send   { email? } */
export const sendPaymentLink = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const link = (await pool.query(`
      SELECT l.*, o.name AS organization_name, i.invoice_no, i.period_start, i.period_end, i.due_date
      FROM payment_links l
      LEFT JOIN organizations o ON o.organization_id = l.organization_id
      LEFT JOIN subscription_invoices i ON i.invoice_id = l.invoice_id
      WHERE l.link_id = $1
    `, [id])).rows[0];
    if (!link) return res.status(404).json({ success: false, message: 'Not found' });

    /* Refusing to resend a dead link matters more than it looks: the customer
       would click it, be told it is expired, and reasonably conclude the
       business is a mess. */
    if (link.status !== 'open') {
      return res.status(409).json({
        success: false,
        message: `This link is ${link.status} — it cannot be paid, so sending it would only confuse the customer.`
      });
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(409).json({
        success: false,
        message: 'This link has expired. Create a new one instead.'
      });
    }

    const to = String(req.body?.email || link.customer_email || '').trim();
    const mail = await deliver(link, {
      to,
      invoice: link.invoice_no
        ? { invoice_no: link.invoice_no, period_start: link.period_start,
            period_end: link.period_end, due_date: link.due_date }
        : null,
      organizationName: link.organization_name || link.customer_name
    });

    if (mail.sent) {
      await pool.query(`
        UPDATE payment_links SET last_sent_at = CURRENT_TIMESTAMP, send_count = send_count + 1,
               customer_email = COALESCE($2, customer_email)
        WHERE link_id = $1
      `, [id, to || null]);
    }

    await recordAdminAudit(req, {
      action: 'paylink.sent', resource_type: 'payment_link', resource_id: id,
      organization_id: link.organization_id,
      new_value: { to, sent: mail.sent, attempt: (link.send_count || 0) + 1 }
    });

    res.status(mail.sent ? 200 : 202).json({
      success: true,
      message: mail.message,
      data: { url: await linkUrl(link.token), email: mail }
    });
  } catch (error) {
    console.error('Payment link send failed:', error);
    res.status(500).json({ success: false, message: 'Could not send that link' });
  }
};

/** POST /api/admin/payment-links/:id/cancel   { reason } */
export const cancelPaymentLink = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const before = (await pool.query('SELECT * FROM payment_links WHERE link_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (before.status === 'paid') {
      return res.status(409).json({
        success: false,
        message: 'This link has already been paid. Refund the payment instead of cancelling the link.'
      });
    }

    /* Cancelled, not deleted — a link that was sent to a customer is part of
       the record of what they were asked for. */
    const row = (await pool.query(`
      UPDATE payment_links SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE link_id = $1 AND status <> 'paid' RETURNING *
    `, [id])).rows[0];

    await recordAdminAudit(req, {
      action: 'paylink.cancelled', resource_type: 'payment_link', resource_id: id,
      organization_id: before.organization_id,
      old_value: { status: before.status, amount: before.amount },
      new_value: { status: 'cancelled', reason: req.body?.reason || null }
    });

    res.json({ success: true, message: 'Link cancelled — it can no longer be paid', data: row });
  } catch (error) {
    console.error('Payment link cancel failed:', error);
    res.status(500).json({ success: false, message: 'Could not cancel that link' });
  }
};

/** GET /api/admin/email-outbox — what was sent, and what could not be. */
export const listOutbox = async (req, res) => {
  try {
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where.push(`e.status = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(size);

    const { rows } = await pool.query(`
      SELECT e.outbox_id, e.to_email, e.to_name, e.subject, e.kind, e.status,
             e.error, e.sent_at, e.created_at, o.name AS organization_name
      FROM email_outbox e
      LEFT JOIN organizations o ON o.organization_id = e.organization_id
      ${clause}
      ORDER BY e.created_at DESC LIMIT $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, mail_configured: await mailConfigured() } });
  } catch (error) {
    console.error('Outbox list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the email log' });
  }
};
