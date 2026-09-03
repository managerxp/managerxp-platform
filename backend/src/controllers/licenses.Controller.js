/*
 * Licence keys.
 *
 * A subscription says a customer has paid. A licence key is what lets a
 * specific machine run the software. They are deliberately separate: one
 * customer may run several branches on one subscription, and a key needs
 * reissuing when a PC dies without anyone touching what they have paid for.
 *
 * The activation endpoint is the only part of this file a café install talks
 * to, and it is unauthenticated by necessity — the install has no account yet,
 * that is the whole point of activating. So it is written defensively: it
 * confirms nothing it does not have to, logs every attempt, and treats the key
 * itself as the only credential.
 */
import crypto from 'crypto';
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/* ==========================================================================
   KEY GENERATION
   ========================================================================== */

/*
 * Crockford's base32: no I, L, O or U. Someone will read one of these down a
 * phone line or copy it off a printed invoice, and 0/O and 1/I/L are where
 * that goes wrong. Dropping U also avoids accidental obscenities in a random
 * string, which matters when the string is printed on a customer's licence.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PREFIX = { cafexp: 'CXP', racexp: 'RXP' };

/**
 * A key looks like CXP-4K7M-9QW2-XR5T-8HND.
 *
 * The prefix says which product at a glance, so support does not have to look
 * it up. The rest is 16 random characters drawn with rejection sampling —
 * `% ALPHABET.length` on a random byte would make the first 8 symbols slightly
 * likelier than the rest, and a licence key is exactly the kind of thing that
 * should not have a bias anyone can exploit.
 */
const generateKey = (product = 'cafexp') => {
  const chars = [];
  while (chars.length < 16) {
    for (const byte of crypto.randomBytes(32)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;   // reject the skewed tail
      chars.push(ALPHABET[byte % ALPHABET.length]);
      if (chars.length === 16) break;
    }
  }
  const groups = chars.join('').match(/.{4}/g);
  return `${PREFIX[product] || 'CXP'}-${groups.join('-')}`;
};

/** Accept a key however the customer typed it: spaces, case, missing dashes. */
const normaliseKey = (input) => {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length < 10) return null;
  const prefix = raw.slice(0, 3);
  const body = raw.slice(3);
  if (body.length !== 16) return null;
  return `${prefix}-${body.match(/.{4}/g).join('-')}`;
};

const shapeLicense = (row) => ({
  license_id: row.license_id,
  license_key: row.license_key,
  product: row.product,
  cafe_id: row.cafe_id,
  cafe_name: row.cafe_name || null,
  subscription_id: row.subscription_id,
  max_pcs: row.max_pcs,
  max_branches: row.max_branches,
  status: row.status,
  machine_id: row.machine_id,
  machine_label: row.machine_label,
  activated_at: row.activated_at,
  last_seen_at: row.last_seen_at,
  activation_count: row.activation_count,
  expires_at: row.expires_at,
  revoked_reason: row.revoked_reason,
  notes: row.notes,
  created_at: row.created_at,
  days_remaining: row.expires_at
    ? Math.ceil((new Date(row.expires_at) - Date.now()) / 86400000)
    : null
});

/* ==========================================================================
   ADMIN
   ========================================================================== */

// GET /api/platform/licenses
export const listLicenses = async (req, res) => {
  const client = await pool.connect();
  try {
    /* Expiry is a fact about the clock, not an event anyone fires. Applied on
       read so a lapsed key never shows as active. */
    await client.query(`
      UPDATE license_keys SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('issued','active') AND expires_at IS NOT NULL AND expires_at < NOW()
    `);

    const { rows } = await client.query(`
      SELECT l.*, c.name AS cafe_name
      FROM license_keys l
      LEFT JOIN cafes c ON c.cafe_id = l.cafe_id
      ORDER BY l.created_at DESC
      LIMIT 500
    `);

    res.json({ success: true, data: rows.map(shapeLicense) });
  } catch (error) {
    console.error('Error listing licences:', error);
    res.status(500).json({ success: false, message: 'Error loading licences' });
  } finally {
    client.release();
  }
};

