import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/*
 * Staff accounts and role-based access.
 *
 * A staff token carries the account's permission keys, so most checks are a
 * membership test rather than a query. Changing a role therefore takes effect
 * at the staff member's next sign-in — deactivating an account is the
 * immediate lever, and that is checked on every request via the status flag
 * when a permission guard needs to be certain.
 */

const STATUSES = ['ACTIVE', 'INACTIVE'];

const shapeStaff = (row) => ({
  staff_id: row.staff_id,
  cafe_id: row.cafe_id,
  staff_name: row.staff_name,
  email: row.email,
  phone_number: row.phone_number,
  role_id: row.role_id,
  role_name: row.role_name,
  status: row.status,
  last_login_at: row.last_login_at,
  created_at: row.created_at
});

const SELECT_STAFF = `
  SELECT s.*, r.role_name
  FROM staff s
  JOIN roles r ON r.role_id = s.role_id
`;

/** Every permission key granted to a role. */
const permissionsForRole = async (client, roleId) => {
  const result = await client.query(
    `SELECT p.permission_key
     FROM role_permissions rp
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.permission_key`,
    [roleId]
  );
  return result.rows.map((r) => r.permission_key);
};

/* ==========================================================================
   AUTH
   ========================================================================== */
// POST /api/staff/login
export const staffLogin = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const result = await client.query(
      `${SELECT_STAFF} WHERE LOWER(s.email) = LOWER($1)`, [String(email).trim()]
    );
    if (result.rows.length === 0) {
      // Same message either way, so the response cannot be used to discover
      // which addresses exist.
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const staff = result.rows[0];
    const valid = await bcrypt.compare(password, staff.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (staff.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'This account has been deactivated' });
    }

    const permissions = await permissionsForRole(client, staff.role_id);

    const token = jwt.sign(
      {
        staff_id: staff.staff_id,
        email: staff.email,
        name: staff.staff_name,
        cafe_id: staff.cafe_id,
        // `role` is what the existing staff guards look for, so a staff token
        // works everywhere an owner token does, subject to its permissions.
        role: staff.role_name,
        role_id: staff.role_id,
        permissions: permissions
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '12h' }
    );

    await client.query(
      'UPDATE staff SET last_login_at = CURRENT_TIMESTAMP WHERE staff_id = $1', [staff.staff_id]
    );

    delete staff.password;
    res.status(200).json({
      success: true,
      message: 'Signed in',
      data: { staff: shapeStaff(staff), permissions, token }
    });
  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ success: false, message: 'Error signing in' });
  } finally {
    client.release();
  }
};

