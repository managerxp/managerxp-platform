import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import { applyMovement } from './products.Controller.js';
import { customerStanding, floorFor } from '../config/customerTier.js';

/*
 * Orders placed from a station.
 *
 * Placing an order does three things in one transaction: deduct stock, raise a
 * bill, and settle it from the wallet if the customer has the balance. If any
 * part fails the whole thing rolls back, so stock is never taken for an order
 * that was not recorded.
 */

const STATUS_FLOW = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED'];
const ALL_STATUSES = STATUS_FLOW.concat(['CANCELLED']);
const money = (v) => Number(Number(v || 0).toFixed(2));

const shapeOrder = (row, items = []) => ({
  order_id: row.order_id,
  order_number: row.order_number,
  customer_id: row.customer_id,
  customer_name: row.customer_name || null,
  session_id: row.session_id,
  pc_name: row.pc_name,
  bill_id: row.bill_id,
  bill_number: row.bill_number || null,
  subtotal: money(row.subtotal),
  tax: money(row.tax),
  total: money(row.total),
  currency: row.currency,
  status: row.status,
  payment_status: row.payment_status,
  note: row.note,
  created_at: row.created_at,
  updated_at: row.updated_at,
  items: items.map((i) => ({
    order_item_id: i.order_item_id,
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: Number(i.quantity),
    unit_price: money(i.unit_price),
    amount: money(i.amount)
  }))
});

/* Takes the parameter position holding the café id — see products for why
   the index is passed rather than assumed. An order is a customer's name
   against a station and a bill; it belongs to one café only. */
const selectOrder = (cafeParam) => `
  SELECT o.*, c.customer_name, b.bill_number
  FROM orders o
  LEFT JOIN customers c ON c.customer_id = o.customer_id
  LEFT JOIN bills b ON b.bill_id = o.bill_id
  WHERE o.cafe_id IS NOT DISTINCT FROM $${cafeParam}
`;

const loadOrder = async (client, orderId, cafeId = null) => {
  const order = await client.query(
    `${selectOrder(2)} AND o.order_id = $1`, [orderId, cafeId]);
  if (order.rows.length === 0) return null;
  const items = await client.query(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY order_item_id ASC', [orderId]
  );
  return shapeOrder(order.rows[0], items.rows);
};

/* ==========================================================================
   PLACE
   ========================================================================== */
