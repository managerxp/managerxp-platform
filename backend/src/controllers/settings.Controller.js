import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { invalidate, getAllSettings, setSetting } from '../config/settings.js';

/*
 * Settings — the values that used to be constants in the controllers.
 * Keys are fixed by the seed; this API updates values, it does not invent keys.
 */

const TYPES = ['string', 'number', 'boolean', 'json'];

const shape = (row) => ({
  setting_key: row.setting_key,
  setting_value: row.setting_value,
  value_type: row.value_type,
  category: row.category,
  description: row.description,
  updated_at: row.updated_at
});

/** Reject values that do not match the key's declared type. */
const validateValue = (value, type) => {
  if (value === null || value === undefined) {
    return { error: 'A value is required' };
  }

  /*
   * An empty string is a value, for a text setting.
   *
   * Blank used to be refused for everything, which meant no text setting
   * could ever be cleared once written — an address typed by mistake, a tax
   * number for a registration that lapsed, or the station unlock PIN, where
   * blank is the entire meaning of "nobody may use the keyboard hatch".
   *
   * Still refused for the typed settings, where blank is not a value at all:
   * an empty number is not zero and an empty boolean is not false.
   */
  if (value === '' && type !== 'string') {
    return { error: 'A value is required' };
  }

  const str = String(value);

  if (type === 'number') {
    const n = Number(str);
    if (!Number.isFinite(n)) return { error: 'This setting must be a number' };
    if (n < 0) return { error: 'This setting cannot be negative' };
  }
  if (type === 'boolean' && !['true', 'false', '0', '1'].includes(str.toLowerCase())) {
    return { error: 'This setting must be true or false' };
  }
  if (type === 'json') {
    try { JSON.parse(str); } catch { return { error: 'This setting must be valid JSON' }; }
  }
  return { value: str };
};

// GET /api/settings?category=
/*
 * Café-scoped only.
 *
 * This table also holds ManagerXP's own configuration — SMTP credentials,
 * trial length, platform tax — and this API is reachable by any café staff
 * account with `settings.view`. Without the scope filter a cashier could read
 * the outbound mail password and an owner could lengthen their own trial.
 *
 * Applied in the query rather than by filtering the result, so a future caller
 * that forgets to filter cannot reintroduce it.
 */
const CAFE_SCOPE = `scope = 'cafe'`;

export const listSettings = async (req, res) => {
  try {
    /*
     * This café's own value where it has one, the platform default otherwise.
     *
     * DISTINCT ON with the café's rows sorted first picks the override when
     * it exists and falls through to the default when it does not, in one
     * pass — so a café that has never opened this screen still sees a full,
     * sensible set rather than an empty one.
     */
    const cafeId = req.actor?.cafe_id ?? null;
    const params = [cafeId];
    let where = `WHERE ${CAFE_SCOPE} AND (cafe_id IS NULL OR cafe_id = $1)`;
    if (req.query.category) {
      params.push(String(req.query.category));
      where += ` AND category = $2`;
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (setting_key) *
         FROM app_settings ${where}
        ORDER BY setting_key ASC, (cafe_id IS NULL) ASC`,
      params
    );
    result.rows.sort((a, b) =>
      (a.category || '').localeCompare(b.category || '') ||
      a.setting_key.localeCompare(b.setting_key));

    // Grouped by category so a settings screen can render sections directly.
    const grouped = {};
    result.rows.forEach((row) => {
      (grouped[row.category] = grouped[row.category] || []).push(shape(row));
    });

    res.status(200).json({
      success: true,
      data: result.rows.map(shape),
      grouped
    });
  } catch (error) {
    console.error('Error listing settings:', error);
    res.status(500).json({ success: false, message: 'Error fetching settings' });
  }
};

// GET /api/settings/:key
export const getSettingByKey = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM app_settings
        WHERE setting_key = $1 AND ${CAFE_SCOPE} AND (cafe_id IS NULL OR cafe_id = $2)
        ORDER BY (cafe_id IS NULL) ASC LIMIT 1`,
      [req.params.key, req.actor?.cafe_id ?? null]
    );
    /* A platform key answers the same as a missing one. Saying "that exists
       but is not yours" tells a caller which keys are worth probing for. */
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Setting not found' });
    }
    res.status(200).json({ success: true, data: shape(result.rows[0]) });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ success: false, message: 'Error fetching setting' });
  }
};