// GET /api/staff/me — who the caller is and what they may do
export const whoAmI = async (req, res) => {
  const client = await pool.connect();
  try {
    const actor = req.actor || {};

    // The café-owner token has no staff record but full authority.
    if (!actor.staff_id) {
      const all = await client.query('SELECT permission_key FROM permissions ORDER BY permission_key');
      return res.status(200).json({
        success: true,
        data: {
          kind: 'owner',
          name: actor.email || 'Owner',
          role_name: actor.role || 'admin',
          permissions: all.rows.map((r) => r.permission_key)
        }
      });
    }

    const result = await client.query(`${SELECT_STAFF} WHERE s.staff_id = $1`, [actor.staff_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Staff account not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        kind: 'staff',
        ...shapeStaff(result.rows[0]),
        permissions: await permissionsForRole(client, result.rows[0].role_id)
      }
    });
  } catch (error) {
    console.error('Error resolving identity:', error);
    res.status(500).json({ success: false, message: 'Error reading account' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   STAFF CRUD
   ========================================================================== */
// GET /api/staff
export const listStaff = async (req, res) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`s.status = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`(s.staff_name ILIKE $${params.length} OR s.email ILIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await pool.query(
      `${SELECT_STAFF} ${where} ORDER BY s.staff_name ASC`, params
    );
    res.status(200).json({ success: true, data: result.rows.map(shapeStaff) });
  } catch (error) {
    console.error('Error listing staff:', error);
    res.status(500).json({ success: false, message: 'Error fetching staff' });
  }
};

// POST /api/staff
export const createStaff = async (req, res) => {
  try {
    const name = (req.body?.staff_name || '').trim();
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';
    const roleId = parseInt(req.body?.role_id, 10);

    if (!name) return res.status(400).json({ success: false, message: 'A name is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    if (!Number.isInteger(roleId)) {
      return res.status(400).json({ success: false, message: 'A role is required' });
    }

    const role = await pool.query('SELECT role_id FROM roles WHERE role_id = $1', [roleId]);
    if (role.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      `INSERT INTO staff (cafe_id, role_id, staff_name, email, phone_number, password, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING staff_id`,
      [
        req.body?.cafe_id || req.actor?.cafe_id || null, roleId, name, email,
        req.body?.phone_number || null, hashed, req.actor?.label || null
      ]
    );

    const full = await pool.query(`${SELECT_STAFF} WHERE s.staff_id = $1`, [inserted.rows[0].staff_id]);

    await recordAudit(req, {
      action: 'staff.create', category: 'staff', entity: 'staff',
      entity_id: full.rows[0].staff_id, sensitive: true,
      summary: `Added staff member ${full.rows[0].staff_name} as ${full.rows[0].role_name}`,
      meta: { email: full.rows[0].email, role_id: full.rows[0].role_id }
    });

    res.status(201).json({ success: true, message: 'Staff member added', data: shapeStaff(full.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That email is already in use' });
    }
    console.error('Error creating staff:', error);
    res.status(500).json({ success: false, message: 'Error adding staff member' });
  }
};

// PUT /api/staff/:id
export const updateStaff = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const name = (req.body?.staff_name || '').trim();
    const email = (req.body?.email || '').trim().toLowerCase();
    const roleId = parseInt(req.body?.role_id, 10);

    if (!name) return res.status(400).json({ success: false, message: 'A name is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }
    if (!Number.isInteger(roleId)) {
      return res.status(400).json({ success: false, message: 'A role is required' });
    }

    // A password is only rewritten when one was actually supplied.
    const password = req.body?.password;
    let hashed = null;
    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      }
      hashed = await bcrypt.hash(String(password), 10);
    }

    const result = await pool.query(
      `UPDATE staff
       SET staff_name = $1, email = $2, phone_number = $3, role_id = $4,
           password = COALESCE($5::varchar, password), updated_at = CURRENT_TIMESTAMP
       WHERE staff_id = $6 RETURNING staff_id`,
      [name, email, req.body?.phone_number || null, roleId, hashed, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    const full = await pool.query(`${SELECT_STAFF} WHERE s.staff_id = $1`, [id]);
    res.status(200).json({ success: true, message: 'Staff member updated', data: shapeStaff(full.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That email is already in use' });
    }
    console.error('Error updating staff:', error);
    res.status(500).json({ success: false, message: 'Error updating staff member' });
  }
};

// PATCH /api/staff/:id/status
export const setStaffStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE or INACTIVE' });
    }
    // Locking yourself out would leave nobody able to unlock the account.
    if (req.actor?.staff_id && Number(req.actor.staff_id) === id && status === 'INACTIVE') {
      return res.status(409).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    const result = await pool.query(
      `UPDATE staff SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE staff_id = $2 RETURNING staff_id`,
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    const full = await pool.query(`${SELECT_STAFF} WHERE s.staff_id = $1`, [id]);

    await recordAudit(req, {
      action: 'staff.status', category: 'staff', entity: 'staff', entity_id: id,
      sensitive: true,
      summary: `${status === 'ACTIVE' ? 'Reactivated' : 'Deactivated'} ` +
        `${full.rows[0].staff_name}'s account`,
      meta: { status }
    });

    res.status(200).json({
      success: true,
      message: status === 'ACTIVE' ? 'Account activated' : 'Account deactivated',
      data: shapeStaff(full.rows[0])
    });
  } catch (error) {
    console.error('Error updating staff status:', error);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
};

/* ==========================================================================
   ROLES
   ========================================================================== */
// GET /api/staff/roles
export const listRoles = async (req, res) => {
  const client = await pool.connect();
  try {
    const roles = await client.query(
      `SELECT r.*, COUNT(s.staff_id)::int AS staff_count
       FROM roles r
       LEFT JOIN staff s ON s.role_id = r.role_id AND s.status = 'ACTIVE'
       GROUP BY r.role_id
       ORDER BY r.is_system DESC, r.role_name ASC`
    );

    const grants = await client.query(
      `SELECT rp.role_id, p.permission_key
       FROM role_permissions rp
       JOIN permissions p ON p.permission_id = rp.permission_id`
    );
    const byRole = {};
    grants.rows.forEach((g) => {
      (byRole[g.role_id] = byRole[g.role_id] || []).push(g.permission_key);
    });

    res.status(200).json({
      success: true,
      data: roles.rows.map((r) => ({
        role_id: r.role_id,
        role_name: r.role_name,
        description: r.description,
        is_system: r.is_system,
        status: r.status,
        staff_count: Number(r.staff_count),
        permissions: byRole[r.role_id] || []
      }))
    });
  } catch (error) {
    console.error('Error listing roles:', error);
    res.status(500).json({ success: false, message: 'Error fetching roles' });
  } finally {
    client.release();
  }
};

// GET /api/staff/permissions
export const listPermissions = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM permissions ORDER BY category ASC, permission_key ASC');
    const grouped = {};
    result.rows.forEach((p) => {
      (grouped[p.category] = grouped[p.category] || []).push({
        permission_key: p.permission_key,
        description: p.description,
        is_custom: p.is_custom
      });
    });
    res.status(200).json({ success: true, data: result.rows, grouped });
  } catch (error) {
    console.error('Error listing permissions:', error);
    res.status(500).json({ success: false, message: 'Error fetching permissions' });
  }
};

// POST /api/staff/roles   { role_name, description, permissions: [key, ...] }
export const createRole = async (req, res) => {
  const client = await pool.connect();
  try {
    const name = (req.body?.role_name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'A role name is required' });

    const keys = Array.isArray(req.body?.permissions) ? req.body.permissions : [];

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO roles (role_name, description, cafe_id) VALUES ($1,$2,$3) RETURNING role_id`,
      [name, req.body?.description || null, req.body?.cafe_id || req.actor?.cafe_id || null]
    );
    const roleId = result.rows[0].role_id;

    // Grant the chosen permissions in the same breath, so a new role is never
    // stranded with nothing until someone remembers to come back to it.
    if (keys.length) {
      const matched = await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM permissions WHERE permission_key = ANY($2)
         RETURNING permission_id`,
        [roleId, keys]
      );
      if (matched.rows.length !== keys.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'One or more of those permission keys does not exist'
        });
      }
    }

    await client.query('COMMIT');

    const granted = await permissionsForRole(client, roleId);
    res.status(201).json({
      success: true,
      message: keys.length ? `Role created with ${granted.length} permission(s)` : 'Role created',
      data: { role_id: roleId, permissions: granted }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A role with that name already exists' });
    }
    console.error('Error creating role:', error);
    res.status(500).json({ success: false, message: 'Error creating role' });
  } finally {
    client.release();
  }
};

/*
 * Custom permissions.
 *
 * A key added here can be granted to roles and will appear on staff tokens,
 * but nothing in the application checks it until code does — so it gates
 * nothing on its own. Built-in keys cannot be removed, because routes depend
 * on them.
 */
// POST /api/staff/permissions   { permission_key, description, category }
export const createPermission = async (req, res) => {
  try {
    const key = (req.body?.permission_key || '').trim().toLowerCase();
    if (!key) return res.status(400).json({ success: false, message: 'A permission key is required' });
    if (!/^[a-z0-9]+(\.[a-z0-9_-]+)+$/.test(key)) {
      return res.status(400).json({
        success: false,
        message: 'Use the area.action form, lower case — for example reports.export'
      });
    }
    if (key.length > 64) {
      return res.status(400).json({ success: false, message: 'That key is too long' });
    }

    const result = await pool.query(
      `INSERT INTO permissions (permission_key, category, description, is_custom)
       VALUES ($1,$2,$3,TRUE) RETURNING *`,
      [
        key,
        (req.body?.category || 'custom').trim().toLowerCase().slice(0, 32),
        req.body?.description || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Permission added',
      data: result.rows[0],
      note: 'Custom keys can be granted to roles, but enforce nothing until the application checks them.'
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That permission key already exists' });
    }
    console.error('Error creating permission:', error);
    res.status(500).json({ success: false, message: 'Error adding permission' });
  }
};

// DELETE /api/staff/permissions/:key
export const deletePermission = async (req, res) => {
  try {
    const key = String(req.params.key || '').toLowerCase();
    const existing = await pool.query(
      'SELECT is_custom FROM permissions WHERE permission_key = $1', [key]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Permission not found' });
    }
    // Routes check the built-in keys by name; removing one would silently
    // disable the guard that depends on it.
    if (!existing.rows[0].is_custom) {
      return res.status(409).json({
        success: false,
        message: 'Built-in permissions cannot be removed — the application checks them by name'
      });
    }

    await pool.query('DELETE FROM permissions WHERE permission_key = $1', [key]);
    res.status(200).json({ success: true, message: 'Permission removed' });
  } catch (error) {
    console.error('Error deleting permission:', error);
    res.status(500).json({ success: false, message: 'Error removing permission' });
  }
};

// PUT /api/staff/roles/:id/permissions   { permissions: ['floor.view', ...] }
export const setRolePermissions = async (req, res) => {
  const client = await pool.connect();
  try {
    const roleId = parseInt(req.params.id, 10);
    const keys = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
    if (!keys) {
      return res.status(400).json({ success: false, message: 'Provide a permissions array' });
    }

    const role = await client.query('SELECT * FROM roles WHERE role_id = $1', [roleId]);
    if (role.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    // Owner must keep every permission, or the café could lock itself out.
    if (role.rows[0].is_system && role.rows[0].role_name.toLowerCase() === 'owner') {
      return res.status(409).json({
        success: false,
        message: 'The Owner role always has every permission and cannot be reduced'
      });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (keys.length) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM permissions WHERE permission_key = ANY($2)`,
        [roleId, keys]
      );
    }
    await client.query('COMMIT');

    const granted = await permissionsForRole(client, roleId);

    // Who can do what is the most consequential setting in the console, so
    // the before and after are both kept.
    await recordAudit(req, {
      action: 'role.permissions', category: 'staff', entity: 'role', entity_id: roleId,
      sensitive: true,
      summary: `Set ${role.rows[0].role_name} to ${granted.length} permission(s)`,
      meta: { role_name: role.rows[0].role_name, permissions: granted }
    });

    res.status(200).json({
      success: true,
      message: `${granted.length} permission(s) granted`,
      data: { role_id: roleId, permissions: granted }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error setting role permissions:', error);
    res.status(500).json({ success: false, message: 'Error updating permissions' });
  } finally {
    client.release();
  }
};

// DELETE /api/staff/roles/:id
export const deleteRole = async (req, res) => {
  try {
    const roleId = parseInt(req.params.id, 10);
    const role = await pool.query('SELECT is_system FROM roles WHERE role_id = $1', [roleId]);
    if (role.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    if (role.rows[0].is_system) {
      return res.status(409).json({ success: false, message: 'Built-in roles cannot be deleted' });
    }

    const used = await pool.query('SELECT COUNT(*)::int AS count FROM staff WHERE role_id = $1', [roleId]);
    if (used.rows[0].count > 0) {
      return res.status(409).json({
        success: false,
        message: `${used.rows[0].count} staff member(s) hold this role. Move them first.`
      });
    }

    await pool.query('DELETE FROM roles WHERE role_id = $1', [roleId]);
    res.status(200).json({ success: true, message: 'Role deleted' });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ success: false, message: 'Error deleting role' });
  }
};
