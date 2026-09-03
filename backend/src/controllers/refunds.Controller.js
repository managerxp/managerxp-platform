/*
 * Refunds.
 *
 * Three rules shape this whole file:
 *
 *   1. The original bill is never touched. Not its total, not its lines. A
 *      refunded invoice still reads exactly what the customer was charged,
 *      because that is what makes the ledger reconcilable a year later.
 *
 *   2. The amount is computed here from the bill's own stored line prices. A
 *      refund_amount arriving in the request body is ignored — it is a display
 *      value the browser calculated, not an instruction.
 *
 *   3. Historical prices win. A t-shirt sold at 799 refunds at 799 even after
 *      the product master says 899, because the refund reverses what happened
 *      rather than repricing it today.
 *
 * The money still moves through `payments` as a negative row, exactly as it
 * did before this file existed — `refunds` is the document that explains that
 * row, not a replacement for it.
 */
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

const money = (v) => Number(Number(v || 0).toFixed(2));

/* ==========================================================================
   REFUNDABILITY

   One query answers everything the UI and the validator need: what was
   charged, what has already come back, and therefore what is still available.
   Computed rather than stored, so it cannot drift from the rows it describes.
   ========================================================================== */
const loadRefundable = async (client, billId) => {
  const bill = (await client.query(`
    SELECT b.*,
           COALESCE((SELECT SUM(amount) FROM payments
                     WHERE bill_id = b.bill_id AND amount > 0), 0)  AS paid_in,
           COALESCE((SELECT SUM(refund_amount) FROM refunds
                     WHERE bill_id = b.bill_id
                       AND refund_status = 'COMPLETED'), 0)         AS refunded
    FROM bills b WHERE b.bill_id = $1
  `, [billId])).rows[0];

  if (!bill) return null;

  const items = (await client.query(`
    SELECT bi.*,
           COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri
                     JOIN refunds r ON r.refund_id = ri.refund_id
                     WHERE ri.bill_item_id = bi.bill_item_id
                       AND r.refund_status = 'COMPLETED'), 0) AS refunded_qty
    FROM bill_items bi
    WHERE bi.bill_id = $1
    ORDER BY bi.bill_item_id
  `, [billId])).rows;

  const paidIn = money(bill.paid_in);
  const refunded = money(bill.refunded);

  return {
    bill,
    paid: paidIn,
    refunded,
    // The ceiling on any new refund. Never the bill total — a partly-paid
    // bill cannot refund more than actually came in.
    remaining: money(paidIn - refunded),
    items: items.map((it) => {
      const qty = Number(it.quantity);
      const refundedQty = Number(it.refunded_qty);
      return {
        ...it,
        quantity: qty,
        unit_price: money(it.unit_price),
        amount: money(it.amount),
        refunded_qty: refundedQty,
        refundable_qty: Number((qty - refundedQty).toFixed(2)),
        fully_refunded: refundedQty >= qty
      };
    })
  };
};

const shapeRefund = (row) => ({
  refund_id: row.refund_id,
  refund_no: row.refund_no,
  bill_id: row.bill_id,
  bill_number: row.bill_number || null,
  payment_id: row.payment_id,
  refund_date: row.refund_date,
  refund_amount: money(row.refund_amount),
  refund_method: row.refund_method,
  refund_reason: row.refund_reason,
  refund_status: row.refund_status,
  processed_by: row.processed_by,
  items: row.items || []
});

/* ==========================================================================
   READ
   ========================================================================== */

// GET /api/bills/:billId/refundable
export const getRefundable = async (req, res) => {
  const client = await pool.connect();
  try {
    const state = await loadRefundable(client, Number(req.params.billId));
    if (!state) return res.status(404).json({ success: false, message: 'Bill not found' });

    res.json({
      success: true,
      data: {
        bill_id: state.bill.bill_id,
        bill_number: state.bill.bill_number,
        // Stated separately and explicitly, because conflating them is how a
        // till ends up refunding money it never took.
        original_total: money(state.bill.total),
        paid: state.paid,
        refunded: state.refunded,
        remaining_refundable: state.remaining,
        net_amount: money(state.paid - state.refunded),
        fully_refunded: state.remaining <= 0 && state.refunded > 0,
        items: state.items.map((it) => ({
          bill_item_id: it.bill_item_id,
          item_type: it.item_type,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          amount: it.amount,
          refunded_qty: it.refunded_qty,
          refundable_qty: it.refundable_qty,
          fully_refunded: it.fully_refunded
        }))
      }
    });
  } catch (error) {
    console.error('Error loading refundable state:', error);
    res.status(500).json({ success: false, message: 'Error loading refund details' });
  } finally {
    client.release();
  }
};

