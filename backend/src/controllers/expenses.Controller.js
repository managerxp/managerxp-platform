import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/*
 * Expenses — the café's own outgoings: salaries, stock, rent, maintenance.
 *
 * Every read and write is scoped to `req.actor.cafe_id`, taken from the
 * token and never from anything the caller sends. A figure here that
 * belonged to another café would not just be wrong — it would misstate
 * whether this café is actually making money.
 */

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const money = (v) => Number(Number(v || 0).toFixed(2));

const shape = (row) => ({
  expense_id: row.expense_id,
  category: row.category,
  description: row.description,
  amount: money(row.amount),
  currency: row.currency,
  expense_date: row.expense_date,
  status: row.status,
  void_reason: row.void_reason,
  created_by: row.created_by,
  voided_by: row.voided_by,
  voided_at: row.voided_at,
  created_at: row.created_at,
  updated_at: row.updated_at
});

/** A caller with no café on their token has nothing to scope to. */
const requireCafe = (req, res) => {
  const cafeId = req.actor?.cafe_id;
  if (!cafeId) {
    res.status(403).json({ success: false, message: 'This account is not tied to a café' });
    return null;
  }
  return cafeId;
};

const cleanCategory = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed.slice(0, 60);
};

const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/* ==========================================================================
   CREATE
   ========================================================================== */
// POST /api/expenses  { category, description, amount, expense_date }
export const createExpense = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;

    const category = cleanCategory(req.body?.category);
    if (!category) {
      return res.status(400).json({ success: false, message: 'A category is required' });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }

    // An expense dated in the future is a budget line, not a spend that has
    // happened — the till has the same rule for a bill's date.
    const today = new Date(); today.setHours(23, 59, 59, 999);
    let expenseDate = today;
    if (req.body?.expense_date !== undefined && req.body.expense_date !== '') {
      const parsed = parseDate(req.body.expense_date);
      if (parsed === undefined) {
        return res.status(400).json({ success: false, message: 'That date is not valid' });
      }
      if (parsed > today) {
        return res.status(400).json({ success: false, message: 'The date cannot be in the future' });
      }
      expenseDate = parsed;
    }

    const description = req.body?.description
      ? String(req.body.description).trim().slice(0, 255) || null
      : null;

    const inserted = await pool.query(
      `INSERT INTO expenses (cafe_id, category, description, amount, expense_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [cafeId, category, description, money(amount), expenseDate, req.actor?.label || null]
    );

    await recordAudit(req, {
      action: 'expense.create',
      category: 'expenses',
      entity: 'expense',
      entity_id: inserted.rows[0].expense_id,
      amount,
      summary: `Logged ${category} — ${amount} XP` + (description ? ` (${description})` : ''),
      meta: { category, amount, expense_date: expenseDate }
    });

    res.status(201).json({ success: true, message: 'Expense logged', data: shape(inserted.rows[0]) });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ success: false, message: 'Error creating expense' });
  }
};

/* ==========================================================================
   READ
   ========================================================================== */
// GET /api/expenses?from=&to=&category=&status=&limit=&offset=
export const listExpenses = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const filters = ['cafe_id = $1'];
    const params = [cafeId];

    // Every-expense views default to hiding voided lines — a void is a
    // correction, and a list that still counts it looks like double spend.
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`status = $${params.length}`);
    } else {
      filters.push(`status = 'ACTIVE'`);
    }
    if (req.query.category) {
      params.push(String(req.query.category));
      filters.push(`category = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      filters.push(`expense_date >= $${params.length}::date`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      filters.push(`expense_date <= $${params.length}::date`);
    }

    const where = filters.join(' AND ');
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT * FROM expenses WHERE ${where}
         ORDER BY expense_date DESC, expense_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM expenses WHERE ${where}`, params)
    ]);

    res.status(200).json({
      success: true,
      data: rows.rows.map(shape),
      pagination: { total: count.rows[0].n, limit, offset }
    });
  } catch (error) {
    console.error('Error listing expenses:', error);
    res.status(500).json({ success: false, message: 'Error listing expenses' });
  }
};

/*
 * The categories this café has actually used, most recent first — the
 * suggestion list for the datalist, not a master anybody administers.
 */
// GET /api/expenses/categories
export const listExpenseCategories = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;

    const result = await pool.query(
      `SELECT category, COUNT(*)::int AS uses, MAX(expense_date) AS last_used
         FROM expenses WHERE cafe_id = $1 AND status = 'ACTIVE'
        GROUP BY category ORDER BY last_used DESC`,
      [cafeId]
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error listing expense categories:', error);
    res.status(500).json({ success: false, message: 'Error listing categories' });
  }
};

/*
 * The comparison the owner actually asked for: what came in against what
 * went out, and where the outgoings went.
 */
// GET /api/expenses/summary?from=&to=
export const expenseSummary = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;

    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({ success: false, message: 'Give a valid from and to date' });
    }

    const [totals, byCategory] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count
           FROM expenses
          WHERE cafe_id = $1 AND status = 'ACTIVE'
            AND expense_date BETWEEN $2::date AND $3::date`,
        [cafeId, from.toISOString(), to.toISOString()]
      ),
      pool.query(
        `SELECT category, COALESCE(SUM(amount),0) AS amount, COUNT(*)::int AS count
           FROM expenses
          WHERE cafe_id = $1 AND status = 'ACTIVE'
            AND expense_date BETWEEN $2::date AND $3::date
          GROUP BY category ORDER BY amount DESC`,
        [cafeId, from.toISOString(), to.toISOString()]
      )
    ]);

    res.status(200).json({
      success: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      data: {
        total: num(totals.rows[0].total),
        count: totals.rows[0].count,
        by_category: byCategory.rows.map((r) => ({
          category: r.category, amount: num(r.amount), count: r.count
        }))
      }
    });
  } catch (error) {
    console.error('Error building expense summary:', error);
    res.status(500).json({ success: false, message: 'Error building the summary' });
  }
};

