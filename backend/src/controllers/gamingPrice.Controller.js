import pool from '../config/database.js';
import { categoryJoin, categoryExpr } from '../config/softwareCategory.js';

/*
 * Gaming Price Master — one price per game + session pair.
 *
 * The catalogue of games is software_master, so software_id fills the game_id
 * role. Nothing here duplicates a name or a duration: every display value is
 * joined back from the masters, so renaming a game or correcting a duration
 * needs one edit, not a sweep through the price table.
 */

const STATUSES = ['ACTIVE', 'INACTIVE'];

/*
 * Whose prices these are.
 *
 * Taken from the authenticated token, never from the request body — a café id
 * a client can set is a café id an attacker can set, and here that would mean
 * reading or rewriting a competitor's rate card.
 *
 * A price belonging to another café is reported as simply absent rather than
 * refused, so this endpoint cannot be used to confirm what another café has
 * configured.
 */
const cafeOf = (req) => req.actor?.cafe_id ?? null;

/*
 * The price row plus its display joins.
 *
 * Takes the parameter position holding the café id, because callers build
 * their parameter lists differently — a lookup leads with the ids it was
 * given, a list leads with the café. Passing the index rather than assuming
 * $1 is what lets the branch's own category filing resolve correctly in every
 * one of them instead of only the two that happened to put it first.
 */
const selectPrice = (cafeParamIndex) => `
  SELECT gp.*,
         sm.software_name,
         sm.software_icon,
         ${categoryExpr()}       AS software_category,
         sm.is_active            AS software_active,
         s.session_name,
         s.duration_type,
         s.duration,
         s.duration_minutes,
         s.status                AS session_status
  FROM gaming_prices gp
  JOIN software_master sm ON sm.software_id = gp.software_id
  JOIN session_master  s  ON s.id = gp.session_master_id
  ${categoryJoin(cafeParamIndex)}
`;

const shape = (row) => ({
  price_id: row.id,
  id: row.id,

  // stored
  software_id: row.software_id,
  session_master_id: row.session_master_id,
  price: Number(row.price),
  currency: row.currency,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,

  // joined for display only — never stored on gaming_prices
  software_name: row.software_name,
  software_icon: row.software_icon,
  /* Lets the till group rates by PC / PS5 / Pool / Darts without a second
     request per tile. */
  category: row.software_category,
  software_active: row.software_active,
  session_name: row.session_name,
  duration_type: row.duration_type,
  duration: row.duration === null ? null : Number(row.duration),
  duration_minutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
  is_unlimited: row.duration_type === 'UNLIMITED',
  session_status: row.session_status
});

/**
 * Both references must exist and be active — a price against a retired game or
 * a withdrawn session would never be sellable.
 */
const checkReferences = async (client, softwareId, sessionId, cafeId) => {
  /* Scoped to what this café can actually see. Pricing another café's house
     activity would create a row referencing something its owner can neither
     find nor edit, so an out-of-scope reference is "not found", not an error
     that hints the row exists elsewhere. */
  const software = await client.query(
    `SELECT software_id, software_name, is_active FROM software_master sm
      WHERE software_id = $1 AND (sm.cafe_id IS NULL OR sm.cafe_id = $2)`,
    [softwareId, cafeId]
  );
  if (software.rows.length === 0) return { error: 'Game not found', status: 404 };
  if (software.rows[0].is_active === false) {
    return { error: `${software.rows[0].software_name} is inactive, so it cannot be priced`, status: 409 };
  }

  const session = await client.query(
    `SELECT id, session_name, status FROM session_master s
      WHERE id = $1 AND (s.cafe_id IS NULL OR s.cafe_id = $2)`,
    [sessionId, cafeId]
  );
  if (session.rows.length === 0) return { error: 'Session not found', status: 404 };
  if (session.rows[0].status !== 'ACTIVE') {
    return { error: `${session.rows[0].session_name} is inactive, so it cannot be priced`, status: 409 };
  }

  return { ok: true };
};

const parsePrice = (raw) => {
  if (raw === undefined || raw === null || raw === '') return { error: 'Price is required' };
  const price = Number(raw);
  if (!Number.isFinite(price)) return { error: 'Price must be a number' };
  if (price < 0) return { error: 'Price cannot be negative' };
  if (price > 99999999) return { error: 'Price is unrealistically large' };
  return { price: Number(price.toFixed(2)) };
};

