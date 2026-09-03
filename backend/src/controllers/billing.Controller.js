import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { resolveCode } from './discounts.Controller.js';
import { activeMembershipDiscount, applyMembershipDiscount } from '../config/membershipPricing.js';
import { customerStanding, checkCredit, outstandingFor, floorFor } from '../config/customerTier.js';
import { loadRules, pickRule, applyRule, describeRule } from '../config/pricingRules.js';
import { getSetting } from '../config/settings.js';

/*
 * Billing.
 *
 * A bill holds its own totals rather than recomputing them on read, so a
 * historical invoice never shifts when a price or tax rate changes later.
 * Every mutation runs inside a transaction with the bill row locked, so two
 * tills taking payment at once cannot both think they settled it.
 */

const PAYMENT_METHODS = ['wallet', 'cash', 'card', 'upi', 'other'];
const ITEM_TYPES = ['gaming', 'fnb', 'shop', 'other'];

const money = (v) => Number(Number(v || 0).toFixed(2));

/*
 * What one line on the bill actually costs, right now.
 *
 * Two separate things can move a listed price, and the order they apply in is
 * a real decision rather than an accident:
 *
 *   1. the pricing window — peak, off-peak, weekend, happy hour. This is the
 *      café charging a different price at this hour; it changes what the item
 *      *is worth*.
 *   2. the member's discount — a benefit taken off whatever the price happens
 *      to be.
 *
 * Window first, then membership, because that is what the two things mean: a
 * Gold member during happy hour gets their 10% off the happy-hour price, not
 * off a price nobody is charging. It is also the order the session engine
 * already used, so a bill and a session agree.
 *
 * This exists because the windows were reaching sessions and nothing else.
 * Gaming started under happy hour was discounted correctly, while a Coke rung
 * up two feet away at the same moment was not — the till never consulted the
 * rules at all.
 */
const priceLine = (listedPrice, { itemType, rules, when, membership }) => {
  const base = money(listedPrice);

  const rule = pickRule(rules || [], {
    when: when || new Date(),
    /* No game or station category is passed for a till line: a manually rung
       gaming item carries no software id, so a window narrowed to one title
       genuinely cannot be matched here and must not be guessed at. Café-wide
       and per-kind windows — the common case — match normally. */
    itemType: String(itemType || 'other').toUpperCase()
  });

  const afterRule = rule ? applyRule(base, rule) : base;

  /*
   * The customer's own discount — whichever of their two is better.
   *
   * A membership's perk is gaming-only, as it always was: it is sold as a
   * discount on play. A regular's is the whole bill, because being a regular
   * is a relationship with the café rather than a product bought against one
   * kind of line. `customerStanding` has already picked between them, so the
   * only decision left here is what the winning one is allowed to touch.
   */
  const percent = Number(membership?.percent) || 0;
  const appliesHere = membership?.source === 'TIER' || itemType === 'gaming';
  const discountPercent = appliesHere ? percent : 0;
  const final = discountPercent > 0
    ? applyMembershipDiscount(afterRule, discountPercent)
    : afterRule;

  const notes = [];
  if (rule && afterRule !== base) notes.push(describeRule(rule));
  if (discountPercent > 0) notes.push(`${membership.label} -${discountPercent}%`);

  return { unitPrice: money(final), rule, notes };
};

/** Append what changed the price, without letting the column overflow. */
const labelLine = (description, notes) => {
  const text = String(description || '');
  if (!notes.length) return text.slice(0, 255);
  const suffix = ` (${notes.join(', ')})`;
  return `${text.slice(0, 255 - suffix.length)}${suffix}`;
};

const shapeBill = (row, items = [], payments = []) => ({
  bill_id: row.bill_id,
  bill_number: row.bill_number,
  cafe_id: row.cafe_id,
  customer_id: row.customer_id,
  customer_name: row.customer_name || row.guest_name || null,
  is_guest: !row.customer_id,
  guest_name: row.guest_name,
  /* The number this receipt should go to. A registered customer's comes off
     their record; a guest's is whatever was given at the counter. Surfaced as
     one field so a receipt sender never has to know which kind of bill it is. */
  guest_phone: row.guest_phone || null,
  contact_phone: row.guest_phone || row.customer_phone || null,
  contact_channel: row.contact_channel || null,
  session_id: row.session_id,
  pc_name: row.pc_name || null,
  subtotal: money(row.subtotal),
  discount: money(row.discount),
  discount_reason: row.discount_reason,
  tax: money(row.tax),
  total: money(row.total),
  paid_amount: money(row.paid_amount),
  balance_due: money(Number(row.total) - Number(row.paid_amount)),

  /* Refunds, kept apart from balance_due on purpose. Money returned is not
     money still owed, and folding the two together is what made the till ask
     for payment on a bill it had already settled. */
  refunded: money(row.refunded_amount || 0),
  net_paid: money(Number(row.paid_amount) - Number(row.refunded_amount || 0)),
  fully_refunded: Number(row.refunded_amount || 0) > 0
    && Number(row.refunded_amount || 0) + 0.005 >= Number(row.paid_amount),

  currency: row.currency,
  status: row.status,
  notes: row.notes,
  created_by: row.created_by,
  settled_at: row.settled_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
  wallet_balance: row.wallet_balance === undefined || row.wallet_balance === null
    ? null : money(row.wallet_balance),
  items: items.map((i) => ({
    bill_item_id: i.bill_item_id,
    item_type: i.item_type,
    reference_id: i.reference_id,
    description: i.description,
    quantity: Number(i.quantity),
    unit_price: money(i.unit_price),
    amount: money(i.amount)
  })),
  payments: payments.map((p) => ({
    payment_id: p.payment_id,
    method: p.method,
    amount: money(p.amount),
    reference: p.reference,
    // A refund is a negative tender in the same ledger; the note carries the
    // reason the server insisted on before allowing it.
    is_refund: p.is_refund === true || Number(p.amount) < 0,
    note: p.note || null,
    received_by: p.received_by,
    created_at: p.created_at
  }))
});

