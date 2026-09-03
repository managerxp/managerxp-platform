import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/*
 * Booking a station ahead of time.
 *
 * A reservation names either a specific station (pc_id) or a category — "any
 * PC", "any PS5" — the same category values pcs.category already uses
 * everywhere else a station type is scoped. Booking a category checks
 * capacity (how many stations of that type exist vs. how many overlapping
 * reservations already claim one) rather than pinning a machine, so "any PS5
 * between 6 and 7" never has to guess which physical unit that becomes until
 * check-in.
 *
 * Check-in is a status flip only — CONFIRMED to CHECKED_IN — never an
 * auto-created session. Starting a session needs a game/price decision this
 * table has no business making; staff check a booking in, then start the
 * session the ordinary way, for the customer or station it named.
 */

const OPEN_STATUSES = ['CONFIRMED', 'CHECKED_IN'];   // these are what compete for capacity
const MINUTES_PER_DAY = 24 * 60;

/** "18:30:00" or "18:30" -> minutes since midnight, or null if unset/invalid. */
const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
};

/**
 * A branch's opening/closing time, resolved from its café — reservations are
 * scoped by cafe_id throughout, never branch_id, so this follows the same
 * "café's first open branch" rule entitlements.Routes.js's resolveScope uses
 * to bridge the same gap. Either value null means the branch has never set
 * hours, which is read as open around the clock, not as always closed.
 */
export const storeHoursFor = async (client, cafeId) => {
  if (!cafeId) return { openingTime: null, closingTime: null };
  const row = (await client.query(
    `SELECT opening_time, closing_time FROM branches
      WHERE cafe_id = $1 AND status <> 'CLOSED' ORDER BY branch_id LIMIT 1`,
    [cafeId]
  )).rows[0];
  return { openingTime: row?.opening_time || null, closingTime: row?.closing_time || null };
};

/**
 * Does [start, end) fall entirely inside one day's open window?
 *
 * Store hours are one window per day, possibly crossing midnight — a café
 * open 18:00-02:00 is one window, not two, the same rule the time-of-day
 * pricing engine (config/pricingRules.js) uses for happy-hour windows. A
 * booking whose start lands in the closed gap, or whose end would run past
 * closing, is refused; unset hours (either value null) always pass.
 */
export const withinStoreHours = (openingTime, closingTime, start, end) => {
  const openMin = timeToMinutes(openingTime);
  const closeMin = timeToMinutes(closingTime);
  if (openMin === null || closeMin === null) return true;

  const startMin = start.getHours() * 60 + start.getMinutes();
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
  const crosses = closeMin <= openMin;
  const spanMin = crosses ? (closeMin + MINUTES_PER_DAY - openMin) : (closeMin - openMin);

  let offset;
  if (!crosses) {
    offset = startMin - openMin;
  } else if (startMin >= openMin) {
    offset = startMin - openMin;                     // evening portion, same day
  } else if (startMin < closeMin) {
    offset = (MINUTES_PER_DAY - openMin) + startMin;  // small-hours portion, previous day's window
  } else {
    offset = -1;                                      // start itself falls in the closed gap
  }

  return offset >= 0 && (offset + durationMin) <= spanMin;
};

export const storeHoursMessage = (openingTime, closingTime) =>
  `This café is open ${String(openingTime).slice(0, 5)}–${String(closingTime).slice(0, 5)}. Choose a time inside those hours.`;

