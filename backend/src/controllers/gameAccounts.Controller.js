/*
 * A café's venue account pool — the logins/licenses it owns so a customer
 * can "Just Play" a game without bringing an account of their own.
 *
 * The password (never the username — that alone isn't a secret) is encrypted
 * at rest with the same AES-256-GCM helper the payment-gateway credentials
 * already use; nothing here ever returns it, decrypted or otherwise. What a
 * session actually needs to launch is the account's `profile_identifier` and
 * `account_name`, not its password — the realistic way a café runs this is a
 * launcher already signed in on that PC, not CafeXP typing a password into a
 * login box on the customer's behalf, which is also the only way this can
 * comply with "never store or handle a platform password" for the customer
 * while still letting the café provide its own account.
 *
 * `status` is the reservation state session.Controller.js's startSession
 * claims against — see that file for how AVAILABLE -> IN_USE happens
 * atomically inside the session-creation transaction.
 */
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { encryptSecret, decryptSecret } from '../modules/payments/payments.crypto.js';

const clean = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const shape = (r) => ({
  id: r.id,
  game_platform_id: r.game_platform_id,
  account_name: r.account_name,
  account_type: r.account_type,
  username: r.username || null,
  has_password: !!r.credentials_encrypted,
  profile_identifier: r.profile_identifier || null,
  status: r.status,
  current_session_id: r.current_session_id || null,
  created_at: r.created_at,
  updated_at: r.updated_at
});

const loadPlatform = async (cafeId, platformId) => {
  const platform = (await pool.query(`
    SELECT gp.id, gp.platform, g.name AS game_name
      FROM game_platforms gp JOIN games g ON g.id = gp.game_id
     WHERE gp.id = $1
  `, [platformId])).rows[0];
  if (!platform) return null;
  // A café may only manage accounts for a platform of a game it has enabled.
  const enabled = (await pool.query(
    'SELECT 1 FROM cafe_games WHERE cafe_id IS NOT DISTINCT FROM $1 AND game_id = (SELECT game_id FROM game_platforms WHERE id = $2)',
    [cafeId, platformId])).rows[0];
  return enabled ? platform : null;
};

/** GET /api/games/platforms/:platformId/accounts */
export const listAccounts = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const platformId = parseInt(req.params.platformId, 10);
    const platform = await loadPlatform(cafeId, platformId);
    if (!platform) return res.status(404).json({ success: false, message: 'Not found' });

    const { rows } = await pool.query(
      `SELECT * FROM game_accounts WHERE cafe_id IS NOT DISTINCT FROM $1 AND game_platform_id = $2 ORDER BY account_name`,
      [cafeId, platformId]);
    res.json({ success: true, data: rows.map(shape) });
  } catch (error) {
    console.error('Venue account list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the venue accounts' });
  }
};

