import pool from './database.js';
import { activeRuleFor, applyRule, describeRule } from './pricingRules.js';
import { categoryJoin, categoryExpr } from './softwareCategory.js';

/*
 * The session pricing engine.
 *
 * One path for every gaming type. There is no PS5 branch, no VR branch and no
 * Pool branch — a station's category decides which prices are offered, and the
 * arithmetic below is identical whichever one was chosen. Adding "Bowling"
 * tomorrow needs a row in the Gaming Price Master and no code at all.
 *
 * The Gaming Price Master prices a game against a session length:
 *
 *     PS5  · 1 Hour      · ₹400
 *     VR   · 30 Minutes  · ₹200
 *     Pool · Any Time    · ₹300      (unlimited)
 *
 * Two shapes come out of that, not six:
 *
 *   BLOCK a block of known length, sold at a fixed price. "PS5 · 1 Hour · ₹400"
 *         costs ₹400 whether they play fifteen minutes or the full hour — not
 *         less, and never more. The block's own length becomes the session's
 *         planned time, so the countdown and the charge describe the same
 *         thing. An hourly figure is still derived and kept for the receipt,
 *         but it is reference, not what is billed.
 *
 *   FLAT  an unlimited session. There is no rate to derive, so the price is
 *         charged whole however long the customer stays.
 *
 * (The old HOUR unit — a catalogue block billed pro-rata from an hourly rate —
 * is no longer produced here. Sessions started before this change keep it in
 * their snapshot and still bill exactly as they did; only the open-ended
 * counter path, which never came through this function, still writes HOUR.)
 *
 * Everything here is a snapshot taken at start. A later edit to the Gaming
 * Price Master must never change what a session already running, or long
 * finished, is worth.
 */

const round2 = (n) => Number(Number(n).toFixed(2));

/**
 * Load a gaming price and turn it into the fields a session stores.
 *
 * Returns `{ error }` rather than throwing, so the caller decides the status
 * code — consistent with how the rest of the controllers here report refusals.
 */
