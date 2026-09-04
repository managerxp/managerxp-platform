import pool from '../../config/database.js';
import { SCOPE } from './ai.scope.js';

/*
 * The analytical tool layer.
 *
 * Every tool here is:
 *
 *   read-only     — SELECT only. Nothing in this file writes, and the service
 *                   never hands the model a way to reach a writing endpoint.
 *   parameterised — no value is ever interpolated into SQL. The café id and
 *                   every date arrive as bind parameters.
 *   tenant-scoped — each query carries a scope clause from ai.scope.js. A tool
 *                   that cannot be scoped is not written.
 *   bounded       — every result set has a LIMIT, so one question cannot pull
 *                   a year of rows into memory.
 *
 * The model does not write SQL and never sees this file. It chooses which of
 * these named tools to run; the SQL is fixed here. That is what stops a
 * question from becoming a query.
 */

const num = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => (v === null || v === undefined ? 0 : Number(Number(v).toFixed(2)));

/** Percentage change, or null when the baseline is zero and change is undefined. */
export const pctChange = (current, previous) => {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) return c === 0 ? 0 : null;
  return Number((((c - p) / p) * 100).toFixed(1));
};

/* ==========================================================================
   REVENUE
   ========================================================================== */
/**
 * Revenue for a window, split by what produced it.
 *
 * Revenue is taken from `bills`, not from session charges: a bill is the
 * settled figure after discount and tax, while a session charge is only the
 * gaming line. Voided bills are excluded — they represent trade that did not
 * happen.
 */
export const get_revenue_summary = async ({ cafeId, from, to }) => {
  const totals = await pool.query(
    `SELECT
       COUNT(*)::int                              AS bills,
       COALESCE(SUM(b.total), 0)                  AS revenue,
       COALESCE(SUM(b.discount), 0)               AS discounts,
       COALESCE(SUM(b.paid_amount), 0)            AS collected,
       COUNT(*) FILTER (WHERE b.status = 'PAID')::int AS settled
     FROM bills b
     WHERE ${SCOPE.bills('b')} AND b.status <> 'VOID'
       AND b.created_at >= $2 AND b.created_at < $3`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );

  // The split comes from bill_items, which is where the kind of charge lives.
  const split = await pool.query(
    `SELECT bi.item_type, COALESCE(SUM(bi.amount), 0) AS amount, COUNT(*)::int AS lines
     FROM bill_items bi
     JOIN bills b ON b.bill_id = bi.bill_id
     WHERE ${SCOPE.bills('b')} AND b.status <> 'VOID'
       AND b.created_at >= $2 AND b.created_at < $3
     GROUP BY bi.item_type`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );

  const byType = {};
  split.rows.forEach((r) => { byType[r.item_type] = money(r.amount); });

  const t = totals.rows[0];
  return {
    revenue: money(t.revenue),
    collected: money(t.collected),
    discounts: money(t.discounts),
    bills: t.bills,
    settled: t.settled,
    gaming: byType.gaming || 0,
    fnb: byType.fnb || 0,
    shop: byType.shop || 0,
    other: byType.other || 0,
    average_bill: t.bills ? money(Number(t.revenue) / t.bills) : 0
  };
};

/** The same figures for two windows, with the change between them. */
export const compare_revenue = async ({ cafeId, from, to, prevFrom, prevTo }) => {
  const [current, previous] = await Promise.all([
    get_revenue_summary({ cafeId, from, to }),
    get_revenue_summary({ cafeId, from: prevFrom, to: prevTo })
  ]);

  const change = {};
  ['revenue', 'gaming', 'fnb', 'shop', 'other', 'bills', 'discounts', 'average_bill']
    .forEach((k) => {
      change[k] = {
        current: current[k],
        previous: previous[k],
        delta: Number((current[k] - previous[k]).toFixed(2)),
        pct: pctChange(current[k], previous[k])
      };
    });

  return { current, previous, change };
};

/** Revenue by hour of day — where a day's trade actually sits. */
export const get_hourly_revenue = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `WITH slots AS (SELECT generate_series(0, 23) AS hour)
     SELECT slots.hour,
            COALESCE(SUM(b.total), 0)  AS revenue,
            COUNT(b.bill_id)::int      AS bills
     FROM slots
     LEFT JOIN bills b
       ON EXTRACT(HOUR FROM b.created_at) = slots.hour
      AND ${SCOPE.bills('b')} AND b.status <> 'VOID'
      AND b.created_at >= $2 AND b.created_at < $3
     GROUP BY slots.hour ORDER BY slots.hour`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  return result.rows.map((r) => ({ hour: r.hour, revenue: money(r.revenue), bills: r.bills }));
};

/* ==========================================================================
   SESSIONS & STATIONS
   ========================================================================== */
