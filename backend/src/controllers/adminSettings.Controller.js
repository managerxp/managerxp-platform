/*
 * ManagerXP platform settings.
 *
 * The counterpart to `settings.Controller.js`, which serves a café its own
 * configuration. They share a table and must never share a view of it: the
 * café API is scoped to `scope = 'cafe'`, this one to `scope = 'platform'`,
 * and neither can reach the other's rows.
 *
 * Two rules:
 *
 *   A secret is write-only. `mail.smtp_password` is returned as whether it is
 *   set, never as a value — not even to a super admin, because "an admin can
 *   read it" is one compromised admin session away from "an attacker can read
 *   it", and nobody needs to see a password they can simply replace.
 *
 *   Every value is validated against its declared type before it is written.
 *   A trial length of "thirty" would otherwise be stored happily and then read
 *   back as NaN by code that has no idea where the number went.
 */
import pool from '../config/database.js';
import { invalidate } from '../config/settings.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import { resetTransport, sendMail, mailConfigured } from '../modules/mail/mailer.js';

/* Presented in this order, with these headings. A settings screen that lists
   forty keys alphabetically is a settings screen nobody reads. */
const GROUPS = [
  { key: 'trial', label: 'Free trial',
    lede: 'What a new customer gets before they pay. Changing these affects trials created from now on, not ones already running.' },
  { key: 'billing', label: 'Billing',
    lede: 'How subscription invoices are priced, numbered and chased.' },
  { key: 'mail', label: 'Email',
    lede: 'Outbound mail. Without an SMTP host nothing is sent — payment links are still created, but you have to pass them on yourself.' },
  { key: 'entitlements', label: 'Entitlements',
    lede: 'How long CafeXP keeps working when it cannot reach this server.' },
  { key: 'usage', label: 'Usage warnings', lede: 'When the console starts warning about limits.' },
  { key: 'admin', label: 'Admin security', lede: 'Sign-in limits for ManagerXP administrators.' }
];

/*
 * Mail settings that `.env` can override on this deployment.
 *
 * The mailbox this instance actually sends from — ManagerXP's own — lives in
 * `.env`, not in this table; see mailer.js. Editing the row here would look
 * as though it changed something and change nothing, which is worse than the
 * field simply being absent, so the settings screen is told which keys that
 * applies to and greys them out with an explanation instead.
 */
const ENV_OVERRIDE = {
  'mail.smtp_host': 'SMTP_HOST',
  'mail.smtp_port': 'SMTP_PORT',
  'mail.smtp_user': 'SMTP_USER',
  'mail.smtp_password': 'SMTP_PASSWORD',
  'mail.smtp_secure': 'SMTP_SECURE',
  'mail.from_address': 'MAIL_FROM_ADDRESS',
  'mail.from_name': 'MAIL_FROM_NAME'
};

const shape = (row) => {
  const envVar = ENV_OVERRIDE[row.setting_key];
  const lockedByEnv = !!envVar && process.env[envVar] !== undefined && process.env[envVar] !== '';
  return {
    key: row.setting_key,
    value: row.is_secret ? null : row.setting_value,
    is_secret: row.is_secret,
    /* For a secret the only fact worth returning: whether one is stored. */
    is_set: row.is_secret ? !!row.setting_value : row.setting_value !== null,
    type: row.value_type,
    category: row.category,
    description: row.description,
    updated_at: row.updated_at,
    locked_by_env: lockedByEnv,
    locked_env_var: lockedByEnv ? envVar : null
  };
};

/** Reject a value that does not match its declared type. */
const validate = (value, type) => {
  if (value === null || value === undefined) return { value: null };
  const s = String(value);
  switch (type) {
    case 'number': {
      if (s.trim() === '' || !Number.isFinite(Number(s))) {
        return { error: 'Enter a number' };
      }
      return { value: String(Number(s)) };
    }
    case 'boolean': {
      if (!['true', 'false'].includes(s.toLowerCase())) return { error: 'Must be true or false' };
      return { value: s.toLowerCase() };
    }
    case 'json': {
      try { JSON.parse(s); } catch { return { error: 'Enter valid JSON' }; }
      return { value: s };
    }
    default:
      return { value: s };
  }
};