/** POST /api/games/platforms/:platformId/accounts */
export const createAccount = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const platformId = parseInt(req.params.platformId, 10);
    const platform = await loadPlatform(cafeId, platformId);
    if (!platform) return res.status(404).json({ success: false, message: 'Not found' });

    const accountName = clean(req.body?.account_name, 160);
    if (!accountName) return res.status(400).json({ success: false, message: 'Give the account a name, e.g. "Venue Account 1"' });

    const username = clean(req.body?.username, 160);
    const password = req.body?.password ? String(req.body.password) : null;
    const profileIdentifier = clean(req.body?.profile_identifier, 160);

    const encrypted = password ? encryptSecret(password) : null;

    const row = (await pool.query(`
      INSERT INTO game_accounts (cafe_id, game_platform_id, account_name, username, credentials_encrypted, profile_identifier)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [cafeId, platformId, accountName, username, encrypted, profileIdentifier])).rows[0];

    await recordAudit(req, {
      action: 'game_account.add', category: 'games', entity: 'game_account', entity_id: row.id,
      summary: `Added venue account "${accountName}" for ${platform.game_name} (${platform.platform})`
    });
    res.status(201).json({ success: true, message: `${accountName} added`, data: shape(row) });
  } catch (error) {
    console.error('Venue account create failed:', error);
    res.status(500).json({ success: false, message: 'Could not add that venue account' });
  }
};

/** PATCH /api/games/platforms/:platformId/accounts/:accountId */
export const updateAccount = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const platformId = parseInt(req.params.platformId, 10);
    const accountId = parseInt(req.params.accountId, 10);

    const before = (await pool.query(
      'SELECT * FROM game_accounts WHERE id = $1 AND game_platform_id = $2 AND cafe_id IS NOT DISTINCT FROM $3',
      [accountId, platformId, cafeId])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const sets = []; const params = [accountId];
    if (req.body?.account_name !== undefined) {
      const v = clean(req.body.account_name, 160);
      if (!v) return res.status(400).json({ success: false, message: 'The account name cannot be empty' });
      params.push(v); sets.push(`account_name = $${params.length}`);
    }
    if (req.body?.username !== undefined) {
      params.push(clean(req.body.username, 160)); sets.push(`username = $${params.length}`);
    }
    if (req.body?.password) {
      params.push(encryptSecret(String(req.body.password))); sets.push(`credentials_encrypted = $${params.length}`);
    }
    if (req.body?.profile_identifier !== undefined) {
      params.push(clean(req.body.profile_identifier, 160)); sets.push(`profile_identifier = $${params.length}`);
    }
    if (req.body?.status !== undefined) {
      /* IN_USE is set only by a session claiming the account (see
         session.Controller.js) and released the same way — staff can only
         ever choose between an account being offered or withdrawn. */
      if (!['AVAILABLE', 'DISABLED'].includes(req.body.status)) {
        return res.status(400).json({ success: false, message: 'Status must be AVAILABLE or DISABLED' });
      }
      if (before.status === 'IN_USE') {
        return res.status(409).json({ success: false, message: 'This account is in an active session — it will free up when that session ends.' });
      }
      params.push(req.body.status); sets.push(`status = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const row = (await pool.query(
      `UPDATE game_accounts SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      params)).rows[0];

    await recordAudit(req, {
      action: 'game_account.update', category: 'games', entity: 'game_account', entity_id: accountId,
      summary: `Saved venue account "${row.account_name}"`
    });
    res.json({ success: true, message: 'Saved', data: shape(row) });
  } catch (error) {
    console.error('Venue account update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that venue account' });
  }
};

/*
 * GET /api/games/platforms/:platformId/accounts/:accountId/credential
 *
 * The one exception to "nothing here ever returns the password, decrypted or
 * otherwise" — added deliberately, not by accident, so the console can relay
 * it to a station for an automated sign-in instead of a launcher already left
 * signed in being the only supported way to run a venue account.
 *
 * Every other route in this file exists for a person — filling in a form,
 * reading a table — and a person seeing a plaintext password is exactly what
 * "encrypted at rest, never shown again" was written to prevent. This route
 * exists for the console's own internal relay path only: it is never called
 * from anywhere a value could end up rendered, logged, or audited, and
 * nothing here writes the result anywhere. Callers must keep it that way.
 */
export const revealCredential = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const platformId = parseInt(req.params.platformId, 10);
    const accountId = parseInt(req.params.accountId, 10);

    const account = (await pool.query(
      'SELECT username, credentials_encrypted FROM game_accounts WHERE id = $1 AND game_platform_id = $2 AND cafe_id IS NOT DISTINCT FROM $3',
      [accountId, platformId, cafeId]
    )).rows[0];
    if (!account) return res.status(404).json({ success: false, message: 'Not found' });

    const password = account.credentials_encrypted ? decryptSecret(account.credentials_encrypted) : null;
    if (!password) {
      return res.status(404).json({ success: false, message: 'No password saved for this account' });
    }

    res.json({ success: true, data: { username: account.username || null, password } });
  } catch (error) {
    console.error('Venue account credential reveal failed:', error);
    res.status(500).json({ success: false, message: 'Could not read that credential' });
  }
};

/** DELETE /api/games/platforms/:platformId/accounts/:accountId */
export const deleteAccount = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const platformId = parseInt(req.params.platformId, 10);
    const accountId = parseInt(req.params.accountId, 10);

    const account = (await pool.query(
      'SELECT * FROM game_accounts WHERE id = $1 AND game_platform_id = $2 AND cafe_id IS NOT DISTINCT FROM $3',
      [accountId, platformId, cafeId])).rows[0];
    if (!account) return res.status(404).json({ success: false, message: 'Not found' });
    if (account.status === 'IN_USE') {
      return res.status(409).json({ success: false, message: 'This account is in an active session and cannot be removed yet.' });
    }

    await pool.query('DELETE FROM game_accounts WHERE id = $1', [accountId]);
    await recordAudit(req, {
      action: 'game_account.remove', category: 'games', entity: 'game_account', entity_id: accountId,
      summary: `Removed venue account "${account.account_name}"`
    });
    res.json({ success: true, message: `${account.account_name} removed` });
  } catch (error) {
    console.error('Venue account delete failed:', error);
    res.status(500).json({ success: false, message: 'Could not remove that venue account' });
  }
};
