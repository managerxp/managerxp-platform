/*
 * Encryption for gateway credentials.
 *
 * A payment gateway's API secret is the authority to charge the café's
 * customers and move money into its account. Storing it as plaintext in a
 * column means anyone with a database dump — a backup file, a support export,
 * a compromised read replica — has the café's merchant account.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a secret that has been
 * tampered with fails to decrypt rather than silently returning nonsense that
 * would then be sent to the provider.
 */
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;    // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;

/*
 * The key, derived from PAYMENTS_ENC_KEY.
 *
 * Falls back to JWT_SECRET so an existing deployment keeps working rather than
 * crashing on boot, but the two are put through separate HKDF info strings:
 * the derived key is unrelated to the token-signing key, so leaking one does
 * not hand over the other.
 *
 * Derived lazily rather than at import. ES module imports are hoisted and run
 * before any statement in the importing file, so a module that reads
 * process.env at import time silently gets whatever was loaded *before* it in
 * the import graph. That happens to be correct today; it would break the
 * moment someone reorders an import, and it would break by storing
 * unencrypted secrets rather than by throwing. Reading on first use makes the
 * ordering irrelevant.
 */
let keyCache;

const getKey = () => {
  if (keyCache !== undefined) return keyCache;

  const material = process.env.PAYMENTS_ENC_KEY || process.env.JWT_SECRET;
  keyCache = material
    ? crypto.hkdfSync('sha256', Buffer.from(material, 'utf8'),
        Buffer.from('cafexp.payments.v1', 'utf8'),
        Buffer.from('gateway-credential-encryption', 'utf8'), 32)
    // No key at all: refuse to pretend the secrets are protected.
    : null;

  return keyCache;
};

/** Whether credentials can be stored at all. */
export const canEncrypt = () => getKey() !== null;

/**
 * Encrypt a secret for storage.
 * Returns `iv.tag.ciphertext`, all base64url — one column, no side table.
 */
export const encryptSecret = (plaintext) => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const key = getKey();
  if (!key) throw new Error('Encryption key is not configured');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, Buffer.from(key), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.');
};

/**
 * Decrypt a stored secret.
 *
 * Returns null rather than throwing on anything malformed. A gateway whose
 * credentials cannot be read must fail as "not configured" — a thrown error
 * here would surface as a 500 on a customer's top-up, which tells an attacker
 * more than it tells the café.
 */
export const decryptSecret = (stored) => {
  const key = getKey();
  if (!stored || !key) return null;
  try {
    const [ivB64, tagB64, bodyB64] = String(stored).split('.');
    if (!ivB64 || !tagB64 || !bodyB64) return null;

    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = crypto.createDecipheriv(ALGO, Buffer.from(key), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return null;
  }
};

/**
 * A hint the operator can recognise without the secret being recoverable.
 * "•••• 7f2a" is enough to answer "is this the key I pasted?".
 */
export const secretHint = (plaintext) => {
  if (!plaintext) return null;
  const s = String(plaintext);
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
};

/**
 * Constant-time string comparison for signatures.
 *
 * `===` on a signature leaks its content through timing: an attacker learns
 * how many leading bytes were right from how long the comparison took, and
 * can recover a valid signature byte by byte.
 */
export const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak-free
  // signal: different lengths cannot be a valid signature anyway.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};