export const get_session_summary = async ({ cafeId, from, to, startHour, endHour }) => {
  const hourFilter = Number.isInteger(startHour) && Number.isInteger(endHour)
    ? 'AND EXTRACT(HOUR FROM s.started_at) >= $4 AND EXTRACT(HOUR FROM s.started_at) < $5'
    : '';
  const params = [cafeId, from, to];
  if (hourFilter) params.push(startHour, endHour);

  const result = await pool.query(
    `SELECT
       COUNT(*)::int                                    AS sessions,
       COUNT(*) FILTER (WHERE s.customer_id IS NULL)::int AS guest_sessions,
       COALESCE(SUM(s.billable_seconds), 0)             AS play_seconds,
       COALESCE(AVG(NULLIF(s.billable_seconds, 0)), 0)  AS avg_seconds,
       COALESCE(SUM(s.amount_charged), 0)               AS gaming_charged,
       COUNT(DISTINCT s.pc_id)::int                     AS stations_used
     FROM sessions s
     WHERE ${SCOPE.sessions('s')}
       AND s.started_at >= $2 AND s.started_at < $3 ${hourFilter}`
      .replaceAll('$CAFE', '$1'),
    params
  );

  const r = result.rows[0];
  return {
    sessions: r.sessions,
    guest_sessions: r.guest_sessions,
    registered_sessions: r.sessions - r.guest_sessions,
    play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
    average_minutes: Number((num(r.avg_seconds) / 60).toFixed(1)),
    gaming_charged: money(r.gaming_charged),
    stations_used: r.stations_used
  };
};

/**
 * Per-station utilisation and revenue.
 *
 * Utilisation is billable time over the hours the window spans — not over
 * opening hours, which the platform does not record. Reporting it against an
 * invented trading day would overstate every station.
 */
export const get_station_utilization = async ({ cafeId, from, to, limit = 50 }) => {
  const result = await pool.query(
    `SELECT p.pc_id, p.name AS station, p.is_active, z.zone_name,
            COUNT(s.session_id)::int             AS sessions,
            COALESCE(SUM(s.billable_seconds), 0) AS play_seconds,
            COALESCE(SUM(s.amount_charged), 0)   AS gaming_revenue,
            MAX(s.started_at)                    AS last_session
     FROM pcs p
     LEFT JOIN floor_zones z ON z.zone_id = p.zone_id
     LEFT JOIN sessions s
       ON s.pc_id = p.pc_id AND s.started_at >= $2 AND s.started_at < $3
     WHERE ${SCOPE.pcs('p')}
     GROUP BY p.pc_id, p.name, p.is_active, z.zone_name
     ORDER BY play_seconds DESC
     LIMIT $4`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to, limit]
  );

  const windowHours = (new Date(to) - new Date(from)) / 3600000;

  return result.rows.map((r) => ({
    station: r.station,
    zone: r.zone_name,
    is_active: r.is_active,
    sessions: r.sessions,
    play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
    gaming_revenue: money(r.gaming_revenue),
    utilisation_pct: windowHours > 0
      ? Number(((num(r.play_seconds) / 3600 / windowHours) * 100).toFixed(1))
      : 0,
    last_session: r.last_session
  }));
};

/** Sessions started by hour — when the floor actually fills. */
export const get_peak_hours = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `WITH slots AS (SELECT generate_series(0, 23) AS hour)
     SELECT slots.hour,
            COUNT(s.session_id)::int             AS sessions,
            COALESCE(SUM(s.billable_seconds), 0) AS play_seconds
     FROM slots
     LEFT JOIN sessions s
       ON EXTRACT(HOUR FROM s.started_at) = slots.hour
      AND ${SCOPE.sessions('s')}
      AND s.started_at >= $2 AND s.started_at < $3
     GROUP BY slots.hour ORDER BY slots.hour`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  return result.rows.map((r) => ({
    hour: r.hour,
    sessions: r.sessions,
    play_hours: Number((num(r.play_seconds) / 3600).toFixed(2))
  }));
};

/* ==========================================================================
   F&B, PRODUCTS, ORDERS
   ========================================================================== */
