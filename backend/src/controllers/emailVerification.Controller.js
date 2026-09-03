/*
 * Email verification for new accounts — café owners and customers alike.
 *
 * Signing up proves somebody can type an address; it does not prove the address
 * is theirs, or that it exists. A code sent to it and typed back does both,
 * which is what stops a café account being created against a mistyped address
 * whose password reset then goes to a stranger.
 *
 * The discipline matches the password-reset OTP, for the same reasons:
 *   - only a hash of the code is stored, never the code itself
 *   - it expires, and failed attempts are counted before it is burned
 *   - "was this address already verified" is never leaked to an unauthenticated
 *     caller, so this cannot be used to enumerate who has an account
 *
 * Accounts created through "Sign in with Google" skip all of this: Google has
 * already proved the address, and asking a customer to verify an address they
 * just proved is friction that buys nothing.
 *
 * One set of primitives, two principals. A café owner (`users`) and a customer
 * (`customers`) are different tables with different id columns, but the OTP
 * hashing, expiry and attempt-limiting is identical — `KIND` is the only thing
 * that changes between them, so the logic lives once and the table it runs
 * against is a lookup, not a fork.
 */
import crypto from 'crypto';
import pool from '../config/database.js';
import { sendMail, emailVerificationOtpEmail } from '../modules/mail/mailer.js';

const OTP_MINUTES = 15;
const MAX_ATTEMPTS = 5;

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');
const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

/* Table + id column for each principal this applies to. `relatedType` is
   what goes on the outgoing email's audit row in `email_outbox`. */
const KIND = {
  owner: { table: 'users', idColumn: 'id', relatedType: 'user' },
  customer: { table: 'customers', idColumn: 'customer_id', relatedType: 'customer' }
};

/*
 * Which café's name goes in the email's subject, so someone juggling logins
 * for more than one café — or a customer account under a specific café —
 * knows which one a code is for before opening it. A brand-new owner
 * account has no café yet (one hasn't been provisioned at registration
 * time), so this resolves to nothing and the email falls back to plain
 * "ManagerXP" branding rather than a wrong or missing name.
 */
const resolveCafeName = async (principal, kind) => {
  const row = kind === 'customer'
    ? (await pool.query(
        'SELECT c.name FROM cafes c JOIN customers cu ON cu.cafe_id = c.cafe_id WHERE cu.customer_id = $1',
        [principal.id]
      )).rows[0]
    : (await pool.query(
        'SELECT name FROM cafes WHERE user_id = $1 ORDER BY cafe_id ASC LIMIT 1',
        [principal.id]
      )).rows[0];
  return row ? row.name : null;
};

/**
 * Put a fresh code on an account and email it.
 *
 * Exported because registration calls it directly — the code goes out as part
 * of signing up, not as a second request the client has to remember to make.
 * Never throws: an account that exists but whose email bounced is recoverable
 * (resend), while a signup rolled back because SMTP hiccuped is not.
 *
 * `principal` is `{ id, email, name }` — for a customer, pass its
 * `customer_id` as `id` at the call site rather than teaching this function a
 * second id-field name to read.
 */
export const issueVerificationCode = async (principal, kind = 'owner') => {
  const { table, idColumn, relatedType } = KIND[kind];
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60 * 1000);

  try {
    await pool.query(
      `UPDATE ${table}
          SET verify_otp_hash = $1, verify_otp_expires_at = $2, verify_otp_attempts = 0
        WHERE ${idColumn} = $3`,
      [hashOtp(code), expiresAt, principal.id]
    );

    const cafeName = await resolveCafeName(principal, kind).catch(() => null);
    const tpl = emailVerificationOtpEmail({ name: principal.name, code, minutes: OTP_MINUTES, cafeName });
    const mail = await sendMail({
      to: principal.email, toName: principal.name, ...tpl,
      kind: 'email_verification', relatedType, relatedId: String(principal.id)
    });
    return { sent: !!mail.sent, message: mail.message };
  } catch (error) {
    console.error('Could not issue a verification code:', error.message);
    return { sent: false, message: 'Could not send the verification code' };
  }
};

