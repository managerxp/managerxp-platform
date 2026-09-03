import pool from '../config/database.js';

/*
 * Reports.
 *
 * Every figure here is an aggregate over rows that already exist — bills,
 * sessions, orders. Nothing is modelled, projected or smoothed. If a café has
 * traded for three days, the report covers three days and says so; it does not
 * extrapolate a month.
 *
 * Revenue is taken from `bills`, not from `sessions.amount_charged`, because a
 * bill is the settled figure after discounts and tax while a session charge is
 * only the gaming line. Where a breakdown by kind is needed, `bill_items`
 * carries the split.
 */

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

/**
 * The window a report covers. Defaults to the last 30 days, which is the
 * span most café questions are actually about.
 */
const range = (req) => {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 30 * 24 * 3600 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from > to) return null;

  return { from: from.toISOString(), to: to.toISOString() };
};

const badRange = (res) =>
  res.status(400).json({ success: false, message: 'Give a valid from and to date' });

/*
 * `finance` and `games` below are scoped to `req.actor.cafe_id`, unlike the
 * six reports above them. Those were written before this install carried
 * more than one café and were never revisited — every query above reads
 * `bills`/`sessions`/`orders`/`customers` with no café filter at all, so a
 * café's staff can currently see another café's revenue and top spenders.
 * `customers` itself has no `cafe_id` column to filter by, which is a
 * schema gap, not a query bug, and is well beyond what a reporting feature
 * should silently rewrite. It is called out here rather than fixed here.
 *
 * Both new endpoints avoid adding to that hole: neither joins `customers`
 * for anything but a display name already reached through a café-scoped
 * `sessions` row.
 */
const requireCafe = (req, res) => {
  const cafeId = req.actor?.cafe_id;
  if (!cafeId) {
    res.status(403).json({ success: false, message: 'This account is not tied to a café' });
    return null;
  }
  return cafeId;
};

/* ==========================================================================
   SUMMARY
   ========================================================================== */
