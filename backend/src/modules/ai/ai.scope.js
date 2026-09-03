/*
 * Tenant scope for CafeXP AI.
 *
 * The café is resolved from the authenticated token and nowhere else. A
 * `cafe_id` in the request body is ignored: accepting one would let any signed
 * -in user read another café's trading figures simply by changing a number.
 *
 * ── What the schema can and cannot scope ────────────────────────────────────
 *
 * Only some tables carry `cafe_id`:
 *
 *     bills · sessions · pcs · staff · floor_zones · discount_codes ·
 *     branches · subscriptions
 *
 * The rest — orders, payments, bill_items, products, customers,
 * station_telemetry, wallet_transactions — carry none. They are reached
 * through a join that does:
 *
 *     payments, bill_items   → bills.cafe_id
 *     orders, order_items    → pcs.cafe_id (via orders.pc_id)
 *                              or bills.cafe_id (via orders.bill_id)
 *     station_telemetry      → pcs.cafe_id
 *     sessions               → cafe_id directly
 *
 * Two things genuinely cannot be scoped, because the platform models them as
 * global rather than per-café:
 *
 *     products          — one catalogue shared across cafés
 *     customers         — one directory shared across cafés
 *
 * Their *activity* is scopable (a product's sales come through orders; a
 * customer's visits come through sessions), so no trading figure leaks. Only
 * the catalogue rows themselves are shared, and the tools never report on a
 * product or customer that has no activity in the caller's café.
 *
 * This file states that plainly rather than implying an isolation the data
 * model does not provide.
 */

/** SQL fragments that scope a table to a café. Every tool must use one. */
export const SCOPE = {
  // Direct — the table carries cafe_id itself.
  bills: (alias = 'b') => `${alias}.cafe_id = $CAFE`,
  sessions: (alias = 's') => `${alias}.cafe_id = $CAFE`,
  pcs: (alias = 'p') => `${alias}.cafe_id = $CAFE`,

  // Indirect — reached through a row that does.
  payments: (alias = 'pay') =>
    `EXISTS (SELECT 1 FROM bills sb WHERE sb.bill_id = ${alias}.bill_id AND sb.cafe_id = $CAFE)`,
  billItems: (alias = 'bi') =>
    `EXISTS (SELECT 1 FROM bills sb WHERE sb.bill_id = ${alias}.bill_id AND sb.cafe_id = $CAFE)`,
  /*
   * Orders reach their café by three routes because the column that should
   * carry it is unreliable: `orders.pc_id` is frequently NULL while `pc_name`
   * is set, so a station-only join silently loses most orders. The bill is the
   * dependable link, with the station as a fallback for orders raised before
   * one exists.
   */
  orders: (alias = 'o') =>
    `(EXISTS (SELECT 1 FROM bills sb WHERE sb.bill_id = ${alias}.bill_id AND sb.cafe_id = $CAFE)
      OR EXISTS (SELECT 1 FROM pcs sp
                 WHERE (sp.pc_id = ${alias}.pc_id OR sp.name = ${alias}.pc_name)
                   AND sp.cafe_id = $CAFE))`,
  telemetry: (alias = 't') =>
    `EXISTS (SELECT 1 FROM pcs sp WHERE sp.pc_id = ${alias}.pc_id AND sp.cafe_id = $CAFE)`
};

/**
 * Build the scope for a request from its authenticated actor.
 *
 * `req.actor` is populated by the auth guards. An owner token carries the
 * café it belongs to; a staff token carries the café its record was created
 * under. Neither comes from the request body.
 */
export const resolveScope = (req) => {
  const actor = (req && req.actor) || {};
  const cafeId = actor.cafe_id ?? null;

  return {
    cafeId,
    // Named so a log line reads usefully without exposing the token.
    actorLabel: actor.label || actor.email || 'unknown',
    actorKind: actor.staff_id ? 'staff' : (actor.role ? 'owner' : 'unknown'),
    staffId: actor.staff_id || null,
    permissions: Array.isArray(actor.permissions) ? actor.permissions : null,
    isOwner: !!actor.role && !actor.staff_id,

    /*
     * A café that cannot be identified is not silently widened to "all
     * cafés" — that is exactly the cross-tenant read this file exists to
     * prevent. The service refuses the request instead.
     */
    get usable() {
      // Number(null) is 0 and Number.isInteger(0) is true, so a null café
      // would otherwise pass this check and every query would then run against
      // `cafe_id = NULL` — matching nothing, silently.
      if (cafeId === null || cafeId === undefined || cafeId === '') return false;
      return Number.isInteger(Number(cafeId));
    }
  };
};

/**
 * Apply the scope to a SQL fragment.
 *
 * `$CAFE` is replaced with a real bind position rather than the value, so the
 * café id travels as a parameter and never as interpolated text.
 */
export const bindScope = (sql, paramIndex) => sql.replace(/\$CAFE/g, `$${paramIndex}`);