/**
 * Issue a key.
 *
 * Exported so the onboarding flow can call it inside its own transaction
 * rather than going back out through HTTP.
 */
export const issueLicense = async (client, {
  cafeId, subscriptionId, product = 'cafexp', maxPcs, maxBranches, expiresAt, notes, issuedBy
}) => {
  /* Collisions are vanishingly unlikely at 32^16, but "vanishingly unlikely"
     is not "impossible" and the failure would be a customer unable to
     activate. Retrying costs nothing. */
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateKey(product);
    try {
      const { rows } = await client.query(`
        INSERT INTO license_keys
          (license_key, product, cafe_id, subscription_id, max_pcs, max_branches,
           expires_at, notes, issued_by, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'issued')
        RETURNING *
      `, [key, product, cafeId || null, subscriptionId || null, maxPcs || null,
          maxBranches || null, expiresAt || null, notes || null, issuedBy || null]);
      return rows[0];
    } catch (err) {
      if (err.code !== '23505') throw err;   // not a uniqueness clash
    }
  }
  throw new Error('Could not generate a unique licence key');
};

// POST /api/platform/licenses
export const createLicense = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = req.body?.cafe_id ? Number(req.body.cafe_id) : null;
    const product = ['cafexp', 'racexp'].includes(req.body?.product) ? req.body.product : 'cafexp';

    let maxPcs = req.body?.max_pcs ? Number(req.body.max_pcs) : null;
    let maxBranches = req.body?.max_branches ? Number(req.body.max_branches) : null;
    let expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
    let subscriptionId = req.body?.subscription_id ? Number(req.body.subscription_id) : null;

    /* Default the entitlements to the café's live subscription. A key issued
       with limits that disagree with what the customer bought is a support
       call waiting to happen. */
    if (cafeId && (!maxPcs || !expiresAt)) {
      const sub = (await client.query(`
        SELECT s.*, p.max_branches
        FROM subscriptions s
        LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
        WHERE s.cafe_id = $1 AND s.is_active AND s.end_date > NOW()
        ORDER BY s.end_date DESC LIMIT 1
      `, [cafeId])).rows[0];

      if (sub) {
        subscriptionId = subscriptionId || sub.subscription_id;
        maxPcs = maxPcs || sub.max_pcs;
        maxBranches = maxBranches || sub.max_branches;
        expiresAt = expiresAt || sub.end_date;
      }
    }

    const license = await issueLicense(client, {
      cafeId, subscriptionId, product, maxPcs, maxBranches, expiresAt,
      notes: req.body?.notes, issuedBy: req.actor?.id
    });

    await recordAudit(req, {
      action: 'platform.license.issue',
      category: 'system',
      entity: 'license',
      entity_id: license.license_id,
      sensitive: true,
      summary: `Issued ${product} licence ${license.license_key}` +
        (cafeId ? ` to café ${cafeId}` : ''),
      meta: { product, max_pcs: maxPcs, expires_at: expiresAt }
    });

    res.status(201).json({
      success: true,
      message: 'Licence key issued',
      data: shapeLicense(license)
    });
  } catch (error) {
    console.error('Error issuing licence:', error);
    res.status(500).json({ success: false, message: 'Error issuing the licence key' });
  } finally {
    client.release();
  }
};