/* ==========================================================================
   MUTATE
   ========================================================================== */
// PUT /api/expenses/:id
export const updateExpense = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;
    const id = parseInt(req.params.id, 10);

    const existing = await pool.query(
      `SELECT * FROM expenses WHERE expense_id = $1 AND cafe_id = $2`, [id, cafeId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    if (existing.rows[0].status === 'VOID') {
      return res.status(409).json({ success: false, message: 'That expense has been voided' });
    }

    const category = req.body?.category === undefined
      ? existing.rows[0].category
      : cleanCategory(req.body.category);
    if (!category) {
      return res.status(400).json({ success: false, message: 'A category is required' });
    }

    let amount = Number(existing.rows[0].amount);
    if (req.body?.amount !== undefined) {
      amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
      }
    }

    let expenseDate = existing.rows[0].expense_date;
    if (req.body?.expense_date !== undefined) {
      const parsed = parseDate(req.body.expense_date);
      if (!parsed) {
        return res.status(400).json({ success: false, message: 'That date is not valid' });
      }
      const today = new Date(); today.setHours(23, 59, 59, 999);
      if (parsed > today) {
        return res.status(400).json({ success: false, message: 'The date cannot be in the future' });
      }
      expenseDate = parsed;
    }

    const description = req.body?.description === undefined
      ? existing.rows[0].description
      : (String(req.body.description).trim().slice(0, 255) || null);

    const updated = await pool.query(
      `UPDATE expenses
          SET category = $1, description = $2, amount = $3, expense_date = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE expense_id = $5 RETURNING *`,
      [category, description, money(amount), expenseDate, id]
    );

    await recordAudit(req, {
      action: 'expense.update',
      category: 'expenses',
      entity: 'expense',
      entity_id: id,
      amount,
      summary: `Edited expense #${id} — ${category}, ${amount} XP`,
      meta: { category, amount, expense_date: expenseDate }
    });

    res.status(200).json({ success: true, message: 'Expense updated', data: shape(updated.rows[0]) });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ success: false, message: 'Error updating expense' });
  }
};

/*
 * Void, not delete — the same rule bills and sessions already follow. The
 * row survives so a café's accounts never have a hole where a spend used to
 * be with no trace of it having existed.
 */
// POST /api/expenses/:id/void  { reason }
export const voidExpense = async (req, res) => {
  try {
    const cafeId = requireCafe(req, res);
    if (!cafeId) return;
    const id = parseInt(req.params.id, 10);
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 255) : null;

    const existing = await pool.query(
      `SELECT * FROM expenses WHERE expense_id = $1 AND cafe_id = $2`, [id, cafeId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    if (existing.rows[0].status === 'VOID') {
      return res.status(409).json({ success: false, message: 'That expense is already voided' });
    }

    const updated = await pool.query(
      `UPDATE expenses
          SET status = 'VOID', void_reason = $1, voided_by = $2, voided_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE expense_id = $3 RETURNING *`,
      [reason, req.actor?.label || null, id]
    );

    await recordAudit(req, {
      action: 'expense.void',
      category: 'expenses',
      entity: 'expense',
      entity_id: id,
      amount: Number(existing.rows[0].amount),
      sensitive: true,
      summary: `Voided expense #${id} — ${existing.rows[0].category}, ${existing.rows[0].amount} XP` +
        (reason ? ` (${reason})` : ''),
      meta: { reason }
    });

    res.status(200).json({ success: true, message: 'Expense voided', data: shape(updated.rows[0]) });
  } catch (error) {
    console.error('Error voiding expense:', error);
    res.status(500).json({ success: false, message: 'Error voiding expense' });
  }
};