// GET /api/reports/summary?from=&to=
export const summary = async (req, res) => {
  try {
    const window = range(req);
    if (!window) return badRange(res);
    const args = [window.from, window.to];

    const [bills, sessions, orders, customers, wallet] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int                                   AS bill_count,
           COALESCE(SUM(total), 0)                         AS revenue,
           COALESCE(SUM(discount), 0)                      AS discounts,
           COALESCE(SUM(tax), 0)                           AS tax,
           COUNT(*) FILTER (WHERE status = 'PAID')::int    AS paid_count,
           COUNT(*) FILTER (WHERE status = 'OPEN')::int    AS open_count,
           COALESCE(SUM(total) FILTER (WHERE status = 'OPEN'), 0) AS outstanding
         FROM bills b
         LEFT JOIN customers c ON c.customer_id = b.customer_id
         WHERE b.created_at BETWEEN $1 AND $2
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'`, args
      ),
      pool.query(
        `SELECT
           COUNT(*)::int                                        AS session_count,
           COUNT(*) FILTER (WHERE s.customer_id IS NULL)::int    AS guest_count,
           COALESCE(SUM(s.billable_seconds), 0)                  AS play_seconds,
           COALESCE(AVG(NULLIF(s.billable_seconds, 0)), 0)       AS avg_seconds
         FROM sessions s
         LEFT JOIN customers c ON c.customer_id = s.customer_id
         WHERE s.started_at BETWEEN $1 AND $2
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'`, args
      ),
      pool.query(
        `SELECT
           COUNT(*)::int                                       AS order_count,
           COALESCE(SUM(o.total), 0)                           AS fnb_revenue,
           COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int  AS cancelled
         FROM orders o
         LEFT JOIN customers c ON c.customer_id = o.customer_id
         WHERE o.created_at BETWEEN $1 AND $2
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'`, args
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS new_customers
         FROM customers WHERE created_at BETWEEN $1 AND $2 AND customer_type <> 'STAFF'`, args
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(w.amount) FILTER (WHERE w.direction = 'credit'), 0) AS topped_up,
           COALESCE(SUM(w.amount) FILTER (WHERE w.direction = 'debit'), 0)  AS spent
         FROM wallet_transactions w
         LEFT JOIN customers c ON c.customer_id = w.customer_id
         WHERE w.created_at BETWEEN $1 AND $2
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'`, args
      )
    ]);

    const b = bills.rows[0];
    const s = sessions.rows[0];
    const o = orders.rows[0];

    res.status(200).json({
      success: true,
      window,
      data: {
        revenue: {
          total: num(b.revenue),
          discounts: num(b.discounts),
          tax: num(b.tax),
          outstanding: num(b.outstanding),
          bills: b.bill_count,
          paid: b.paid_count,
          open: b.open_count,
          // The plain question a café owner asks: what does a bill average?
          average_bill: b.bill_count ? Number((num(b.revenue) / b.bill_count).toFixed(2)) : 0
        },
        sessions: {
          count: s.session_count,
          guests: s.guest_count,
          registered: s.session_count - s.guest_count,
          play_hours: Number((num(s.play_seconds) / 3600).toFixed(2)),
          average_minutes: Number((num(s.avg_seconds) / 60).toFixed(1))
        },
        fnb: {
          orders: o.order_count,
          revenue: num(o.fnb_revenue),
          cancelled: o.cancelled
        },
        customers: {
          new: customers.rows[0].new_customers,
          wallet_topped_up: num(wallet.rows[0].topped_up),
          wallet_spent: num(wallet.rows[0].spent)
        }
      }
    });
  } catch (error) {
    console.error('Error building summary report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   REVENUE OVER TIME
   ========================================================================== */
/*
 * GET /api/reports/revenue?from=&to=&bucket=day|week|month
 *
 * generate_series fills the gaps, so a day with no trade is a zero rather
 * than a missing point — a chart that skips quiet days lies about the trend.
 */
export const revenue = async (req, res) => {
  try {
    const window = range(req);
    if (!window) return badRange(res);

    const bucket = ['day', 'week', 'month'].includes(req.query.bucket)
      ? req.query.bucket
      : 'day';

    const result = await pool.query(
      `WITH span AS (
         SELECT generate_series(
           date_trunc($3, $1::timestamptz),
           date_trunc($3, $2::timestamptz),
           ('1 ' || $3)::interval
         ) AS at
       ),
       billed AS (
         SELECT date_trunc($3, b.created_at) AS at,
                SUM(b.total)    AS revenue,
                SUM(b.discount) AS discounts,
                COUNT(*)::int   AS bills
         FROM bills b
         LEFT JOIN customers c ON c.customer_id = b.customer_id
         WHERE b.created_at BETWEEN $1 AND $2
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
         GROUP BY 1
       ),
       played AS (
         SELECT date_trunc($3, s.started_at) AS at,
                COUNT(*)::int AS sessions,
                SUM(s.billable_seconds) AS play_seconds
         FROM sessions s
         LEFT JOIN customers c ON c.customer_id = s.customer_id
         WHERE s.started_at BETWEEN $1 AND $2
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
         GROUP BY 1
       ),
       sold AS (
         SELECT date_trunc($3, o.created_at) AS at,
                SUM(o.total) AS fnb_revenue,
                COUNT(*)::int AS orders
         FROM orders o
         LEFT JOIN customers c ON c.customer_id = o.customer_id
         WHERE o.created_at BETWEEN $1 AND $2 AND o.status <> 'CANCELLED'
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
         GROUP BY 1
       )
       SELECT span.at,
              COALESCE(billed.revenue, 0)      AS revenue,
              COALESCE(billed.discounts, 0)    AS discounts,
              COALESCE(billed.bills, 0)        AS bills,
              COALESCE(played.sessions, 0)     AS sessions,
              COALESCE(played.play_seconds, 0) AS play_seconds,
              COALESCE(sold.fnb_revenue, 0)    AS fnb_revenue,
              COALESCE(sold.orders, 0)         AS orders
       FROM span
       LEFT JOIN billed ON billed.at = span.at
       LEFT JOIN played ON played.at = span.at
       LEFT JOIN sold   ON sold.at   = span.at
       ORDER BY span.at`,
      [window.from, window.to, bucket]
    );

    res.status(200).json({
      success: true,
      window: { ...window, bucket },
      data: result.rows.map((r) => ({
        at: r.at,
        revenue: num(r.revenue),
        discounts: num(r.discounts),
        bills: r.bills,
        sessions: r.sessions,
        play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
        fnb_revenue: num(r.fnb_revenue),
        orders: r.orders
      }))
    });
  } catch (error) {
    console.error('Error building revenue report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   STATIONS
   ========================================================================== */
// GET /api/reports/stations?from=&to=
export const stations = async (req, res) => {
  try {
    const window = range(req);
    if (!window) return badRange(res);

    // Utilisation is billable time over the hours the window actually spans,
    // which is the only denominator that does not need invented opening hours.
    const result = await pool.query(
      `SELECT p.pc_id, p.name AS pc_name, z.zone_name,
              COUNT(s.session_id)::int              AS sessions,
              COALESCE(SUM(s.billable_seconds), 0)  AS play_seconds,
              COALESCE(SUM(s.amount_charged), 0)    AS gaming_revenue,
              MAX(s.started_at)                     AS last_session
       FROM pcs p
       LEFT JOIN floor_zones z ON z.zone_id = p.zone_id
       LEFT JOIN (
         /* Pre-filtered rather than a WHERE after the join to pcs: a WHERE
            there would drop a station down to no row at all for a window
            where every session on it happened to be a staff/test one,
            instead of correctly showing it idle. */
         SELECT s.* FROM sessions s
         LEFT JOIN customers c ON c.customer_id = s.customer_id
         WHERE COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
       ) s ON s.pc_id = p.pc_id AND s.started_at BETWEEN $1 AND $2
       GROUP BY p.pc_id, p.name, z.zone_name
       ORDER BY play_seconds DESC, p.name`,
      [window.from, window.to]
    );

    const windowHours = (new Date(window.to) - new Date(window.from)) / 3600000;

    res.status(200).json({
      success: true,
      window: { ...window, hours: Number(windowHours.toFixed(2)) },
      data: result.rows.map((r) => ({
        pc_id: r.pc_id,
        pc_name: r.pc_name,
        zone_name: r.zone_name,
        sessions: r.sessions,
        play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
        gaming_revenue: num(r.gaming_revenue),
        utilisation_percent: windowHours > 0
          ? Number(((num(r.play_seconds) / 3600 / windowHours) * 100).toFixed(1))
          : 0,
        last_session: r.last_session
      }))
    });
  } catch (error) {
    console.error('Error building station report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   PEAK HOURS
   ========================================================================== */
// GET /api/reports/hours?from=&to=  — when the café is actually busy
export const hours = async (req, res) => {
  try {
    const window = range(req);
    if (!window) return badRange(res);

    const result = await pool.query(
      `WITH slots AS (SELECT generate_series(0, 23) AS hour)
       SELECT slots.hour,
              COUNT(s.session_id)::int             AS sessions,
              COALESCE(SUM(s.billable_seconds), 0) AS play_seconds
       FROM slots
       LEFT JOIN (
         SELECT s.* FROM sessions s
         LEFT JOIN customers c ON c.customer_id = s.customer_id
         WHERE COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
       ) s
         ON EXTRACT(HOUR FROM s.started_at) = slots.hour
        AND s.started_at BETWEEN $1 AND $2
       GROUP BY slots.hour
       ORDER BY slots.hour`,
      [window.from, window.to]
    );

    res.status(200).json({
      success: true,
      window,
      data: result.rows.map((r) => ({
        hour: r.hour,
        sessions: r.sessions,
        play_hours: Number((num(r.play_seconds) / 3600).toFixed(2))
      }))
    });
  } catch (error) {
    console.error('Error building peak-hours report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   CUSTOMERS
   ========================================================================== */
// GET /api/reports/customers?from=&to=&limit=
export const customers = async (req, res) => {
  try {
    const window = range(req);
    if (!window) return badRange(res);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const [top, mix] = await Promise.all([
      pool.query(
        `SELECT c.customer_id, c.customer_name, c.phone_number,
                COUNT(s.session_id)::int             AS sessions,
                COALESCE(SUM(s.billable_seconds), 0) AS play_seconds,
                COALESCE(SUM(s.amount_charged), 0)   AS gaming_spend,
                MAX(s.started_at)                    AS last_visit
         FROM customers c
         JOIN sessions s ON s.customer_id = c.customer_id
         WHERE s.started_at BETWEEN $1 AND $2 AND c.customer_type <> 'STAFF'
         GROUP BY c.customer_id, c.customer_name, c.phone_number
         ORDER BY gaming_spend DESC, sessions DESC
         LIMIT $3`,
        [window.from, window.to, limit]
      ),
      // "New" means their first ever session falls inside the window, so
      // someone who joined last year and came back counts as returning.
      pool.query(
        `WITH first_seen AS (
           SELECT s.customer_id, MIN(s.started_at) AS first_session
           FROM sessions s
           JOIN customers c ON c.customer_id = s.customer_id
           WHERE s.customer_id IS NOT NULL AND c.customer_type <> 'STAFF'
           GROUP BY s.customer_id
         )
         SELECT
           COUNT(*) FILTER (WHERE first_session BETWEEN $1 AND $2)::int AS new_customers,
           COUNT(*) FILTER (WHERE first_session < $1)::int              AS existing_customers
         FROM first_seen
         WHERE customer_id IN (
           SELECT DISTINCT customer_id FROM sessions
           WHERE started_at BETWEEN $1 AND $2 AND customer_id IS NOT NULL
         )`,
        [window.from, window.to]
      )
    ]);

    res.status(200).json({
      success: true,
      window,
      data: {
        top: top.rows.map((r) => ({
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          phone_number: r.phone_number,
          sessions: r.sessions,
          play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
          gaming_spend: num(r.gaming_spend),
          last_visit: r.last_visit
        })),
        mix: mix.rows[0]
      }
    });
  } catch (error) {
    console.error('Error building customer report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   PRODUCTS
   ========================================================================== */
// GET /api/reports/products?from=&to=&limit=
export const products = async (req, res) => {
  try {
    const window = range(req);
    if (!window) return badRange(res);
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);

    const [items, categories] = await Promise.all([
      pool.query(
        `SELECT oi.product_id, oi.product_name,
                SUM(oi.quantity)::int AS quantity,
                COALESCE(SUM(oi.amount), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.order_id = oi.order_id
         LEFT JOIN customers c ON c.customer_id = o.customer_id
         WHERE o.created_at BETWEEN $1 AND $2 AND o.status <> 'CANCELLED'
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
         GROUP BY oi.product_id, oi.product_name
         ORDER BY revenue DESC
         LIMIT $3`,
        [window.from, window.to, limit]
      ),
      pool.query(
        `SELECT COALESCE(pc.category_name, 'Uncategorised') AS category_name,
                SUM(oi.quantity)::int AS quantity,
                COALESCE(SUM(oi.amount), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.order_id = oi.order_id
         LEFT JOIN customers c ON c.customer_id = o.customer_id
         LEFT JOIN products p ON p.product_id = oi.product_id
         LEFT JOIN product_categories pc ON pc.category_id = p.category_id
         WHERE o.created_at BETWEEN $1 AND $2 AND o.status <> 'CANCELLED'
           AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
         GROUP BY 1
         ORDER BY revenue DESC`,
        [window.from, window.to]
      )
    ]);

    res.status(200).json({
      success: true,
      window,
      data: {
        items: items.rows.map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          quantity: r.quantity,
          revenue: num(r.revenue)
        })),
        categories: categories.rows.map((r) => ({
          category_name: r.category_name,
          quantity: r.quantity,
          revenue: num(r.revenue)
        }))
      }
    });
  } catch (error) {
    console.error('Error building product report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   FINANCE — revenue against expenses
   ========================================================================== */
/*
 * GET /api/reports/finance?from=&to=&bucket=day|week|month
 *
 * The comparison a "how are we doing" question actually needs: what came in
 * against what went out, bucketed the same way `revenue()` already is, and
 * gap-filled the same way — a quiet day is a zero, not a missing point that
 * would make a line chart jump.
 */
export const finance = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;
    const window = range(req);
    if (!window) return badRange(res);

    const bucket = ['day', 'week', 'month'].includes(req.query.bucket)
      ? req.query.bucket
      : 'day';

    const result = await pool.query(
      `WITH span AS (
         SELECT generate_series(
           date_trunc($4, $2::timestamptz),
           date_trunc($4, $3::timestamptz),
           ('1 ' || $4)::interval
         ) AS at
       ),
       billed AS (
         SELECT date_trunc($4, b.created_at) AS at, SUM(b.total) AS revenue
           FROM bills b
           LEFT JOIN customers c ON c.customer_id = b.customer_id
          WHERE b.cafe_id = $1 AND b.created_at BETWEEN $2 AND $3
            AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
          GROUP BY 1
       ),
       spent AS (
         SELECT date_trunc($4, expense_date::timestamptz) AS at, SUM(amount) AS expenses
           FROM expenses
          WHERE cafe_id = $1 AND status = 'ACTIVE'
            AND expense_date BETWEEN $2::date AND $3::date
          GROUP BY 1
       )
       SELECT span.at,
              COALESCE(billed.revenue, 0)  AS revenue,
              COALESCE(spent.expenses, 0)  AS expenses
         FROM span
         LEFT JOIN billed ON billed.at = span.at
         LEFT JOIN spent  ON spent.at  = span.at
        ORDER BY span.at`,
      [cafeId, window.from, window.to, bucket]
    );

    const totalRevenue = result.rows.reduce((s, r) => s + num(r.revenue), 0);
    const totalExpenses = result.rows.reduce((s, r) => s + num(r.expenses), 0);

    res.status(200).json({
      success: true,
      window: { ...window, bucket },
      data: {
        points: result.rows.map((r) => ({
          at: r.at,
          revenue: num(r.revenue),
          expenses: num(r.expenses),
          profit: Number((num(r.revenue) - num(r.expenses)).toFixed(2))
        })),
        total_revenue: Number(totalRevenue.toFixed(2)),
        total_expenses: Number(totalExpenses.toFixed(2)),
        profit: Number((totalRevenue - totalExpenses).toFixed(2))
      }
    });
  } catch (error) {
    console.error('Error building finance report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};

/* ==========================================================================
   GAMES — which customer played which game
   ========================================================================== */
/*
 * GET /api/reports/games?from=&to=&limit=
 *
 * One row per game and per customer who played it, so a game's popularity
 * and who is actually paying for it are the same table rather than two
 * reports someone has to cross-reference by hand.
 *
 * Only sessions with a `gaming_price_id` are included — a session priced
 * before that column existed, or one billed at a plain hourly rate with no
 * catalogue entry, has no game to attribute the time to. It still counts in
 * every other report; it simply cannot appear in a report about which game
 * was played.
 *
 * Revenue here is `amount_charged` on the session itself, the same source
 * `stations()` and `customers()` above already use for a per-entity figure —
 * not the bill, which may bundle food and drink alongside the gaming line.
 */
export const games = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;
    const window = range(req);
    if (!window) return badRange(res);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const result = await pool.query(
      `SELECT sm.software_id, sm.software_name, sm.category,
              s.customer_id,
              COALESCE(c.customer_name, s.guest_name, 'Guest') AS customer_name,
              (s.customer_id IS NULL) AS is_guest,
              COUNT(*)::int                          AS sessions,
              COALESCE(SUM(s.billable_seconds), 0)   AS play_seconds,
              COALESCE(SUM(s.amount_charged), 0)     AS revenue
         FROM sessions s
         JOIN gaming_prices gp   ON gp.id = s.gaming_price_id
         JOIN software_master sm ON sm.software_id = gp.software_id
         LEFT JOIN customers c   ON c.customer_id = s.customer_id
        WHERE s.cafe_id = $1 AND s.status = 'ended'
          AND s.started_at BETWEEN $2 AND $3
          AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
        GROUP BY sm.software_id, sm.software_name, sm.category,
                 s.customer_id, c.customer_name, s.guest_name
        ORDER BY sm.software_name, revenue DESC
        LIMIT $4`,
      [cafeId, window.from, window.to, limit]
    );

    // The same rows, rolled up per game, so the screen can lead with "what
    // was popular" and let "who played it" be the thing you open.
    const byGame = new Map();
    result.rows.forEach((r) => {
      const key = r.software_id;
      if (!byGame.has(key)) {
        byGame.set(key, {
          software_id: r.software_id,
          software_name: r.software_name,
          category: r.category,
          sessions: 0,
          play_hours: 0,
          revenue: 0
        });
      }
      const g = byGame.get(key);
      g.sessions += r.sessions;
      g.play_hours = Number((g.play_hours + num(r.play_seconds) / 3600).toFixed(2));
      g.revenue = Number((g.revenue + num(r.revenue)).toFixed(2));
    });

    res.status(200).json({
      success: true,
      window,
      data: {
        games: Array.from(byGame.values()).sort((a, b) => b.revenue - a.revenue),
        rows: result.rows.map((r) => ({
          software_id: r.software_id,
          software_name: r.software_name,
          category: r.category,
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          is_guest: r.is_guest,
          sessions: r.sessions,
          play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
          revenue: num(r.revenue)
        }))
      }
    });
  } catch (error) {
    console.error('Error building games report:', error);
    res.status(500).json({ success: false, message: 'Error building the report' });
  }
};
