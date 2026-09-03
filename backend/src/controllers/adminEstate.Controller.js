/*
 * Installations and devices, from the vendor's side — sections 31 and 32.
 *
 * These are the two screens an operator opens when a café says "it stopped
 * working", so both lead with the answer to that: status, and when the thing
 * was last heard from. A list that makes you click into each row to find out
 * whether it is online is a list that does not help.
 *
 * Every state change here is destructive to somebody's trading day, so each
 * demands a reason and each is audited. Revoking is deliberately harder to
 * reach than suspending: suspension is reversible from this screen, revocation
 * means the machine must be registered again from scratch.
 */
import pool from '../config/database.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';

/* ==========================================================================
   INSTALLATIONS
   ========================================================================== */

/** GET /api/admin/installations?q=&status=&organization_id=&online= */
export const listInstallations = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];

    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(i.name,'')) LIKE $${params.length}
                   OR LOWER(i.public_id) LIKE $${params.length}
                   OR LOWER(o.name) LIKE $${params.length}
                   OR LOWER(COALESCE(b.name,'')) LIKE $${params.length})`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where.push(`i.status = $${params.length}`);
    }
    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`i.organization_id = $${params.length}`);
    }
    /* "Offline" is a derived question, not a stored flag: nothing writes a row
       when a machine goes quiet, so it can only be answered by the clock. */
    if (req.query.online === 'false') {
      where.push(`(i.last_seen_at IS NULL OR i.last_seen_at < NOW() - interval '15 minutes')`);
    } else if (req.query.online === 'true') {
      where.push(`i.last_seen_at >= NOW() - interval '15 minutes'`);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await pool.query(`
      SELECT COUNT(*)::int AS n FROM installations i
      LEFT JOIN organizations o ON o.organization_id = i.organization_id
      LEFT JOIN branches b ON b.branch_id = i.branch_id ${clause}
    `, params)).rows[0].n;

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT i.installation_id, i.public_id, i.name, i.status, i.version,
             i.device_identifier, i.last_seen_at, i.last_authorized_at,
             i.registered_at, i.revoked_reason,
             i.organization_id, o.name AS organization_name, o.status AS organization_status,
             i.branch_id, b.name AS branch_name,
             (i.last_seen_at >= NOW() - interval '15 minutes') AS online,
             (SELECT COUNT(*)::int FROM pcs p
               WHERE p.installation_id = i.installation_id AND p.is_active) AS device_count
      FROM installations i
      LEFT JOIN organizations o ON o.organization_id = i.organization_id
      LEFT JOIN branches b ON b.branch_id = i.branch_id
      ${clause}
      ORDER BY i.last_seen_at DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, total, page, size } });
  } catch (error) {
    console.error('Admin installation list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load installations' });
  }
};

/** POST /api/admin/installations/:id/status  { status, reason } */
export const setInstallationStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE, SUSPENDED or REVOKED' });
    }
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    if (status !== 'ACTIVE' && !reason) {
      return res.status(400).json({
        success: false,
        message: `A reason is required to ${status === 'REVOKED' ? 'revoke' : 'suspend'} an installation`
      });
    }

    const before = (await pool.query(
      'SELECT * FROM installations WHERE installation_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    /* Revoking clears the credential. The machine cannot authorise again with
       what it holds, which is the difference between revoked and suspended —
       a suspension is lifted from this screen, a revocation means registering
       from scratch. */
    const updated = (await pool.query(`
      UPDATE installations
      SET status = $2::text,
          revoked_reason = COALESCE($3::text, revoked_reason),
          credential_hash = CASE WHEN $2::text = 'REVOKED' THEN NULL ELSE credential_hash END,
          updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1 RETURNING *
    `, [id, status, reason])).rows[0];

    await recordAdminAudit(req, {
      action: `installation.${status.toLowerCase()}`,
      resource_type: 'installation', resource_id: id,
      organization_id: before.organization_id, branch_id: before.branch_id,
      old_value: { status: before.status }, new_value: { status, reason }
    });

    res.json({
      success: true,
      message: status === 'REVOKED'
        ? 'Installation revoked. It must be registered again to come back.'
        : status === 'SUSPENDED' ? 'Installation suspended' : 'Installation restored',
      data: updated
    });
  } catch (error) {
    console.error('Admin installation status change failed:', error);
    res.status(500).json({ success: false, message: 'Could not change that installation' });
  }
};

/**
 * POST /api/admin/installations/:id/reauth
 *
 * Forces the machine to sign in again: the stored credential stops working,
 * but the installation stays active and keeps its devices and its history.
 * The middle option between doing nothing and revoking.
 */
export const forceReauth = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const before = (await pool.query(
      'SELECT * FROM installations WHERE installation_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    await pool.query(`
      UPDATE installations
      SET credential_hash = NULL, last_authorized_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1
    `, [id]);

    await recordAdminAudit(req, {
      action: 'installation.reauth_forced', resource_type: 'installation', resource_id: id,
      organization_id: before.organization_id, branch_id: before.branch_id
    });

    res.json({
      success: true,
      message: 'This installation must sign in again. Its devices and history are untouched.'
    });
  } catch (error) {
    console.error('Admin force reauth failed:', error);
    res.status(500).json({ success: false, message: 'Could not force re-authentication' });
  }
};

/* ==========================================================================
   DEVICES
   ========================================================================== */

/** GET /api/admin/devices?q=&type=&organization_id=&active= */
export const listDevices = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];

    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(p.name) LIKE $${params.length}
                   OR LOWER(COALESCE(p.mac_address,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(p.ip_address,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(o.name,'')) LIKE $${params.length})`);
    }
    if (req.query.type) {
      params.push(String(req.query.type).toUpperCase());
      where.push(`p.device_type = $${params.length}`);
    }
    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`p.organization_id = $${params.length}`);
    }
    if (req.query.active === 'false') where.push('p.is_active = FALSE');
    else if (req.query.active === 'true') where.push('p.is_active = TRUE');

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await pool.query(`
      SELECT COUNT(*)::int AS n FROM pcs p
      LEFT JOIN organizations o ON o.organization_id = p.organization_id ${clause}
    `, params)).rows[0].n;

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT p.pc_id, p.name, p.device_type, p.is_active, p.ip_address, p.mac_address,
             p.last_seen_at, p.registered_at, p.client_version,
             p.organization_id, o.name AS organization_name,
             p.branch_id, b.name AS branch_name,
             p.installation_id, i.public_id AS installation_public_id, i.status AS installation_status,
             (p.last_seen_at >= NOW() - interval '15 minutes') AS online
      FROM pcs p
      LEFT JOIN organizations o ON o.organization_id = p.organization_id
      LEFT JOIN branches b ON b.branch_id = p.branch_id
      LEFT JOIN installations i ON i.installation_id = p.installation_id
      ${clause}
      ORDER BY o.name NULLS LAST, b.name NULLS LAST, p.name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, total, page, size } });
  } catch (error) {
    console.error('Admin device list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load devices' });
  }
};

