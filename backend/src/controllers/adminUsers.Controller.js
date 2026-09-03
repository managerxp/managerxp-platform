/*
 * ManagerXP administrator accounts, roles and permissions.
 *
 * This is the screen that can lock everybody out of the product, so most of
 * the code below is refusals. Four in particular, each of which would
 * otherwise be a plausible accident:
 *
 *   You cannot disable or demote yourself. An administrator who removes their
 *   own access has no way to undo it, and the fix is a SQL console.
 *
 *   The last super admin cannot be disabled, demoted or deleted. One account
 *   must always be able to restore the others.
 *
 *   You cannot grant authority you do not hold. Only a super admin may create
 *   another; otherwise `admins.manage` would be a promotion to super admin in
 *   two steps.
 *
 *   Nobody sets anybody else's password. A new administrator is created
 *   without one and receives a reset link, so a working credential never
 *   exists in a form field, a chat message, or this file.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import { sendMail, mailConfigured } from '../modules/mail/mailer.js';
import { getSetting } from '../config/settings.js';

/* ==========================================================================
   ADMIN USERS
   ========================================================================== */

/** GET /api/admin/admin-users */
export const listAdminUsers = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.admin_user_id, a.email, a.name, a.status, a.last_login_at, a.last_login_ip,
             a.failed_attempts, a.locked_until, a.created_at, a.totp_enabled,
             (a.password_hash IS NULL OR a.reset_token_hash IS NOT NULL) AS pending_setup,
             r.admin_role_id, r.role_key, r.label AS role_label, r.is_superuser,
             creator.email AS created_by_email,
             (SELECT COUNT(*)::int FROM admin_login_events e
               WHERE e.admin_user_id = a.admin_user_id AND e.outcome = 'SUCCESS') AS sign_ins
      FROM admin_users a
      JOIN admin_roles r ON r.admin_role_id = a.admin_role_id
      LEFT JOIN admin_users creator ON creator.admin_user_id = a.created_by
      ORDER BY r.is_superuser DESC, a.name
    `);

    const superAdmins = rows.filter((r) => r.is_superuser && r.status === 'ACTIVE').length;

    res.json({
      success: true,
      data: {
        items: rows.map((r) => ({
          ...r,
          /* Told plainly, because it is what makes the account safe to edit or
             not: the only one left who can restore the others. */
          is_last_super_admin: r.is_superuser && r.status === 'ACTIVE' && superAdmins === 1,
          is_self: r.admin_user_id === req.admin.admin_user_id,
          locked: !!(r.locked_until && new Date(r.locked_until) > new Date())
        })),
        can_create_superuser: req.admin.is_superuser,
        mail_configured: await mailConfigured()
      }
    });
  } catch (error) {
    console.error('Admin user list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load administrators' });
  }
};

/** Issue a single-use reset token and, if possible, email it. */
const issueSetupLink = async (admin, { isNew }) => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  await pool.query(`
    UPDATE admin_users
    SET reset_token_hash = $2, reset_expires_at = NOW() + interval '24 hours'
    WHERE admin_user_id = $1
  `, [admin.admin_user_id, hash]);

  const base = String(await getSetting('platform.pay_base_url', '')).replace(/\/$/, '');
  const url = `${base}/admin/reset?token=${token}`;

  const subject = isNew
    ? 'Your ManagerXP administrator account'
    : 'Reset your ManagerXP password';
  const intro = isNew
    ? `An administrator account has been created for you on ManagerXP. Choose a password to finish setting it up.`
    : `A password reset was requested for your ManagerXP administrator account.`;

  const mail = await sendMail({
    to: admin.email, toName: admin.name, subject,
    html: `<div style="background:#0a0a0a;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:14px;padding:24px">
        <h1 style="margin:0 0 12px;color:#fff;font-size:17px">${subject}</h1>
        <p style="margin:0 0 18px;color:#a3a3a3;font-size:14px;line-height:1.6">${intro}</p>
        <a href="${url}" style="display:block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:600;font-size:14px;text-align:center">Set your password</a>
        <p style="margin:16px 0 0;color:#666;font-size:12px;line-height:1.6">
          This link works once and expires in 24 hours.<br>
          <span style="color:#a3a3a3;word-break:break-all">${url}</span>
        </p>
        <p style="margin:14px 0 0;color:#666;font-size:12px">
          If you were not expecting this, tell whoever runs your ManagerXP — someone
          has created or reset an account in your name.
        </p>
      </div></div>`,
    text: `${intro}\n\nSet your password: ${url}\n\nThis link works once and expires in 24 hours.`,
    kind: 'admin_setup', relatedType: 'admin_user', relatedId: String(admin.admin_user_id)
  });

  /* The URL is returned to the caller whether or not the email went. Without
     a mail transport the alternative is an administrator who exists and can
     never sign in. */
  return { url, mail };
};

/** POST /api/admin/admin-users */
export const createAdminUser = async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const roleId = Number(req.body?.admin_role_id);

    if (!email || !name || !roleId) {
      return res.status(400).json({ success: false, message: 'A name, email and role are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'That email address does not look right' });
    }

    const role = (await pool.query(
      'SELECT * FROM admin_roles WHERE admin_role_id = $1', [roleId])).rows[0];
    if (!role) return res.status(400).json({ success: false, message: 'No such role' });

    /* Escalation guard. Without it, `admins.manage` is a two-step promotion to
       super admin: create one, sign in as them. */
    if (role.is_superuser && !req.admin.is_superuser) {
      return res.status(403).json({
        success: false,
        message: 'Only a super admin can create another super admin'
      });
    }

    const clash = (await pool.query(
      'SELECT 1 FROM admin_users WHERE LOWER(email) = $1', [email])).rows[0];
    if (clash) {
      return res.status(409).json({ success: false, message: 'An administrator with that email already exists' });
    }

    /* Created with a password nobody knows — random, hashed, and immediately
       superseded by the reset link. There is deliberately no way for the
       creator to choose it. */
    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const created = (await pool.query(`
      INSERT INTO admin_users (email, name, password_hash, admin_role_id, created_by)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING admin_user_id, email, name, status
    `, [email, name, unusable, roleId, req.admin.admin_user_id])).rows[0];

    const setup = await issueSetupLink(created, { isNew: true });

    await recordAdminAudit(req, {
      action: 'admin_user.created', resource_type: 'admin_user', resource_id: created.admin_user_id,
      new_value: { email, name, role: role.role_key }
    });

    res.status(201).json({
      success: true,
      message: setup.mail.sent
        ? `${name} created. A setup link has been emailed to ${email}.`
        : `${name} created. ${setup.mail.message} Send them the link below.`,
      data: { ...created, role: role.role_key, setup_url: setup.url, email_result: setup.mail }
    });
  } catch (error) {
    console.error('Admin user create failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that administrator' });
  }
};

/**
 * Everything that must stay true after a change to an administrator.
 * Returns `{ status, message }` for a refusal, or null when it is allowed.
 *
 * The two statuses mean different things and are kept apart deliberately:
 *
 *   403 — you lack the authority. Someone else could do this.
 *   409 — the system would end up in a state it must never be in. Nobody
 *         could do this, however senior.
 *
 * Collapsing them would tell an administrator to go and find a super admin
 * when in fact no super admin could help either.
 */
const guardChange = async (actor, target, { nextRole, nextStatus }) => {
  const isSelf = actor.admin_user_id === target.admin_user_id;
  const losingAccess = nextStatus && nextStatus !== 'ACTIVE';
  const changingRole = nextRole && nextRole.admin_role_id !== target.admin_role_id;

  if (isSelf && losingAccess) {
    return { status: 409, message: 'You cannot disable your own account — you would not be able to undo it.' };
  }
  if (isSelf && changingRole && target.is_superuser && !nextRole.is_superuser) {
    return { status: 409, message: 'You cannot remove your own super admin role.' };
  }
  if (nextRole?.is_superuser && !actor.is_superuser) {
    return { status: 403, message: 'Only a super admin can grant the super admin role.' };
  }
  if (target.is_superuser && !actor.is_superuser && (losingAccess || changingRole)) {
    return { status: 403, message: 'Only a super admin can change another super admin.' };
  }

  /* The last one standing. Counted at the moment of the change rather than
     cached, because two administrators demoting each other simultaneously is
     exactly how an account like this disappears. */
  if (target.is_superuser && target.status === 'ACTIVE'
      && (losingAccess || (changingRole && !nextRole.is_superuser))) {
    const others = (await pool.query(`
      SELECT COUNT(*)::int AS n FROM admin_users a
      JOIN admin_roles r ON r.admin_role_id = a.admin_role_id
      WHERE r.is_superuser AND a.status = 'ACTIVE' AND a.admin_user_id <> $1
    `, [target.admin_user_id])).rows[0].n;
    if (others === 0) {
      return {
        status: 409,
        message: 'This is the only active super admin. Promote someone else first, or nobody can restore access.'
      };
    }
  }
  return null;
};

/** PATCH /api/admin/admin-users/:id */
export const updateAdminUser = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const target = (await pool.query(`
      SELECT a.*, r.role_key, r.is_superuser
      FROM admin_users a JOIN admin_roles r ON r.admin_role_id = a.admin_role_id
      WHERE a.admin_user_id = $1
    `, [id])).rows[0];
    if (!target) return res.status(404).json({ success: false, message: 'Not found' });

    let nextRole = null;
    if (req.body?.admin_role_id && Number(req.body.admin_role_id) !== target.admin_role_id) {
      nextRole = (await pool.query(
        'SELECT * FROM admin_roles WHERE admin_role_id = $1', [Number(req.body.admin_role_id)])).rows[0];
      if (!nextRole) return res.status(400).json({ success: false, message: 'No such role' });
    }

    const nextStatus = req.body?.status ? String(req.body.status).toUpperCase() : null;
    if (nextStatus && !['ACTIVE', 'SUSPENDED', 'DISABLED'].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE, SUSPENDED or DISABLED' });
    }

    const refusal = await guardChange(req.admin, target, { nextRole, nextStatus });
    if (refusal) return res.status(refusal.status).json({ success: false, message: refusal.message });

    const sets = [];
    const params = [id];
    if (req.body?.name !== undefined) { params.push(String(req.body.name).trim()); sets.push(`name = $${params.length}`); }
    if (nextRole) { params.push(nextRole.admin_role_id); sets.push(`admin_role_id = $${params.length}`); }
    if (nextStatus) { params.push(nextStatus); sets.push(`status = $${params.length}`); }

    /* Reactivating clears the lockout. Otherwise an administrator restored
       after being suspended finds themselves refused for a reason that no
       longer applies. */
    if (nextStatus === 'ACTIVE') sets.push('failed_attempts = 0', 'locked_until = NULL');

    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const updated = (await pool.query(`
      UPDATE admin_users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE admin_user_id = $1 RETURNING admin_user_id, email, name, status, admin_role_id
    `, params)).rows[0];

    await recordAdminAudit(req, {
      action: 'admin_user.updated', resource_type: 'admin_user', resource_id: id,
      old_value: { name: target.name, role: target.role_key, status: target.status },
      new_value: { name: updated.name, role: nextRole?.role_key || target.role_key, status: updated.status }
    });

    res.json({ success: true, message: `${updated.name} saved`, data: updated });
  } catch (error) {
    console.error('Admin user update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that administrator' });
  }
};

/** POST /api/admin/admin-users/:id/reset — send them a fresh setup link. */
export const resetAdminPassword = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const target = (await pool.query(
      'SELECT admin_user_id, email, name, status FROM admin_users WHERE admin_user_id = $1', [id])).rows[0];
    if (!target) return res.status(404).json({ success: false, message: 'Not found' });
    if (target.status !== 'ACTIVE') {
      return res.status(409).json({
        success: false,
        message: 'This account is not active — reactivate it before sending a reset link.'
      });
    }

    const setup = await issueSetupLink(target, { isNew: false });

    await recordAdminAudit(req, {
      action: 'admin_user.reset_sent', resource_type: 'admin_user', resource_id: id,
      new_value: { email: target.email, emailed: setup.mail.sent }
    });

    res.json({
      success: true,
      message: setup.mail.sent
        ? `Reset link emailed to ${target.email}`
        : `${setup.mail.message} Send them the link below.`,
      data: { setup_url: setup.url, email_result: setup.mail }
    });
  } catch (error) {
    console.error('Admin reset failed:', error);
    res.status(500).json({ success: false, message: 'Could not send a reset link' });
  }
};

/** GET /api/admin/admin-users/:id/logins */
export const listLoginEvents = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`
      SELECT event_id, outcome, ip, user_agent, created_at
      FROM admin_login_events WHERE admin_user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [id]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Login event list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load sign-in history' });
  }
};

