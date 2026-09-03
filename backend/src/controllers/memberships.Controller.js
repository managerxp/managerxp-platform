import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';

/*
 * Memberships — recurring tiers that carry perks (a standing discount, bonus
 * coins on joining). A customer holds at most one live membership, enforced by
 * a partial unique index rather than by application logic alone.
 */

const STATUSES = ['ACTIVE', 'INACTIVE'];
const money = (v) => Number(Number(v || 0).toFixed(2));

const shapePlan = (row) => ({
  plan_id: row.plan_id,
  plan_name: row.plan_name,
  tier: row.tier,
  description: row.description,
  price: money(row.price),
  currency: row.currency,
  duration_days: row.duration_days,
  discount_percent: Number(row.discount_percent),
  bonus_credit: money(row.bonus_credit),
  perks: row.perks || [],
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
  member_count: row.member_count === undefined ? undefined : Number(row.member_count)
});

const shapeMembership = (row) => {
  const expires = row.expires_at ? new Date(row.expires_at) : null;
  const daysLeft = expires ? Math.max(0, Math.ceil((expires - new Date()) / 86400000)) : null;
  return {
    customer_membership_id: row.customer_membership_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    plan_id: row.plan_id,
    plan_name: row.plan_name,
    tier: row.tier,
    discount_percent: row.discount_percent === undefined ? null : Number(row.discount_percent),
    perks: row.perks || [],
    price_paid: money(row.price_paid),
    started_at: row.started_at,
    expires_at: row.expires_at,
    days_remaining: daysLeft,
    is_expired: !!expires && expires < new Date(),
    status: row.status,
    bill_id: row.bill_id,
    sold_by: row.sold_by
  };
};

const SELECT_MEMBERSHIP = `
  SELECT cm.*, mp.plan_name, mp.tier, mp.discount_percent, mp.perks, c.customer_name
  FROM customer_memberships cm
  JOIN membership_plans mp ON mp.plan_id = cm.plan_id
  JOIN customers c ON c.customer_id = cm.customer_id
`;

/* ==========================================================================
   PLANS
   ========================================================================== */
const validatePlan = (body) => {
  const name = (body.plan_name || '').trim();
  if (!name) return { error: 'A plan name is required' };

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be zero or more' };

  const duration = parseInt(body.duration_days, 10);
  if (!Number.isInteger(duration) || duration < 1) {
    return { error: 'Duration must be at least one day' };
  }

  const discount = body.discount_percent === undefined || body.discount_percent === ''
    ? 0 : Number(body.discount_percent);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return { error: 'Discount must be between 0 and 100 percent' };
  }

  const bonus = body.bonus_credit === undefined || body.bonus_credit === ''
    ? 0 : Number(body.bonus_credit);
  if (!Number.isFinite(bonus) || bonus < 0) return { error: 'Bonus credit cannot be negative' };

  let perks = null;
  if (body.perks !== undefined && body.perks !== null && body.perks !== '') {
    perks = Array.isArray(body.perks) ? body.perks
      : String(body.perks).split('\n').map((s) => s.trim()).filter(Boolean);
  }

  return {
    name, price: money(price), duration, discount: Number(discount.toFixed(2)),
    bonus: money(bonus), perks,
    tier: String(body.tier || 'STANDARD').toUpperCase().slice(0, 32)
  };
};