export const resolveGamingPrice = async (client, gamingPriceId, { stationCategory, cafeId, when } = {}) => {
  const db = client || pool;
  const id = parseInt(gamingPriceId, 10);
  if (!Number.isInteger(id)) return { error: 'A gaming price is required' };

  /*
   * Scoped to the café starting the session.
   *
   * gaming_price_id arrives from the client, so without this a crafted request
   * could start a session priced from another café's rate card — cheaper or
   * dearer than anything this café ever agreed to charge. Out of scope reads
   * as "no longer exists", the same answer a deleted price gives, so the
   * endpoint cannot be used to probe a neighbour's catalogue.
   *
   * cafeId is only omitted by internal callers that have already established
   * scope; a request path always passes it.
   */
  /* The category is the branch's own filing, not the published default —
     it has to be, because it is compared against the station's category a few
     lines below. Resolving it differently here than the dropdown that offered
     the price would refuse a price the operator was just shown. */
  const result = await db.query(
    `SELECT gp.id, gp.price, gp.currency, gp.status,
            sm.software_id, sm.software_name,
            ${categoryExpr()} AS category,
            sm.is_active AS software_active,
            s.session_name, s.duration_minutes, s.duration_type, s.status AS session_status
       FROM gaming_prices gp
       JOIN software_master sm ON sm.software_id = gp.software_id
       JOIN session_master  s  ON s.id = gp.session_master_id
       ${categoryJoin(2)}
      WHERE gp.id = $1
        AND ($2::int IS NULL OR gp.cafe_id IS NOT DISTINCT FROM $2::int)`,
    [id, cafeId ?? null]
  );

  const row = result.rows[0];
  if (!row) return { error: 'That gaming price no longer exists' };

  /* Each of these is a price the café has deliberately withdrawn. Selling at
     it because a stale dropdown still offered it is how a customer is charged
     something nobody meant to charge. */
  if (row.status !== 'ACTIVE') return { error: 'That price is not currently on sale' };
  if (!row.software_active) return { error: `${row.software_name} is no longer available` };
  if (row.session_status !== 'ACTIVE') return { error: 'That session length is no longer offered' };

  /* A PS5 price on a pool table is a mis-charge, not a preference. Only
     enforced when the station says what it is; an uncategorised station is
     treated as general purpose rather than refused. */
  if (stationCategory && row.category && stationCategory !== row.category) {
    return {
      error: `${row.software_name} is a ${row.category} price and this station is ${stationCategory}`
    };
  }

  const basePrice = Number(row.price);

  /*
   * Time-of-day pricing, resolved once, here.
   *
   * Peak, off-peak, weekend and happy-hour windows adjust the master's price
   * before any rate is derived from it, so everything downstream — the hourly
   * conversion, the running estimate, the final bill — is computed from the
   * price that was actually in force when the customer sat down. Doing it at
   * this single point is what keeps the quote and the charge the same number.
   */
  const rule = await activeRuleFor(db, {
    cafeId,
    softwareId: row.software_id,
    category: row.category,
    // Table time, explicitly — a food window must never reprice a session.
    itemType: 'GAMING',
    when: when || new Date()
  });
  const price = applyRule(basePrice, rule);
  const ruleLabel = describeRule(rule);

  const symbol = row.currency === 'INR' ? '₹' : `${row.currency} `;
  const label = `${row.software_name} · ${row.session_name} · ${symbol}${price}` +
    (ruleLabel ? ` · ${ruleLabel}` : '');

  const unlimited = row.duration_type === 'UNLIMITED' || row.duration_minutes === null;

  if (unlimited) {
    return {
      snapshot: {
        gaming_price_id: row.id,
        pricing_unit: 'FLAT',
        rate_per_hour: 0,
        flat_amount: round2(price),
        // Kept beside the charged figure so a receipt can show what the rule
        // changed, rather than only the number it landed on.
        base_flat_amount: round2(basePrice),
        base_rate_per_hour: null,
        pricing_rule_id: rule ? rule.rule_id : null,
        pricing_rule_label: ruleLabel,
        price_label: label,
        category: row.category,
        software_name: row.software_name,
        session_name: row.session_name,
        currency: row.currency
      }
    };
  }

  /* A zero-length block would divide by zero and produce an infinite rate.
     It should not be possible to save one, but a bad row must not become a
     bill of ₹Infinity. */
  if (!row.duration_minutes || row.duration_minutes <= 0) {
    return { error: 'That price has no usable duration' };
  }

  const hours = row.duration_minutes / 60;
  return {
    snapshot: {
      gaming_price_id: row.id,
      pricing_unit: 'BLOCK',
      /* The full block price is what is billed — see amountForSeconds, which
         charges flat_amount whole for a BLOCK regardless of seconds played. */
      flat_amount: round2(price),
      /* The block's own length. startSession forces planned_minutes to this so
         the station's countdown ends exactly when the paid-for block does. */
      block_minutes: row.duration_minutes,
      /* Derived hourly, kept only so a receipt can show "₹400 (₹400/hr · 1 h)".
         Nothing bills from it for a BLOCK; the running figure and the final
         charge both come from flat_amount. */
      rate_per_hour: round2(price / hours),
      base_flat_amount: round2(basePrice),
      base_rate_per_hour: round2(basePrice / hours),
      pricing_rule_id: rule ? rule.rule_id : null,
      pricing_rule_label: ruleLabel,
      price_label: label,
      category: row.category,
      software_name: row.software_name,
      session_name: row.session_name,
      currency: row.currency
    }
  };
};

/**
 * What a session is worth for a given number of seconds played.
 *
 * Takes the session row — its snapshot — never the price master, so the answer
 * is the same today as it will be after the next price rise. Used for both the
 * running estimate and the final charge, so the number a customer is quoted
 * mid-session is produced by the same code that bills them.
 *
 * The membership discount is part of that same snapshot, for the same reason
 * the rate is: `membership_discount_percent` is read off the session row, not
 * looked up live, so a membership cancelled twenty minutes into someone's play
 * cannot reach back and raise the price on time already spent under the old
 * terms.
 */
export const amountForSeconds = (session, seconds) => {
  /* A FLAT (unlimited) and a BLOCK (fixed-length) session are both charged
     their whole price no matter how many seconds were played — that is the
     entire point of "not less, not more" for a block. Only the legacy HOUR
     unit, still carried by open-ended counter play and by sessions started
     before block pricing, meters against elapsed time. */
  const billsWhole = session.pricing_unit === 'FLAT' || session.pricing_unit === 'BLOCK';
  const base = billsWhole
    ? round2(session.flat_amount || 0)
    : round2((Number(session.rate_per_hour) || 0) * (Math.max(0, seconds) / 3600));

  const discountPct = Number(session.membership_discount_percent) || 0;
  if (!discountPct) return base;
  return round2(base * (1 - discountPct / 100));
};

export default { resolveGamingPrice, amountForSeconds };
