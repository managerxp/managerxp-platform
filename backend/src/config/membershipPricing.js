import pool from './database.js';

/*
 * A membership's one billing effect: a standing percentage off gaming.
 *
 * The plan cards have always shown "10% off gaming" as a perk, but nothing
 * ever read it — a Gold member was billed the same as a walk-in. This is the
 * one place that resolves the discount, so the till, a session and a manual
 * bill line all agree on what a member actually pays, and there is exactly
 * one bug to fix if that ever needs to change.
 *
 * The joining bonus is unrelated and already worked: it is credited to the
 * wallet once, at the moment of subscribing, in memberships.Controller.js.
 * This only concerns the recurring perk — the discount applied to every
 * gaming charge for as long as the membership is live.
 */

const round2 = (n) => Number(Number(n || 0).toFixed(2));

/**
 * The customer's live membership discount, if they have one.
 *
 * Sweeps a lapsed membership to EXPIRED first — the same lazy check
 * memberships.Controller.js already does on read — so a customer whose Gold
 * membership ran out last week is never quietly still getting 10% off because
 * nothing had gone back to flip the status column.
 *
 * Returns `{ percent: 0, label: null }` for a guest or a customer with no
 * membership, so a caller never needs to check for one first.
 */
export const activeMembershipDiscount = async (client, customerId) => {
  const db = client || pool;
  if (!customerId) return { percent: 0, label: null };

  await db.query(
    `UPDATE customer_memberships
        SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
      WHERE customer_id = $1 AND status = 'ACTIVE' AND expires_at < CURRENT_TIMESTAMP`,
    [customerId]
  );

  const result = await db.query(
    `SELECT mp.discount_percent, mp.plan_name
       FROM customer_memberships cm
       JOIN membership_plans mp ON mp.plan_id = cm.plan_id
      WHERE cm.customer_id = $1 AND cm.status = 'ACTIVE' AND cm.expires_at > CURRENT_TIMESTAMP
      ORDER BY mp.discount_percent DESC
      LIMIT 1`,
    [customerId]
  );

  if (!result.rows.length) return { percent: 0, label: null };
  const percent = Number(result.rows[0].discount_percent) || 0;
  return { percent, label: percent > 0 ? result.rows[0].plan_name : null };
};

/** A price after a member's standing discount. Zero percent is a no-op. */
export const applyMembershipDiscount = (amount, percent) => {
  if (!percent) return round2(amount);
  return round2(Number(amount) * (1 - Number(percent) / 100));
};

export default { activeMembershipDiscount, applyMembershipDiscount };