// POST /api/memberships/plans
export const createPlan = async (req, res) => {
  try {
    const parsed = validatePlan(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const currency = await getSetting('wallet.currency', 'XP');
    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase() : 'ACTIVE';

    const result = await pool.query(
      `INSERT INTO membership_plans (plan_name, tier, description, price, currency,
                                     duration_days, discount_percent, bonus_credit, perks, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [parsed.name, parsed.tier, req.body?.description || null, parsed.price, currency,
       parsed.duration, parsed.discount, parsed.bonus,
       parsed.perks ? JSON.stringify(parsed.perks) : null, status]
    );

    res.status(201).json({ success: true, message: 'Plan created', data: shapePlan(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A plan with that name already exists' });
    }
    console.error('Error creating membership plan:', error);
    res.status(500).json({ success: false, message: 'Error creating plan' });
  }
};

// GET /api/memberships/plans?status=
export const listPlans = async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where = 'WHERE mp.status = $1';
    }

    const result = await pool.query(
      `SELECT mp.*, COUNT(cm.customer_membership_id) FILTER (WHERE cm.status = 'ACTIVE')::int AS member_count
       FROM membership_plans mp
       LEFT JOIN customer_memberships cm ON cm.plan_id = mp.plan_id
       ${where}
       GROUP BY mp.plan_id
       ORDER BY mp.price ASC, mp.plan_id ASC`,
      params
    );

    res.status(200).json({ success: true, data: result.rows.map(shapePlan) });
  } catch (error) {
    console.error('Error listing membership plans:', error);
    res.status(500).json({ success: false, message: 'Error fetching plans' });
  }
};

// PUT /api/memberships/plans/:id
export const updatePlan = async (req, res) => {
  try {
    const parsed = validatePlan(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase() : null;

    const result = await pool.query(
      `UPDATE membership_plans
       SET plan_name = $1, tier = $2, description = $3, price = $4, duration_days = $5,
           discount_percent = $6, bonus_credit = $7, perks = $8,
           status = COALESCE($9::varchar, status), updated_at = CURRENT_TIMESTAMP
       WHERE plan_id = $10 RETURNING *`,
      [parsed.name, parsed.tier, req.body?.description || null, parsed.price, parsed.duration,
       parsed.discount, parsed.bonus, parsed.perks ? JSON.stringify(parsed.perks) : null,
       status, parseInt(req.params.id, 10)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    res.status(200).json({ success: true, message: 'Plan updated', data: shapePlan(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A plan with that name already exists' });
    }
    console.error('Error updating membership plan:', error);
    res.status(500).json({ success: false, message: 'Error updating plan' });
  }
};

// PATCH /api/memberships/plans/:id/status
export const setPlanStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE or INACTIVE' });
    }
    const result = await pool.query(
      `UPDATE membership_plans SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE plan_id = $2 RETURNING *`,
      [status, parseInt(req.params.id, 10)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    res.status(200).json({
      success: true,
      message: status === 'ACTIVE' ? 'Plan activated' : 'Plan deactivated',
      data: shapePlan(result.rows[0])
    });
  } catch (error) {
    console.error('Error updating plan status:', error);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
};

/* ==========================================================================
   SUBSCRIBE
   ========================================================================== */
// POST /api/memberships/plans/:id/subscribe   { customer_id, payment_method }
export const subscribe = async (req, res) => {
  const client = await pool.connect();
  try {
    const planId = parseInt(req.params.id, 10);
    const customerId = parseInt(req.body?.customer_id, 10);
    const method = String(req.body?.payment_method || 'wallet').toLowerCase();

    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'A customer is required' });
    }

    await client.query('BEGIN');

    const plan = await client.query('SELECT * FROM membership_plans WHERE plan_id = $1', [planId]);
    if (plan.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    if (plan.rows[0].status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That plan is not on sale' });
    }

    const customer = await client.query(
      'SELECT customer_id, customer_name, cafe_id FROM customers WHERE customer_id = $1', [customerId]
    );
    if (customer.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Retire any live membership first — the unique index allows only one.
    await client.query(
      `UPDATE customer_memberships SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $1 AND status = 'ACTIVE'`,
      [customerId]
    );

    const row = plan.rows[0];
    const price = money(row.price);
    const expiresAt = new Date(Date.now() + row.duration_days * 86400000);

    const seq = await client.query(`SELECT nextval('bill_number_seq') AS n`);
    const billNumber = 'CX-' + String(seq.rows[0].n).padStart(6, '0');

    const bill = await client.query(
      `INSERT INTO bills (bill_number, customer_id, cafe_id, currency, created_by, subtotal, total)
       VALUES ($1::varchar, $2::int, $3::int, $4::varchar, $5::varchar, $6::numeric, $6::numeric)
       RETURNING bill_id`,
      [billNumber, customerId, customer.rows[0].cafe_id ?? null, row.currency, req.actor?.label || null, price]
    );
    const billId = bill.rows[0].bill_id;

    await client.query(
      `INSERT INTO bill_items (bill_id, item_type, reference_id, description, quantity, unit_price, amount)
       VALUES ($1::int, 'other', $2::int, $3::varchar, 1, $4::numeric, $4::numeric)`,
      [billId, planId, `Membership — ${row.plan_name} (${row.duration_days} days)`, price]
    );

    if (price > 0 && method === 'wallet') {
      const wallet = await client.query(
        'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE', [customerId]
      );
      const balance = wallet.rows.length ? Number(wallet.rows[0].balance) : 0;
      if (wallet.rows.length === 0 || balance < price) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Not enough in the wallet for this membership',
          data: { balance: money(balance), price }
        });
      }
      const next = money(balance - price);
      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
        [next, wallet.rows[0].wallet_id]
      );
      const ledger = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
         VALUES ($1,$2,'debit',$3,$4,'purchase',$5,$6) RETURNING transaction_id`,
        [wallet.rows[0].wallet_id, customerId, price, next,
         `Membership ${row.plan_name}`, req.actor?.label || null]
      );
      await client.query(
        `INSERT INTO payments (bill_id, customer_id, method, amount, reference, wallet_transaction_id, received_by)
         VALUES ($1,$2,'wallet',$3,$4,$5,$6)`,
        [billId, customerId, price, billNumber, ledger.rows[0].transaction_id, req.actor?.label || null]
      );
    } else if (price > 0) {
      await client.query(
        `INSERT INTO payments (bill_id, customer_id, method, amount, reference, received_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [billId, customerId, method, price, billNumber, req.actor?.label || null]
      );
    }

    await client.query(
      `UPDATE bills SET paid_amount = $1, status = 'PAID', settled_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $2`,
      [price, billId]
    );

    // Joining bonus lands in the wallet as a credit, so it shows in the ledger.
    const bonus = money(row.bonus_credit);
    if (bonus > 0) {
      const wallet = await client.query(
        `INSERT INTO wallets (customer_id) VALUES ($1)
         ON CONFLICT (customer_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [customerId]
      );
      const balance = Number(wallet.rows[0].balance);
      const next = money(balance + bonus);
      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
        [next, wallet.rows[0].wallet_id]
      );
      await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
         VALUES ($1,$2,'credit',$3,$4,'bonus',$5,$6)`,
        [wallet.rows[0].wallet_id, customerId, bonus, next,
         `${row.plan_name} joining bonus`, req.actor?.label || null]
      );
    }

    const created = await client.query(
      `INSERT INTO customer_memberships
         (customer_id, plan_id, bill_id, price_paid, expires_at, sold_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING customer_membership_id`,
      [customerId, planId, billId, price, expiresAt, req.actor?.label || null]
    );

    await client.query('COMMIT');

    const full = await client.query(
      `${SELECT_MEMBERSHIP} WHERE cm.customer_membership_id = $1`,
      [created.rows[0].customer_membership_id]
    );

    res.status(201).json({
      success: true,
      message: `${customer.rows[0].customer_name} joined ${row.plan_name}`,
      data: shapeMembership(full.rows[0]),
      bill: { bill_id: billId, bill_number: billNumber, total: price },
      bonus_credited: bonus
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error subscribing to membership:', error);
    res.status(500).json({ success: false, message: 'Error creating membership' });
  } finally {
    client.release();
  }
};

// GET /api/memberships?status=
export const listMemberships = async (req, res) => {
  try {
    // Retire anything past its date first so the list is accurate.
    await pool.query(
      `UPDATE customer_memberships SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'ACTIVE' AND expires_at < CURRENT_TIMESTAMP`
    );

    const params = [];
    let where = '';
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where = 'WHERE cm.status = $1';
    }

    const result = await pool.query(
      `${SELECT_MEMBERSHIP} ${where} ORDER BY cm.expires_at DESC LIMIT 200`,
      params
    );

    res.status(200).json({ success: true, data: result.rows.map(shapeMembership) });
  } catch (error) {
    console.error('Error listing memberships:', error);
    res.status(500).json({ success: false, message: 'Error fetching memberships' });
  }
};

/*
 * GET /api/memberships/plans/catalog — what a signed-in customer could
 * subscribe to themselves.
 * POST /api/memberships/plans/:id/subscribe-self — subscribe, paid from
 * their own wallet.
 *
 * Same idea as packages.Controller.js's catalog/purchase-self: thin wrappers
 * that resolve who's paying from the token rather than the body, then hand
 * off to the exact code path staff already use to sell a plan. Plans are not
 * café-scoped, so unlike packages there is no café to resolve here.
 */
export const listPlansCatalog = async (req, res) => {
  req.query = { ...req.query, status: 'ACTIVE' };
  return listPlans(req, res);
};

export const subscribeSelf = async (req, res) => {
  const customerId = Number(req.actor?.customer_id);
  if (!customerId) return res.status(400).json({ success: false, message: 'Sign in required' });
  req.body = { ...req.body, customer_id: customerId, payment_method: 'wallet' };
  return subscribe(req, res);
};

// GET /api/memberships/customer/:customerId
export const getCustomerMembership = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== customerId) {
      return res.status(403).json({ success: false, message: 'You can only view your own membership' });
    }

    await pool.query(
      `UPDATE customer_memberships SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $1 AND status = 'ACTIVE' AND expires_at < CURRENT_TIMESTAMP`,
      [customerId]
    );

    const result = await pool.query(
      `${SELECT_MEMBERSHIP} WHERE cm.customer_id = $1 ORDER BY cm.started_at DESC`,
      [customerId]
    );

    const all = result.rows.map(shapeMembership);
    res.status(200).json({
      success: true,
      data: { current: all.find((m) => m.status === 'ACTIVE') || null, history: all }
    });
  } catch (error) {
    console.error('Error fetching customer membership:', error);
    res.status(500).json({ success: false, message: 'Error fetching membership' });
  }
};

// POST /api/memberships/:id/cancel
export const cancelMembership = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE customer_memberships SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE customer_membership_id = $1 AND status = 'ACTIVE' RETURNING customer_membership_id`,
      [parseInt(req.params.id, 10)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No active membership with that id' });
    }
    res.status(200).json({ success: true, message: 'Membership cancelled' });
  } catch (error) {
    console.error('Error cancelling membership:', error);
    res.status(500).json({ success: false, message: 'Error cancelling membership' });
  }
};