const SELECT_BILL = `
  SELECT b.*, c.customer_name, c.phone_number AS customer_phone,
         p.name AS pc_name, w.balance AS wallet_balance,
         /* What has gone back on this bill. A correlated subquery rather than a
            join so a bill with three refunds still returns one row. */
         COALESCE((SELECT SUM(ABS(amount)) FROM payments
                   WHERE bill_id = b.bill_id AND amount < 0), 0) AS refunded_amount
  FROM bills b
  LEFT JOIN customers c ON c.customer_id = b.customer_id
  LEFT JOIN sessions  s ON s.session_id = b.session_id
  LEFT JOIN pcs       p ON p.pc_id = s.pc_id
  LEFT JOIN wallets   w ON w.customer_id = b.customer_id
`;

/** Next bill number, e.g. CX-000042. */
const nextBillNumber = async (client) => {
  const seq = await client.query(`SELECT nextval('bill_number_seq') AS n`);
  return 'CX-' + String(seq.rows[0].n).padStart(6, '0');
};

/**
 * Recalculate a bill from its items and payments, and move its status.
 * Called after anything that could change the arithmetic.
 */
export const recalculate = async (client, billId) => {
  const bill = await client.query('SELECT * FROM bills WHERE bill_id = $1 FOR UPDATE', [billId]);
  if (bill.rows.length === 0) return null;
  const row = bill.rows[0];
  if (row.status === 'VOID') return row;

  const items = await client.query(
    'SELECT COALESCE(SUM(amount),0) AS subtotal FROM bill_items WHERE bill_id = $1',
    [billId]
  );
  /*
   * Positive tenders only.
   *
   * This used to be SUM(amount) over every row, and refunds are stored as
   * negative rows — so refunding a settled bill lowered paid_amount, walked
   * the status back to PARTIAL, and the till then offered to "Take payment"
   * for money it had already taken. A refunded bill is not an unpaid bill.
   *
   * paid_amount is therefore gross received and never moves when money is
   * returned. What went back is counted separately, below, so the two
   * questions — "did they pay?" and "did we give any back?" — stay separable.
   */
  const paid = await client.query(
    'SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE bill_id = $1 AND amount > 0',
    [billId]
  );
  const refundedRow = await client.query(
    'SELECT COALESCE(SUM(ABS(amount)),0) AS refunded FROM payments WHERE bill_id = $1 AND amount < 0',
    [billId]
  );

  const subtotal = money(items.rows[0].subtotal);
  const discount = Math.min(money(row.discount), subtotal);

  /*
   * Tax, computed here from the café's own rate.
   *
   * It used to be whatever number happened to be sitting in bills.tax — set
   * once at creation and never derived from anything — so a café that turned
   * GST on saw it applied to new bills and silently absent the moment a line
   * was added or a discount changed. Recalculating it alongside the subtotal
   * is what makes it hold.
   *
   * Charged on the DISCOUNTED amount: discount before tax is the normal
   * treatment, and the alternative overcharges the customer on money they did
   * not pay.
   */
  /* Read for the bill's own café. Tax registration is per business, so one
     café turning GST on must not start charging it on another's bills — and
     `row` is the bill itself, which carries the café that raised it. */
  const taxCafe = row.cafe_id ?? null;
  const taxEnabled = String(await getSetting('billing.tax_enabled', 'false', taxCafe)) === 'true';
  const taxPercent = Number(await getSetting('billing.tax_percent', 0, taxCafe)) || 0;
  const taxInclusive = String(await getSetting('billing.tax_inclusive', 'false', taxCafe)) === 'true';

  const taxable = Math.max(0, subtotal - discount);
  let tax;
  let total;

  if (!taxEnabled || taxPercent <= 0) {
    tax = 0;
    total = money(taxable);
  } else if (taxInclusive) {
    /* Prices already contain the tax, so the total does not move — the receipt
       just shows how much of it was tax. Extracting rather than adding is the
       difference between "₹100 including 18% GST" and charging ₹118. */
    total = money(taxable);
    tax = money(taxable - taxable / (1 + taxPercent / 100));
  } else {
    tax = money(taxable * taxPercent / 100);
    total = money(taxable + tax);
  }
  const paidAmount = money(paid.rows[0].paid);
  const refundedAmount = money(refundedRow.rows[0].refunded);

  // Fractional currency means an exact equality test would strand bills a
  // hundredth short, so settle on a cent of tolerance.
  /* Status describes the *charge*, so it is derived from gross paid against
     total and is deliberately unaffected by refunds. A fully refunded bill
     stays PAID — the customer did pay it; the money coming back afterwards is
     a separate, recorded event, not a retraction of the sale. */
  const status = paidAmount + 0.005 >= total && total > 0 ? 'PAID'
    : paidAmount > 0 ? 'PARTIAL'
    : 'OPEN';

  // $5 is used both as a column value and in a comparison, so it needs an
  // explicit type — otherwise Postgres deduces varchar in one place and text
  // in the other and refuses the statement.
  const updated = await client.query(
    `UPDATE bills
     SET subtotal = $1, discount = $2, total = $3, paid_amount = $4,
         tax = $7,
         status = $5::varchar,
         settled_at = CASE WHEN $5::varchar = 'PAID' AND settled_at IS NULL
                           THEN CURRENT_TIMESTAMP ELSE settled_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE bill_id = $6 RETURNING *`,
    [subtotal, discount, total, paidAmount, status, billId, tax]
  );
  return updated.rows[0];
};

/* ==========================================================================
   STOCK

   Selling at the till used to change no stock at all. Only the station's F&B
   order queue deducted anything, so a customer ordering a Coke from their PC
   reduced the shelf count while a cashier selling the same Coke over the
   counter did not — and the counter is the busier path. Stock therefore
   looked frozen: 19 mousepads sold through bills, 6 still showing.

   These two mirror what orders.Controller.js already does, including writing
   the same stock_movements ledger, so both paths tell one story.

   Only lines that actually point at a tracked product move stock: a custom
   line, a gaming charge or an ad-hoc "other" has no shelf behind it.
   ========================================================================== */
const STOCK_ITEM_TYPES = ['fnb', 'shop'];

/**
 * Take stock for a bill line.
 *
 * Refuses when there is not enough. The till checks first so the cashier gets
 * an immediate answer, but the check has to exist here too: a second cashier
 * selling the last one at the same moment, a screen left open while stock
 * moved, or anything calling the API directly all bypass the UI. The row is
 * locked FOR UPDATE so two tills cannot both read the same last unit.
 *
 * Returns { error } rather than throwing, so the caller can roll back and
 * answer with a sentence naming the product and the real number.
 */
