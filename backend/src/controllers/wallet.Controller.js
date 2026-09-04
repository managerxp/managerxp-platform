import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { customerStanding, floorFor } from '../config/customerTier.js';

/*
 * Customer wallet.
 *
 * The balance on `wallets` is authoritative; `wallet_transactions` is an
 * append-only ledger. Both are written inside one database transaction with
 * the wallet row locked, so concurrent credits and debits cannot interleave
 * and lose an update.
 */

const MAX_AMOUNT = 1000000; // sanity ceiling on a single movement

/** Parse and validate a money amount coming from a request body. */
const parseAmount = (raw) => {
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return { error: 'Amount must be a number' };
  if (amount <= 0) return { error: 'Amount must be greater than zero' };
  if (amount > MAX_AMOUNT) return { error: `Amount may not exceed ${MAX_AMOUNT}` };
  // Money is two decimal places; refuse anything finer rather than rounding
  // silently and disagreeing with the customer about their balance.
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(4))) {
    return { error: 'Amount may have at most two decimal places' };
  }
  return { amount: Number(amount.toFixed(2)) };
};

const shapeWallet = (row) => ({
  wallet_id: row.wallet_id,
  customer_id: row.customer_id,
  balance: Number(row.balance),
  currency: row.currency,
  is_active: row.is_active,
  updated_at: row.updated_at
});

const shapeTransaction = (row) => ({
  transaction_id: row.transaction_id,
  direction: row.direction,
  amount: Number(row.amount),
  balance_after: Number(row.balance_after),
  category: row.category,
  method: row.method,
  note: row.note,
  performed_by: row.performed_by,
  created_at: row.created_at
});

/**
 * Fetch the customer's wallet, creating it on first access so customers who
 * registered before wallets existed still work.
 */
const ensureWallet = async (client, customerId) => {
  const existing = await client.query(
    'SELECT * FROM wallets WHERE customer_id = $1',
    [customerId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const customer = await client.query(
    'SELECT customer_id FROM customers WHERE customer_id = $1',
    [customerId]
  );
  if (customer.rows.length === 0) return null;

  const created = await client.query(
    `INSERT INTO wallets (customer_id)
     VALUES ($1)
     ON CONFLICT (customer_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [customerId]
  );
  return created.rows[0];
};

// GET /api/wallet/customer/:customerId
export const getWallet = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const wallet = await ensureWallet(client, customerId);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.status(200).json({ success: true, data: shapeWallet(wallet) });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    res.status(500).json({ success: false, message: 'Error fetching wallet' });
  } finally {
    client.release();
  }
};

// GET /api/wallet/customer/:customerId/transactions?limit=&offset=
export const getTransactions = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const wallet = await ensureWallet(client, customerId);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const result = await client.query(
      `SELECT * FROM wallet_transactions
       WHERE customer_id = $1
       ORDER BY created_at DESC, transaction_id DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );

    const total = await client.query(
      'SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE customer_id = $1',
      [customerId]
    );

    res.status(200).json({
      success: true,
      data: result.rows.map(shapeTransaction),
      balance: Number(wallet.balance),
      currency: wallet.currency,
      pagination: { limit, offset, total: total.rows[0].count }
    });
  } catch (error) {
    console.error('Error fetching wallet transactions:', error);
    res.status(500).json({ success: false, message: 'Error fetching transactions' });
  } finally {
    client.release();
  }
};

/** Shared credit/debit path — one transaction, one locked wallet row. */
const applyMovement = async (req, res, direction) => {
  const client = await pool.connect();
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const { amount, error } = parseAmount(req.body?.amount);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const requestedCategory = String(req.body?.category || (direction === 'credit' ? 'topup' : 'purchase')).slice(0, 32);
    const method = req.body?.method ? String(req.body.method).slice(0, 32) : null;
    const note = req.body?.note ? String(req.body.note) : null;
    const performedBy = req.actor?.label || null;

    await client.query('BEGIN');

    const wallet = await ensureWallet(client, customerId);
    if (!wallet) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Lock the row for the rest of the transaction so a concurrent movement
    // cannot read the same starting balance.
    const locked = await client.query(
      'SELECT * FROM wallets WHERE wallet_id = $1 FOR UPDATE',
      [wallet.wallet_id]
    );
    const current = Number(locked.rows[0].balance);

    if (locked.rows[0].is_active === false) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'This wallet is inactive' });
    }

    const next = direction === 'credit'
      ? Number((current + amount).toFixed(2))
      : Number((current - amount).toFixed(2));

    // A regular customer's wallet may go negative, up to their own
    // credit_limit — see customerTier.js. Everyone else's floor stays zero.
    const standing = direction === 'debit' ? await customerStanding(client, customerId) : null;
    const floor = standing ? floorFor(standing) : 0;

    if (next < floor) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: floor < 0 ? 'That would exceed their credit limit' : 'Insufficient balance',
        data: { balance: current, requested: amount, credit_limit: standing ? standing.creditLimit : 0 }
      });
    }

    // A debit that crosses into negative territory is a regular customer
    // drawing on their credit, not an ordinary spend — the ledger says so
    // regardless of what category the caller asked for, so "how much is
    // outstanding" can be read straight off wallet_transactions.
    const category = direction === 'debit' && next < 0 ? 'credit_used' : requestedCategory;

    const updated = await client.query(
      `UPDATE wallets
       SET balance = $1, updated_at = CURRENT_TIMESTAMP
       WHERE wallet_id = $2
       RETURNING *`,
      [next, wallet.wallet_id]
    );

    const ledger = await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, customer_id, direction, amount, balance_after, category, method, note, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [wallet.wallet_id, customerId, direction, amount, next, category, method, note, performedBy]
    );

    await client.query('COMMIT');

    // Money moving is the first thing anyone looks for in an audit trail.
    await recordAudit(req, {
      action: direction === 'credit' ? 'wallet.credit' : 'wallet.debit',
      category: 'wallet',
      entity: 'customer',
      entity_id: customerId,
      amount: Number(amount),
      sensitive: true,
      summary: `${direction === 'credit' ? 'Added' : 'Deducted'} ${amount} XP ` +
        `${direction === 'credit' ? 'to' : 'from'} customer ${customerId}` +
        (note ? ` — ${note}` : ''),
      meta: { category, method, note, balance_after: next }
    });

    res.status(201).json({
      success: true,
      message: direction === 'credit' ? 'Wallet credited' : 'Wallet debited',
      data: {
        wallet: shapeWallet(updated.rows[0]),
        transaction: shapeTransaction(ledger.rows[0])
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`Error applying wallet ${direction}:`, error);
    res.status(500).json({ success: false, message: `Error processing ${direction}` });
  } finally {
    client.release();
  }
};

// POST /api/wallet/customer/:customerId/credit
export const creditWallet = (req, res) => applyMovement(req, res, 'credit');

// POST /api/wallet/customer/:customerId/debit
export const debitWallet = (req, res) => applyMovement(req, res, 'debit');
