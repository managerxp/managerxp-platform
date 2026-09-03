/*
 * ManagerXP administrator authentication and authorization.
 *
 * Separate from `authGuards.js` on purpose. That file authenticates café
 * owners, café staff and customers — three principals who all belong to a
 * tenant. This one authenticates the vendor, who belongs to none of them and
 * can see all of them. Mixing the two is how a customer ends up holding a
 * token that opens another customer's billing.
 *
 * Three things keep them apart:
 *
 *   - A distinct audience claim (`aud: 'managerxp-admin'`). A café owner's
 *     token is signed with the same secret, so without this an owner token
 *     would verify here. It carries no audience, so it fails.
 *   - A distinct subject field (`admin_user_id`, never `id`).
 *   - Permissions read from the database on every request, not from the token.
 *     Revoking a permission has to take effect now, not in eight hours when
 *     the token happens to expire.
 */
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';

export const ADMIN_AUDIENCE = 'managerxp-admin';

export const signAdminToken = async (admin) => {
  const hours = Number(await getSetting('admin.session_hours', 8));
  return jwt.sign(
    {
      admin_user_id: admin.admin_user_id,
      email: admin.email,
      role: admin.role_key
    },
    process.env.JWT_SECRET,
    { expiresIn: `${hours}h`, audience: ADMIN_AUDIENCE }
  );
};

const readAdminToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7).trim(), process.env.JWT_SECRET, {
      audience: ADMIN_AUDIENCE
    });
    // Belt and braces: a token without the admin subject is not an admin
    // token, whatever else it claims.
    return payload.admin_user_id ? payload : null;
  } catch {
    return null;
  }
};

/**
 * Load the administrator and the permissions their role currently grants.
 *
 * One query. An authorization check that costs three round trips is one
 * somebody eventually caches or skips.
 */
const loadAdmin = async (adminUserId) => {
  const admin = (await pool.query(`
    SELECT a.admin_user_id, a.email, a.name, a.status,
           r.role_key, r.label AS role_label, r.is_superuser
    FROM admin_users a
    JOIN admin_roles r ON r.admin_role_id = a.admin_role_id
    WHERE a.admin_user_id = $1
  `, [adminUserId])).rows[0];

  if (!admin) return null;

  /* A superuser is granted whatever the catalogue currently holds, rather
     than a list captured when the role was created. A permission added next
     month must not be missing from the one role that has to have it. */
  const permissions = admin.is_superuser
    ? (await pool.query('SELECT permission_key FROM admin_permissions')).rows.map((r) => r.permission_key)
    : (await pool.query(`
        SELECT rp.permission_key
        FROM admin_role_permissions rp
        JOIN admin_users a ON a.admin_role_id = rp.admin_role_id
        WHERE a.admin_user_id = $1
      `, [adminUserId])).rows.map((r) => r.permission_key);

  return { ...admin, permissions };
};

/**
 * Require a signed-in ManagerXP administrator.
 *
 * Status is re-read from the database rather than trusted from the token: an
 * administrator suspended five minutes ago must stop working now, not when
 * their session expires.
 */
export const requireAdmin = async (req, res, next) => {
  const payload = readAdminToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Sign in to continue' });
  }

  try {
    const admin = await loadAdmin(payload.admin_user_id);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Sign in to continue' });
    }
    if (admin.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'This account is not active' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    console.error('Admin auth failed:', error);
    res.status(500).json({ success: false, message: 'Could not verify your session' });
  }
};

/**
 * Require a specific permission.
 *
 * Section 40: "Do not rely only on frontend route visibility. Backend must
 * enforce permissions." Hiding a sidebar entry decides what is offered;
 * this decides what is possible.
 */
export const requirePermission = (...keys) => (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: 'Sign in to continue' });
  }
  const granted = req.admin.permissions || [];
  const ok = keys.some((k) => granted.includes(k));
  if (!ok) {
    return res.status(403).json({
      success: false,
      message: 'Your role does not allow this',
      data: { required: keys }
    });
  }
  next();
};

/**
 * Record an administrative action.
 *
 * Never throws. An audit write that fails must not roll back the thing it was
 * describing — a missing log line is a smaller problem than a half-applied
 * subscription change, and the error is still surfaced to the console.
 */
export const recordAdminAudit = async (req, entry) => {
  try {
    await pool.query(`
      INSERT INTO admin_audit
        (admin_user_id, admin_email, action, resource_type, resource_id,
         organization_id, branch_id, old_value, new_value, ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      req.admin?.admin_user_id || null,
      req.admin?.email || null,
      entry.action,
      entry.resource_type || null,
      entry.resource_id != null ? String(entry.resource_id) : null,
      entry.organization_id || null,
      entry.branch_id || null,
      entry.old_value ? JSON.stringify(entry.old_value) : null,
      entry.new_value ? JSON.stringify(entry.new_value) : null,
      clientIp(req)
    ]);
  } catch (error) {
    console.error('Could not write admin audit entry:', error.message);
  }
};

export const clientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || null;
};

export { loadAdmin };
