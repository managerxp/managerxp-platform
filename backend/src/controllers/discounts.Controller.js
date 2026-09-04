import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/*
 * Discount codes.
 *
 * A code is one of three audiences:
 *
 *   public    — anyone at the counter may use it
 *   tier      — only customers on a matching live membership tier
 *   customers — only the named customers attached to it
 *
 * Validation always answers in words a cashier can repeat to the person in
 * front of them ("this code is for Gold members"), because a bare "invalid
 * code" turns into an argument at the till.
 *
 * Redemptions are rows, not a counter on the code. That is what makes a
 * per-customer limit enforceable and lets a refund find the redemption again.
 */

const money = (v) => Number(Number(v || 0).toFixed(2));

const shape = (row) => ({
  code_id: row.code_id,
  code: row.code,
  description: row.description,
  discount_type: row.discount_type,
  value: money(row.value),
  max_discount: row.max_discount === null ? null : money(row.max_discount),
  min_bill_amount: money(row.min_bill_amount),
  audience: row.audience,
  tier: row.tier,
  total_limit: row.total_limit,
  per_customer_limit: row.per_customer_limit,
  starts_at: row.starts_at,
  expires_at: row.expires_at,
  status: row.status,
  created_by: row.created_by,
  created_at: row.created_at,
  redemptions: row.redemptions === undefined ? undefined : Number(row.redemptions),
  redeemed_total: row.redeemed_total === undefined ? undefined : money(row.redeemed_total),
  customers: row.customers || undefined
});

/** What a code takes off a given subtotal, capped and never below zero. */
export const discountFor = (code, subtotal) => {
  const base = Number(subtotal || 0);
  let off = code.discount_type === 'percent'
    ? (base * Number(code.value)) / 100
    : Number(code.value);

  if (code.max_discount !== null && code.max_discount !== undefined) {
    off = Math.min(off, Number(code.max_discount));
  }
  // A discount may never exceed the bill, or the total goes negative.
  return money(Math.max(0, Math.min(off, base)));
};

/* ==========================================================================
   READ
   ========================================================================== */