/* ==========================================================================
   ROLES AND PERMISSIONS
   ========================================================================== */

/** GET /api/admin/roles */
export const listRoles = async (req, res) => {
  try {
    const [roles, permissions, grants, counts] = await Promise.all([
      pool.query('SELECT * FROM admin_roles ORDER BY is_superuser DESC, role_key').then((r) => r.rows),
      pool.query('SELECT * FROM admin_permissions ORDER BY resource, permission_key').then((r) => r.rows),
      pool.query('SELECT * FROM admin_role_permissions').then((r) => r.rows),
      pool.query(`
        SELECT admin_role_id, COUNT(*)::int AS n FROM admin_users
        WHERE status = 'ACTIVE' GROUP BY admin_role_id
      `).then((r) => r.rows)
    ]);

    const countMap = Object.fromEntries(counts.map((c) => [c.admin_role_id, c.n]));
    const allKeys = permissions.map((p) => p.permission_key);

    /* Grouped by the resource they act on, which is how somebody reasons about
       them — "what may Finance do to subscriptions" rather than scanning 33
       keys in one column. */
    const grouped = {};
    permissions.forEach((p) => {
      (grouped[p.resource] = grouped[p.resource] || []).push(p);
    });

    res.json({
      success: true,
      data: {
        roles: roles.map((r) => ({
          ...r,
          /* A superuser's grants are a flag, not a list: it holds whatever the
             catalogue currently contains, including permissions added after
             the role existed. Returning the live list keeps the screen honest
             about that. */
          permissions: r.is_superuser
            ? allKeys
            : grants.filter((g) => g.admin_role_id === r.admin_role_id).map((g) => g.permission_key),
          admin_count: countMap[r.admin_role_id] || 0,
          editable: !r.is_superuser
        })),
        permissions: Object.entries(grouped).map(([resource, items]) => ({ resource, items })),
        can_edit: req.admin.is_superuser || (req.admin.permissions || []).includes('admins.manage')
      }
    });
  } catch (error) {
    console.error('Role list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load roles' });
  }
};

