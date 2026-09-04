/*
 * The location master API.
 *
 * Read endpoints are public: the signup form needs them before anyone has an
 * account, and a country list is not a secret. Writing is ManagerXP's alone —
 * this is shared data, so one tenant editing it would edit it for every other
 * tenant, and that route is guarded in `locations.Routes.js`.
 *
 * Cities are never returned in bulk. There is no "all cities" endpoint by
 * design; they arrive only after a state is chosen, because the alternative is
 * shipping hundreds of thousands of rows to a browser that wanted one.
 */
import pool from '../config/database.js';

/* Countries and states change perhaps once a year. Cached in memory with a
   long life; cities are not cached here because they are already narrow — one
   state's worth — and go stale in a way the others do not. */
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

const cached = async (key, load) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { value, at: Date.now() });
  return value;
};

/** Dropped whenever an administrator changes the master. */
export const invalidateLocationCache = () => cache.clear();

/* A search term is matched as a prefix first and anywhere second, so typing
   "ind" offers India before Indonesia — the shorter, earlier match is almost
   always the one meant. */
const orderForSearch = (column, param) => `
  ORDER BY
    CASE WHEN LOWER(${column}) LIKE ${param} || '%' THEN 0 ELSE 1 END,
    ${column}
`;

/** GET /api/locations/countries?search= */
export const listCountries = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();

    const rows = search
      ? (await pool.query(`
          SELECT id, name, iso2_code, iso3_code, phone_code, currency_code, currency_name, timezone
          FROM countries
          WHERE is_active AND (LOWER(name) LIKE '%' || $1 || '%' OR LOWER(iso2_code) = $1 OR LOWER(iso3_code) = $1)
          ${orderForSearch('name', '$1')}
          LIMIT 100
        `, [search])).rows
      : await cached('countries', async () => (await pool.query(`
          SELECT id, name, iso2_code, iso3_code, phone_code, currency_code, currency_name, timezone
          FROM countries WHERE is_active ORDER BY name
        `)).rows);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Country list failed:', error);
    res.status(500).json({ success: false, message: 'Unable to load locations. Please try again.' });
  }
};

/** GET /api/locations/countries/:countryId/states?search= */
export const listStates = async (req, res) => {
  try {
    const countryId = Number(req.params.countryId);
    if (!Number.isInteger(countryId) || countryId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid country.' });
    }

    const country = await cached(`country:${countryId}`, async () => (await pool.query(
      'SELECT id, name, is_active FROM countries WHERE id = $1', [countryId])).rows[0]);
    if (!country || !country.is_active) {
      return res.status(404).json({ success: false, message: 'Country not found.' });
    }

    const search = String(req.query.search || '').trim().toLowerCase();
    const rows = search
      ? (await pool.query(`
          SELECT id, country_id, name, code, type FROM states
          WHERE country_id = $1 AND is_active AND LOWER(name) LIKE '%' || $2 || '%'
          ${orderForSearch('name', '$2')}
          LIMIT 200
        `, [countryId, search])).rows
      : await cached(`states:${countryId}`, async () => (await pool.query(`
          SELECT id, country_id, name, code, type FROM states
          WHERE country_id = $1 AND is_active ORDER BY name
        `, [countryId])).rows);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('State list failed:', error);
    res.status(500).json({ success: false, message: 'Unable to load locations. Please try again.' });
  }
};

/** GET /api/locations/states/:stateId/cities?search= */
export const listCities = async (req, res) => {
  try {
    const stateId = Number(req.params.stateId);
    if (!Number.isInteger(stateId) || stateId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid state.' });
    }

    const state = (await pool.query(
      'SELECT id, is_active FROM states WHERE id = $1', [stateId])).rows[0];
    if (!state || !state.is_active) {
      return res.status(404).json({ success: false, message: 'State not found.' });
    }

    const search = String(req.query.search || '').trim().toLowerCase();
    const params = [stateId];
    let where = 'state_id = $1 AND is_active';
    let order = 'ORDER BY name';
    if (search) {
      params.push(search);
      where += ` AND LOWER(name) LIKE '%' || $2 || '%'`;
      order = orderForSearch('name', '$2');
    }

    const { rows } = await pool.query(`
      SELECT id, state_id, country_id, name FROM cities
      WHERE ${where} ${order} LIMIT 500
    `, params);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('City list failed:', error);
    res.status(500).json({ success: false, message: 'Unable to load locations. Please try again.' });
  }
};

