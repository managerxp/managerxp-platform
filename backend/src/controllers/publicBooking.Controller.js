import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { can } from '../modules/entitlements/entitlements.service.js';
import {
  shape, SELECT_RESERVATION, parseTimes, categoryAvailability, pcHasConflict,
  storeHoursFor, withinStoreHours, storeHoursMessage
} from './reservations.Controller.js';

/*
 * The public booking page — managerxp.com/book/:slug — no account, no café
 * token, just a link a café hands its customers. Everything here resolves
 * the café from the slug in the URL rather than trusting a cafe_id in the
 * request, and creates only guest reservations (no customer_id, since there
 * is no login here to attach one to). The actual availability math is the
 * same capacity check the authenticated booking flow uses — imported from
 * reservations.Controller.js rather than re-derived, so "is this station
 * free" can never answer differently depending on which door was used to ask.
 *
 * Reservations is a subscription feature (see the RESERVATIONS key in
 * entitlements.service.js). A café whose package does not include it, or
 * had it switched off by ManagerXP, gets the same 404 an unknown slug does —
 * the link genuinely stops working rather than merely being hidden from the
 * owner's dashboard, so downgrading a plan actually turns the feature off.
 */

const resolveCafe = async (slug) => {
  if (!slug) return null;
  const row = (await pool.query(
    `SELECT cafe_id, name, organization_id FROM cafes WHERE slug = $1 AND is_active = TRUE`, [String(slug)]
  )).rows[0];
  if (!row) return null;
  if (row.organization_id && !(await can(row.organization_id, 'RESERVATIONS'))) return null;
  return row;
};

/* ==========================================================================
   GET /api/public/cafes/:slug
   What the booking page needs before it can show a form: the café's name
   and which station types it actually has.
   ========================================================================== */
export const publicCafeInfo = async (req, res) => {
  try {
    const cafe = await resolveCafe(req.params.slug);
    if (!cafe) return res.status(404).json({ success: false, message: 'No café found at that link' });

    const [categories, hours] = await Promise.all([
      pool.query(
        `SELECT category, COUNT(*)::int AS total FROM pcs
          WHERE cafe_id = $1 AND category IS NOT NULL AND status != 'INACTIVE'
          GROUP BY category ORDER BY category`,
        [cafe.cafe_id]
      ),
      storeHoursFor(pool, cafe.cafe_id)
    ]);
    res.status(200).json({
      success: true,
      data: {
        name: cafe.name, categories: categories.rows,
        opening_time: hours.openingTime ? String(hours.openingTime).slice(0, 5) : null,
        closing_time: hours.closingTime ? String(hours.closingTime).slice(0, 5) : null
      }
    });
  } catch (error) {
    console.error('Public café lookup failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that café' });
  }
};

/* ==========================================================================
   GET /api/public/cafes/:slug/availability?category=&start_time=&end_time=
   ========================================================================== */
export const publicAvailability = async (req, res) => {
  try {
    const cafe = await resolveCafe(req.params.slug);
    if (!cafe) return res.status(404).json({ success: false, message: 'No café found at that link' });

    const times = parseTimes(req.query);
    if (times.error) return res.status(400).json({ success: false, message: times.error });

    const category = req.query.category ? String(req.query.category).trim() : null;
    if (!category) return res.status(400).json({ success: false, message: 'Choose a station type' });

    const hours = await storeHoursFor(pool, cafe.cafe_id);
    if (!withinStoreHours(hours.openingTime, hours.closingTime, times.start, times.end)) {
      return res.status(200).json({
        success: true,
        data: { category, available: false, reason: 'closed', message: storeHoursMessage(hours.openingTime, hours.closingTime) }
      });
    }

    const avail = await categoryAvailability(pool, { cafeId: cafe.cafe_id, category, start: times.start, end: times.end });
    res.status(200).json({ success: true, data: { category, ...avail, available: avail.available > 0 } });
  } catch (error) {
    console.error('Public availability check failed:', error);
    res.status(500).json({ success: false, message: 'Could not check availability' });
  }
};