export const get_fnb_summary = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int                                     AS orders,
       COALESCE(SUM(o.total), 0)                         AS revenue,
       COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
       COALESCE(AVG(NULLIF(o.total, 0)), 0)              AS average_order
     FROM orders o
     WHERE ${SCOPE.orders('o')}
       AND o.created_at >= $2 AND o.created_at < $3`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  const r = result.rows[0];
  return {
    orders: r.orders,
    revenue: money(r.revenue),
    cancelled: r.cancelled,
    average_order: money(r.average_order)
  };
};

export const get_product_sales = async ({ cafeId, from, to, limit = 15 }) => {
  const result = await pool.query(
    `SELECT oi.product_name,
            SUM(oi.quantity)::int       AS quantity,
            COALESCE(SUM(oi.amount), 0) AS revenue
     FROM order_items oi
     JOIN orders o ON o.order_id = oi.order_id
     WHERE ${SCOPE.orders('o')} AND o.status <> 'CANCELLED'
       AND o.created_at >= $2 AND o.created_at < $3
     GROUP BY oi.product_name
     ORDER BY revenue DESC
     LIMIT $4`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to, limit]
  );
  return result.rows.map((r) => ({
    product: r.product_name,
    quantity: r.quantity,
    revenue: money(r.revenue)
  }));
};

/* ==========================================================================
   MONEY MOVEMENTS
   ========================================================================== */
export const get_payment_summary = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `SELECT pay.method,
            COALESCE(SUM(pay.amount) FILTER (WHERE pay.amount > 0), 0) AS taken,
            COALESCE(SUM(-pay.amount) FILTER (WHERE pay.amount < 0), 0) AS refunded,
            COUNT(*) FILTER (WHERE pay.amount > 0)::int AS tenders
     FROM payments pay
     WHERE ${SCOPE.payments('pay')}
       AND pay.created_at >= $2 AND pay.created_at < $3
     GROUP BY pay.method ORDER BY taken DESC`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  return result.rows.map((r) => ({
    method: r.method,
    taken: money(r.taken),
    refunded: money(r.refunded),
    tenders: r.tenders
  }));
};

export const get_refund_summary = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS refunds, COALESCE(SUM(-pay.amount), 0) AS amount
     FROM payments pay
     WHERE ${SCOPE.payments('pay')} AND pay.amount < 0
       AND pay.created_at >= $2 AND pay.created_at < $3`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  return { refunds: result.rows[0].refunds, amount: money(result.rows[0].amount) };
};

export const get_discount_summary = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `SELECT COALESCE(SUM(b.discount), 0) AS amount,
            COUNT(*) FILTER (WHERE b.discount > 0)::int AS discounted_bills
     FROM bills b
     WHERE ${SCOPE.bills('b')} AND b.status <> 'VOID'
       AND b.created_at >= $2 AND b.created_at < $3`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  return {
    amount: money(result.rows[0].amount),
    discounted_bills: result.rows[0].discounted_bills
  };
};

/* ==========================================================================
   CUSTOMERS
   ========================================================================== */
/**
 * Customers are a global directory, so only their activity in this café is
 * reported — reached through sessions, which carry cafe_id.
 */
export const get_customer_summary = async ({ cafeId, from, to, limit = 10 }) => {
  const top = await pool.query(
    `SELECT c.customer_name,
            COUNT(s.session_id)::int             AS visits,
            COALESCE(SUM(s.billable_seconds), 0) AS play_seconds,
            COALESCE(SUM(s.amount_charged), 0)   AS spend
     FROM sessions s
     JOIN customers c ON c.customer_id = s.customer_id
     WHERE ${SCOPE.sessions('s')}
       AND s.started_at >= $2 AND s.started_at < $3
     GROUP BY c.customer_id, c.customer_name
     ORDER BY visits DESC, spend DESC
     LIMIT $4`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to, limit]
  );

  return top.rows.map((r) => ({
    customer: r.customer_name,
    visits: r.visits,
    play_hours: Number((num(r.play_seconds) / 3600).toFixed(2)),
    spend: money(r.spend)
  }));
};

/* ==========================================================================
   STATION HEALTH
   ========================================================================== */
/**
 * How much of the window each station was actually reporting telemetry for.
 * Silence is the closest thing the platform records to downtime — it does not
 * log outages directly, so this is described as "not reporting" rather than
 * claimed as downtime.
 */
export const get_station_reporting = async ({ cafeId, from, to }) => {
  const result = await pool.query(
    `SELECT p.name AS station,
            COUNT(t.telemetry_id)::int AS samples,
            MAX(t.sampled_at)          AS last_sample,
            ROUND(AVG(t.cpu_percent), 1) AS avg_cpu
     FROM pcs p
     LEFT JOIN station_telemetry t
       ON t.pc_id = p.pc_id AND t.sampled_at >= $2 AND t.sampled_at < $3
     WHERE ${SCOPE.pcs('p')}
     GROUP BY p.pc_id, p.name ORDER BY samples ASC
     LIMIT 50`
      .replaceAll('$CAFE', '$1'),
    [cafeId, from, to]
  );
  return result.rows.map((r) => ({
    station: r.station,
    samples: r.samples,
    last_sample: r.last_sample,
    avg_cpu: num(r.avg_cpu)
  }));
};

/* ==========================================================================
   REGISTRY
   ========================================================================== */
/**
 * The tools the service may run, by name. Anything not in this map cannot be
 * called — the name is looked up here rather than resolved dynamically, so a
 * crafted question cannot reach a function that was never meant to be a tool.
 */
export const TOOLS = {
  get_revenue_summary,
  compare_revenue,
  get_hourly_revenue,
  get_session_summary,
  get_station_utilization,
  get_peak_hours,
  get_fnb_summary,
  get_product_sales,
  get_payment_summary,
  get_refund_summary,
  get_discount_summary,
  get_customer_summary,
  get_station_reporting
};

export const TOOL_NAMES = Object.keys(TOOLS);

/** Run a named tool under a scope. Refuses anything not in the registry. */
export const runTool = async (name, args) => {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!Number.isInteger(Number(args.cafeId))) {
    throw new Error('A tool was called without a café scope');
  }
  return tool(args);
};
