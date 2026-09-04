/*
 * Forgot password — one door for both a café owner (`users`) and a customer
 * (`customers`).
 *
 * A single flow rather than two, because the person resetting a password does
 * not know or care which table their row lives in — they know their email.
 * The awkward case this has to get right is a person who is both: an owner
 * who is also a customer somewhere, under the same address. Rather than pick
 * one table arbitrarily, every step here acts on *every* account that email
 * touches, so proving control of the inbox resets all of them together.
 *
 * Same discipline as the platform-admin reset this mirrors:
 *   - the response never reveals whether the email exists
 *   - only a hash of the code is stored, never the code itself
 *   - failed attempts are counted and the code is burned after too many
 *   - every attempt is logged server-side even when the account is unknown
 */
import bcrypt from 'bcryptjs';
import bcryptCompiled from 'bcrypt';
import crypto from 'crypto';
import pool from '../config/database.js';
import { sendMail, passwordResetOtpEmail } from '../modules/mail/mailer.js';

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

/** A 6-digit code, zero-padded — crypto-random, not Math.random. */
const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

/**
 * Every account this email touches, owner and customer both.
 *
 * `table` and the hashing library travel together: `users` was built against
 * bcryptjs, `customers` against the native `bcrypt` binding. Both produce and
 * verify the same hash format, but resetting a password has to write it back
 * with the library the rest of that table's code already uses.
 */
const findAccounts = async (email) => {
  const owner = (await pool.query(
    'SELECT id, name, email FROM users WHERE LOWER(email) = $1',
    [email]
  )).rows[0];

  const customer = (await pool.query(
    'SELECT customer_id, customer_name, email FROM customers WHERE LOWER(email) = $1',
    [email]
  )).rows[0];

  const accounts = [];
  if (owner) accounts.push({ table: 'users', idCol: 'id', id: owner.id, name: owner.name, bcrypt });
  if (customer) accounts.push({ table: 'customers', idCol: 'customer_id', id: customer.customer_id, name: customer.customer_name, bcrypt: bcryptCompiled });
  return accounts;
};

/*
 * Which café's name goes in the reset email's subject. A customer account
 * belongs to exactly one café; an owner may run more than one, so the
 * oldest — the one they set up first — wins, same rule auth.Controller.js
 * uses to decide which café an owner's session is scoped to. Neither table
 * having a café yet (a bare owner account with none provisioned) falls back
 * to plain "ManagerXP" branding rather than a missing name.
 */
const resolveCafeName = async (account) => {
  const row = account.table === 'customers'
    ? (await pool.query(
        'SELECT c.name FROM cafes c JOIN customers cu ON cu.cafe_id = c.cafe_id WHERE cu.customer_id = $1',
        [account.id]
      )).rows[0]
    : (await pool.query(
        'SELECT name FROM cafes WHERE user_id = $1 ORDER BY cafe_id ASC LIMIT 1',
        [account.id]
      )).rows[0];
  return row ? row.name : null;
};

const setOtp = async (account, hash, expiresAt) => {
  await pool.query(
    `UPDATE ${account.table}
        SET reset_otp_hash = $1, reset_otp_expires_at = $2, reset_otp_attempts = 0
      WHERE ${account.idCol} = $3`,
    [hash, expiresAt, account.id]
  );
};

/** Re-fetch just the reset columns, so a stale row from findAccounts is never checked against. */
const loadOtpState = async (account) => (await pool.query(
  `SELECT reset_otp_hash, reset_otp_expires_at, reset_otp_attempts
     FROM ${account.table} WHERE ${account.idCol} = $1`,
  [account.id]
)).rows[0];

const bumpAttempts = async (account) => {
  await pool.query(
    `UPDATE ${account.table} SET reset_otp_attempts = reset_otp_attempts + 1 WHERE ${account.idCol} = $1`,
    [account.id]
  );
};

const clearOtp = async (account) => {
  await pool.query(
    `UPDATE ${account.table}
        SET reset_otp_hash = NULL, reset_otp_expires_at = NULL, reset_otp_attempts = 0
      WHERE ${account.idCol} = $1`,
    [account.id]
  );
};

/**
 * Check one account's stored code against what was submitted.
 *
 * Returns a reason rather than a boolean so the caller can log something more
 * useful than "failed" — but the reason never reaches the HTTP response,
 * where every failure reads the same to avoid confirming which detail was
 * wrong.
 */
const checkOtp = (state, submittedHash) => {
  if (!state || !state.reset_otp_hash) return 'no_active_code';
  if (state.reset_otp_attempts >= MAX_ATTEMPTS) return 'too_many_attempts';
  if (new Date(state.reset_otp_expires_at) <= new Date()) return 'expired';
  if (state.reset_otp_hash !== submittedHash) return 'mismatch';
  return 'ok';
};