const takeStockForLine = async (client, { itemType, referenceId, quantity, billNumber, actor }) => {
  if (!STOCK_ITEM_TYPES.includes(itemType) || !referenceId) return null;

  const product = (await client.query(
    'SELECT product_id, product_name, track_stock, stock_quantity FROM products WHERE product_id = $1 FOR UPDATE',
    [referenceId]
  )).rows[0];

  if (!product || product.track_stock !== true) return null;

  const available = Number(product.stock_quantity);
  if (Number(quantity) > available) {
    return {
      error: available <= 0
        ? `${product.product_name} is out of stock`
        : `Only ${available} ${product.product_name} left — cannot sell ${quantity}`,
      available
    };
  }

  const next = Number((Number(product.stock_quantity) - Number(quantity)).toFixed(2));

  await client.query(
    'UPDATE products SET stock_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
    [next, product.product_id]
  );
  await client.query(
    `INSERT INTO stock_movements
       (product_id, direction, quantity, stock_after, reason, note, performed_by)
     VALUES ($1,'out',$2,$3,'sale',$4,$5)`,
    [product.product_id, quantity, next, `Sold on ${billNumber || 'a bill'}`, actor || null]
  );

  return { product_id: product.product_id, name: product.product_name, stock_after: next };
};

/** Put stock back — a removed line, or a refunded quantity. */
const returnStockForLine = async (client, { itemType, referenceId, quantity, reason, note, actor }) => {
  if (!STOCK_ITEM_TYPES.includes(itemType) || !referenceId) return null;

  const product = (await client.query(
    'SELECT product_id, track_stock, stock_quantity FROM products WHERE product_id = $1 FOR UPDATE',
    [referenceId]
  )).rows[0];
  if (!product || product.track_stock !== true) return null;

  const next = Number((Number(product.stock_quantity) + Number(quantity)).toFixed(2));

  await client.query(
    'UPDATE products SET stock_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
    [next, product.product_id]
  );
  await client.query(
    `INSERT INTO stock_movements
       (product_id, direction, quantity, stock_after, reason, note, performed_by)
     VALUES ($1,'in',$2,$3,$4,$5,$6)`,
    [product.product_id, quantity, next, reason || 'sale-reversed', note || null, actor || null]
  );

  return { product_id: product.product_id, stock_after: next };
};

const loadBill = async (client, billId) => {
  const bill = await client.query(`${SELECT_BILL} WHERE b.bill_id = $1`, [billId]);
  if (bill.rows.length === 0) return null;
  const items = await client.query(
    'SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY bill_item_id ASC', [billId]
  );
  const payments = await client.query(
    'SELECT * FROM payments WHERE bill_id = $1 ORDER BY payment_id ASC', [billId]
  );
  return shapeBill(bill.rows[0], items.rows, payments.rows);
};

/* ==========================================================================
   CREATE
   ========================================================================== */