// A café's whole floor is rarely more than a few dozen stations, and this is
// an unauthenticated form — a cap here is what stops "10,000" typed into the
// field from trying to insert that many rows.
const MAX_GROUP_SIZE = 10;

/* ==========================================================================
   POST /api/public/cafes/:slug/reservations
   { category, start_time, end_time, guest_name, guest_phone, notes?, quantity? }
   Always a guest booking, always paid at the counter — there is no wallet to
   charge without a login, so this only ever holds the station, the same as
   a phone-in booking would.

   `quantity` books that many stations of the category together, for a group
   arriving as one party — all or nothing, inside one transaction, so a
   group of 3 never ends up with 2 stations held and a third silently
   missing. `party_size` (already on the schema, previously write-only from
   the staff-side form and never read back) is set to the group's total on
   every row created, so a café looking at any one of them can tell it is
   part of a group and how large.
   ========================================================================== */
export const publicCreateReservation = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafe = await resolveCafe(req.params.slug);
    if (!cafe) return res.status(404).json({ success: false, message: 'No café found at that link' });

    const times = parseTimes(req.body);
    if (times.error) return res.status(400).json({ success: false, message: times.error });

    const category = req.body?.category ? String(req.body.category).trim().slice(0, 60) : null;
    if (!category) return res.status(400).json({ success: false, message: 'Choose a station type' });

    const guestName = req.body?.guest_name ? String(req.body.guest_name).trim().slice(0, 160) : '';
    if (!guestName) return res.status(400).json({ success: false, message: 'Enter your name' });
    const guestPhone = req.body?.guest_phone ? String(req.body.guest_phone).trim().slice(0, 20) : null;
    const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 300) : null;

    const rawQuantity = req.body?.quantity ? parseInt(req.body.quantity, 10) : 1;
    const quantity = Number.isFinite(rawQuantity) ? Math.min(MAX_GROUP_SIZE, Math.max(1, rawQuantity)) : 1;

    const hours = await storeHoursFor(pool, cafe.cafe_id);
    if (!withinStoreHours(hours.openingTime, hours.closingTime, times.start, times.end)) {
      return res.status(409).json({ success: false, message: storeHoursMessage(hours.openingTime, hours.closingTime) });
    }

    await client.query('BEGIN');

    const avail = await categoryAvailability(client, { cafeId: cafe.cafe_id, category, start: times.start, end: times.end });
    if (avail.total === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: `No ${category} stations at this café` });
    }
    if (avail.available <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `No ${category} stations free at that time` });
    }
    if (avail.available < quantity) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Only ${avail.available} of ${quantity} ${category} stations are free at that time`
      });
    }

    const ids = [];
    for (let i = 0; i < quantity; i++) {
      const inserted = await client.query(
        `INSERT INTO reservations
           (cafe_id, category, guest_name, guest_phone, start_time, end_time, party_size, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'public')
         RETURNING reservation_id`,
        [cafe.cafe_id, category, guestName, guestPhone, times.start, times.end, quantity, notes]
      );
      ids.push(inserted.rows[0].reservation_id);
    }

    await client.query('COMMIT');

    const full = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = ANY($1::int[]) ORDER BY r.reservation_id`, [ids]);
    const rows = full.rows.map(shape);

    await recordAudit(req, {
      action: 'reservation.create', category: 'reservations', entity: 'reservation', entity_id: rows[0].reservation_id,
      summary: quantity > 1
        ? `Public booking: ${quantity}× ${category} for ${guestName} at ${rows[0].start_time}`
        : `Public booking: ${category} for ${guestName} at ${rows[0].start_time}`
    });

    res.status(201).json({
      success: true,
      message: quantity > 1 ? `Booked ${quantity} stations — see you then!` : 'Booked — see you then!',
      data: quantity > 1 ? rows : rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Public booking failed:', error);
    res.status(500).json({ success: false, message: 'Could not book that' });
  } finally {
    client.release();
  }
};