/** PUT /api/admin/roles/:id/permissions   { permissions: [...] } */
export const setRolePermissions = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const wanted = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
    if (!wanted) return res.status(400).json({ success: false, message: 'Send a permissions array' });

    const role = (await client.query('SELECT * FROM admin_roles WHERE admin_role_id = $1', [id])).rows[0];
    if (!role) return res.status(404).json({ success: false, message: 'Not found' });

    /* A super admin's grants are not a list to be edited. Allowing it would
       let someone narrow the one role that must be able to fix everything. */
    if (role.is_superuser) {
      return res.status(409).json({
        success: false,
        message: 'Super admin always holds every permission, including ones added later. It cannot be narrowed.'
      });
    }

    /* You cannot grant what you do not hold. Otherwise an administrator with
       `admins.manage` grants themselves `payments.refund` through a role. */
    if (!req.admin.is_superuser) {
      const mine = new Set(req.admin.permissions || []);
      const overreach = wanted.filter((p) => !mine.has(p));
      if (overreach.length) {
        return res.status(403).json({
          success: false,
          message: `You cannot grant permissions you do not hold: ${overreach.join(', ')}`
        });
      }
    }

    const valid = (await client.query('SELECT permission_key FROM admin_permissions')).rows
      .map((r) => r.permission_key);
    const unknown = wanted.filter((p) => !valid.includes(p));
    if (unknown.length) {
      return res.status(400).json({ success: false, message: `Unknown permissions: ${unknown.join(', ')}` });
    }

    const before = (await client.query(
      'SELECT permission_key FROM admin_role_permissions WHERE admin_role_id = $1', [id]))
      .rows.map((r) => r.permission_key);

    await client.query('BEGIN');
    await client.query('DELETE FROM admin_role_permissions WHERE admin_role_id = $1', [id]);
    for (const key of wanted) {
      await client.query(`
        INSERT INTO admin_role_permissions (admin_role_id, permission_key)
        VALUES ($1,$2) ON CONFLICT DO NOTHING
      `, [id, key]);
    }
    await client.query('COMMIT');

    const added = wanted.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !wanted.includes(p));

    await recordAdminAudit(req, {
      action: 'role.permissions_changed', resource_type: 'role', resource_id: id,
      old_value: { permissions: before }, new_value: { permissions: wanted, added, removed }
    });

    res.json({
      success: true,
      message: added.length || removed.length
        ? `${role.label}: ${added.length} added, ${removed.length} removed`
        : 'No changes',
      data: { added, removed }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Role permission write failed:', error);
    res.status(500).json({ success: false, message: 'Could not save those permissions' });
  } finally {
    client.release();
  }
};