// POST /api/platform/licenses/:id/revoke
export const revokeLicense = async (req, res) => {
  const client = await pool.connect();
  try {
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    if (!reason) {
      // A revoked key stops a café trading. Nobody should be able to do that
      // without leaving a note saying why.
      return res.status(400).json({ success: false, message: 'Give a reason for revoking this key' });
    }

    const { rows } = await client.query(`
      UPDATE license_keys
      SET status = 'revoked', revoked_reason = $2, revoked_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE license_id = $1 AND status <> 'revoked'
      RETURNING *
    `, [Number(req.params.id), reason]);

    if (!rows.length) {
      return res.status(409).json({ success: false, message: 'That key is already revoked' });
    }

    await recordAudit(req, {
      action: 'platform.license.revoke',
      category: 'system',
      entity: 'license',
      entity_id: rows[0].license_id,
      sensitive: true,
      summary: `Revoked licence ${rows[0].license_key} — ${reason}`,
      meta: { reason }
    });

    res.json({ success: true, message: 'Licence revoked', data: shapeLicense(rows[0]) });
  } catch (error) {
    console.error('Error revoking licence:', error);
    res.status(500).json({ success: false, message: 'Error revoking the licence' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/platform/licenses/:id/unbind
 *
 * Frees a key from the machine it was activated on. The customer whose PC
 * died needs this, and without it the only options are "issue a new key" or
 * "edit the database".
 */
export const unbindLicense = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      UPDATE license_keys
      SET machine_id = NULL, machine_label = NULL, status = 'issued',
          activated_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE license_id = $1 AND status IN ('active','suspended')
      RETURNING *
    `, [Number(req.params.id)]);

    if (!rows.length) {
      return res.status(409).json({ success: false, message: 'That key is not bound to a machine' });
    }

    await recordAudit(req, {
      action: 'platform.license.unbind',
      category: 'system',
      entity: 'license',
      entity_id: rows[0].license_id,
      sensitive: true,
      summary: `Unbound licence ${rows[0].license_key} so it can be activated again`
    });

    res.json({ success: true, message: 'Key released — it can be activated again', data: shapeLicense(rows[0]) });
  } catch (error) {
    console.error('Error unbinding licence:', error);
    res.status(500).json({ success: false, message: 'Error releasing the licence' });
  } finally {
    client.release();
  }
};

// GET /api/platform/licenses/:id/activations
export const listActivations = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT * FROM license_activations
      WHERE license_id = $1
      ORDER BY created_at DESC LIMIT 100
    `, [Number(req.params.id)]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing activations:', error);
    res.status(500).json({ success: false, message: 'Error loading activation history' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   ACTIVATION  (public — the café install calls this)
   ========================================================================== */

const logAttempt = async (client, { licenseId, key, machineId, machineLabel, ip, outcome, detail }) => {
  await client.query(`
    INSERT INTO license_activations
      (license_id, license_key, machine_id, machine_label, ip_address, outcome, detail)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [licenseId || null, key || null, machineId || null, machineLabel || null,
      ip || null, outcome, detail || null]
  ).catch((err) => console.error('[license] could not log attempt:', err.message));
};

/**
 * POST /api/licenses/activate
 *
 * Called by a fresh install with a key and a machine fingerprint.
 *
 * Every failure returns the same shape and a deliberately unhelpful message.
 * Distinguishing "no such key" from "key belongs to another machine" would
 * turn this into an oracle for guessing valid keys.
 */
export const activateLicense = async (req, res) => {
  const client = await pool.connect();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;

  try {
    const key = normaliseKey(req.body?.license_key);
    const machineId = req.body?.machine_id ? String(req.body.machine_id).slice(0, 128) : null;
    const machineLabel = req.body?.machine_label ? String(req.body.machine_label).slice(0, 160) : null;

    if (!key || !machineId) {
      await logAttempt(client, { key: req.body?.license_key, machineId, machineLabel, ip,
        outcome: 'rejected', detail: 'Malformed request' });
      return res.status(400).json({ success: false, message: 'Enter a valid licence key' });
    }

    // Serialise concurrent activations of the same key.
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT * FROM license_keys WHERE license_key = $1 FOR UPDATE', [key]);
    const license = found.rows[0];

    const refuse = async (outcome, detail, message) => {
      await client.query('ROLLBACK');
      await logAttempt(client, { licenseId: license?.license_id, key, machineId, machineLabel, ip, outcome, detail });
      return res.status(403).json({ success: false, message });
    };

    if (!license) {
      return refuse('not_found', 'No such key', 'That licence key is not valid.');
    }
    if (license.status === 'revoked') {
      return refuse('revoked', license.revoked_reason, 'That licence key is no longer valid.');
    }
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      await client.query(`UPDATE license_keys SET status = 'expired' WHERE license_id = $1`, [license.license_id]);
      return refuse('expired', 'Past expiry', 'That licence has expired. Please renew to continue.');
    }
    /* Already bound elsewhere. This is the message a customer most needs to
       understand, so it is the one exception to the vague-errors rule — but it
       still confirms nothing to someone who does not already hold the key. */
    if (license.machine_id && license.machine_id !== machineId) {
      return refuse('machine_mismatch', `bound to ${license.machine_id}`,
        'This key is already in use on another machine. Contact ManagerXP to move it.');
    }

    const isFirst = !license.machine_id;
    const { rows } = await client.query(`
      UPDATE license_keys
      SET machine_id = $2,
          machine_label = COALESCE($3, machine_label),
          status = 'active',
          activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP),
          last_seen_at = CURRENT_TIMESTAMP,
          activation_count = activation_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE license_id = $1
      RETURNING *
    `, [license.license_id, machineId, machineLabel]);

    await client.query('COMMIT');

    await logAttempt(client, {
      licenseId: license.license_id, key, machineId, machineLabel, ip,
      outcome: isFirst ? 'activated' : 'reactivated',
      detail: isFirst ? 'First activation' : 'Same machine'
    });

    const active = rows[0];
    const cafe = active.cafe_id
      ? (await client.query('SELECT name, is_active FROM cafes WHERE cafe_id = $1', [active.cafe_id])).rows[0]
      : null;

    res.json({
      success: true,
      message: isFirst ? 'Licence activated' : 'Licence confirmed',
      data: {
        product: active.product,
        cafe_id: active.cafe_id,
        cafe_name: cafe?.name || null,
        // A suspended install must be told, or it will fail later with
        // something far more confusing than the real reason.
        cafe_active: cafe ? cafe.is_active : true,
        max_pcs: active.max_pcs,
        max_branches: active.max_branches,
        expires_at: active.expires_at,
        days_remaining: active.expires_at
          ? Math.ceil((new Date(active.expires_at) - Date.now()) / 86400000)
          : null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error activating licence:', error);
    res.status(500).json({ success: false, message: 'Could not activate right now. Please try again.' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/licenses/check
 *
 * A running install checking in. Cheap, frequent, and read-mostly: it updates
 * last_seen so the admin can tell a live install from an abandoned one.
 */
export const checkLicense = async (req, res) => {
  const client = await pool.connect();
  try {
    const key = normaliseKey(req.body?.license_key);
    const machineId = req.body?.machine_id ? String(req.body.machine_id).slice(0, 128) : null;
    if (!key) return res.status(400).json({ success: false, message: 'Invalid key' });

    const { rows } = await client.query(`
      UPDATE license_keys
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE license_key = $1 AND (machine_id IS NULL OR machine_id = $2)
      RETURNING *
    `, [key, machineId]);

    const license = rows[0];
    if (!license) {
      return res.json({ success: true, data: { valid: false, reason: 'not_recognised' } });
    }

    const expired = license.expires_at && new Date(license.expires_at) < new Date();
    const cafe = license.cafe_id
      ? (await client.query('SELECT is_active, suspended_reason FROM cafes WHERE cafe_id = $1',
          [license.cafe_id])).rows[0]
      : null;

    res.json({
      success: true,
      data: {
        valid: license.status !== 'revoked' && !expired && (cafe ? cafe.is_active : true),
        status: expired ? 'expired' : license.status,
        // The install shows this to the operator, so it has to be the real
        // reason rather than a generic failure.
        reason: license.status === 'revoked' ? license.revoked_reason
          : expired ? 'Licence expired'
          : (cafe && !cafe.is_active ? cafe.suspended_reason : null),
        expires_at: license.expires_at,
        max_pcs: license.max_pcs,
        days_remaining: license.expires_at
          ? Math.ceil((new Date(license.expires_at) - Date.now()) / 86400000)
          : null
      }
    });
  } catch (error) {
    console.error('Error checking licence:', error);
    res.status(500).json({ success: false, message: 'Could not check the licence' });
  } finally {
    client.release();
  }
};