// POST /api/bills
export const createBill = async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer_id, guest_name, guest_phone, contact_channel,
            session_id, cafe_id, notes, items } = req.body || {};

    if (!customer_id && !guest_name) {
      return res.status(400).json({
        success: false,
        message: 'A customer or a guest name is required'
      });
    }

    await client.query('BEGIN');

    const currency = await getSetting('wallet.currency', 'XP');

    /*
     * A ticket tied to a session joins that session's bill if one already
     * exists, rather than trying to raise a second one.
     *
     * A café can order food while a session is still running — that ticket is
     * meant to sit open until the visit ends, not force payment on the spot.
     * The database allows exactly one live bill per session
     * (`idx_bills_one_live_per_session`), so a second trip to the till for
     * the same session — another snack, then the gaming charge when the
     * session ends — used to hit that constraint and be flatly refused. Now
     * it lands on the same growing bill, which is the whole point of "add it
     * now, settle everything later".
     */
    let billId = null;
    let joinedExisting = false;
    if (session_id) {
      const existing = await client.query(
        `SELECT bill_id FROM bills WHERE session_id = $1 AND status <> 'VOID' FOR UPDATE`,
        [session_id]
      );
      if (existing.rows.length) { billId = existing.rows[0].bill_id; joinedExisting = true; }
    }

    if (!billId) {
      /*
       * Derive the café rather than storing NULL when the caller omits it.
       *
       * This used to be `cafe_id || null`, so every bill raised from the
       * counter or by a closing session — neither of which passes one —
       * belonged to no café at all. Any tenant-scoped read then skipped them
       * silently, which is invisible on a single-café install and data loss
       * on a second one.
       *
       * Order of preference: what the caller said, the session's café, the
       * station's café, then the café on the authenticated token.
       */
      let resolvedCafeId = cafe_id || null;
      if (!resolvedCafeId && session_id) {
        const fromSession = await client.query(
          `SELECT COALESCE(s.cafe_id, p.cafe_id) AS cafe_id
           FROM sessions s LEFT JOIN pcs p ON p.pc_id = s.pc_id
           WHERE s.session_id = $1`,
          [session_id]
        );
        resolvedCafeId = fromSession.rows[0]?.cafe_id || null;
      }
      if (!resolvedCafeId) resolvedCafeId = req.actor?.cafe_id || null;

      const billNumber = await nextBillNumber(client);
      const inserted = await client.query(
        `INSERT INTO bills (bill_number, cafe_id, customer_id, guest_name, guest_phone,
                            contact_channel, session_id, currency, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING bill_id`,
        [
          billNumber,
          resolvedCafeId,
          customer_id || null,
          customer_id ? null : String(guest_name).slice(0, 255),
          /* Kept for a registered customer too. They may ask for the receipt
             on a different number from the one on their account, and the
             bill should record where it was actually sent. */
          guest_phone ? String(guest_phone).trim().slice(0, 32) : null,
          ['whatsapp', 'sms', 'none'].includes(contact_channel) ? contact_channel : null,
          session_id || null,
          currency,
          notes || null,
          req.actor?.label || null
        ]
      );
      billId = inserted.rows[0].bill_id;
    }
    /* Joining an existing bill only ever adds lines to it — its customer,
       notes and contact details are left exactly as they were, the same way
       adding a line through `addItem` below never rewrites bill-level
       fields. A second trip to the till is "add this too", not "replace
       what I said the first time". */

    /* A gaming line bought straight from the till, with no session either
       side of it — there is no start-to-end window to snapshot across, so the
       member's discount is simply whatever it is right now. Looked up once
       for the whole ticket rather than per line: a customer does not hold two
       memberships, and re-querying per line would only invite the two to
       disagree if a plan changed between them. */
    const membership = customer_id
      ? await customerStanding(client, customer_id)
      : { percent: 0, label: null };

    /*
     * Read once for the whole ticket, at one moment. Re-reading per line
     * would let a window opening mid-transaction price the first half of a
     * ticket differently from the second.
     *
     * Taken from the bill's own café rather than a local variable, because
     * that is settled either way by this point — whether this call created
     * the bill or joined one that was already open for the session.
     */
    const billCafe = (await client.query(
      'SELECT cafe_id FROM bills WHERE bill_id = $1', [billId]
    )).rows[0]?.cafe_id || null;
    const rules = await loadRules(client, billCafe);
    const pricedAt = new Date();

    for (const item of (Array.isArray(items) ? items : [])) {
      const quantity = Number(item.quantity || 1);
      const listedPrice = Number(item.unit_price || 0);
      if (!item.description || !Number.isFinite(quantity) || quantity <= 0 ||
          !Number.isFinite(listedPrice) || listedPrice < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Every line needs a description, a positive quantity and a price of zero or more' });
      }

      const resolvedType = ITEM_TYPES.includes(item.item_type) ? item.item_type : 'other';
      const priced = priceLine(listedPrice, {
        itemType: resolvedType, rules, when: pricedAt, membership
      });
      const unitPrice = priced.unitPrice;
      const description = labelLine(item.description, priced.notes);

      await client.query(
        `INSERT INTO bill_items (bill_id, item_type, reference_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          billId,
          resolvedType,
          item.reference_id || null,
          description,
          quantity,
          unitPrice,
          money(quantity * unitPrice)
        ]
      );
    }

    await recalculate(client, billId);

    /*
     * Whether this ticket may be left unpaid.
     *
     * Computed here, inside the transaction, so the figure the till is told
     * matches the bill that was just written. It is advice rather than a
     * refusal: raising the bill is what records what the customer took, and
     * blocking that would leave the café with stock gone and nothing on
     * paper. The till uses this to decide whether to offer "pay later" or to
     * insist on payment now.
     */
    const bill = await loadBill(client, billId);
    let credit = null;
    if (customer_id) {
      const verdict = await checkCredit(client, customer_id, bill.balance_due, billCafe);
      credit = {
        can_pay_later: verdict.ok,
        reason: verdict.reason || null,
        message: verdict.message || null,
        wallet_balance: verdict.balance ?? null,
        credit_limit: verdict.limit ?? null,
        remaining: verdict.remaining ?? null
      };
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: joinedExisting ? 'Added to the open bill' : 'Bill created',
      data: bill,
      credit
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That session already has a bill' });
    }
    console.error('Error creating bill:', error);
    res.status(500).json({ success: false, message: 'Error creating bill' });
  } finally {
    client.release();
  }
};

/**
 * Raise a bill for a finished session — or, more often now, join one that
 * already exists.
 *
 * A café can order food while still playing, and that ticket is meant to sit
 * open until the visit is over, not force payment on the spot. It settles as
 * one bill with the gaming time, which means the gaming charge and an
 * already-open food order are racing for the same session's bill: whichever
 * happens first — a snack ordered mid-session, or the session ending —
 * creates the bill, and the other has to join it rather than collide with it.
 *
 * `idx_bills_one_live_per_session` is the database's own rule that a session
 * has exactly one live bill. This used to run straight into that rule the
 * moment food had already been billed to a session: the INSERT below threw,
 * and ending a session that had anything on its tab failed outright — the
 * one moment a café least wants billing to break.
 *
 * Used by the session controller, so it takes an existing client and runs
 * inside that transaction.
 */
export const createBillForSession = async (client, session, actorLabel) => {
  const currency = await getSetting('wallet.currency', 'XP');
  const amount = money(session.amount);

  const existing = await client.query(
    `SELECT bill_id FROM bills WHERE session_id = $1 AND status <> 'VOID' FOR UPDATE`,
    [session.session_id]
  );

  let billId;
  if (existing.rows.length) {
    billId = existing.rows[0].bill_id;
  } else {
    const billNumber = await nextBillNumber(client);
    // Casts are explicit: several of these arrive as null, and Postgres
    // cannot infer a type for a bare null parameter.
    const inserted = await client.query(
      `INSERT INTO bills (bill_number, cafe_id, customer_id, guest_name, session_id,
                          currency, created_by)
       VALUES ($1::varchar, $2::int, $3::int, $4::varchar, $5::int, $6::varchar, $7::varchar)
       RETURNING bill_id`,
      [
        billNumber,
        session.cafe_id || null,
        session.customer_id || null,
        session.customer_id ? null : session.guest_name,
        session.session_id,
        currency,
        actorLabel || null
      ]
    );
    billId = inserted.rows[0].bill_id;
  }

  const minutes = Math.max(1, Math.round(session.billable_seconds / 60));
  /* The membership discount is already inside `amount` — it was applied by
     amountForSeconds from the session's own snapshot before this was ever
     called. This is only the receipt line saying why the figure is what it
     is, not a second place the discount gets applied. */
  const description = session.membership_label
    ? `Gaming — ${minutes} min on ${session.pc_name || 'station'} (${session.membership_label} member)`
    : `Gaming — ${minutes} min on ${session.pc_name || 'station'}`;

  await client.query(
    `INSERT INTO bill_items (bill_id, item_type, reference_id, description, quantity, unit_price, amount)
     VALUES ($1::int, 'gaming', $2::int, $3::varchar, 1, $4::numeric, $4::numeric)`,
    [
      billId,
      session.session_id,
      description,
      amount
    ]
  );

  await recalculate(client, billId);
  return billId;
};

/* ==========================================================================
   READ
   ========================================================================== */
// GET /api/bills?status=&customer_id=&session_id=&search=&since=
export const listBills = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const filters = [];
    const params = [];

    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase().split(','));
      filters.push(`b.status = ANY($${params.length})`);
    }
    if (req.query.customer_id) {
      params.push(parseInt(req.query.customer_id, 10));
      filters.push(`b.customer_id = $${params.length}`);
    }
    if (req.query.session_id) {
      params.push(parseInt(req.query.session_id, 10));
      filters.push(`b.session_id = $${params.length}`);
    }
    if (req.query.since) {
      params.push(req.query.since);
      filters.push(`b.created_at >= $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`(b.bill_number ILIKE $${params.length} OR c.customer_name ILIKE $${params.length} OR b.guest_name ILIKE $${params.length})`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const listParams = [...params, limit, offset];

    const result = await pool.query(
      `${SELECT_BILL} ${where} ORDER BY b.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    /*
     * The summary figures (billed/collected/outstanding/refunded) are what
     * shows up as the café's revenue on this screen, so a staff/test bill is
     * excluded from them here — but not from the list itself just above,
     * which stays a bill-management view: staff still need to find and
     * settle their own test bills, just without those bills counting as
     * takings.
     */
    const totalsFilters = filters.concat(["COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'"]);
    const totalsWhere = `WHERE ${totalsFilters.join(' AND ')}`;

    const totals = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(b.total),0) AS billed,
              COALESCE(SUM(b.paid_amount),0) AS collected,
              COALESCE(SUM(CASE WHEN b.status IN ('OPEN','PARTIAL')
                                THEN b.total - b.paid_amount ELSE 0 END),0) AS outstanding,
              /* Reported separately, never netted off collected — an owner asks
                 "how much did we take" and "how much went back" as two
                 questions, and a single blended figure answers neither. */
              COALESCE((SELECT SUM(ABS(pp.amount)) FROM payments pp
                        JOIN bills bb ON bb.bill_id = pp.bill_id
                        WHERE pp.amount < 0
                          AND bb.bill_id IN (SELECT b2.bill_id FROM bills b2
                                             LEFT JOIN customers c2 ON c2.customer_id = b2.customer_id
                                             ${totalsWhere.replace(/\bb\./g, 'b2.').replace(/\bc\./g, 'c2.')})), 0) AS refunded
       FROM bills b LEFT JOIN customers c ON c.customer_id = b.customer_id ${totalsWhere}`,
      params
    );

    res.status(200).json({
      success: true,
      data: result.rows.map((r) => shapeBill(r)),
      summary: {
        billed: money(totals.rows[0].billed),
        collected: money(totals.rows[0].collected),
        outstanding: money(totals.rows[0].outstanding)
      },
      pagination: { limit, offset, total: totals.rows[0].count }
    });
  } catch (error) {
    console.error('Error listing bills:', error);
    res.status(500).json({ success: false, message: 'Error fetching bills' });
  }
};

