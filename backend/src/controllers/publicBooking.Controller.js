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

/* ==========================================================================
   POST /api/public/cafes/:slug/reservations
   { category, start_time, end_time, guest_name, guest_phone, notes? }
   Always a guest booking, always paid at the counter — there is no wallet to
   charge without a login, so this only ever holds the station, the same as
   a phone-in booking would.
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

    const inserted = await client.query(
      `INSERT INTO reservations (cafe_id, category, guest_name, guest_phone, start_time, end_time, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'public')
       RETURNING reservation_id`,
      [cafe.cafe_id, category, guestName, guestPhone, times.start, times.end, notes]
    );

    await client.query('COMMIT');

    const full = await pool.query(`${SELECT_RESERVATION} WHERE r.reservation_id = $1`, [inserted.rows[0].reservation_id]);
    const row = shape(full.rows[0]);

    await recordAudit(req, {
      action: 'reservation.create', category: 'reservations', entity: 'reservation', entity_id: row.reservation_id,
      summary: `Public booking: ${row.category} for ${guestName} at ${row.start_time}`
    });

    res.status(201).json({ success: true, message: 'Booked — see you then!', data: row });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Public booking failed:', error);
    res.status(500).json({ success: false, message: 'Could not book that' });
  } finally {
    client.release();
  }
};