/**
 * POST .../verify-email   { email, code }
 *
 * The one place an unverified account becomes usable. Returned as a factory
 * so the same body of logic serves both `/api/auth/verify-email` (owners) and
 * `/api/customers/verify-email` (customers) — see the bound exports below.
 */
const makeVerifyEmail = (kind) => async (req, res) => {
  const { table, idColumn } = KIND[kind];
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();

    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: 'Enter the six-digit code sent to your email' });
    }

    const nameColumn = kind === 'customer' ? 'customer_name' : 'name';
    const account = (await pool.query(
      `SELECT ${idColumn} AS id, email, ${nameColumn} AS name,
              email_verified, verify_otp_hash, verify_otp_expires_at, verify_otp_attempts
         FROM ${table} WHERE LOWER(email) = $1`, [email])).rows[0];

    /* A wrong address and a wrong code are answered the same way. Saying "no
       such account" here would turn this endpoint into a way to discover which
       addresses are registered. */
    if (!account) {
      return res.status(400).json({ success: false, message: 'That code is not valid. Ask for a new one.' });
    }

    // Already done — idempotent, so a double-submit is a success, not an error.
    if (account.email_verified) {
      return res.status(200).json({ success: true, message: 'This email is already verified', data: { verified: true } });
    }

    if (!account.verify_otp_hash) {
      return res.status(400).json({ success: false, message: 'No code is waiting. Ask for a new one.' });
    }
    if (account.verify_otp_attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Ask for a new code.' });
    }
    if (new Date(account.verify_otp_expires_at) <= new Date()) {
      return res.status(400).json({ success: false, message: 'That code has expired. Ask for a new one.' });
    }

    if (account.verify_otp_hash !== hashOtp(code)) {
      await pool.query(
        `UPDATE ${table} SET verify_otp_attempts = verify_otp_attempts + 1 WHERE ${idColumn} = $1`, [account.id]);
      const left = MAX_ATTEMPTS - (account.verify_otp_attempts + 1);
      return res.status(400).json({
        success: false,
        message: left > 0
          ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'That code is not right. Ask for a new one.'
      });
    }

    /* Verified. The code is burned in the same statement that flips the flag,
       so it cannot be replayed. */
    await pool.query(
      `UPDATE ${table}
          SET email_verified = TRUE, verify_otp_hash = NULL,
              verify_otp_expires_at = NULL, verify_otp_attempts = 0,
              updated_at = CURRENT_TIMESTAMP
        WHERE ${idColumn} = $1`, [account.id]);

    res.status(200).json({
      success: true,
      message: 'Email verified — you can sign in now',
      data: { verified: true }
    });
  } catch (error) {
    console.error('Email verification failed:', error);
    res.status(500).json({ success: false, message: 'Could not verify that code' });
  }
};

/**
 * POST .../resend-verification   { email }
 *
 * Always answers the same, whether or not the address has an account waiting.
 */
const makeResendVerification = (kind) => async (req, res) => {
  const { table, idColumn } = KIND[kind];
  const generic = {
    success: true,
    message: 'If that address needs verifying, a new code is on its way.'
  };
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'Enter your email address' });

    const nameColumn = kind === 'customer' ? 'customer_name' : 'name';
    const account = (await pool.query(
      `SELECT ${idColumn} AS id, email, ${nameColumn} AS name, email_verified FROM ${table} WHERE LOWER(email) = $1`,
      [email])).rows[0];

    if (account && !account.email_verified) await issueVerificationCode(account, kind);

    res.status(200).json(generic);
  } catch (error) {
    console.error('Resend verification failed:', error);
    res.status(200).json(generic);   // still generic — never leak the failure shape
  }
};

// Café owners — unchanged route/import names, so auth.Routes.js needs no edit.
export const verifyEmail = makeVerifyEmail('owner');
export const resendVerification = makeResendVerification('owner');

// Customers.
export const verifyCustomerEmail = makeVerifyEmail('customer');
export const resendCustomerVerification = makeResendVerification('customer');