// PUT /api/settings/:key   { value }
export const updateSetting = async (req, res) => {
  try {
    const key = req.params.key;
    const cafeId = req.actor?.cafe_id ?? null;
    /* The value in force for this café — its own row if it has one, the
       default otherwise. That is what the audit trail should record as the
       "from", and its type is what the new value is validated against. */
    const existing = await pool.query(
      `SELECT * FROM app_settings
        WHERE setting_key = $1 AND ${CAFE_SCOPE} AND (cafe_id IS NULL OR cafe_id = $2)
        ORDER BY (cafe_id IS NULL) ASC LIMIT 1`,
      [key, cafeId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Setting not found' });
    }

    const parsed = validateValue(req.body?.value, existing.rows[0].value_type);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    /* Written through setSetting so a café gets its own row rather than
       editing the default every other café reads. */
    const saved = await setSetting(key, parsed.value, cafeId);
    const result = { rows: [saved || existing.rows[0]] };

    // Keep the old value: "who changed the hourly rate, and from what" is a
    // question that only has an answer if the previous figure was recorded.
    await recordAudit(req, {
      action: 'setting.update',
      category: 'settings',
      entity: 'setting',
      entity_id: key,
      sensitive: true,
      summary: `Changed ${key} from ${existing.rows[0].setting_value} to ${parsed.value}`,
      meta: { from: existing.rows[0].setting_value, to: parsed.value }
    });

    res.status(200).json({
      success: true,
      message: 'Setting updated',
      data: shape(result.rows[0])
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, message: 'Error updating setting' });
  }
};

// PUT /api/settings   { settings: { key: value, ... } }
export const updateSettings = async (req, res) => {
  const client = await pool.connect();
  try {
    const payload = req.body?.settings;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, message: 'Provide a settings object' });
    }

    const keys = Object.keys(payload);
    if (!keys.length) {
      return res.status(400).json({ success: false, message: 'No settings supplied' });
    }

    await client.query('BEGIN');
    const updated = [];
    const cafeId = req.actor?.cafe_id ?? null;

    for (const key of keys) {
      // The type in force for this café — its own row, or the default.
      const existing = await client.query(
        `SELECT value_type FROM app_settings
          WHERE setting_key = $1 AND ${CAFE_SCOPE} AND (cafe_id IS NULL OR cafe_id = $2)
          ORDER BY (cafe_id IS NULL) ASC LIMIT 1`,
        [key, cafeId]
      );
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: `Unknown setting: ${key}` });
      }

      const parsed = validateValue(payload[key], existing.rows[0].value_type);
      if (parsed.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `${key}: ${parsed.error}` });
      }

      /* Insert-or-update this café's own row rather than editing the shared
         default. Runs on the transaction's client so a failure part-way
         through this batch rolls the whole set back. */
      const row = cafeId === null
        ? await client.query(
            `UPDATE app_settings
                SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
              WHERE setting_key = $2 AND cafe_id IS NULL RETURNING *`,
            [parsed.value, key])
        : await client.query(
            `INSERT INTO app_settings
               (setting_key, setting_value, value_type, category, description, scope, is_secret, cafe_id)
             SELECT d.setting_key, $2, d.value_type, d.category, d.description, d.scope, d.is_secret, $3
               FROM app_settings d WHERE d.setting_key = $1 AND d.cafe_id IS NULL
             ON CONFLICT (setting_key, cafe_id) WHERE cafe_id IS NOT NULL
             DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [key, parsed.value, cafeId]);
      updated.push(shape(row.rows[0]));
    }

    await client.query('COMMIT');
    invalidate();

    await recordAudit(req, {
      action: 'setting.update_many',
      category: 'settings',
      entity: 'setting',
      entity_id: keys.join(','),
      sensitive: true,
      summary: `Changed ${updated.length} setting(s): ` +
        updated.map((s) => `${s.setting_key}=${s.setting_value}`).join(', '),
      meta: { keys, values: payload }
    });

    res.status(200).json({
      success: true,
      message: `${updated.length} setting(s) updated`,
      data: updated
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Error updating settings' });
  } finally {
    client.release();
  }
};

// GET /api/settings/effective — resolved values, as the app actually sees them
export const effectiveSettings = async (req, res) => {
  try {
    const all = await getAllSettings();
    const out = {};
    Object.keys(all).forEach((key) => { out[key] = all[key].value; });
    res.status(200).json({ success: true, data: out });
  } catch (error) {
    console.error('Error resolving settings:', error);
    res.status(500).json({ success: false, message: 'Error resolving settings' });
  }
};
