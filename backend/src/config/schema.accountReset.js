/* ==========================================================================
   Forgot password — OTP reset for café owners and customers.

   A 6-digit code, not a link. Both account kinds are used from places a link
   is awkward to act on — a café owner mid-shift on the desktop console, a
   customer at a shared station — so the reset has to be typeable, not
   click-through. The code is short-lived and attempt-limited instead: what a
   link's unguessable length buys you, a tight expiry and a lockout buy here.

   One pair of columns on each of `users` (café owners) and `customers`,
   rather than a shared table, because a reset is intrinsic to the account row
   it belongs to — same reasoning as admin_users' own reset_token_hash.

   Only the hash is stored, never the code itself — the same discipline as a
   password. `reset_otp_attempts` is what turns a 6-digit space (only a
   million possibilities, far weaker than a token) into something that cannot
   be brute-forced: the code is invalidated long before a guessing script gets
   close.
   ========================================================================== */
export const initializeAccountReset = async (client) => {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reset_otp_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reset_otp_attempts SMALLINT NOT NULL DEFAULT 0
  `);

  await client.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS reset_otp_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reset_otp_attempts SMALLINT NOT NULL DEFAULT 0
  `);

  console.log('✅ Password reset (OTP) columns created/verified');
};

export default { initializeAccountReset };
