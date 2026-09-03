/*
 * ManagerXP administrator sign-in.
 *
 * Everything here is written on the assumption that this endpoint is the most
 * attacked one in the product: it is the door to every customer's data, and
 * unlike the café login it has a small, guessable set of valid usernames.
 *
 * Consequences visible below:
 *
 *   - The failure answer never distinguishes "no such account" from "wrong
 *     password". Both take the same path and return the same sentence.
 *   - Lockout state lives in the database, not in memory, so restarting the
 *     process does not hand an attacker a fresh allowance.
 *   - The password reset response is identical whether or not the address
 *     exists, so the form cannot be used to enumerate administrators.
 *   - Every attempt is recorded, including the ones that matched nothing.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import { signAdminToken, loadAdmin, clientIp, recordAdminAudit } from '../middleware/adminAuth.js';

const logAttempt = async (req, { adminUserId, email, outcome }) => {
  try {
    await pool.query(`
      INSERT INTO admin_login_events (admin_user_id, email_attempted, outcome, ip, user_agent)
      VALUES ($1,$2,$3,$4,$5)
    `, [
      adminUserId || null,
      email || null,
      outcome,
      clientIp(req),
      String(req.headers['user-agent'] || '').slice(0, 255)
    ]);
  } catch (error) {
    console.error('Could not record admin login event:', error.message);
  }
};

/* One sentence for every failure mode that is not a lockout. Saying less than
   we know is the point. */
const REFUSED = 'Email or password is incorrect';

/**
 * Try to sign in as a ManagerXP administrator.
 *
 * Returns a verdict rather than writing a response, because two callers need
 * it: the admin-only endpoint, and the single sign-in door that serves café
 * owners too. `{ notAnAdmin: true }` is the signal to fall through to the café
 * owner path — and it is only ever returned when the address matches no
 * administrator at all, so an owner signing in leaves no misleading trail in
 * the admin login log.
 */
export const attemptAdminLogin = async (req, email, password) => {
  const admin = (await pool.query(`
    SELECT a.*, r.role_key, r.is_superuser
    FROM admin_users a
    JOIN admin_roles r ON r.admin_role_id = a.admin_role_id
    WHERE LOWER(a.email) = $1
  `, [email])).rows[0];

  if (!admin) return { notAnAdmin: true };

  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    await logAttempt(req, { adminUserId: admin.admin_user_id, email, outcome: 'LOCKED' });
    const minutes = Math.ceil((new Date(admin.locked_until) - Date.now()) / 60000);
    return {
      ok: false, status: 429,
      message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    };
  }

  if (admin.status !== 'ACTIVE') {
    await logAttempt(req, { adminUserId: admin.admin_user_id, email, outcome: 'SUSPENDED' });
    return { ok: false, status: 403, message: 'This account is not active' };
  }

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    const maxAttempts = Number(await getSetting('admin.max_login_attempts', 5));
    const lockMinutes = Number(await getSetting('admin.lockout_minutes', 15));
    const attempts = admin.failed_attempts + 1;

    /* Every parameter is cast. Comparing two bare parameters to each other
       ($2 >= $3) gives Postgres nothing to infer a type from and it refuses
       the statement — which turned a wrong password into a 500 and, far worse,
       meant the counter never incremented and the lockout never armed. */
    await pool.query(`
      UPDATE admin_users
      SET failed_attempts = $2::int,
          locked_until = CASE
            WHEN $2::int >= $3::int THEN NOW() + ($4::text || ' minutes')::interval
            ELSE locked_until
          END
      WHERE admin_user_id = $1
    `, [admin.admin_user_id, attempts, maxAttempts, String(lockMinutes)]);

    await logAttempt(req, { adminUserId: admin.admin_user_id, email, outcome: 'BAD_PASSWORD' });

    /* The attempt that trips the lock says so. Reporting it as an ordinary
       wrong password would leave someone typing a password they have now
       corrected, being refused for a reason that no longer applies. */
    if (attempts >= maxAttempts) {
      return {
        ok: false, status: 429,
        message: `Too many failed attempts. Try again in ${lockMinutes} minute${lockMinutes === 1 ? '' : 's'}.`
      };
    }
    return { ok: false, status: 401, message: REFUSED };
  }

  await pool.query(`
    UPDATE admin_users
    SET failed_attempts = 0, locked_until = NULL,
        last_login_at = CURRENT_TIMESTAMP, last_login_ip = $2
    WHERE admin_user_id = $1
  `, [admin.admin_user_id, clientIp(req)]);

  await logAttempt(req, { adminUserId: admin.admin_user_id, email, outcome: 'SUCCESS' });

  const token = await signAdminToken(admin);
  const loaded = await loadAdmin(admin.admin_user_id);

  return {
    ok: true,
    data: {
      token,
      admin: {
        admin_user_id: loaded.admin_user_id,
        name: loaded.name,
        email: loaded.email,
        role: loaded.role_key,
        role_label: loaded.role_label,
        is_superuser: loaded.is_superuser,
        permissions: loaded.permissions
      }
    },
    message: `Welcome back, ${admin.name.split(' ')[0]}`
  };
};