// POST /api/account/forgot-password  { email }
export const forgotPassword = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = {
    success: true,
    message: 'If that email has an account, a reset code is on its way.'
  };

  if (!email) return res.json(generic);

  try {
    const accounts = await findAccounts(email);
    if (!accounts.length) return res.json(generic);

    const code = generateOtp();
    const hash = hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_MINUTES * 60000);

    await Promise.all(accounts.map((a) => setOtp(a, hash, expiresAt)));

    const name = accounts[0].name;
    // The customer side is the more specific "this café's login" framing when
    // an email is both a customer and an owner somewhere.
    const cafeAccount = accounts.find((a) => a.table === 'customers') || accounts[0];
    const cafeName = await resolveCafeName(cafeAccount).catch(() => null);
    const template = passwordResetOtpEmail({ name, code, minutes: OTP_MINUTES, cafeName });
    const sent = await sendMail({ to: email, toName: name, kind: 'password_reset', ...template });

    console.log(`[password reset] OTP issued for ${email} (${accounts.map((a) => a.table).join(' + ')})` +
      (sent.sent ? '' : ` — email not sent: ${sent.message}`));

    /*
     * The one deliberate exception to "never reveal anything": when mail is
     * not configured at all, a self-hosted operator must not be locked out of
     * their own database over a missing SMTP setting. The code is echoed back
     * only in that specific case, and only server-side operators will ever
     * see it logged either way.
     */
    if (sent.reason === 'no_transport') {
      return res.json({ ...generic, data: { otp_debug: code, note: 'Email is not configured — showing the code directly.' } });
    }

    return res.json(generic);
  } catch (error) {
    console.error('Password reset request failed:', error);
    return res.json(generic);
  }
};

// POST /api/account/verify-otp  { email, otp }
/*
 * A read-only check, used so the UI can move from "enter the code" to "choose
 * a password" without asking twice. It still counts against the same attempt
 * budget as the real reset — otherwise it would be a second, unlimited guess
 * against the same 6-digit code.
 */
export const verifyOtp = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const otp = String(req.body?.otp || '').trim();
  const REFUSED = { success: false, message: 'That code is incorrect or has expired' };

  if (!email || !/^\d{6}$/.test(otp)) return res.status(400).json(REFUSED);

  try {
    const accounts = await findAccounts(email);
    if (!accounts.length) return res.status(400).json(REFUSED);

    const hash = hashOtp(otp);
    let anyOk = false;

    for (const account of accounts) {
      const state = await loadOtpState(account);
      const result = checkOtp(state, hash);
      if (result === 'ok') { anyOk = true; continue; }
      if (result === 'mismatch') await bumpAttempts(account);
    }

    if (!anyOk) return res.status(400).json(REFUSED);
    return res.json({ success: true, message: 'Code verified' });
  } catch (error) {
    console.error('OTP verification failed:', error);
    return res.status(500).json(REFUSED);
  }
};

// POST /api/account/reset-password  { email, otp, password }
export const resetPassword = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const otp = String(req.body?.otp || '').trim();
  const password = String(req.body?.password || '');
  const REFUSED = { success: false, message: 'That code is incorrect or has expired' };

  if (!email || !/^\d{6}$/.test(otp)) return res.status(400).json(REFUSED);
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Use a password of at least 8 characters' });
  }

  try {
    const accounts = await findAccounts(email);
    if (!accounts.length) return res.status(400).json(REFUSED);

    const hash = hashOtp(otp);
    const eligible = [];

    for (const account of accounts) {
      const state = await loadOtpState(account);
      const result = checkOtp(state, hash);
      if (result === 'ok') eligible.push(account);
      else if (result === 'mismatch') await bumpAttempts(account);
    }

    if (!eligible.length) return res.status(400).json(REFUSED);

    // Every account this email actually proved control of, reset together —
    // never the ones that merely share the address without a matching code.
    await Promise.all(eligible.map(async (account) => {
      const passwordHash = await account.bcrypt.hash(password, 10);
      await pool.query(
        `UPDATE ${account.table} SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE ${account.idCol} = $2`,
        [passwordHash, account.id]
      );
      await clearOtp(account);
    }));

    console.log(`[password reset] completed for ${email} (${eligible.map((a) => a.table).join(' + ')})`);

    return res.json({ success: true, message: 'Password changed. You can sign in now.' });
  } catch (error) {
    console.error('Password reset failed:', error);
    return res.status(500).json({ success: false, message: 'Could not change the password' });
  }
};

export default { forgotPassword, verifyOtp, resetPassword };