// GET /api/bills/:billId/refunds
export const listBillRefunds = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT r.*, b.bill_number,
             COALESCE(
               JSON_AGG(JSON_BUILD_OBJECT(
                 'refund_item_id', ri.refund_item_id,
                 'bill_item_id',   ri.bill_item_id,
                 'description',    ri.description,
                 'quantity',       ri.quantity,
                 'unit_price',     ri.unit_price,
                 'refund_amount',  ri.refund_amount
               ) ORDER BY ri.refund_item_id) FILTER (WHERE ri.refund_item_id IS NOT NULL),
               '[]'
             ) AS items
      FROM refunds r
      LEFT JOIN bills b ON b.bill_id = r.bill_id
      LEFT JOIN refund_items ri ON ri.refund_id = r.refund_id
      WHERE r.bill_id = $1
      GROUP BY r.refund_id, b.bill_number
      ORDER BY r.created_at DESC
    `, [Number(req.params.billId)]);

    res.json({ success: true, data: rows.map(shapeRefund) });
  } catch (error) {
    console.error('Error listing refunds:', error);
    res.status(500).json({ success: false, message: 'Error loading refund history' });
  } finally {
    client.release();
  }
};

// GET /api/refunds/:refundId
export const getRefund = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT r.*, b.bill_number,
             COALESCE(
               JSON_AGG(JSON_BUILD_OBJECT(
                 'refund_item_id', ri.refund_item_id,
                 'bill_item_id',   ri.bill_item_id,
                 'description',    ri.description,
                 'quantity',       ri.quantity,
                 'unit_price',     ri.unit_price,
                 'refund_amount',  ri.refund_amount
               ) ORDER BY ri.refund_item_id) FILTER (WHERE ri.refund_item_id IS NOT NULL),
               '[]'
             ) AS items
      FROM refunds r
      LEFT JOIN bills b ON b.bill_id = r.bill_id
      LEFT JOIN refund_items ri ON ri.refund_id = r.refund_id
      WHERE r.refund_id = $1
      GROUP BY r.refund_id, b.bill_number
    `, [Number(req.params.refundId)]);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Refund not found' });
    res.json({ success: true, data: shapeRefund(rows[0]) });
  } catch (error) {
    console.error('Error loading refund:', error);
    res.status(500).json({ success: false, message: 'Error loading the refund' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CREATE

   One transaction. Either a refund exists complete with its lines and its
   money movement, or nothing was written at all.
   ========================================================================== */

// POST /api/bills/:billId/refund
export const createRefund = async (req, res) => {
  const client = await pool.connect();
  try {
    /* The bill can arrive under either name: the existing route is
       /bills/:id/refund, while the read endpoints use /:billId. Accepting
       both means this handler works on whichever route it is mounted under
       rather than silently rejecting every request on one of them. */
    const billId = Number(req.params.billId ?? req.params.id ?? req.body?.bill_id);
    if (!Number.isInteger(billId)) {
      return res.status(400).json({ success: false, message: 'Invalid bill' });
    }

    /*
     * Idempotency, checked before any work. A cashier double-clicking, or a
     * client retrying after a dropped response, returns the refund that
     * already happened rather than making a second one.
     */
    const key = req.body?.idempotency_key ? String(req.body.idempotency_key).slice(0, 64) : null;
    if (key) {
      const existing = (await client.query(
        'SELECT refund_id, refund_no, refund_amount FROM refunds WHERE idempotency_key = $1', [key])).rows[0];
      if (existing) {
        return res.json({
          success: true,
          message: 'Refund already processed',
          data: { ...existing, refund_amount: money(existing.refund_amount), duplicate: true }
        });
      }
    }

    await client.query('BEGIN');

    /* Lock the bill for the length of the transaction. Two cashiers refunding
       the same bill at once would otherwise both read the same "remaining"
       figure and both pass validation. */
    const locked = await client.query('SELECT bill_id FROM bills WHERE bill_id = $1 FOR UPDATE', [billId]);
    if (!locked.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const state = await loadRefundable(client, billId);

    if (state.bill.status === 'VOID') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This bill was voided — there is nothing to refund'
      });
    }
    if (state.paid <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Nothing has been paid against this bill yet'
      });
    }
    if (state.remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `This bill has already been fully refunded (${state.refunded} of ${state.paid})`
      });
    }

    /* ---- work out the amount ----
       Either from the selected lines, or as a stated amount for a whole-bill
       or goodwill refund. In both cases the figure is derived or clamped
       here; the body's own refund_amount is never used as the authority. */
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const byId = new Map(state.items.map((it) => [it.bill_item_id, it]));
    const lines = [];
    let amount = 0;

    if (requestedItems.length > 0) {
      for (const raw of requestedItems) {
        const itemId = Number(raw?.bill_item_id ?? raw?.invoice_item_id);
        const line = byId.get(itemId);

        if (!line) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Line ${itemId} is not on this bill`
          });
        }

        // Default to everything still refundable on that line.
        const qty = raw?.quantity === undefined || raw?.quantity === null
          ? line.refundable_qty
          : Number(raw.quantity);

        if (!Number.isFinite(qty) || qty <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Quantity for "${line.description}" must be greater than zero`
          });
        }
        if (qty > line.refundable_qty + 0.001) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            // Names the line and the real ceiling — "invalid quantity" tells a
            // cashier with a customer waiting nothing they can act on.
            message: `Only ${line.refundable_qty} of "${line.description}" can still be refunded` +
              (line.refunded_qty > 0 ? ` (${line.refunded_qty} already returned)` : '')
          });
        }

        /* The snapshot rule, in one line: the price comes off the bill_item,
           never from products or gaming_prices. */
        const lineAmount = money(qty * line.unit_price);
        amount += lineAmount;

        lines.push({
          bill_item_id: line.bill_item_id,
          quantity: qty,
          unit_price: line.unit_price,
          refund_amount: lineAmount,
          description: line.description,
          reason: raw?.reason ? String(raw.reason).slice(0, 255) : null
        });
      }
      amount = money(amount);
    } else {
      // No lines selected: a whole-bill or goodwill refund of a stated amount.
      const stated = Number(req.body?.amount);
      if (!Number.isFinite(stated) || stated <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Select the items to refund, or enter an amount'
        });
      }
      amount = money(stated);
    }

    if (amount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'The refund amount must be greater than zero' });
    }

    /* The ceiling, enforced after the amount is known however it was derived.
       This is the check that stops a café refunding more than it took. */
    if (amount > state.remaining + 0.001) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `That exceeds what can still be refunded. Paid ${state.paid}, ` +
          `already refunded ${state.refunded}, remaining ${state.remaining}.`,
        data: { paid: state.paid, refunded: state.refunded, remaining: state.remaining }
      });
    }

    /* ---- the method ----
       Defaults to how the customer originally paid, which is what a café
       almost always wants and what card networks generally require. An
       explicit override is allowed but must still be a method the system
       knows. */
    const original = (await client.query(`
      SELECT payment_id, method FROM payments
      WHERE bill_id = $1 AND amount > 0
      ORDER BY amount DESC, payment_id ASC LIMIT 1
    `, [billId])).rows[0];

    const VALID = ['wallet', 'cash', 'card', 'upi', 'other'];
    const method = VALID.includes(req.body?.refund_method)
      ? req.body.refund_method
      : (original?.method || 'cash');

    /* ---- write it ---- */
    const seq = (await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM refunds
       WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`)).rows[0].n;
    const refundNo = `RF-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;

    // The money movement, in the same table it has always used.
    const refundPayment = (await client.query(`
      INSERT INTO payments (bill_id, customer_id, method, amount, is_refund, note, received_by, payment_status, paid_at)
      VALUES ($1,$2,$3,$4,TRUE,$5,$6,'COMPLETED',CURRENT_TIMESTAMP)
      RETURNING payment_id
    `, [billId, state.bill.customer_id, method, -amount,
        req.body?.reason ? String(req.body.reason).slice(0, 255) : 'Refund',
        req.actor?.label || null])).rows[0];

    const refund = (await client.query(`
      INSERT INTO refunds
        (refund_no, cafe_id, bill_id, payment_id, refund_payment_id, refund_amount,
         refund_method, refund_reason, refund_status, idempotency_key, processed_by, processed_by_staff_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMPLETED',$9,$10,$11)
      RETURNING *
    `, [refundNo, state.bill.cafe_id, billId, original?.payment_id || null,
        refundPayment.payment_id, amount, method,
        req.body?.reason ? String(req.body.reason).slice(0, 255) : null,
        key, req.actor?.label || 'staff', req.actor?.staff_id || null])).rows[0];

    for (const line of lines) {
      await client.query(`
        INSERT INTO refund_items
          (refund_id, bill_item_id, quantity, unit_price, refund_amount, description, reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [refund.refund_id, line.bill_item_id, line.quantity, line.unit_price,
          line.refund_amount, line.description, line.reason]);

      /*
       * A returned item goes back on the shelf.
       *
       * Only for tracked products, and only when lines were selected — a
       * goodwill refund of a stated amount returns money, not goods, and
       * crediting stock for it would invent inventory that never came back.
       */
      const source = byId.get(line.bill_item_id);
      if (source && ['fnb', 'shop'].includes(source.item_type) && source.reference_id) {
        const product = (await client.query(
          'SELECT product_id, track_stock, stock_quantity FROM products WHERE product_id = $1 FOR UPDATE',
          [source.reference_id]
        )).rows[0];

        if (product && product.track_stock === true) {
          const next = Number((Number(product.stock_quantity) + Number(line.quantity)).toFixed(2));
          await client.query(
            'UPDATE products SET stock_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
            [next, product.product_id]
          );
          await client.query(`
            INSERT INTO stock_movements
              (product_id, direction, quantity, stock_after, reason, note, performed_by)
            VALUES ($1,'in',$2,$3,'refund',$4,$5)
          `, [product.product_id, line.quantity, next,
              `Returned on ${refundNo}`, req.actor?.label || null]);
        }
      }
    }

    /*
     * paid_amount is deliberately NOT reduced.
     *
     * It records what the customer paid, and they did pay it. Decrementing it
     * made a settled bill look partly unpaid, which walked the status back to
     * PARTIAL and made the till offer "Take payment" on money it had already
     * taken. What went back is read from the negative payment rows instead —
     * see recalculate() and shapeBill() — so "paid" and "refunded" stay two
     * separate facts.
     *
     * Nothing else on the bill is touched either: subtotal, tax, total and
     * every bill_item are left exactly as they were. The invoice still says
     * what was charged.
     */
    await client.query(
      'UPDATE bills SET updated_at = CURRENT_TIMESTAMP WHERE bill_id = $1', [billId]);

    await client.query('COMMIT');

    await recordAudit(req, {
      action: 'billing.refund',
      category: 'billing',
      entity: 'refund',
      entity_id: refund.refund_id,
      amount,
      sensitive: true,
      summary: `Refunded ${amount} on ${state.bill.bill_number} via ${method}` +
        (req.body?.reason ? ` — ${req.body.reason}` : ''),
      meta: {
        refund_no: refundNo,
        bill_id: billId,
        items: lines.length,
        remaining_after: money(state.remaining - amount)
      }
    });

    res.status(201).json({
      success: true,
      message: `${refundNo} — ${amount} refunded`,
      data: {
        refund_id: refund.refund_id,
        refund_no: refundNo,
        refund_amount: amount,
        refund_method: method,
        items: lines,
        // What the invoice screen should now show, computed rather than
        // left for the browser to work out.
        bill: {
          original_total: money(state.bill.total),
          paid: state.paid,
          refunded: money(state.refunded + amount),
          remaining_refundable: money(state.remaining - amount),
          net_amount: money(state.paid - state.refunded - amount),
          fully_refunded: money(state.remaining - amount) <= 0
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    // The idempotency index firing means a concurrent duplicate got there
    // first — which is the guard working, not a failure to report.
    if (error.code === '23505' && String(error.constraint || '').includes('idempotency')) {
      return res.status(409).json({
        success: false,
        message: 'That refund is already being processed'
      });
    }

    console.error('Error creating refund:', error);
    res.status(500).json({ success: false, message: 'Error processing the refund' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   REPORTING
   ========================================================================== */

// GET /api/refunds
export const listRefunds = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const { rows } = await client.query(`
      SELECT r.*, b.bill_number
      FROM refunds r
      LEFT JOIN bills b ON b.bill_id = r.bill_id
      WHERE ($1::int IS NULL OR r.cafe_id = $1)
      ORDER BY r.refund_date DESC
      LIMIT $2
    `, [cafeId, limit]);

    /* Gross, refunds and net, kept apart. Netting refunds off silently is how
       a report stops being able to answer "how much did we sell, and how much
       came back" — two questions a café owner asks separately. */
    const totals = (await client.query(`
      SELECT
        COALESCE(SUM(refund_amount) FILTER (
          WHERE refund_date >= date_trunc('month', NOW()) AND refund_status = 'COMPLETED'), 0) AS this_month,
        COALESCE(SUM(refund_amount) FILTER (
          WHERE refund_date >= NOW() - INTERVAL '30 days' AND refund_status = 'COMPLETED'), 0) AS last_30d,
        COUNT(*) FILTER (WHERE refund_status = 'COMPLETED')::int AS count_all
      FROM refunds
      WHERE ($1::int IS NULL OR cafe_id = $1)
    `, [cafeId])).rows[0];

    res.json({
      success: true,
      data: {
        refunds: rows.map(shapeRefund),
        summary: {
          this_month: money(totals.this_month),
          last_30d: money(totals.last_30d),
          count: totals.count_all
        }
      }
    });
  } catch (error) {
    console.error('Error listing refunds:', error);
    res.status(500).json({ success: false, message: 'Error loading refunds' });
  } finally {
    client.release();
  }
};