// GET /api/bills/:id
export const getBill = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid bill id' });
    }
    const bill = await loadBill(client, id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });

    // A customer may only read their own bill; staff may read any.
    if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== bill.customer_id) {
      return res.status(403).json({ success: false, message: 'You can only view your own bills' });
    }

    res.status(200).json({ success: true, data: bill });
  } catch (error) {
    console.error('Error fetching bill:', error);
    res.status(500).json({ success: false, message: 'Error fetching bill' });
  } finally {
    client.release();
  }
};

// GET /api/bills/customer/:customerId — the customer's own history
export const listCustomerBills = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== customerId) {
      return res.status(403).json({ success: false, message: 'You can only view your own bills' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const result = await pool.query(
      `${SELECT_BILL} WHERE b.customer_id = $1 AND b.status <> 'VOID'
       ORDER BY b.created_at DESC LIMIT $2`,
      [customerId, limit]
    );

    res.status(200).json({ success: true, data: result.rows.map((r) => shapeBill(r)) });
  } catch (error) {
    console.error('Error listing customer bills:', error);
    res.status(500).json({ success: false, message: 'Error fetching bills' });
  }
};

/* ==========================================================================
   MUTATE
   ========================================================================== */
const openBill = async (client, id) => {
  const bill = await client.query('SELECT * FROM bills WHERE bill_id = $1 FOR UPDATE', [id]);
  if (bill.rows.length === 0) return { error: 'Bill not found', status: 404 };
  if (bill.rows[0].status === 'VOID') return { error: 'That bill has been voided', status: 409 };
  if (bill.rows[0].status === 'PAID') return { error: 'That bill is already settled', status: 409 };
  return { bill: bill.rows[0] };
};

// POST /api/bills/:id/items
export const addItem = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const { description, quantity, unit_price, item_type, reference_id } = req.body || {};

    const qty = Number(quantity === undefined ? 1 : quantity);
    const price = Number(unit_price);
    if (!description) return res.status(400).json({ success: false, message: 'A description is required' });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, message: 'Quantity must be greater than zero' });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, message: 'Price must be zero or more' });

    await client.query('BEGIN');
    const found = await openBill(client, id);
    if (found.error) {
      await client.query('ROLLBACK');
      return res.status(found.status).json({ success: false, message: found.error });
    }

    const resolvedType = ITEM_TYPES.includes(item_type) ? item_type : 'other';
    const isGaming = resolvedType === 'gaming';

    /* Same rule as the till: a gaming line added to an open bill (typically
       from the Gaming Price picker in the Add Item dialog) gets the bill's
       own customer's standing discount, if they have one. */
    const membership = isGaming && found.bill.customer_id
      ? await customerStanding(client, found.bill.customer_id)
      : { percent: 0, label: null };

    /* And the same windows. A snack added to a running tab during happy hour
       has to be priced the same as one rung up on a fresh ticket at that
       moment — otherwise the discount depends on which button staff pressed. */
    const rules = await loadRules(client, found.bill.cafe_id);
    const priced = priceLine(price, {
      itemType: resolvedType, rules, when: new Date(), membership
    });
    const unitPrice = priced.unitPrice;
    const finalDescription = labelLine(description, priced.notes);

    await client.query(
      `INSERT INTO bill_items (bill_id, item_type, reference_id, description, quantity, unit_price, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        resolvedType,
        reference_id || null,
        finalDescription,
        qty, unitPrice, money(qty * unitPrice)
      ]
    );

    /* Inside the same transaction as the line itself: a sale that recorded the
       charge but not the stock, or the reverse, would be worse than either. */
    const moved = await takeStockForLine(client, {
      itemType: resolvedType,
      referenceId: reference_id,
      quantity: qty,
      billNumber: found.bill && found.bill.bill_number,
      actor: req.actor && req.actor.label
    });

    /* Not enough on the shelf. Rolling back takes the line with it, so the
       bill never holds something that was not sold. */
    if (moved && moved.error) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: moved.error,
        data: { available: moved.available }
      });
    }

    await recalculate(client, id);
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Item added',
      // Returned so the till can update the tile it just sold from without
      // refetching the whole catalogue.
      stock: moved,
      data: await loadBill(client, id)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error adding bill item:', error);
    res.status(500).json({ success: false, message: 'Error adding item' });
  } finally {
    client.release();
  }
};

// DELETE /api/bills/:id/items/:itemId
export const removeItem = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);

    await client.query('BEGIN');
    const found = await openBill(client, id);
    if (found.error) {
      await client.query('ROLLBACK');
      return res.status(found.status).json({ success: false, message: found.error });
    }

    /* RETURNING the whole row, not just the id: putting the stock back needs
       to know what was on the line, and it is gone once the delete lands. */
    const deleted = await client.query(
      'DELETE FROM bill_items WHERE bill_item_id = $1 AND bill_id = $2 RETURNING *',
      [itemId, id]
    );
    if (deleted.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Item not found on this bill' });
    }

    const line = deleted.rows[0];
    await returnStockForLine(client, {
      itemType: line.item_type,
      referenceId: line.reference_id,
      quantity: Number(line.quantity),
      reason: 'sale-reversed',
      note: `Removed from ${found.bill.bill_number} before settling`,
      actor: req.actor && req.actor.label
    });

    await recalculate(client, id);
    await client.query('COMMIT');

    res.status(200).json({ success: true, message: 'Item removed', data: await loadBill(client, id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error removing bill item:', error);
    res.status(500).json({ success: false, message: 'Error removing item' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   DISCOUNT CODE
   ========================================================================== */
/*
 * POST /api/bills/:id/discount-code   { code }
 *
 * One code per bill: applying a second replaces the first, so a cashier
 * correcting a mistyped code never stacks two discounts by accident.
 */
export const applyDiscountCode = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid bill id' });
    }

    await client.query('BEGIN');

    const bill = await client.query('SELECT * FROM bills WHERE bill_id = $1 FOR UPDATE', [id]);
    if (bill.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    const row = bill.rows[0];

    if (row.status === 'VOID') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'This bill has been voided' });
    }
    if (row.status === 'PAID') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This bill is already settled — refund it before changing the discount'
      });
    }

    const subtotal = money(
      (await client.query(
        'SELECT COALESCE(SUM(amount),0) AS s FROM bill_items WHERE bill_id = $1', [id]
      )).rows[0].s
    );

    const outcome = await resolveCode(client, req.body?.code, row.customer_id, subtotal);
    if (outcome.error) {
      await client.query('ROLLBACK');
      // 200 rather than 4xx: a rejected code is a normal counter event, and
      // the cashier needs the sentence, not an error banner.
      return res.status(200).json({ success: false, message: outcome.error });
    }

    // Replace any previous code on this bill.
    await client.query('DELETE FROM discount_code_redemptions WHERE bill_id = $1', [id]);

    await client.query(
      `INSERT INTO discount_code_redemptions (code_id, customer_id, bill_id, amount, redeemed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [outcome.code.code_id, row.customer_id, id, outcome.discount, req.actor?.label || null]
    );

    await client.query(
      `UPDATE bills SET discount = $1, discount_reason = $2, discount_code_id = $3,
                        updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $4`,
      [outcome.discount, `Code ${outcome.code.code}`, outcome.code.code_id, id]
    );

    await recalculate(client, id);
    await client.query('COMMIT');

    const updated = await loadBill(client, id);

    await recordAudit(req, {
      action: 'bill.discount_code',
      category: 'billing',
      entity: 'bill',
      entity_id: id,
      amount: outcome.discount,
      sensitive: true,
      summary: `Applied code ${outcome.code.code} to bill ${updated.bill_number} — ` +
        `${outcome.discount} off`,
      meta: { code: outcome.code.code, code_id: outcome.code.code_id, subtotal }
    });

    res.status(200).json({
      success: true,
      message: `${outcome.code.code} applied — ${outcome.discount} off`,
      data: updated
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error applying discount code:', error);
    res.status(500).json({ success: false, message: 'Error applying the code' });
  } finally {
    client.release();
  }
};

// DELETE /api/bills/:id/discount-code
export const removeDiscountCode = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    await client.query('BEGIN');

    const removed = await client.query(
      `DELETE FROM discount_code_redemptions WHERE bill_id = $1
       RETURNING code_id, amount`, [id]
    );
    await client.query(
      `UPDATE bills SET discount = 0, discount_reason = NULL, discount_code_id = NULL,
                        updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $1`, [id]
    );
    await recalculate(client, id);
    await client.query('COMMIT');

    const updated = await loadBill(client, id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    if (removed.rows.length) {
      await recordAudit(req, {
        action: 'bill.discount_code_remove',
        category: 'billing',
        entity: 'bill',
        entity_id: id,
        amount: Number(removed.rows[0].amount),
        sensitive: true,
        summary: `Removed the discount code from bill ${updated.bill_number}`,
        meta: { code_id: removed.rows[0].code_id }
      });
    }

    res.status(200).json({ success: true, message: 'Discount removed', data: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error removing discount code:', error);
    res.status(500).json({ success: false, message: 'Error removing the code' });
  } finally {
    client.release();
  }
};

// PATCH /api/bills/:id/discount   { discount, reason, tax }
export const applyAdjustment = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const discount = req.body?.discount === undefined ? undefined : Number(req.body.discount);
    const tax = req.body?.tax === undefined ? undefined : Number(req.body.tax);

    if (discount !== undefined && (!Number.isFinite(discount) || discount < 0)) {
      return res.status(400).json({ success: false, message: 'Discount must be zero or more' });
    }
    if (tax !== undefined && (!Number.isFinite(tax) || tax < 0)) {
      return res.status(400).json({ success: false, message: 'Tax must be zero or more' });
    }

    await client.query('BEGIN');
    const found = await openBill(client, id);
    if (found.error) {
      await client.query('ROLLBACK');
      return res.status(found.status).json({ success: false, message: found.error });
    }

    await client.query(
      `UPDATE bills
       SET discount = COALESCE($1, discount),
           discount_reason = COALESCE($2, discount_reason),
           tax = COALESCE($3, tax),
           updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $4`,
      [
        discount === undefined ? null : money(discount),
        req.body?.reason || null,
        tax === undefined ? null : money(tax),
        id
      ]
    );

    await recalculate(client, id);
    await client.query('COMMIT');

    const adjusted = await loadBill(client, id);

    // A discount is the classic thing an owner wants to see who applied, and
    // why, months after the fact.
    await recordAudit(req, {
      action: 'bill.adjust',
      category: 'billing',
      entity: 'bill',
      entity_id: id,
      amount: discount === undefined ? null : money(discount),
      sensitive: discount !== undefined && Number(discount) > 0,
      summary: `Adjusted bill ${adjusted.bill_number}` +
        (discount !== undefined ? ` — discount ${money(discount)}` : '') +
        (tax !== undefined ? ` — tax ${money(tax)}` : '') +
        (req.body?.reason ? ` (${req.body.reason})` : ''),
      meta: { discount, tax, reason: req.body?.reason || null, total: adjusted.total }
    });

    res.status(200).json({ success: true, message: 'Bill updated', data: adjusted });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error adjusting bill:', error);
    res.status(500).json({ success: false, message: 'Error updating bill' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PAYMENT
   ========================================================================== */
// POST /api/bills/:id/payments   { method, amount, reference }
export const recordPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const method = String(req.body?.method || '').toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ success: false, message: `Method must be one of ${PAYMENT_METHODS.join(', ')}` });
    }

    await client.query('BEGIN');
    const found = await openBill(client, id);
    if (found.error) {
      await client.query('ROLLBACK');
      return res.status(found.status).json({ success: false, message: found.error });
    }
    const bill = found.bill;

    const due = money(Number(bill.total) - Number(bill.paid_amount));
    const amount = req.body?.amount === undefined ? due : money(Number(req.body.amount));

    if (!Number.isFinite(amount) || amount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Payment must be greater than zero' });
    }
    if (amount > due + 0.005) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `That is more than the ${due} outstanding on this bill`
      });
    }

    let walletTransactionId = null;

    if (method === 'wallet') {
      if (!bill.customer_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'A guest bill has no wallet to charge' });
      }

      const wallet = await client.query(
        'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE',
        [bill.customer_id]
      );
      if (wallet.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'This customer has no wallet yet' });
      }

      const balance = Number(wallet.rows[0].balance);
      // A regular customer may run this negative, up to their own
      // credit_limit — see customerTier.js. Everyone else's floor is zero,
      // same refusal as before.
      const standing = await customerStanding(client, bill.customer_id);
      const floor = floorFor(standing);
      const next = money(balance - amount);
      if (next < floor) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: floor < 0 ? 'That would exceed their credit limit' : 'Not enough in the wallet',
          data: { balance: money(balance), requested: amount, credit_limit: standing.creditLimit }
        });
      }

      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
        [next, wallet.rows[0].wallet_id]
      );
      const ledger = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
         VALUES ($1,$2,'debit',$3,$4,$5,$6,$7) RETURNING transaction_id`,
        [
          wallet.rows[0].wallet_id, bill.customer_id, amount, next,
          next < 0 ? 'credit_used' : 'purchase',
          `Bill ${bill.bill_number}`, req.actor?.label || null
        ]
      );
      walletTransactionId = ledger.rows[0].transaction_id;
    }

    await client.query(
      `INSERT INTO payments (bill_id, customer_id, method, amount, reference, wallet_transaction_id, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id, bill.customer_id, method, amount,
        req.body?.reference || null, walletTransactionId, req.actor?.label || null
      ]
    );

    const updated = await recalculate(client, id);
    await client.query('COMMIT');

    await recordAudit(req, {
      action: 'bill.payment',
      category: 'billing',
      entity: 'bill',
      entity_id: id,
      amount: Number(amount),
      summary: `Took ${amount} by ${method} against bill ${bill.bill_number}` +
        (updated.status === 'PAID' ? ' — settled' : ' — part payment'),
      meta: {
        method,
        reference: req.body?.reference || null,
        status: updated.status,
        wallet_transaction_id: walletTransactionId
      }
    });

    res.status(201).json({
      success: true,
      message: updated.status === 'PAID' ? 'Bill settled' : 'Payment recorded',
      data: await loadBill(client, id)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error recording payment:', error);
    res.status(500).json({ success: false, message: 'Error recording payment' });
  } finally {
    client.release();
  }
};