// POST /api/orders   { items: [{ product_id, quantity }], note, pc_name, session_id }
export const placeOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'Add something to the order first' });
    }

    // A customer ordering for themselves cannot order on someone else's behalf.
    const customerId = req.actor?.isStaff
      ? (req.body?.customer_id ? parseInt(req.body.customer_id, 10) : null)
      : Number(req.actor?.customer_id);

    if (!customerId) {
      return res.status(400).json({ success: false, message: 'A customer is required' });
    }

    await client.query('BEGIN');

    const customer = await client.query(
      'SELECT customer_id, customer_name, cafe_id FROM customers WHERE customer_id = $1', [customerId]
    );
    if (customer.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const currency = await getSetting('wallet.currency', 'XP');
    const seq = await client.query(`SELECT nextval('order_number_seq') AS n`);
    const orderNumber = 'ORD-' + seq.rows[0].n;

    /* The café placing the order: the staff token's, or the customer's own
       when a customer orders from a station. */
    const orderCafe = req.actor?.cafe_id ?? customer.rows[0]?.cafe_id ?? null;

    const inserted = await client.query(
      `INSERT INTO orders (order_number, customer_id, session_id, pc_name, currency, note, placed_by, cafe_id)
       VALUES ($1::varchar,$2::int,$3::int,$4::varchar,$5::varchar,$6::text,$7::varchar,$8::int)
       RETURNING order_id`,
      [
        orderNumber, customerId,
        req.body?.session_id ? parseInt(req.body.session_id, 10) : null,
        req.body?.pc_name || null, currency,
        req.body?.note || null,
        req.actor?.label || null,
        orderCafe
      ]
    );
    const orderId = inserted.rows[0].order_id;

    let subtotal = 0;
    let tax = 0;

    for (const line of items) {
      const productId = parseInt(line.product_id, 10);
      const quantity = Number(line.quantity || 1);
      if (!Number.isInteger(productId) || !Number.isFinite(quantity) || quantity <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Every line needs a product and a positive quantity' });
      }

      const product = await client.query('SELECT * FROM products WHERE product_id = $1', [productId]);
      if (product.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'A product on this order no longer exists' });
      }
      const p = product.rows[0];
      if (p.status !== 'ACTIVE' || !p.is_available) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: `${p.product_name} is not available right now` });
      }

      // Take the stock now, so two stations cannot both claim the last one.
      const moved = await applyMovement(client, {
        productId, direction: 'out', quantity,
        reason: 'order', referenceId: orderId,
        note: orderNumber, actor: req.actor?.label
      });
      if (moved.error) {
        await client.query('ROLLBACK');
        return res.status(moved.status || 409).json({ success: false, message: moved.error });
      }

      const unitPrice = money(p.price);
      const amount = money(unitPrice * quantity);
      const lineTax = money(amount * (Number(p.tax_percent) / 100));
      subtotal = money(subtotal + amount);
      tax = money(tax + lineTax);

      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, tax_percent, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, productId, p.product_name, quantity, unitPrice, p.tax_percent, amount]
      );
    }

    const total = money(subtotal + tax);

    // Raise a bill so the order lands in billing like everything else.
    const billSeq = await client.query(`SELECT nextval('bill_number_seq') AS n`);
    const billNumber = 'CX-' + String(billSeq.rows[0].n).padStart(6, '0');

    const bill = await client.query(
      `INSERT INTO bills (bill_number, customer_id, session_id, currency, created_by,
                          subtotal, tax, total)
       VALUES ($1::varchar,$2::int,$3::int,$4::varchar,$5::varchar,$6::numeric,$7::numeric,$8::numeric)
       RETURNING bill_id`,
      [billNumber, customerId,
       req.body?.session_id ? parseInt(req.body.session_id, 10) : null,
       currency, req.actor?.label || null, subtotal, tax, total]
    );
    const billId = bill.rows[0].bill_id;

    const orderItems = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
    for (const item of orderItems.rows) {
      await client.query(
        `INSERT INTO bill_items (bill_id, item_type, reference_id, description, quantity, unit_price, amount)
         VALUES ($1,'fnb',$2,$3,$4,$5,$6)`,
        [billId, item.product_id, item.product_name, item.quantity, item.unit_price, item.amount]
      );
    }

    // Settle from the wallet when it covers it; otherwise the bill stays open
    // and staff take payment at delivery.
    let paymentStatus = 'UNPAID';
    if (total > 0) {
      const wallet = await client.query(
        'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE', [customerId]
      );
      const balance = wallet.rows.length ? Number(wallet.rows[0].balance) : 0;
      // A regular customer's wallet may cover this by going negative, up to
      // their own credit_limit — see customerTier.js. Everyone else's floor
      // is zero, same behaviour as before.
      const standing = wallet.rows.length ? await customerStanding(client, customerId) : null;
      const floor = standing ? floorFor(standing) : 0;
      const next = money(balance - total);

      if (wallet.rows.length && next >= floor) {
        await client.query(
          'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
          [next, wallet.rows[0].wallet_id]
        );
        const ledger = await client.query(
          `INSERT INTO wallet_transactions
             (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
           VALUES ($1,$2,'debit',$3,$4,$5,$6,$7) RETURNING transaction_id`,
          [wallet.rows[0].wallet_id, customerId, total, next, next < 0 ? 'credit_used' : 'food', orderNumber, req.actor?.label || null]
        );
        await client.query(
          `INSERT INTO payments (bill_id, customer_id, method, amount, reference, wallet_transaction_id, received_by)
           VALUES ($1,$2,'wallet',$3,$4,$5,$6)`,
          [billId, customerId, total, orderNumber, ledger.rows[0].transaction_id, req.actor?.label || null]
        );
        await client.query(
          `UPDATE bills SET paid_amount = $1, status = 'PAID', settled_at = CURRENT_TIMESTAMP
           WHERE bill_id = $2`,
          [total, billId]
        );
        paymentStatus = 'PAID';
      }
    } else {
      paymentStatus = 'PAID';
    }

    await client.query(
      `UPDATE orders SET subtotal = $1, tax = $2, total = $3, bill_id = $4,
                         payment_status = $5::varchar, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = $6`,
      [subtotal, tax, total, billId, paymentStatus, orderId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: paymentStatus === 'PAID'
        ? 'Order placed and paid from your wallet'
        : 'Order placed — pay when it arrives',
      data: await loadOrder(client, orderId, orderCafe)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error placing order:', error);
    res.status(500).json({ success: false, message: 'Error placing order' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   READ
   ========================================================================== */
// GET /api/orders?status=&customer_id=
export const listOrders = async (req, res) => {
  try {
    const filters = [];
    // $1 is the café — selectOrder's WHERE reads it; filters append from $2.
    const params = [req.actor?.cafe_id ?? null];

    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase().split(','));
      filters.push(`o.status = ANY($${params.length})`);
    }
    if (req.query.customer_id) {
      params.push(parseInt(req.query.customer_id, 10));
      filters.push(`o.customer_id = $${params.length}`);
    }
    if (req.query.active === 'true') {
      params.push(['PLACED', 'CONFIRMED', 'PREPARING', 'READY']);
      filters.push(`o.status = ANY($${params.length})`);
    }

    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const orders = await pool.query(
      `${selectOrder(1)} ${where} ORDER BY o.created_at DESC LIMIT 100`, params
    );

    // One extra query for all items beats one per order.
    const ids = orders.rows.map((o) => o.order_id);
    let itemsByOrder = {};
    if (ids.length) {
      const items = await pool.query(
        'SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY order_item_id ASC', [ids]
      );
      items.rows.forEach((i) => {
        (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i);
      });
    }

    res.status(200).json({
      success: true,
      data: orders.rows.map((o) => shapeOrder(o, itemsByOrder[o.order_id] || []))
    });
  } catch (error) {
    console.error('Error listing orders:', error);
    res.status(500).json({ success: false, message: 'Error fetching orders' });
  }
};

// GET /api/orders/customer/:customerId
export const listCustomerOrders = async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== customerId) {
      return res.status(403).json({ success: false, message: 'You can only view your own orders' });
    }

    /* Scoped to the café the customer belongs to, so a staff token from one
       café cannot read another's order history through a customer id. */
    const owner = await client.query(
      'SELECT cafe_id FROM customers WHERE customer_id = $1', [customerId]);
    const orderCafeId = req.actor?.cafe_id ?? owner.rows[0]?.cafe_id ?? null;

    const orders = await client.query(
      `${selectOrder(2)} AND o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 25`,
      [customerId, orderCafeId]
    );
    const ids = orders.rows.map((o) => o.order_id);
    let itemsByOrder = {};
    if (ids.length) {
      const items = await client.query(
        'SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY order_item_id ASC', [ids]
      );
      items.rows.forEach((i) => {
        (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i);
      });
    }

    res.status(200).json({
      success: true,
      data: orders.rows.map((o) => shapeOrder(o, itemsByOrder[o.order_id] || []))
    });
  } catch (error) {
    console.error('Error listing customer orders:', error);
    res.status(500).json({ success: false, message: 'Error fetching orders' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   STATUS
   ========================================================================== */
// PATCH /api/orders/:id/status   { status }
export const setOrderStatus = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || '').toUpperCase();
    if (!ALL_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of ${ALL_STATUSES.join(', ')}` });
    }

    await client.query('BEGIN');
    const order = await client.query('SELECT * FROM orders WHERE order_id = $1 FOR UPDATE', [id]);
    if (order.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const row = order.rows[0];
    if (row.status === 'DELIVERED' || row.status === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `That order is already ${row.status.toLowerCase()}` });
    }

    // Cancelling returns the stock, so the shelf count stays honest.
    if (status === 'CANCELLED') {
      const items = await client.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
      for (const item of items.rows) {
        if (!item.product_id) continue;
        await applyMovement(client, {
          productId: item.product_id, direction: 'in', quantity: Number(item.quantity),
          reason: 'order-cancelled', referenceId: id,
          note: row.order_number, actor: req.actor?.label
        });
      }
    }

    await client.query(
      `UPDATE orders SET status = $1::varchar, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`,
      [status, id]
    );
    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: status === 'CANCELLED' ? 'Order cancelled and stock returned' : `Order marked ${status.toLowerCase()}`,
      data: await loadOrder(client, id, req.actor?.cafe_id ?? null)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, message: 'Error updating order' });
  } finally {
    client.release();
  }
};
