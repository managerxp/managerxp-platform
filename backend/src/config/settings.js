import pool from './database.js';

/*
 * Settings accessor.
 *
 * Controllers used to carry these values as constants, which meant changing a
 * rate needed a code edit and a restart. They now live in app_settings and are
 * read through here.
 *
 * Reads are cached briefly so a hot path does not hit the database on every
 * request, and the cache is cleared whenever a setting is written.
 */

const CACHE_TTL_MS = 30000;

let cache = null;
let cachedAt = 0;

const coerce = (value, type) => {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    case 'json':
      try { return JSON.parse(value); } catch { return null; }
    default:
      return value;
  }
};

/*
 * Load every setting into the cache, defaults and per-café overrides alike.
 *
 * Keyed as `cafeId:key`, with the platform default under `:key`. Reading a
 * setting for a café is then one lookup for the override and one for the
 * default, with no query in between — which matters because these are read on
 * hot paths like pricing a bill line.
 */
const cacheKey = (key, cafeId) => `${cafeId ?? ''}:${key}`;

const loadAll = async () => {
  const result = await pool.query('SELECT * FROM app_settings');
  cache = {};
  result.rows.forEach((row) => {
    cache[cacheKey(row.setting_key, row.cafe_id)] = {
      value: coerce(row.setting_value, row.value_type),
      raw: row.setting_value,
      type: row.value_type,
      category: row.category,
      description: row.description,
      cafe_id: row.cafe_id,
      updated_at: row.updated_at
    };
  });
  cachedAt = Date.now();
  return cache;
};

const ensureFresh = async () => {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  return loadAll();
};

/**
 * Read one setting. `fallback` covers the window before the table is seeded,
 * so a fresh database can still serve requests.
 */
/**
 * Read one setting, for a café if one is given.
 *
 * The café's own value wins; without one it falls through to the platform
 * default. `cafeId` is optional so the fifty-odd existing call sites keep
 * working unchanged — they read the default, which is exactly what they read
 * before this existed. Passing a café is what makes a setting that café's
 * own, and is done at the call sites where it changes money or behaviour.
 */
export const getSetting = async (key, fallback = null, cafeId = null) => {
  try {
    const all = await ensureFresh();
    if (cafeId !== null && cafeId !== undefined) {
      const own = all[cacheKey(key, cafeId)];
      if (own && own.value !== null) return own.value;
    }
    const entry = all[cacheKey(key, null)];
    return entry && entry.value !== null ? entry.value : fallback;
  } catch (error) {
    console.error(`[settings] read failed for ${key}:`, error.message);
    return fallback;
  }
};

/** Read several at once — one cache hit rather than several. */
export const getSettings = async (keys, cafeId = null) => {
  const all = await ensureFresh().catch(() => ({}));
  const out = {};
  keys.forEach((key) => {
    const own = cafeId != null ? all[cacheKey(key, cafeId)] : null;
    const entry = own && own.value !== null ? own : all[cacheKey(key, null)];
    out[key] = entry ? entry.value : null;
  });
  return out;
};

export const getAllSettings = async () => ensureFresh();

/**
 * Write a setting and drop the cache so the next read is authoritative.
 *
 * With a café, this writes that café's own row — inserting one the first time
 * they change a setting, so the platform default is never overwritten by one
 * tenant. Without a café it edits the default itself, which is what the
 * platform-admin console does.
 */
export const setSetting = async (key, value, cafeId = null) => {
  const raw = value === null || value === undefined ? null : String(value);

  if (cafeId === null || cafeId === undefined) {
    const result = await pool.query(
      `UPDATE app_settings
          SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
        WHERE setting_key = $2 AND cafe_id IS NULL
        RETURNING *`,
      [raw, key]
    );
    invalidate();
    return result.rows[0] || null;
  }

  /* The café's own row, created on first use. Its shape — type, category,
     description — is copied from the default so the settings screen can
     render it identically without a second lookup. */
  const result = await pool.query(
    `INSERT INTO app_settings
       (setting_key, setting_value, value_type, category, description, scope, is_secret, cafe_id)
     SELECT d.setting_key, $2, d.value_type, d.category, d.description, d.scope, d.is_secret, $3
       FROM app_settings d
      WHERE d.setting_key = $1 AND d.cafe_id IS NULL
     ON CONFLICT (setting_key, cafe_id) WHERE cafe_id IS NOT NULL
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [key, raw, cafeId]
  );
  invalidate();
  return result.rows[0] || null;
};

export const invalidate = () => {
  cache = null;
  cachedAt = 0;
};

export default { getSetting, getSettings, getAllSettings, setSetting, invalidate };