// POST /api/bills/:id/void   { reason }
/* ==========================================================================
   REFUND
   ========================================================================== */
/*
 * POST /api/bills/:id/refund   { amount?, method?, reason }
 *
 * Returns money against a bill that has already been paid. Without this a
 * settled bill was a dead end: void refuses a bill with payments and tells you
 * to refund first, but there was nothing to refund with.
 *
 * The refund is recorded as a negative tender in `payments`, so recalculate()
 * lowers paid_amount and walks the bill back through PARTIAL/OPEN on its own.
 * Refunding to a wallet credits it in the same transaction — money must not be
 * able to leave the bill without arriving somewhere.
 */
export const refundBill = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid bill id' });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 255) : null;
    if (!reason) {
      // A refund with no stated reason is the one an audit cannot explain later.
      return res.status(400).json({ success: false, message: 'A reason is required to refund' });
    }

    await client.query('BEGIN');

    const billRow = await client.query('SELECT * FROM bills WHERE bill_id = $1 FOR UPDATE', [id]);
    if (billRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    const bill = billRow.rows[0];

    if (bill.status === 'VOID') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That bill has been voided' });
    }

    const paid = money(bill.paid_amount);
    if (paid <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Nothing has been paid against this bill, so there is nothing to refund'
      });
    }

    // Default to a full refund of what was taken.
    const amount = req.body?.amount === undefined || req.body.amount === null || req.body.amount === ''
      ? paid
      : money(Number(req.body.amount));

    if (!Number.isFinite(amount) || amount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'The refund must be more than zero' });
    }
    if (amount > paid + 0.005) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Only ${paid} has been paid against this bill`
      });
    }

    /*
     * Where the money goes back. Defaulting to the method that was actually
     * used avoids the common till mistake of refunding cash against a card
     * payment; an explicit method overrides it when the customer asks.
     */
    const tenders = await client.query(
      `SELECT method, SUM(amount) AS total FROM payments
       WHERE bill_id = $1 AND amount > 0 GROUP BY method ORDER BY SUM(amount) DESC`,
      [id]
    );
    const requested = String(req.body?.method || '').toLowerCase();
    const method = PAYMENT_METHODS.includes(requested)
      ? requested
      : (tenders.rows[0]?.method || 'cash');

    let walletTransactionId = null;

    if (method === 'wallet') {
      if (!bill.customer_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'A guest bill has no wallet to refund to — choose cash, card or UPI'
        });
      }

      const wallet = await client.query(
        'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE', [bill.customer_id]
      );
      if (wallet.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'This customer has no wallet' });
      }

      const next = money(Number(wallet.rows[0].balance) + amount);
      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
        [next, wallet.rows[0].wallet_id]
      );
      const ledger = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
         VALUES ($1,$2,'credit',$3,$4,'refund',$5,$6)
         RETURNING transaction_id`,
        [
          wallet.rows[0].wallet_id, bill.customer_id, amount, next,
          `Refund on ${bill.bill_number}: ${reason}`, req.actor?.label || null
        ]
      );
      walletTransactionId = ledger.rows[0].transaction_id;
    }

    await client.query(
      `INSERT INTO payments
         (bill_id, customer_id, method, amount, reference, wallet_transaction_id,
          received_by, is_refund, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)`,
      [
        id, bill.customer_id, method, -amount,
        req.body?.reference || null, walletTransactionId,
        req.actor?.label || null, reason
      ]
    );

    const updated = await recalculate(client, id);
    await client.query('COMMIT');

    const fresh = await loadBill(client, id);

    await recordAudit(req, {
      action: 'bill.refund',
      category: 'billing',
      entity: 'bill',
      entity_id: id,
      amount: amount,
      sensitive: true,
      summary: `Refunded ${amount} by ${method} on bill ${fresh.bill_number} — ${reason}`,
      meta: {
        method,
        reason,
        wallet_transaction_id: walletTransactionId,
        remaining_paid: updated ? money(updated.paid_amount) : null
      }
    });

    res.status(201).json({
      success: true,
      message: `Refunded ${amount} by ${method}`,
      data: fresh
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error refunding bill:', error);
    res.status(500).json({ success: false, message: 'Error processing the refund' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CLAIM A GUEST BILL
   ========================================================================== */
/*
 * PATCH /api/bills/:id/customer   { customer_id }
 *
 * A walk-in plays as a guest, then registers at the counter. Without this the
 * bill stays orphaned: it never appears in their history and never counts
 * toward anything they are owed.
 */
export const claimBill = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const customerId = parseInt(req.body?.customer_id, 10);
    if (!Number.isInteger(id) || !Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'A bill and a customer are required' });
    }

    await client.query('BEGIN');

    const billRow = await client.query('SELECT * FROM bills WHERE bill_id = $1 FOR UPDATE', [id]);
    if (billRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (billRow.rows[0].customer_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This bill already belongs to a customer'
      });
    }

    const customer = await client.query(
      'SELECT customer_name FROM customers WHERE customer_id = $1', [customerId]
    );
    if (customer.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    await client.query(
      `UPDATE bills SET customer_id = $1, guest_name = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $2`,
      [customerId, id]
    );
    // The payments carry the owner too, so history reads consistently.
    await client.query(
      'UPDATE payments SET customer_id = $1 WHERE bill_id = $2', [customerId, id]
    );

    await client.query('COMMIT');
    const fresh = await loadBill(client, id);

    await recordAudit(req, {
      action: 'bill.claim',
      category: 'billing',
      entity: 'bill',
      entity_id: id,
      sensitive: true,
      summary: `Moved guest bill ${fresh.bill_number} onto ${customer.rows[0].customer_name}`,
      meta: { customer_id: customerId, was_guest: billRow.rows[0].guest_name }
    });

    res.status(200).json({
      success: true,
      message: `Bill moved to ${customer.rows[0].customer_name}`,
      data: fresh
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error claiming bill:', error);
    res.status(500).json({ success: false, message: 'Error moving the bill' });
  } finally {
    client.release();
  }
};

export const voidBill = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);

    await client.query('BEGIN');
    const bill = await client.query('SELECT * FROM bills WHERE bill_id = $1 FOR UPDATE', [id]);
    if (bill.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (bill.rows[0].status === 'VOID') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That bill is already void' });
    }
    // Refunds are a separate decision, so a paid bill cannot simply vanish.
    if (Number(bill.rows[0].paid_amount) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This bill has payments against it. Refund them before voiding.'
      });
    }

    await client.query(
      `UPDATE bills SET status = 'VOID', notes = COALESCE($1, notes), updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $2`,
      [req.body?.reason ? `Voided: ${req.body.reason}` : null, id]
    );
    await client.query('COMMIT');

    const voided = await loadBill(client, id);

    await recordAudit(req, {
      action: 'bill.void',
      category: 'billing',
      entity: 'bill',
      entity_id: id,
      amount: Number(voided.total || 0),
      sensitive: true,
      summary: `Voided bill ${voided.bill_number} for ${voided.total}` +
        (req.body?.reason ? ` — ${req.body.reason}` : ''),
      meta: { reason: req.body?.reason || null }
    });

    res.status(200).json({ success: true, message: 'Bill voided', data: voided });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error voiding bill:', error);
    res.status(500).json({ success: false, message: 'Error voiding bill' });
  } finally {
    client.release();
  }
};