// GET /api/discounts?status=&search=
export const listCodes = async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.status) { params.push(String(req.query.status)); where.push(`d.status = $${params.length}`); }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      where.push(`(d.code ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
    }

    const result = await pool.query(
      `SELECT d.*,
              COUNT(r.redemption_id)::int         AS redemptions,
              COALESCE(SUM(r.amount), 0)          AS redeemed_total,
              COALESCE(
                (SELECT json_agg(json_build_object('customer_id', c.customer_id,
                                                   'customer_name', c.customer_name))
                 FROM discount_code_customers dc
                 JOIN customers c ON c.customer_id = dc.customer_id
                 WHERE dc.code_id = d.code_id), '[]'::json) AS customers
       FROM discount_codes d
       LEFT JOIN discount_code_redemptions r ON r.code_id = d.code_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       GROUP BY d.code_id
       ORDER BY d.created_at DESC`,
      params
    );

    res.status(200).json({ success: true, data: result.rows.map(shape) });
  } catch (error) {
    console.error('Error listing discount codes:', error);
    res.status(500).json({ success: false, message: 'Error fetching discount codes' });
  }
};

/* ==========================================================================
   VALIDATE
   ========================================================================== */
/**
 * Resolve a typed code for a customer and subtotal.
 * Returns { code, discount } or { error } with a sentence for the cashier.
 */
export const resolveCode = async (client, rawCode, customerId, subtotal) => {
  const typed = String(rawCode || '').trim();
  if (!typed) return { error: 'Enter a code' };

  const found = await client.query(
    'SELECT * FROM discount_codes WHERE UPPER(code) = UPPER($1)', [typed]
  );
  if (found.rows.length === 0) return { error: `No code called "${typed}"` };

  const code = found.rows[0];
  const now = new Date();

  if (code.status === 'PAUSED') return { error: `${code.code} is paused` };
  if (code.status === 'EXPIRED') return { error: `${code.code} has expired` };
  if (code.starts_at && new Date(code.starts_at) > now) {
    return { error: `${code.code} does not start until ${new Date(code.starts_at).toLocaleDateString()}` };
  }
  if (code.expires_at && new Date(code.expires_at) < now) {
    return { error: `${code.code} expired on ${new Date(code.expires_at).toLocaleDateString()}` };
  }
  if (Number(subtotal) < Number(code.min_bill_amount)) {
    return { error: `${code.code} needs a bill of at least ${money(code.min_bill_amount)}` };
  }

  /* ---- audience ---- */
  if (code.audience !== 'public' && !customerId) {
    return { error: `${code.code} is for registered customers — this bill is a guest` };
  }

  if (code.audience === 'customers') {
    const allowed = await client.query(
      'SELECT 1 FROM discount_code_customers WHERE code_id = $1 AND customer_id = $2',
      [code.code_id, customerId]
    );
    if (allowed.rows.length === 0) {
      return { error: `${code.code} is not available to this customer` };
    }
  }

  if (code.audience === 'tier') {
    const membership = await client.query(
      `SELECT p.tier FROM customer_memberships cm
       JOIN membership_plans p ON p.plan_id = cm.plan_id
       WHERE cm.customer_id = $1 AND cm.status = 'ACTIVE'
         AND (cm.expires_at IS NULL OR cm.expires_at > CURRENT_TIMESTAMP)`,
      [customerId]
    );
    const tiers = membership.rows.map((r) => String(r.tier || '').toLowerCase());
    if (!tiers.includes(String(code.tier || '').toLowerCase())) {
      return { error: `${code.code} is for ${code.tier} members only` };
    }
  }

  /* ---- limits ---- */
  if (code.total_limit !== null) {
    const used = await client.query(
      'SELECT COUNT(*)::int AS n FROM discount_code_redemptions WHERE code_id = $1',
      [code.code_id]
    );
    if (used.rows[0].n >= code.total_limit) {
      return { error: `${code.code} has been fully used (${code.total_limit} redemptions)` };
    }
  }

  if (customerId && code.per_customer_limit !== null) {
    const mine = await client.query(
      'SELECT COUNT(*)::int AS n FROM discount_code_redemptions WHERE code_id = $1 AND customer_id = $2',
      [code.code_id, customerId]
    );
    if (mine.rows[0].n >= code.per_customer_limit) {
      return {
        error: `This customer has already used ${code.code} ` +
          `${mine.rows[0].n} time(s) — the limit is ${code.per_customer_limit}`
      };
    }
  }

  return { code, discount: discountFor(shape(code), subtotal) };
};

// POST /api/discounts/validate   { code, customer_id, subtotal }
export const validateCode = async (req, res) => {
  const client = await pool.connect();
  try {
    const outcome = await resolveCode(
      client,
      req.body?.code,
      req.body?.customer_id ? parseInt(req.body.customer_id, 10) : null,
      Number(req.body?.subtotal || 0)
    );

    if (outcome.error) {
      return res.status(200).json({ success: false, valid: false, message: outcome.error });
    }

    res.status(200).json({
      success: true,
      valid: true,
      message: `${outcome.code.code} takes off ${outcome.discount}`,
      data: { code: shape(outcome.code), discount: outcome.discount }
    });
  } catch (error) {
    console.error('Error validating discount code:', error);
    res.status(500).json({ success: false, message: 'Error checking the code' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   WRITE
   ========================================================================== */
// POST /api/discounts
export const createCode = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim().toUpperCase();

    if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: 'A code is 3-40 characters: letters, numbers, dashes or underscores'
      });
    }

    const type = body.discount_type === 'amount' ? 'amount' : 'percent';
    const value = Number(body.value);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ success: false, message: 'The value must be more than zero' });
    }
    if (type === 'percent' && value > 100) {
      return res.status(400).json({ success: false, message: 'A percentage cannot exceed 100' });
    }

    const audience = ['public', 'tier', 'customers'].includes(body.audience) ? body.audience : 'public';
    const customerIds = Array.isArray(body.customer_ids)
      ? body.customer_ids.map((n) => parseInt(n, 10)).filter(Number.isInteger)
      : [];

    if (audience === 'tier' && !body.tier) {
      return res.status(400).json({ success: false, message: 'Choose the membership tier this code is for' });
    }
    if (audience === 'customers' && !customerIds.length) {
      return res.status(400).json({ success: false, message: 'Choose at least one customer for this code' });
    }

    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO discount_codes
         (cafe_id, code, description, discount_type, value, max_discount, min_bill_amount,
          audience, tier, total_limit, per_customer_limit, starts_at, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        body.cafe_id ?? req.actor?.cafe_id ?? null,
        code,
        body.description ? String(body.description).trim().slice(0, 255) : null,
        type,
        value,
        body.max_discount ? Number(body.max_discount) : null,
        body.min_bill_amount ? Number(body.min_bill_amount) : 0,
        audience,
        audience === 'tier' ? String(body.tier).slice(0, 40) : null,
        body.total_limit ? parseInt(body.total_limit, 10) : null,
        body.per_customer_limit === null || body.per_customer_limit === undefined
          ? 1
          : parseInt(body.per_customer_limit, 10),
        body.starts_at ? new Date(body.starts_at).toISOString() : null,
        body.expires_at ? new Date(body.expires_at).toISOString() : null,
        req.actor?.label || null
      ]
    );

    const created = inserted.rows[0];

    if (audience === 'customers') {
      for (const id of customerIds) {
        await client.query(
          `INSERT INTO discount_code_customers (code_id, customer_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [created.code_id, id]
        );
      }
    }

    await client.query('COMMIT');

    await recordAudit(req, {
      action: 'discount.create',
      category: 'billing',
      entity: 'discount_code',
      entity_id: created.code_id,
      sensitive: true,
      summary: `Created code ${code} — ${type === 'percent' ? value + '%' : value + ' off'}` +
        (audience === 'tier' ? ` for ${created.tier} members`
          : audience === 'customers' ? ` for ${customerIds.length} named customer(s)`
          : ' for anyone'),
      meta: { audience, type, value, customer_ids: customerIds }
    });

    res.status(201).json({ success: true, message: `Code ${code} created`, data: shape(created) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That code already exists' });
    }
    console.error('Error creating discount code:', error);
    res.status(500).json({ success: false, message: 'Error creating the code' });
  } finally {
    client.release();
  }
};

