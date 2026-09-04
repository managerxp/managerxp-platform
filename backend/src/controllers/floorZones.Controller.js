import pool from '../config/database.js';

/*
 * Floor zones.
 *
 * A zone is a named part of the room — "VIP Room", "Console Corner", "Main
 * Hall". Stations point at one, so the Floor page can be grouped the way the
 * café is actually laid out. A zone is presentation only: it never affects
 * pricing, sessions or billing, so deleting one simply un-assigns its
 * stations rather than touching anything downstream.
 */

// Matches the status palette the admin console already paints with.
const ACCENTS = ['accent', 'online', 'gaming', 'warning', 'idle'];

const shape = (row) => ({
  zone_id: row.zone_id,
  cafe_id: row.cafe_id,
  zone_name: row.zone_name,
  description: row.description,
  accent: row.accent,
  sort_order: row.sort_order,
  station_count: row.station_count === undefined ? undefined : Number(row.station_count)
});

const cafeOf = (req) =>
  req.body?.cafe_id ?? req.query?.cafe_id ?? req.user?.cafe_id ?? null;

// GET /api/floor-zones
export const listZones = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT z.*, COUNT(p.pc_id)::int AS station_count
       FROM floor_zones z
       LEFT JOIN pcs p ON p.zone_id = z.zone_id
       GROUP BY z.zone_id
       ORDER BY z.sort_order, LOWER(z.zone_name)`
    );
    res.status(200).json({ success: true, data: result.rows.map(shape) });
  } catch (error) {
    console.error('Error listing floor zones:', error);
    res.status(500).json({ success: false, message: 'Error fetching floor zones' });
  }
};

// POST /api/floor-zones   { zone_name, description?, accent?, sort_order? }
export const createZone = async (req, res) => {
  try {
    const name = (req.body?.zone_name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'A zone name is required' });
    }

    const accent = ACCENTS.includes(req.body?.accent) ? req.body.accent : 'accent';
    const order = Number.isInteger(parseInt(req.body?.sort_order, 10))
      ? parseInt(req.body.sort_order, 10)
      : null;

    // A new zone goes last unless a position was given.
    const nextOrder = order === null
      ? (await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM floor_zones')).rows[0].n
      : order;

    const result = await pool.query(
      `INSERT INTO floor_zones (cafe_id, zone_name, description, accent, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [cafeOf(req), name.slice(0, 80),
       (req.body?.description || '').trim().slice(0, 255) || null, accent, nextOrder]
    );

    res.status(201).json({ success: true, message: 'Zone created', data: shape(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A zone with that name already exists' });
    }
    console.error('Error creating floor zone:', error);
    res.status(500).json({ success: false, message: 'Error creating zone' });
  }
};

// PUT /api/floor-zones/:id
export const updateZone = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid zone id' });
    }

    const existing = await pool.query('SELECT * FROM floor_zones WHERE zone_id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Zone not found' });
    }
    const current = existing.rows[0];

    const name = req.body?.zone_name === undefined
      ? current.zone_name
      : (req.body.zone_name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'A zone name is required' });
    }

    const result = await pool.query(
      `UPDATE floor_zones
       SET zone_name = $1, description = $2, accent = $3, sort_order = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE zone_id = $5 RETURNING *`,
      [
        name.slice(0, 80),
        req.body?.description === undefined
          ? current.description
          : ((req.body.description || '').trim().slice(0, 255) || null),
        ACCENTS.includes(req.body?.accent) ? req.body.accent : current.accent,
        Number.isInteger(parseInt(req.body?.sort_order, 10))
          ? parseInt(req.body.sort_order, 10)
          : current.sort_order,
        id
      ]
    );

    res.status(200).json({ success: true, message: 'Zone updated', data: shape(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A zone with that name already exists' });
    }
    console.error('Error updating floor zone:', error);
    res.status(500).json({ success: false, message: 'Error updating zone' });
  }
};

// DELETE /api/floor-zones/:id
export const deleteZone = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid zone id' });
    }

    // ON DELETE SET NULL does the un-assigning; report how many moved so the
    // console can say so rather than silently rearranging the floor.
    const affected = await pool.query(
      'SELECT COUNT(*)::int AS n FROM pcs WHERE zone_id = $1', [id]
    );
    const result = await pool.query(
      'DELETE FROM floor_zones WHERE zone_id = $1 RETURNING zone_name', [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Zone not found' });
    }

    res.status(200).json({
      success: true,
      message: affected.rows[0].n
        ? `Zone deleted — ${affected.rows[0].n} station(s) moved to Unassigned`
        : 'Zone deleted'
    });
  } catch (error) {
    console.error('Error deleting floor zone:', error);
    res.status(500).json({ success: false, message: 'Error deleting zone' });
  }
};

/*
 * PUT /api/floor-zones/assign
 * { assignments: [{ pc_id, zone_id|null, floor_order? }, ...] }
 *
 * One call for the whole board: the Floor editor sends the arrangement it has
 * on screen, so a half-applied drag can never leave the layout inconsistent.
 */
export const assignStations = async (req, res) => {
  const client = await pool.connect();
  try {
    const list = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
    if (!list) {
      return res.status(400).json({ success: false, message: 'assignments must be an array' });
    }
    if (list.length > 500) {
      return res.status(400).json({ success: false, message: 'Too many assignments in one call' });
    }

    await client.query('BEGIN');

    let changed = 0;
    for (const entry of list) {
      const pcId = parseInt(entry?.pc_id, 10);
      if (!Number.isInteger(pcId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Every assignment needs a pc_id' });
      }

      const zoneId = entry?.zone_id === null || entry?.zone_id === undefined || entry.zone_id === ''
        ? null
        : parseInt(entry.zone_id, 10);
      if (zoneId !== null && !Number.isInteger(zoneId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'zone_id must be a number or null' });
      }

      const order = Number.isInteger(parseInt(entry?.floor_order, 10))
        ? parseInt(entry.floor_order, 10)
        : 0;

      const result = await client.query(
        `UPDATE pcs SET zone_id = $1, floor_order = $2, updated_at = CURRENT_TIMESTAMP
         WHERE pc_id = $3 RETURNING pc_id`,
        [zoneId, order, pcId]
      );
      changed += result.rowCount;
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: `${changed} station(s) arranged` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: 'That zone no longer exists' });
    }
    console.error('Error assigning stations to zones:', error);
    res.status(500).json({ success: false, message: 'Error arranging the floor' });
  } finally {
    client.release();
  }
};
