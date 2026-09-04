/*
 * "Sign in with Google" — the OAuth 2.0 authorization-code flow.
 *
 * Two hops:
 *   GET /api/auth/google           → sends the browser to Google's consent page.
 *   GET /api/auth/google/callback  → Google sends it back here with a code; we
 *                                     swap the code for the user's verified
 *                                     profile, find or make their account, and
 *                                     hand the browser back to the frontend with
 *                                     the app's own token.
 *
 * The account that comes out the far end is an ordinary `users` row and the
 * token is the ordinary owner token — so everything downstream (the dashboard,
 * the portal, every tenant-scoped query) treats a Google sign-in exactly like a
 * password sign-in. Google only decides *who*; it never gets a say in *what they
 * can do*.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import pool from '../config/database.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
/* Where the browser lands after we are done. Falls back to the site root so a
   missing setting degrades to "home", never to a blank backend page. */
const POST_LOGIN = process.env.GOOGLE_POST_LOGIN_REDIRECT
  || `${process.env.PUBLIC_BASE_URL || 'http://localhost:5173'}/auth/google`;
const FRONTEND = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';

export const googleConfigured = () => !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

const client = () => new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

/* The café an account is scoped to — oldest first, so it is stable rather than
   whatever row the heap hands back. Same rule the password login uses. */
const resolveCafeId = async (userId) => {
  const r = await pool.query(
    'SELECT cafe_id FROM cafes WHERE user_id = $1 ORDER BY cafe_id ASC LIMIT 1', [userId]);
  return r.rows[0]?.cafe_id ?? null;
};

/** Bounce back to the login page with a reason, never a stack trace. */
const fail = (res, reason) =>
  res.redirect(`${FRONTEND}/login?error=${encodeURIComponent(reason)}`);

/* ==========================================================================
   GET /api/auth/google
   ========================================================================== */
/* Accept the frontend's own origin as where the browser started from, so the
   post-login redirect lands back on whichever host/IP actually served the
   login page — the LAN IP of a second machine, not just whatever single
   address happens to be in .env. Only a bare http(s) origin is trusted
   (scheme+host+port, no path); anything else falls back to .env's default. */
const parseOrigin = (raw) => {
  if (!raw) return null;
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch { return null; }
};

export const startGoogleAuth = (req, res) => {
  if (!googleConfigured()) {
    return fail(res, 'google_not_configured');
  }
  const origin = parseOrigin(req.query.origin);
  /*
   * `state` is a short-lived signed token, checked on the way back. Without it
   * an attacker could feed a victim a callback URL carrying the attacker's code
   * and sign the victim into the attacker's account (login CSRF). Signed with
   * the app secret and given two minutes to live, it cannot be forged and
   * cannot be replayed later. The caller's origin rides along in the same
   * signed payload so it can't be tampered with on the way back either.
   */
  const state = jwt.sign({ n: crypto.randomBytes(8).toString('hex'), origin },
    process.env.JWT_SECRET, { expiresIn: '2m' });

  const url = client().generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    // Let a returning user pick which Google account, rather than silently
    // reusing whichever one the browser is already signed into.
    prompt: 'select_account',
    state
  });
  res.redirect(url);
};

/* ==========================================================================
   GET /api/auth/google/callback
   ========================================================================== */
export const googleCallback = async (req, res) => {
  if (!googleConfigured()) return fail(res, 'google_not_configured');

  const { code, state, error } = req.query;
  // The user clicked "cancel" on the consent screen, or Google refused.
  if (error) return fail(res, 'google_denied');
  if (!code || !state) return fail(res, 'google_bad_request');

  let postLogin = POST_LOGIN;
  try {
    const decoded = jwt.verify(String(state), process.env.JWT_SECRET);   // throws if forged/expired
    if (decoded.origin) postLogin = `${decoded.origin}/auth/google`;
  } catch {
    return fail(res, 'google_state_invalid');
  }

  try {
    const oauth = client();
    const { tokens } = await oauth.getToken(String(code));
    if (!tokens.id_token) return fail(res, 'google_no_identity');

    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
    const p = ticket.getPayload();

    /* An unverified Google email must not be trusted to match an existing
       account — that is how one person's Google would take over another's
       password account. Google marks consumer accounts verified; refuse the
       rare case that is not. */
    if (!p?.email || !p.email_verified) return fail(res, 'google_email_unverified');

    const email = String(p.email).toLowerCase();
    const googleId = String(p.sub);
    const name = p.name || email.split('@')[0];
    const picture = p.picture || null;

    /* Find by Google id first, then by email — so a password account with the
       same address is linked rather than duplicated. */
    let user = (await pool.query(
      `SELECT id, email, name, role FROM users
        WHERE google_id = $1 OR LOWER(email) = $2
        ORDER BY (google_id = $1) DESC LIMIT 1`,
      [googleId, email]
    )).rows[0];

    if (user) {
      /* Link the Google identity to the existing row and keep the picture
         fresh, without ever overwriting a name the owner may have set.

         The address is marked verified here too: Google only issues an
         email_verified profile for an address it has already proven, which is
         the same proof our own six-digit code exists to obtain. Somebody who
         signed up with a password and never got round to typing the code has
         now demonstrated the address a stronger way. */
      await pool.query(
        `UPDATE users
            SET google_id = COALESCE(google_id, $1),
                avatar_url = COALESCE($2, avatar_url),
                email_verified = TRUE,
                verify_otp_hash = NULL,
                verify_otp_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [googleId, picture, user.id]
      );
    } else {
      /* A brand-new account. It has no password anyone set, so the column —
         which is NOT NULL — is filled with a random hash that no input can ever
         match; the account is reached only through Google. phone_number is left
         empty for the owner to complete in their profile later. */
      const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      user = (await pool.query(
        `INSERT INTO users (email, phone_number, name, address, password, role,
                            google_id, avatar_url, auth_provider, email_verified)
         VALUES ($1, '', $2, '{}'::jsonb, $3, 'user', $4, $5, 'google', TRUE)
         RETURNING id, email, name, role`,
        [email, name, unusable, googleId, picture]
      )).rows[0];
    }

    const cafeId = await resolveCafeId(user.id);
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, cafe_id: cafeId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    /* The frontend rebuilds its session from this. Sent in the URL *fragment*,
       not the query: a fragment is never sent to a server and never lands in a
       Referer header, so the token does not leak the way `?token=` would. The
       user object is a compact base64 so the callback page can show the right
       name and avatar without a second round trip. */
    const profile = Buffer.from(JSON.stringify({
      id: user.id, email: user.email, name: user.name, role: user.role,
      cafe_id: cafeId, avatar_url: picture
    })).toString('base64');

    return res.redirect(`${postLogin}#token=${encodeURIComponent(token)}&user=${encodeURIComponent(profile)}`);
  } catch (err) {
    console.error('Google callback failed:', err.message);
    return fail(res, 'google_failed');
  }
};
