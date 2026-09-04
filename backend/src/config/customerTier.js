import pool from './database.js';
import { activeMembershipDiscount } from './membershipPricing.js';

/*
 * What a customer is entitled to at the till.
 *
 * Two discounts can exist at once — the standing one a regular gets, and the
 * one a paid membership carries — and they answer different questions. The
 * customer gets **the better of the two, never both**.
 *
 * Stacking was the alternative and it is worse in every direction: a regular
 * who also buys Gold would quietly get 25% off, which nobody priced for; and
 * two percentages compounding is a number no member of staff can check in
 * their head when a customer queries the bill. One discount, and the till can
 * name which one it was.
 */

const round2 = (n) => Number(Number(n || 0).toFixed(2));

/**
 * The discount and credit standing for one customer.
 *
 * Returns a complete answer for a guest too — zero discount, no credit — so
 * callers never have to check whether they were given a customer first.
 */
export const customerStanding = async (client, customerId) => {
  const db = client || pool;
  const none = {
    type: 'NORMAL', percent: 0, label: null,
    creditLimit: 0, canPayLater: false, source: null
  };
  if (!customerId) return none;

  const row = (await db.query(
    `SELECT customer_type, discount_percent, credit_limit, customer_name
       FROM customers WHERE customer_id = $1`,
    [customerId]
  )).rows[0];
  if (!row) return none;

  const tierPercent = Number(row.discount_percent) || 0;
  const membership = await activeMembershipDiscount(db, customerId);
  const memberPercent = Number(membership.percent) || 0;

  /* The better of the two, and it says which so the bill line can explain
     itself rather than showing an unattributed deduction. */
  const useMembership = memberPercent > tierPercent;
  const percent = Math.max(tierPercent, memberPercent);

  return {
    type: row.customer_type || 'NORMAL',
    percent,
    label: percent === 0 ? null : (useMembership ? membership.label : 'Regular'),
    source: percent === 0 ? null : (useMembership ? 'MEMBERSHIP' : 'TIER'),
    creditLimit: Number(row.credit_limit) || 0,
    /* Only a regular may leave without paying, and only up to the figure the
       café set. A limit of zero is a refusal, not an absence of one. */
    canPayLater: row.customer_type === 'REGULAR' && Number(row.credit_limit) > 0
  };
};

/**
 * What this customer currently owes across every unsettled bill.
 *
 * Derived rather than stored: a running balance kept alongside the bills is a
 * second source of truth that drifts the first time a bill is voided or
 * refunded outside the one code path that maintains it.
 */
export const outstandingFor = async (client, customerId, cafeId = null, excludeBillId = null) => {
  const db = client || pool;
  if (!customerId) return 0;
  const row = (await db.query(
    `SELECT COALESCE(SUM(total - paid_amount), 0) AS owed
       FROM bills
      WHERE customer_id = $1
        AND status <> 'VOID'
        AND total > paid_amount
        AND ($2::int IS NULL OR cafe_id IS NOT DISTINCT FROM $2::int)
        /* The bill being asked about is left out, because the caller adds it
           back as the amount under consideration. Counting it in both places
           is how a 360 ticket against a 500 limit came out as 720. */
        AND ($3::int IS NULL OR bill_id <> $3::int)`,
    [customerId, cafeId, excludeBillId]
  )).rows[0];
  return round2(row.owed);
};

/**
 * How far below zero this customer's wallet may go. Zero for everyone
 * except a regular with a credit limit — the one number every debit site
 * checks against instead of a flat "balance >= 0".
 */
export const floorFor = (standing) => (standing.type === 'REGULAR' ? -standing.creditLimit : 0);

/**
 * May this customer's wallet go this far into the negative?
 *
 * Answers with a reason rather than a boolean, because the till has to tell
 * somebody why — "not a regular" and "would exceed their limit" lead to
 * different conversations at the counter.
 *
 * Reads wallets.balance directly rather than summing unpaid bills: a
 * regular's credit is now the same number as their wallet balance, not a
 * second figure tracked alongside it that could drift from it.
 */
export const checkCredit = async (client, customerId, amount, cafeId = null) => {
  const db = client || pool;
  const standing = await customerStanding(db, customerId);

  if (!customerId) {
    return { ok: false, reason: 'guest', message: 'A guest cannot run a tab — take payment now.' };
  }
  if (standing.type !== 'REGULAR') {
    return {
      ok: false, reason: 'not_regular',
      message: 'Only regular customers can pay later. Mark them as a regular first, or take payment now.'
    };
  }
  if (standing.creditLimit <= 0) {
    return {
      ok: false, reason: 'no_limit',
      message: 'This regular has no credit limit set. Set one on their record to let them run a tab.'
    };
  }

  const row = (await db.query(
    `SELECT balance FROM wallets WHERE customer_id = $1`, [customerId]
  )).rows[0];
  const balance = row ? Number(row.balance) : 0;
  const floor = floorFor(standing);
  const after = round2(balance - Number(amount || 0));

  if (after < floor) {
    const owed = balance < 0 ? round2(-balance) : 0;
    return {
      ok: false, reason: 'over_limit', balance, limit: standing.creditLimit, after,
      message: `That would put their balance at ${after}, past the ${standing.creditLimit} credit limit` +
        (owed > 0 ? ` — they already owe ${owed}.` : '.')
    };
  }

  return { ok: true, balance, limit: standing.creditLimit, after, remaining: round2(after - floor) };
};

export default { customerStanding, outstandingFor, checkCredit, floorFor };