/** POST /api/admin/auth/login — the administrator-only door. */
export const login = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const result = await attemptAdminLogin(req, email, password);

    if (result.notAnAdmin) {
      /* Hash something anyway. Returning instantly for an unknown address and
         slowly for a known one turns response time into a user-enumeration
         oracle, which is the whole thing the identical message protects. */
      await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO');
      await logAttempt(req, { email, outcome: 'NO_SUCH_USER' });
      return res.status(401).json({ success: false, message: REFUSED });
    }

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({ success: true, message: result.message, data: result.data });
  } catch (error) {
    console.error('Admin login failed:', error);
    res.status(500).json({ success: false, message: 'Could not sign you in. Please try again.' });
  }
};


/** GET /api/admin/auth/me — who am I, and what may I do. */
export const me = async (req, res) => {
  const a = req.admin;
  res.json({
    success: true,
    data: {
      admin_user_id: a.admin_user_id,
      name: a.name,
      email: a.email,
      role: a.role_key,
      role_label: a.role_label,
      is_superuser: a.is_superuser,
      permissions: a.permissions
    }
  });
};

/**
 * POST /api/admin/auth/logout
 *
 * Tokens are stateless, so this records the event and lets the client discard
 * the token. Saying otherwise would be theatre; a real server-side revocation
 * needs a token store, which is a deliberate later decision.
 */
export const logout = async (req, res) => {
  await recordAdminAudit(req, { action: 'admin.logout', resource_type: 'admin_user',
    resource_id: req.admin?.admin_user_id });
  res.json({ success: true, message: 'Signed out' });
};

/**
 * POST /api/admin/auth/forgot-password
 *
 * Answers identically whether or not the address exists. The token is
 * returned in the response ONLY when no mail transport is configured, so a
 * self-hosted operator is not locked out of their own console — and that
 * branch is gated on an explicit environment flag rather than on NODE_ENV,
 * which is too easy to have wrong in production.
 */
export const forgotPassword = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = {
    success: true,
    message: 'If that address belongs to an administrator, a reset link is on its way.'
  };

  if (!email) return res.json(generic);

  try {
    const admin = (await pool.query(
      'SELECT admin_user_id, email FROM admin_users WHERE LOWER(email) = $1 AND status = $2',
      [email, 'ACTIVE']
    )).rows[0];

    if (!admin) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    await pool.query(`
      UPDATE admin_users
      SET reset_token_hash = $2, reset_expires_at = NOW() + interval '1 hour'
      WHERE admin_user_id = $1
    `, [admin.admin_user_id, hash]);

    await logAttempt(req, { adminUserId: admin.admin_user_id, email, outcome: 'RESET_REQUESTED' });

    if (process.env.ADMIN_RESET_ECHO === 'true') {
      console.log(`[admin reset] ${admin.email} -> ${token}`);
      return res.json({ ...generic, data: { reset_token: token } });
    }

    // No mail transport is wired yet. Logged server-side so an operator can
    // retrieve it from the console rather than being stuck.
    console.log(`[admin reset] token issued for ${admin.email}: ${token}`);
    return res.json(generic);
  } catch (error) {
    console.error('Admin password reset request failed:', error);
    return res.json(generic);
  }
};

/** POST /api/admin/auth/reset-password */
export const resetPassword = async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || password.length < 10) {
    return res.status(400).json({
      success: false,
      // Longer than the customer minimum on purpose: this password opens
      // every customer's account, not one.
      message: 'A valid reset link and a password of at least 10 characters are required'
    });
  }

  try {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const admin = (await pool.query(`
      SELECT admin_user_id, email FROM admin_users
      WHERE reset_token_hash = $1 AND reset_expires_at > NOW()
    `, [hash])).rows[0];

    if (!admin) {
      return res.status(410).json({ success: false, message: 'That reset link is no longer valid' });
    }

    await pool.query(`
      UPDATE admin_users
      SET password_hash = $2, reset_token_hash = NULL, reset_expires_at = NULL,
          failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE admin_user_id = $1
    `, [admin.admin_user_id, await bcrypt.hash(password, 10)]);

    await logAttempt(req, { adminUserId: admin.admin_user_id, email: admin.email, outcome: 'RESET_COMPLETED' });

    res.json({ success: true, message: 'Password changed. You can sign in now.' });
  } catch (error) {
    console.error('Admin password reset failed:', error);
    res.status(500).json({ success: false, message: 'Could not change the password' });
  }
};

/** POST /api/admin/auth/change-password — for a signed-in administrator. */
export const changePassword = async (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');

  if (next.length < 10) {
    return res.status(400).json({ success: false, message: 'Use a password of at least 10 characters' });
  }

  try {
    const row = (await pool.query(
      'SELECT password_hash FROM admin_users WHERE admin_user_id = $1', [req.admin.admin_user_id]
    )).rows[0];

    if (!await bcrypt.compare(current, row.password_hash)) {
      return res.status(401).json({ success: false, message: 'Your current password is incorrect' });
    }

    await pool.query(
      'UPDATE admin_users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE admin_user_id = $1',
      [req.admin.admin_user_id, await bcrypt.hash(next, 10)]
    );
    await recordAdminAudit(req, { action: 'admin.password_changed', resource_type: 'admin_user',
      resource_id: req.admin.admin_user_id });

    res.json({ success: true, message: 'Password changed' });
  } catch (error) {
    console.error('Admin password change failed:', error);
    res.status(500).json({ success: false, message: 'Could not change your password' });
  }
};