export const shape = (row) => ({
  reservation_id: row.reservation_id,
  cafe_id: row.cafe_id,
  pc_id: row.pc_id || null,
  pc_name: row.pc_name || null,
  // A pinned station's own type, when the booking didn't name one itself —
  // callers grouping by station type (a calendar's columns) need this even
  // for a specific-station booking, not only an "any station" one.
  category: row.category || row.pc_category || null,
  customer_id: row.customer_id || null,
  customer_name: row.customer_name || row.guest_name || null,
  is_guest: !row.customer_id,
  guest_name: row.guest_name || null,
  guest_phone: row.guest_phone || null,
  start_time: row.start_time,
  end_time: row.end_time,
  status: row.status,
  party_size: row.party_size || null,
  notes: row.notes || null,
  cancelled_reason: row.cancelled_reason || null,
  checked_in_at: row.checked_in_at || null,
  created_by: row.created_by || null,
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const SELECT_RESERVATION = `
  SELECT r.*, p.name AS pc_name, p.category AS pc_category, c.customer_name
    FROM reservations r
    LEFT JOIN pcs p ON p.pc_id = r.pc_id
    LEFT JOIN customers c ON c.customer_id = r.customer_id
`;

/** A café's own cafe_id, resolved for whichever kind of token is calling. */
const cafeIdFor = async (req) => {
  if (req.actor?.isStaff) return req.actor.cafe_id ?? null;
  const customerId = Number(req.actor?.customer_id);
  if (!customerId) return null;
  const row = (await pool.query('SELECT cafe_id FROM customers WHERE customer_id = $1', [customerId])).rows[0];
  return row ? row.cafe_id : null;
};

export const parseTimes = (body) => {
  const start = new Date(body?.start_time);
  const end = new Date(body?.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Give a valid start and end time' };
  }
  if (end <= start) return { error: 'End time must be after the start time' };
  if (start < new Date(Date.now() - 5 * 60000)) return { error: 'Start time cannot be in the past' };
  return { start, end };
};

/*
 * How many stations of `category` a reservation for `start`..`end` would
 * still find free, ignoring `excludeReservationId` (so re-checking a
 * booking's own slot while editing it does not count itself as a conflict).
 *
 * A specific pc_id is checked the simpler way by the caller — this is only
 * for the "any station of this category" case.
 */
export const categoryAvailability = async (client, { cafeId, category, start, end, excludeReservationId }) => {
  const total = await client.query(
    `SELECT COUNT(*)::int AS n FROM pcs WHERE cafe_id IS NOT DISTINCT FROM $1 AND category = $2 AND status != 'INACTIVE'`,
    [cafeId, category]
  );
  const booked = await client.query(
    `SELECT COUNT(*)::int AS n FROM reservations r
       LEFT JOIN pcs p ON p.pc_id = r.pc_id
      WHERE r.cafe_id IS NOT DISTINCT FROM $1
        AND r.status = ANY($2)
        AND r.reservation_id IS DISTINCT FROM $3
        AND (r.category = $4 OR p.category = $4)
        AND r.start_time < $6 AND r.end_time > $5`,
    [cafeId, OPEN_STATUSES, excludeReservationId ?? null, category, start, end]
  );
  const totalN = total.rows[0].n;
  const bookedN = booked.rows[0].n;
  return { total: totalN, booked: bookedN, available: Math.max(0, totalN - bookedN) };
};

/** Does this exact station have anything overlapping `start`..`end`? */
export const pcHasConflict = async (client, { pcId, start, end, excludeReservationId }) => {
  const r = await client.query(
    `SELECT 1 FROM reservations
      WHERE pc_id = $1 AND status = ANY($2) AND reservation_id IS DISTINCT FROM $3
        AND start_time < $5 AND end_time > $4
      LIMIT 1`,
    [pcId, OPEN_STATUSES, excludeReservationId ?? null, start, end]
  );
  return r.rows.length > 0;
};

/* ==========================================================================
   GET /api/reservations/categories — station types this café actually has,
   for a booking form to offer (rather than a free-text field nobody can spell
   the same way twice).
   ========================================================================== */
export const listBookableCategories = async (req, res) => {
  try {
    const cafeId = await cafeIdFor(req);
    const rows = await pool.query(
      `SELECT category, COUNT(*)::int AS total FROM pcs
        WHERE cafe_id IS NOT DISTINCT FROM $1 AND category IS NOT NULL AND status != 'INACTIVE'
        GROUP BY category ORDER BY category`,
      [cafeId]
    );
    res.status(200).json({ success: true, data: rows.rows });
  } catch (error) {
    console.error('Error listing bookable categories:', error);
    res.status(500).json({ success: false, message: 'Could not load station types' });
  }
};

/* ==========================================================================
   GET /api/reservations/hours — this café's store hours, so a booking
   calendar can scope its own display to when the place is actually open
   instead of showing a day's worth of grid nobody can book into.
   ========================================================================== */
export const getStoreHours = async (req, res) => {
  try {
    const cafeId = await cafeIdFor(req);
    const hours = await storeHoursFor(pool, cafeId);
    res.status(200).json({
      success: true,
      data: {
        opening_time: hours.openingTime ? String(hours.openingTime).slice(0, 5) : null,
        closing_time: hours.closingTime ? String(hours.closingTime).slice(0, 5) : null
      }
    });
  } catch (error) {
    console.error('Error loading store hours:', error);
    res.status(500).json({ success: false, message: 'Could not load store hours' });
  }
};

/* ==========================================================================
   GET /api/reservations/availability
   ?category=PC&start_time=...&end_time=...   -> capacity for "any station"
   ?pc_id=12&start_time=...&end_time=...       -> whether that one station is free
   ========================================================================== */
export const checkAvailability = async (req, res) => {
  try {
    const cafeId = await cafeIdFor(req);
    const times = parseTimes(req.query);
    if (times.error) return res.status(400).json({ success: false, message: times.error });

    const hours = await storeHoursFor(pool, cafeId);
    if (!withinStoreHours(hours.openingTime, hours.closingTime, times.start, times.end)) {
      return res.status(200).json({
        success: true,
        data: {
          available: false, reason: 'closed',
          category: req.query.category || null, pc_id: req.query.pc_id ? parseInt(req.query.pc_id, 10) : null,
          message: storeHoursMessage(hours.openingTime, hours.closingTime)
        }
      });
    }

    const pcId = req.query.pc_id ? parseInt(req.query.pc_id, 10) : null;
    if (pcId) {
      const conflict = await pcHasConflict(pool, { pcId, start: times.start, end: times.end });
      return res.status(200).json({
        success: true,
        data: { pc_id: pcId, available: !conflict }
      });
    }

    const category = req.query.category ? String(req.query.category).trim() : null;
    if (!category) return res.status(400).json({ success: false, message: 'Give a pc_id or a category to check' });

    const avail = await categoryAvailability(pool, { cafeId, category, start: times.start, end: times.end });
    res.status(200).json({
      success: true,
      data: { category, ...avail, available: avail.available > 0 }
    });
  } catch (error) {
    console.error('Availability check failed:', error);
    res.status(500).json({ success: false, message: 'Could not check availability' });
  }
};

/* ==========================================================================
   POST /api/reservations
   { pc_id? , category?, customer_id? (staff only), guest_name?, guest_phone?,
     start_time, end_time, party_size?, notes? }
   ========================================================================== */
export const createReservation = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = await cafeIdFor(req);
    const times = parseTimes(req.body);
    if (times.error) return res.status(400).json({ success: false, message: times.error });

    const pcId = req.body?.pc_id ? parseInt(req.body.pc_id, 10) : null;
    const category = req.body?.category ? String(req.body.category).trim().slice(0, 60) : null;
    if (!pcId && !category) {
      return res.status(400).json({ success: false, message: 'Choose a station or a station type' });
    }

    // A customer books only for themself; staff may book for a customer or a guest.
    let customerId = null, guestName = null, guestPhone = null;
    if (req.actor?.isStaff) {
      customerId = req.body?.customer_id ? parseInt(req.body.customer_id, 10) : null;
      guestName = customerId ? null : (req.body?.guest_name ? String(req.body.guest_name).trim().slice(0, 160) : null);
      guestPhone = customerId ? null : (req.body?.guest_phone ? String(req.body.guest_phone).trim().slice(0, 20) : null);
      if (!customerId && !guestName) {
        return res.status(400).json({ success: false, message: 'Name the customer, or give a guest name' });
      }
    } else {
      customerId = Number(req.actor?.customer_id);
      if (!customerId) return res.status(400).json({ success: false, message: 'Sign in required' });
    }

    const partySize = req.body?.party_size ? parseInt(req.body.party_size, 10) : null;
    const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 300) : null;

    const hours = await storeHoursFor(pool, cafeId);
    if (!withinStoreHours(hours.openingTime, hours.closingTime, times.start, times.end)) {
      return res.status(409).json({ success: false, message: storeHoursMessage(hours.openingTime, hours.closingTime) });
    }

    await client.query('BEGIN');

    if (pcId) {
      const pc = await client.query('SELECT pc_id, category FROM pcs WHERE pc_id = $1 AND cafe_id IS NOT DISTINCT FROM $2', [pcId, cafeId]);
      if (pc.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Station not found' });
      }
      if (await pcHasConflict(client, { pcId, start: times.start, end: times.end })) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'That station is already booked for part of this time' });
      }
    } else {
      const avail = await categoryAvailability(client, { cafeId, category, start: times.start, end: times.end });
      if (avail.total === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: `No ${category} stations at this café` });
      }
      if (avail.available <= 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: `No ${category} stations free at that time` });
      }
    }

    const inserted = await client.query(
      `INSERT INTO reservations
         (cafe_id, pc_id, category, customer_id, guest_name, guest_phone,
          start_time, end_time, party_size, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING reservation_id`,
      [cafeId, pcId, pcId ? null : category, customerId, guestName, guestPhone,
        times.start, times.end, partySize, notes, req.actor?.label || null]
    );

    await client.query('COMMIT');

    const full = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = $1`, [inserted.rows[0].reservation_id]);
    const row = shape(full.rows[0]);

    await recordAudit(req, {
      action: 'reservation.create', category: 'reservations', entity: 'reservation', entity_id: row.reservation_id,
      summary: `Booked ${row.pc_name || row.category} for ${row.customer_name || 'a guest'} at ${row.start_time}`
    });

    res.status(201).json({ success: true, message: 'Reservation booked', data: row });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating reservation:', error);
    res.status(500).json({ success: false, message: 'Could not book that reservation' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   GET /api/reservations?status=&from=&to=&category=&pc_id=
   Staff only — the café's own bookings.
   ========================================================================== */
export const listReservations = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const filters = ['r.cafe_id IS NOT DISTINCT FROM $1'];
    const params = [cafeId];

    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`r.status = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      filters.push(`r.end_time >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      filters.push(`r.start_time <= $${params.length}`);
    }
    if (req.query.category) {
      params.push(String(req.query.category));
      filters.push(`(r.category = $${params.length} OR p.category = $${params.length})`);
    }
    if (req.query.pc_id) {
      params.push(parseInt(req.query.pc_id, 10));
      filters.push(`r.pc_id = $${params.length}`);
    }

    const result = await pool.query(
      `${SELECT_RESERVATION} WHERE ${filters.join(' AND ')} ORDER BY r.start_time ASC`,
      params
    );
    res.status(200).json({ success: true, data: result.rows.map(shape) });
  } catch (error) {
    console.error('Error listing reservations:', error);
    res.status(500).json({ success: false, message: 'Could not load reservations' });
  }
};

/* ==========================================================================
   GET /api/reservations/customer/:customerId
   ========================================================================== */
export const listCustomerReservations = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== customerId) {
      return res.status(403).json({ success: false, message: 'You can only view your own reservations' });
    }

    const result = await pool.query(
      `${SELECT_RESERVATION} WHERE r.customer_id = $1 ORDER BY r.start_time DESC`,
      [customerId]
    );
    res.status(200).json({ success: true, data: result.rows.map(shape) });
  } catch (error) {
    console.error('Error listing customer reservations:', error);
    res.status(500).json({ success: false, message: 'Could not load reservations' });
  }
};

const loadOwned = async (req, id) => {
  const row = (await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = $1`, [id])).rows[0];
  if (!row) return { error: 404, message: 'Reservation not found' };
  if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== row.customer_id) {
    return { error: 403, message: 'You can only manage your own reservations' };
  }
  return { row };
};