// POST /api/gaming-prices
export const createPrice = async (req, res) => {
  const client = await pool.connect();
  try {
    const softwareId = parseInt(req.body?.software_id ?? req.body?.game_id, 10);
    const sessionId = parseInt(req.body?.session_master_id, 10);

    if (!Number.isInteger(softwareId)) {
      return res.status(400).json({ success: false, message: 'A game is required' });
    }
    if (!Number.isInteger(sessionId)) {
      return res.status(400).json({ success: false, message: 'A session is required' });
    }

    const parsed = parsePrice(req.body?.price);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const cafeId = cafeOf(req);
    const refs = await checkReferences(client, softwareId, sessionId, cafeId);
    if (refs.error) return res.status(refs.status).json({ success: false, message: refs.error });

    const currency = (req.body?.currency || 'INR').toUpperCase().slice(0, 8);
    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase()
      : 'ACTIVE';

    const inserted = await client.query(
      `INSERT INTO gaming_prices (cafe_id, software_id, session_master_id, price, currency, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [cafeId, softwareId, sessionId, parsed.price, currency, status]
    );

    const full = await client.query(`${selectPrice(2)} WHERE gp.id = $1`, [inserted.rows[0].id, cafeId]);
    res.status(201).json({ success: true, message: 'Price saved', data: shape(full.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'That game already has a price for this session. Edit the existing one instead.'
      });
    }
    console.error('Error creating gaming price:', error);
    res.status(500).json({ success: false, message: 'Error saving price' });
  } finally {
    client.release();
  }
};

// GET /api/gaming-prices?software_id=&session_master_id=&status=&search=&limit=&offset=
export const listPrices = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    /* First filter, always applied: only this café's prices. Not optional and
       not driven by a query parameter, so there is no request that widens it. */
    const filters = [];
    const params = [cafeOf(req)];
    filters.push(`gp.cafe_id IS NOT DISTINCT FROM $1`);

    if (req.query.software_id) {
      params.push(parseInt(req.query.software_id, 10));
      filters.push(`gp.software_id = $${params.length}`);
    }
    if (req.query.session_master_id) {
      params.push(parseInt(req.query.session_master_id, 10));
      filters.push(`gp.session_master_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`gp.status = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`(sm.software_name ILIKE $${params.length} OR s.session_name ILIKE $${params.length})`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const listParams = [...params, limit, offset];

    const result = await pool.query(
      `${selectPrice(1)} ${where}
       ORDER BY sm.software_name ASC,
         CASE WHEN s.duration_minutes IS NULL THEN 1 ELSE 0 END,
         s.duration_minutes ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const total = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM gaming_prices gp
       JOIN software_master sm ON sm.software_id = gp.software_id
       JOIN session_master  s  ON s.id = gp.session_master_id
       ${where}`,
      params
    );

    res.status(200).json({
      success: true,
      data: result.rows.map(shape),
      pagination: { limit, offset, total: total.rows[0].count }
    });
  } catch (error) {
    console.error('Error listing gaming prices:', error);
    res.status(500).json({ success: false, message: 'Error fetching prices' });
  }
};

// GET /api/gaming-prices/lookup?software_id=1&session_master_id=2
export const lookupPrice = async (req, res) => {
  try {
    const softwareId = parseInt(req.query.software_id ?? req.query.game_id, 10);
    const sessionId = parseInt(req.query.session_master_id, 10);

    if (!Number.isInteger(softwareId) || !Number.isInteger(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'software_id and session_master_id are both required'
      });
    }

    const result = await pool.query(
      `${selectPrice(3)}
        WHERE gp.software_id = $1 AND gp.session_master_id = $2
          AND gp.cafe_id IS NOT DISTINCT FROM $3`,
      [softwareId, sessionId, cafeOf(req)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No price is configured for that game and session'
      });
    }

    res.status(200).json({ success: true, data: shape(result.rows[0]) });
  } catch (error) {
    console.error('Error looking up gaming price:', error);
    res.status(500).json({ success: false, message: 'Error looking up price' });
  }
};

// GET /api/gaming-prices/:id
export const getPriceById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid price id' });
    }
    const result = await pool.query(
      `${selectPrice(2)} WHERE gp.id = $1 AND gp.cafe_id IS NOT DISTINCT FROM $2`,
      [id, cafeOf(req)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Price not found' });
    }
    res.status(200).json({ success: true, data: shape(result.rows[0]) });
  } catch (error) {
    console.error('Error fetching gaming price:', error);
    res.status(500).json({ success: false, message: 'Error fetching price' });
  }
};

// PUT /api/gaming-prices/:id
export const updatePrice = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid price id' });
    }

    const cafeId = cafeOf(req);
    const existing = await client.query(
      'SELECT * FROM gaming_prices WHERE id = $1 AND cafe_id IS NOT DISTINCT FROM $2',
      [id, cafeId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Price not found' });
    }

    const current = existing.rows[0];
    const softwareId = req.body?.software_id ?? req.body?.game_id ?? current.software_id;
    const sessionId = req.body?.session_master_id ?? current.session_master_id;

    const parsed = req.body?.price === undefined
      ? { price: Number(current.price) }
      : parsePrice(req.body.price);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    // Only re-check the masters when the pair actually moves.
    if (Number(softwareId) !== current.software_id || Number(sessionId) !== current.session_master_id) {
      const refs = await checkReferences(client, Number(softwareId), Number(sessionId), cafeId);
      if (refs.error) return res.status(refs.status).json({ success: false, message: refs.error });
    }

    const currency = (req.body?.currency || current.currency).toUpperCase().slice(0, 8);
    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase()
      : current.status;

    await client.query(
      `UPDATE gaming_prices
       SET software_id = $1, session_master_id = $2, price = $3, currency = $4,
           status = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND cafe_id IS NOT DISTINCT FROM $7`,
      [Number(softwareId), Number(sessionId), parsed.price, currency, status, id, cafeId]
    );

    const full = await client.query(`${selectPrice(2)} WHERE gp.id = $1`, [id, cafeId]);
    res.status(200).json({ success: true, message: 'Price updated', data: shape(full.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'That game already has a price for this session'
      });
    }
    console.error('Error updating gaming price:', error);
    res.status(500).json({ success: false, message: 'Error updating price' });
  } finally {
    client.release();
  }
};

// PATCH /api/gaming-prices/:id/status
export const setPriceStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE or INACTIVE' });
    }

    const updated = await pool.query(
      `UPDATE gaming_prices SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND cafe_id IS NOT DISTINCT FROM $3 RETURNING id`,
      [status, id, cafeOf(req)]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Price not found' });
    }

    const full = await pool.query(`${selectPrice(2)} WHERE gp.id = $1`, [id, cafeId]);
    res.status(200).json({
      success: true,
      message: status === 'ACTIVE' ? 'Price activated' : 'Price deactivated',
      data: shape(full.rows[0])
    });
  } catch (error) {
    console.error('Error updating price status:', error);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
};

// DELETE /api/gaming-prices/:id
export const deletePrice = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await pool.query(
      'DELETE FROM gaming_prices WHERE id = $1 AND cafe_id IS NOT DISTINCT FROM $2 RETURNING id',
      [id, cafeOf(req)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Price not found' });
    }
    res.status(200).json({ success: true, message: 'Price deleted' });
  } catch (error) {
    console.error('Error deleting gaming price:', error);
    res.status(500).json({ success: false, message: 'Error deleting price' });
  }
};

/**
 * GET /api/gaming-prices/matrix
 * Every active game with its configured prices, for the pricing grid.
 */
export const priceMatrix = async (req, res) => {
  try {
    // The shared catalogue plus this café's own additions — never a neighbour's.
    const cafeId = cafeOf(req);
    const games = await pool.query(
      `SELECT software_id, software_name, software_icon
       FROM software_master sm
       WHERE is_active = TRUE AND (sm.cafe_id IS NULL OR sm.cafe_id = $1)
       ORDER BY software_name ASC`,
      [cafeId]
    );
    const sessions = await pool.query(
      `SELECT * FROM session_master s
       WHERE status = 'ACTIVE' AND (s.cafe_id IS NULL OR s.cafe_id = $1)
       ORDER BY CASE WHEN duration_minutes IS NULL THEN 1 ELSE 0 END, duration_minutes ASC`,
      [cafeId]
    );
    const prices = await pool.query(
      `${selectPrice(1)} WHERE gp.status = 'ACTIVE' AND gp.cafe_id IS NOT DISTINCT FROM $1`,
      [cafeId]
    );

    res.status(200).json({
      success: true,
      data: {
        games: games.rows,
        sessions: sessions.rows.map((r) => ({
          session_master_id: r.id,
          session_name: r.session_name,
          duration_type: r.duration_type,
          duration_minutes: r.duration_minutes === null ? null : Number(r.duration_minutes),
          is_unlimited: r.duration_type === 'UNLIMITED'
        })),
        prices: prices.rows.map(shape)
      }
    });
  } catch (error) {
    console.error('Error building price matrix:', error);
    res.status(500).json({ success: false, message: 'Error building price matrix' });
  }
};