/** GET /api/admin/settings */
export const listPlatformSettings = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM app_settings WHERE scope = 'platform'
      ORDER BY category, setting_key
    `);

    const byCategory = new Map();
    rows.forEach((r) => {
      if (!byCategory.has(r.category)) byCategory.set(r.category, []);
      byCategory.get(r.category).push(shape(r));
    });

    /* Known groups first in their declared order, then anything unexpected —
       so a setting added later still appears rather than vanishing. */
    const known = GROUPS.map((g) => ({ ...g, settings: byCategory.get(g.key) || [] }))
      .filter((g) => g.settings.length > 0);
    const extras = [...byCategory.entries()]
      .filter(([k]) => !GROUPS.some((g) => g.key === k))
      .map(([k, settings]) => ({ key: k, label: k, lede: null, settings }));

    res.json({
      success: true,
      data: { groups: [...known, ...extras], mail_configured: await mailConfigured() }
    });
  } catch (error) {
    console.error('Platform settings list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load settings' });
  }
};

/** PUT /api/admin/settings   { settings: { key: value } } */
export const updatePlatformSettings = async (req, res) => {
  const client = await pool.connect();
  try {
    const payload = req.body?.settings;
    if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) {
      return res.status(400).json({ success: false, message: 'Nothing to change' });
    }

    const changes = [];
    const errors = [];

    await client.query('BEGIN');
    for (const [key, raw] of Object.entries(payload)) {
      const existing = (await client.query(
        `SELECT * FROM app_settings WHERE setting_key = $1 AND scope = 'platform'`, [key])).rows[0];
      if (!existing) { errors.push(`${key} is not a platform setting`); continue; }

      /* Refused rather than silently accepted-and-ignored. Writing the row
         and having `.env` win anyway is the confusing outcome this exists to
         avoid — an admin who saves a new SMTP password here should be told
         it did not take, not shown a green toast for a change that never
         reaches the mailbox. */
      const envVar = ENV_OVERRIDE[key];
      if (envVar && process.env[envVar] !== undefined && process.env[envVar] !== '') {
        errors.push(`${key} is set via the server's ${envVar} environment variable and cannot be changed here`);
        continue;
      }

      /* An empty string against a secret means "leave it alone". Blanking the
         SMTP password by saving a form that never showed it is precisely the
         accident this prevents. */
      if (existing.is_secret && (raw === '' || raw === null || raw === undefined)) continue;

      const parsed = validate(raw, existing.value_type);
      if (parsed.error) { errors.push(`${key}: ${parsed.error}`); continue; }
      if (parsed.value === existing.setting_value) continue;

      await client.query(`
        UPDATE app_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
        WHERE setting_key = $2
      `, [parsed.value, key]);

      changes.push({
        key,
        /* A secret's old and new values never enter the audit log — only that
           it changed, and by whom. */
        from: existing.is_secret ? '(secret)' : existing.setting_value,
        to: existing.is_secret ? '(secret)' : parsed.value
      });
    }

    if (errors.length && !changes.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: errors.join('; ') });
    }
    await client.query('COMMIT');

    invalidate();
    /* The mail transport holds a connection pool built from these values, so a
       changed host or password must not keep being used. */
    if (changes.some((c) => c.key.startsWith('mail.'))) resetTransport();

    if (changes.length) {
      await recordAdminAudit(req, {
        action: 'settings.updated', resource_type: 'settings',
        resource_id: changes.map((c) => c.key).join(','),
        old_value: Object.fromEntries(changes.map((c) => [c.key, c.from])),
        new_value: Object.fromEntries(changes.map((c) => [c.key, c.to]))
      });
    }

    res.json({
      success: true,
      message: changes.length
        ? `${changes.length} setting${changes.length === 1 ? '' : 's'} saved` +
          (errors.length ? ` — ${errors.length} skipped` : '')
        : 'No changes',
      data: { changed: changes.map((c) => c.key), errors }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Platform settings update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save those settings' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/settings/test-email   { to }
 *
 * The button that answers "is email actually working". Configuration that has
 * never delivered a message is a guess, and the moment to find out is now
 * rather than when a customer says an invoice never arrived.
 */
export const sendTestEmail = async (req, res) => {
  try {
    const to = String(req.body?.to || req.admin?.email || '').trim();
    if (!to) return res.status(400).json({ success: false, message: 'Enter an address to send to' });

    if (!await mailConfigured()) {
      return res.status(409).json({
        success: false,
        message: 'No SMTP host is set, so there is nowhere to send from. Fill in the email settings first.'
      });
    }

    const result = await sendMail({
      to,
      subject: 'ManagerXP test email',
      html: `<div style="font-family:sans-serif;padding:20px">
               <h2 style="margin:0 0 8px">Email is working</h2>
               <p style="color:#555;margin:0">
                 If you are reading this, ManagerXP can send payment links and invoices
                 from this server.
               </p>
             </div>`,
      text: 'Email is working. ManagerXP can send payment links and invoices from this server.',
      kind: 'test'
    });

    await recordAdminAudit(req, {
      action: 'settings.test_email', resource_type: 'settings',
      new_value: { to, sent: result.sent }
    });

    res.status(result.sent ? 200 : 502).json({
      success: result.sent,
      message: result.sent
        ? `Test email sent to ${to}. If it does not arrive, check the spam folder and the from address.`
        : result.message
    });
  } catch (error) {
    console.error('Test email failed:', error);
    res.status(500).json({ success: false, message: 'Could not send the test email' });
  }
};