// PATCH /api/discounts/:id/status   { status }
export const setCodeStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || '').toUpperCase();
    if (!['ACTIVE', 'PAUSED', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE, PAUSED or EXPIRED' });
    }

    const result = await pool.query(
      `UPDATE discount_codes SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE code_id = $2 RETURNING *`,
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Code not found' });
    }

    await recordAudit(req, {
      action: 'discount.status',
      category: 'billing',
      entity: 'discount_code',
      entity_id: id,
      sensitive: true,
      summary: `Set code ${result.rows[0].code} to ${status}`,
      meta: { status }
    });

    res.status(200).json({ success: true, message: `${result.rows[0].code} is now ${status}`, data: shape(result.rows[0]) });
  } catch (error) {
    console.error('Error updating discount code:', error);
    res.status(500).json({ success: false, message: 'Error updating the code' });
  }
};

// DELETE /api/discounts/:id
export const deleteCode = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    // A redeemed code is part of the billing history, so it is retired rather
    // than removed — deleting it would orphan the discount on old bills.
    const used = await pool.query(
      'SELECT COUNT(*)::int AS n FROM discount_code_redemptions WHERE code_id = $1', [id]
    );
    if (used.rows[0].n > 0) {
      return res.status(409).json({
        success: false,
        message: `This code has been used ${used.rows[0].n} time(s). Pause or expire it instead — ` +
          'deleting it would break the bills it was applied to.'
      });
    }

    const result = await pool.query(
      'DELETE FROM discount_codes WHERE code_id = $1 RETURNING code', [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Code not found' });
    }

    await recordAudit(req, {
      action: 'discount.delete',
      category: 'billing',
      entity: 'discount_code',
      entity_id: id,
      sensitive: true,
      summary: `Deleted unused code ${result.rows[0].code}`
    });

    res.status(200).json({ success: true, message: `${result.rows[0].code} deleted` });
  } catch (error) {
    console.error('Error deleting discount code:', error);
    res.status(500).json({ success: false, message: 'Error deleting the code' });
  }
};

// GET /api/discounts/:id/redemptions
export const listRedemptions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, c.customer_name, b.bill_number
       FROM discount_code_redemptions r
       LEFT JOIN customers c ON c.customer_id = r.customer_id
       LEFT JOIN bills b ON b.bill_id = r.bill_id
       WHERE r.code_id = $1
       ORDER BY r.created_at DESC LIMIT 200`,
      [parseInt(req.params.id, 10)]
    );
    res.status(200).json({
      success: true,
      data: result.rows.map((r) => ({
        redemption_id: r.redemption_id,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        bill_id: r.bill_id,
        bill_number: r.bill_number,
        amount: money(r.amount),
        redeemed_by: r.redeemed_by,
        created_at: r.created_at
      }))
    });
  } catch (error) {
    console.error('Error listing redemptions:', error);
    res.status(500).json({ success: false, message: 'Error reading redemptions' });
  }
};