/** POST /api/admin/roles */
export const createRole = async (req, res) => {
  try {
    const key = String(req.body?.role_key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const label = String(req.body?.label || '').trim();
    if (!key || !label) {
      return res.status(400).json({ success: false, message: 'A key and a label are required' });
    }
    if (!req.admin.is_superuser) {
      return res.status(403).json({ success: false, message: 'Only a super admin can create a role' });
    }

    const clash = (await pool.query('SELECT 1 FROM admin_roles WHERE role_key = $1', [key])).rows[0];
    if (clash) return res.status(409).json({ success: false, message: 'That role key already exists' });

    /* Created empty and never as a superuser. A new role starts with no
       authority and is granted what it needs, rather than starting with
       everything and having things taken away. */
    const role = (await pool.query(`
      INSERT INTO admin_roles (role_key, label, description, is_system, is_superuser)
      VALUES ($1,$2,$3,FALSE,FALSE) RETURNING *
    `, [key, label, req.body?.description || null])).rows[0];

    await recordAdminAudit(req, {
      action: 'role.created', resource_type: 'role', resource_id: role.admin_role_id,
      new_value: { role_key: key, label }
    });

    res.status(201).json({
      success: true,
      message: `${label} created with no permissions. Grant it what it needs.`,
      data: role
    });
  } catch (error) {
    console.error('Role create failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that role' });
  }
};