/**
 * POST /api/admin/devices/:id/status  { active, reason }
 *
 * Disabling frees the seat against the customer's PC allowance, which is the
 * whole point: a machine that has been retired should stop being charged for.
 * The row survives, because its session and billing history is the café's
 * trading record.
 */
export const setDeviceStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = req.body?.active === true;
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    if (!active && !reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to disable a device' });
    }

    const before = (await pool.query('SELECT * FROM pcs WHERE pc_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = (await pool.query(`
      UPDATE pcs SET is_active = $2, updated_at = CURRENT_TIMESTAMP
      WHERE pc_id = $1 RETURNING *
    `, [id, active])).rows[0];

    await recordAdminAudit(req, {
      action: active ? 'device.enabled' : 'device.disabled',
      resource_type: 'device', resource_id: id,
      organization_id: before.organization_id, branch_id: before.branch_id,
      old_value: { is_active: before.is_active, name: before.name },
      new_value: { is_active: active, reason }
    });

    res.json({
      success: true,
      message: active
        ? `${updated.name} re-enabled`
        : `${updated.name} disabled. It no longer counts against the PC limit.`,
      data: updated
    });
  } catch (error) {
    console.error('Admin device status change failed:', error);
    res.status(500).json({ success: false, message: 'Could not change that device' });
  }
};