/* ==========================================================================
   POST /api/reservations/:id/cancel   { reason? }
   Staff, or the customer who booked it.
   ========================================================================== */
export const cancelReservation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const loaded = await loadOwned(req, id);
    if (loaded.error) return res.status(loaded.error).json({ success: false, message: loaded.message });

    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(loaded.row.status)) {
      return res.status(409).json({ success: false, message: 'That reservation is already closed' });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 160) : null;
    await pool.query(
      `UPDATE reservations SET status = 'CANCELLED', cancelled_reason = $1, updated_at = CURRENT_TIMESTAMP
       WHERE reservation_id = $2`,
      [reason, id]
    );

    await recordAudit(req, {
      action: 'reservation.cancel', category: 'reservations', entity: 'reservation', entity_id: id,
      summary: `Cancelled reservation #${id}` + (reason ? ` — ${reason}` : '')
    });

    const full = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = $1`, [id]);
    res.status(200).json({ success: true, message: 'Reservation cancelled', data: shape(full.rows[0]) });
  } catch (error) {
    console.error('Error cancelling reservation:', error);
    res.status(500).json({ success: false, message: 'Could not cancel that reservation' });
  }
};

/* ==========================================================================
   POST /api/reservations/:id/check-in — staff only.
   A status flip: the customer has arrived and claimed their booking. Does
   not start a session — see the file header for why.
   ========================================================================== */
export const checkInReservation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = (await pool.query('SELECT * FROM reservations WHERE reservation_id = $1 AND cafe_id IS NOT DISTINCT FROM $2',
      [id, req.actor?.cafe_id ?? null])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Reservation not found' });
    if (row.status !== 'CONFIRMED') {
      return res.status(409).json({ success: false, message: `That reservation is ${row.status.toLowerCase()}, not confirmed` });
    }

    await pool.query(
      `UPDATE reservations SET status = 'CHECKED_IN', checked_in_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE reservation_id = $1`,
      [id]
    );

    await recordAudit(req, {
      action: 'reservation.check_in', category: 'reservations', entity: 'reservation', entity_id: id,
      summary: `Checked in reservation #${id}`
    });

    const full = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = $1`, [id]);
    res.status(200).json({ success: true, message: 'Checked in', data: shape(full.rows[0]) });
  } catch (error) {
    console.error('Error checking in reservation:', error);
    res.status(500).json({ success: false, message: 'Could not check in that reservation' });
  }
};

/* ==========================================================================
   POST /api/reservations/:id/no-show — staff only.
   ========================================================================== */
export const markNoShow = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = (await pool.query('SELECT * FROM reservations WHERE reservation_id = $1 AND cafe_id IS NOT DISTINCT FROM $2',
      [id, req.actor?.cafe_id ?? null])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Reservation not found' });
    if (row.status !== 'CONFIRMED') {
      return res.status(409).json({ success: false, message: `That reservation is ${row.status.toLowerCase()}, not confirmed` });
    }

    await pool.query(
      `UPDATE reservations SET status = 'NO_SHOW', updated_at = CURRENT_TIMESTAMP WHERE reservation_id = $1`,
      [id]
    );

    await recordAudit(req, {
      action: 'reservation.no_show', category: 'reservations', entity: 'reservation', entity_id: id,
      summary: `Marked reservation #${id} as a no-show`
    });

    const full = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = $1`, [id]);
    res.status(200).json({ success: true, message: 'Marked as a no-show', data: shape(full.rows[0]) });
  } catch (error) {
    console.error('Error marking no-show:', error);
    res.status(500).json({ success: false, message: 'Could not update that reservation' });
  }
};