/**
 * GET /api/locations/country/:countryId
 *
 * A country and its states in one request, for a form that already knows the
 * country. Cities are deliberately absent — including them is what turns a
 * convenience endpoint into a megabyte.
 */
export const getCountryBundle = async (req, res) => {
  try {
    const countryId = Number(req.params.countryId);
    if (!Number.isInteger(countryId) || countryId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid country.' });
    }

    const bundle = await cached(`bundle:${countryId}`, async () => {
      const country = (await pool.query(`
        SELECT id, name, iso2_code, iso3_code, phone_code, currency_code, currency_name, timezone
        FROM countries WHERE id = $1 AND is_active
      `, [countryId])).rows[0];
      if (!country) return null;
      const states = (await pool.query(`
        SELECT id, country_id, name, code, type FROM states
        WHERE country_id = $1 AND is_active ORDER BY name
      `, [countryId])).rows;
      return { country, states };
    });

    if (!bundle) return res.status(404).json({ success: false, message: 'Country not found.' });
    res.json({ success: true, data: bundle });
  } catch (error) {
    console.error('Country bundle failed:', error);
    res.status(500).json({ success: false, message: 'Unable to load locations. Please try again.' });
  }
};

/**
 * Validate a country/state/city triple.
 *
 * Shared by every writer — signup, branch creation, anything that stores an
 * address — so the chain is checked in exactly one place. Returns the resolved
 * rows on success, because callers invariably need the names and the currency
 * straight afterwards and would otherwise fetch them again.
 *
 * Never trusts what the browser sent. A dropdown is a convenience; the
 * relationships are re-read from the database every time.
 */
export const resolveLocation = async ({ country_id, state_id, city_id }, { required = true } = {}) => {
  const countryId = Number(country_id) || null;
  const stateId = Number(state_id) || null;
  const cityId = Number(city_id) || null;

  if (!countryId) {
    return required
      ? { error: 'Select a country.' }
      : { country: null, state: null, city: null };
  }

  const country = (await pool.query(
    'SELECT * FROM countries WHERE id = $1', [countryId])).rows[0];
  if (!country) return { error: 'Invalid country.' };
  if (!country.is_active) return { error: 'That country is not available.' };

  if (!stateId) {
    return required ? { error: 'Select a state or province.' } : { country, state: null, city: null };
  }
  const state = (await pool.query('SELECT * FROM states WHERE id = $1', [stateId])).rows[0];
  if (!state) return { error: 'Invalid state.' };
  if (!state.is_active) return { error: 'That state is not available.' };
  if (state.country_id !== country.id) {
    return { error: 'Invalid state for the selected country.' };
  }

  if (!cityId) {
    return required ? { error: 'Select a city.' } : { country, state, city: null };
  }
  const city = (await pool.query('SELECT * FROM cities WHERE id = $1', [cityId])).rows[0];
  if (!city) return { error: 'Invalid city.' };
  if (!city.is_active) return { error: 'That city is not available.' };
  /* Both checked. The state link is the real relationship; the country link is
     the redundant column, and a disagreement between them is exactly the
     corruption worth catching. */
  if (city.state_id !== state.id) return { error: 'Invalid city for the selected state.' };
  if (city.country_id !== country.id) return { error: 'Invalid city for the selected country.' };

  return { country, state, city };
};

/* ==========================================================================
   ADMIN
   ========================================================================== */

/** PATCH /api/locations/:kind/:id — activate or deactivate. */
export const setLocationActive = async (req, res) => {
  try {
    const kind = String(req.params.kind);
    const table = { countries: 'countries', states: 'states', cities: 'cities' }[kind];
    if (!table) return res.status(400).json({ success: false, message: 'Unknown location type.' });

    const id = Number(req.params.id);
    const active = req.body?.is_active === true;

    /* Deactivated, never deleted. A city with customers filed under it cannot
       be removed without orphaning them, and a soft switch is reversible when
       somebody turns off the wrong one. */
    const { rows } = await pool.query(`
      UPDATE ${table} SET is_active = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING id, name, is_active
    `, [id, active]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });

    invalidateLocationCache();
    res.json({
      success: true,
      message: `${rows[0].name} is now ${active ? 'active' : 'inactive'}`,
      data: rows[0]
    });
  } catch (error) {
    console.error('Location status change failed:', error);
    res.status(500).json({ success: false, message: 'Unable to process request.' });
  }
};
