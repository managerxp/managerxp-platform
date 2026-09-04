import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';

/*
 * Packages — prepaid bundles of playing time or coins.
 *
 * `units` means minutes for HOURS, coins for CREDIT, plays for SESSIONS. The
 * master holds what is for sale; customer_packages holds what someone bought
 * and how much of it is left.
 */

const TYPES = ['HOURS', 'CREDIT', 'SESSIONS'];
const STATUSES = ['ACTIVE', 'INACTIVE'];

const money = (v) => Number(Number(v || 0).toFixed(2));

const shapePackage = (row) => ({
  package_id: row.package_id,
  package_name: row.package_name,
  description: row.description,
  package_type: row.package_type,
  units: money(row.units),
  bonus_units: money(row.bonus_units),
  total_units: money(Number(row.units) + Number(row.bonus_units)),
  price: money(row.price),
  currency: row.currency,
  validity_days: row.validity_days,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
  sold_count: row.sold_count === undefined ? undefined : Number(row.sold_count)
});

const shapeCustomerPackage = (row) => ({
  customer_package_id: row.customer_package_id,
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  package_id: row.package_id,
  package_name: row.package_name,
  package_type: row.package_type,
  total_units: money(row.total_units),
  remaining_units: money(row.remaining_units),
  used_units: money(Number(row.total_units) - Number(row.remaining_units)),
  price_paid: money(row.price_paid),
  purchased_at: row.purchased_at,
  expires_at: row.expires_at,
  // Expiry is evaluated on read, so a lapsed package reports correctly even
  // before any sweep has run.
  is_expired: !!row.expires_at && new Date(row.expires_at) < new Date(),
  status: row.status,
  bill_id: row.bill_id,
  sold_by: row.sold_by
});

const SELECT_CUSTOMER_PACKAGE = `
  SELECT cp.*, p.package_name, p.package_type, c.customer_name
  FROM customer_packages cp
  JOIN packages p ON p.package_id = cp.package_id
  JOIN customers c ON c.customer_id = cp.customer_id
`;

/* ==========================================================================
   MASTER
   ========================================================================== */
const validatePackage = (body) => {
  const name = (body.package_name || '').trim();
  if (!name) return { error: 'A package name is required' };

  const type = String(body.package_type || 'HOURS').toUpperCase();
  if (!TYPES.includes(type)) return { error: `Type must be one of ${TYPES.join(', ')}` };

  const units = Number(body.units);
  if (!Number.isFinite(units) || units <= 0) return { error: 'Units must be greater than zero' };

  const bonus = body.bonus_units === undefined || body.bonus_units === '' ? 0 : Number(body.bonus_units);
  if (!Number.isFinite(bonus) || bonus < 0) return { error: 'Bonus units cannot be negative' };

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be zero or more' };

  const validity = body.validity_days === undefined || body.validity_days === null || body.validity_days === ''
    ? null : parseInt(body.validity_days, 10);
  if (validity !== null && (!Number.isInteger(validity) || validity < 1)) {
    return { error: 'Validity must be at least one day, or left blank for no expiry' };
  }

  return { name, type, units: money(units), bonus: money(bonus), price: money(price), validity };
};

// POST /api/packages
export const createPackage = async (req, res) => {
  try {
    const parsed = validatePackage(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const currency = await getSetting('wallet.currency', 'XP');
    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase() : 'ACTIVE';

    const result = await pool.query(
      `INSERT INTO packages (cafe_id, package_name, description, package_type, units, bonus_units,
                             price, currency, validity_days, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.actor?.cafe_id ?? null,
       parsed.name, req.body?.description || null, parsed.type, parsed.units, parsed.bonus,
       parsed.price, currency, parsed.validity, status]
    );

    res.status(201).json({ success: true, message: 'Package created', data: shapePackage(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A package with that name already exists' });
    }
    console.error('Error creating package:', error);
    res.status(500).json({ success: false, message: 'Error creating package' });
  }
};

// GET /api/packages?status=&search=
export const listPackages = async (req, res) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`p.status = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`p.package_name ILIKE $${params.length}`);
    }
    /* Always scoped: a package list is a price list. */
    const where = `WHERE p.cafe_id IS NOT DISTINCT FROM $${params.push(req.actor?.cafe_id ?? null)}` +
      (filters.length ? ` AND ${filters.join(' AND ')}` : '');

    const result = await pool.query(
      `SELECT p.*, COUNT(cp.customer_package_id)::int AS sold_count
       FROM packages p
       LEFT JOIN customer_packages cp ON cp.package_id = p.package_id
       ${where}
       GROUP BY p.package_id
       ORDER BY p.price ASC, p.package_id ASC`,
      params
    );

    res.status(200).json({ success: true, data: result.rows.map(shapePackage) });
  } catch (error) {
    console.error('Error listing packages:', error);
    res.status(500).json({ success: false, message: 'Error fetching packages' });
  }
};

// PUT /api/packages/:id
export const updatePackage = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = validatePackage(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase() : null;

    const result = await pool.query(
      `UPDATE packages
       SET package_name = $1, description = $2, package_type = $3, units = $4,
           bonus_units = $5, price = $6, validity_days = $7,
           status = COALESCE($8::varchar, status), updated_at = CURRENT_TIMESTAMP
       WHERE package_id = $9 AND cafe_id IS NOT DISTINCT FROM $10 RETURNING *`,
      [parsed.name, req.body?.description || null, parsed.type, parsed.units, parsed.bonus,
       parsed.price, parsed.validity, status, id, req.actor?.cafe_id ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    res.status(200).json({ success: true, message: 'Package updated', data: shapePackage(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A package with that name already exists' });
    }
    console.error('Error updating package:', error);
    res.status(500).json({ success: false, message: 'Error updating package' });
  }
};

// PATCH /api/packages/:id/status
export const setPackageStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE or INACTIVE' });
    }
    const result = await pool.query(
      `UPDATE packages SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE package_id = $2 AND cafe_id IS NOT DISTINCT FROM $3 RETURNING *`,
      [status, parseInt(req.params.id, 10), req.actor?.cafe_id ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    res.status(200).json({
      success: true,
      message: status === 'ACTIVE' ? 'Package activated' : 'Package deactivated',
      data: shapePackage(result.rows[0])
    });
  } catch (error) {
    console.error('Error updating package status:', error);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
};

// DELETE /api/packages/:id
export const deletePackage = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sold = await pool.query(
      'SELECT COUNT(*)::int AS count FROM customer_packages WHERE package_id = $1', [id]
    );
    // Deleting would orphan someone's balance, so it is refused outright.
    if (sold.rows[0].count > 0) {
      return res.status(409).json({
        success: false,
        message: `This package has been sold ${sold.rows[0].count} time(s). Deactivate it instead.`
      });
    }
    const result = await pool.query(`DELETE FROM packages WHERE package_id = $1 AND cafe_id IS NOT DISTINCT FROM $2
        RETURNING package_id`, [id, req.actor?.cafe_id ?? null]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    res.status(200).json({ success: true, message: 'Package deleted' });
  } catch (error) {
    console.error('Error deleting package:', error);
    res.status(500).json({ success: false, message: 'Error deleting package' });
  }
};

/* ==========================================================================
   PURCHASE
   ========================================================================== */
// POST /api/packages/:id/purchase   { customer_id, payment_method }
export const purchasePackage = async (req, res) => {
  const client = await pool.connect();
  try {
    const packageId = parseInt(req.params.id, 10);
    const customerId = parseInt(req.body?.customer_id, 10);
    const method = String(req.body?.payment_method || 'wallet').toLowerCase();

    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'A customer is required' });
    }

    await client.query('BEGIN');

    const pkg = await client.query(`SELECT * FROM packages WHERE package_id = $1 AND cafe_id IS NOT DISTINCT FROM $2`,
      [packageId, req.actor?.cafe_id ?? null]);
    if (pkg.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    if (pkg.rows[0].status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That package is not on sale' });
    }

    const customer = await client.query(
      'SELECT customer_id, customer_name FROM customers WHERE customer_id = $1', [customerId]
    );
    if (customer.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const row = pkg.rows[0];
    const totalUnits = money(Number(row.units) + Number(row.bonus_units));
    const price = money(row.price);
    const expiresAt = row.validity_days
      ? new Date(Date.now() + row.validity_days * 86400000)
      : null;

    // Raise a bill so the sale shows in billing and reporting like any other.
    const seq = await client.query(`SELECT nextval('bill_number_seq') AS n`);
    const billNumber = 'CX-' + String(seq.rows[0].n).padStart(6, '0');

    const bill = await client.query(
      `INSERT INTO bills (bill_number, customer_id, cafe_id, currency, created_by, subtotal, total)
       VALUES ($1::varchar, $2::int, $3::int, $4::varchar, $5::varchar, $6::numeric, $6::numeric)
       RETURNING bill_id`,
      [billNumber, customerId, req.actor?.cafe_id ?? null, row.currency, req.actor?.label || null, price]
    );
    const billId = bill.rows[0].bill_id;

    await client.query(
      `INSERT INTO bill_items (bill_id, item_type, reference_id, description, quantity, unit_price, amount)
       VALUES ($1::int, 'other', $2::int, $3::varchar, 1, $4::numeric, $4::numeric)`,
      [billId, packageId, `Package — ${row.package_name}`, price]
    );

    let paid = false;

    if (price > 0 && method === 'wallet') {
      const wallet = await client.query(
        'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE', [customerId]
      );
      const balance = wallet.rows.length ? Number(wallet.rows[0].balance) : 0;

      if (wallet.rows.length === 0 || balance < price) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Not enough in the wallet for this package',
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
         `Package ${row.package_name}`, req.actor?.label || null]
      );
      await client.query(
        `INSERT INTO payments (bill_id, customer_id, method, amount, reference, wallet_transaction_id, received_by)
         VALUES ($1,$2,'wallet',$3,$4,$5,$6)`,
        [billId, customerId, price, billNumber, ledger.rows[0].transaction_id, req.actor?.label || null]
      );
      paid = true;
    } else if (price > 0) {
      await client.query(
        `INSERT INTO payments (bill_id, customer_id, method, amount, reference, received_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [billId, customerId, method, price, billNumber, req.actor?.label || null]
      );
      paid = true;
    } else {
      paid = true;   // a free package needs no payment
    }

    await client.query(
      `UPDATE bills SET paid_amount = $1, status = $2::varchar,
                        settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE bill_id = $3`,
      [paid ? price : 0, paid ? 'PAID' : 'OPEN', billId]
    );

    const purchased = await client.query(
      `INSERT INTO customer_packages
         (customer_id, package_id, bill_id, total_units, remaining_units, price_paid, expires_at, sold_by)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7) RETURNING customer_package_id`,
      [customerId, packageId, billId, totalUnits, price, expiresAt, req.actor?.label || null]
    );

    await client.query('COMMIT');

    const full = await client.query(
      `${SELECT_CUSTOMER_PACKAGE} WHERE cp.customer_package_id = $1`,
      [purchased.rows[0].customer_package_id]
    );

    res.status(201).json({
      success: true,
      message: `${row.package_name} sold to ${customer.rows[0].customer_name}`,
      data: shapeCustomerPackage(full.rows[0]),
      bill: { bill_id: billId, bill_number: billNumber, total: price }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error selling package:', error);
    res.status(500).json({ success: false, message: 'Error selling package' });
  } finally {
    client.release();
  }
};

/*
 * GET /api/packages/catalog — what a signed-in customer could buy themselves.
 * POST /api/packages/:id/purchase-self — buy one, paid from their own wallet.
 *
 * Thin wrappers around the staff-facing listPackages/purchasePackage rather
 * than a second copy of that logic: a customer is never trusted to name their
 * own café or pay any way but their own wallet, so this resolves both from
 * the token and their own row, then hands off to the exact same code path
 * staff selling a package already goes through.
 */
export const listPackagesCatalog = async (req, res) => {
  const customerId = Number(req.actor?.customer_id);
  if (!customerId) return res.status(400).json({ success: false, message: 'Sign in required' });
  const customer = await pool.query('SELECT cafe_id FROM customers WHERE customer_id = $1', [customerId]);
  if (!customer.rows.length) return res.status(404).json({ success: false, message: 'Customer not found' });

  req.actor = { ...req.actor, cafe_id: customer.rows[0].cafe_id };
  req.query = { ...req.query, status: 'ACTIVE' };
  return listPackages(req, res);
};

export const purchasePackageSelf = async (req, res) => {
  const customerId = Number(req.actor?.customer_id);
  if (!customerId) return res.status(400).json({ success: false, message: 'Sign in required' });
  const customer = await pool.query('SELECT cafe_id FROM customers WHERE customer_id = $1', [customerId]);
  if (!customer.rows.length) return res.status(404).json({ success: false, message: 'Customer not found' });

  req.actor = { ...req.actor, cafe_id: customer.rows[0].cafe_id };
  // Never the body's word for who is paying or how — a customer buying for
  // themselves always pays from their own wallet, never cash they didn't hand
  // anyone, and never another customer's account.
  req.body = { ...req.body, customer_id: customerId, payment_method: 'wallet' };
  return purchasePackage(req, res);
};

// GET /api/packages/customer/:customerId
export const listCustomerPackages = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    if (!req.actor?.isStaff && Number(req.actor?.customer_id) !== customerId) {
      return res.status(403).json({ success: false, message: 'You can only view your own packages' });
    }

    // Expire anything past its date before reading, so the list is truthful.
    await pool.query(
      `UPDATE customer_packages SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $1 AND status = 'ACTIVE'
         AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`,
      [customerId]
    );

    const result = await pool.query(
      `${SELECT_CUSTOMER_PACKAGE} WHERE cp.customer_id = $1
       ORDER BY CASE WHEN cp.status = 'ACTIVE' THEN 0 ELSE 1 END, cp.purchased_at DESC`,
      [customerId]
    );

    res.status(200).json({ success: true, data: result.rows.map(shapeCustomerPackage) });
  } catch (error) {
    console.error('Error listing customer packages:', error);
    res.status(500).json({ success: false, message: 'Error fetching packages' });
  }
};

// POST /api/packages/customer-package/:id/consume   { units }
export const consumeUnits = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const units = Number(req.body?.units);
    if (!Number.isFinite(units) || units <= 0) {
      return res.status(400).json({ success: false, message: 'Units must be greater than zero' });
    }

    await client.query('BEGIN');
    const held = await client.query(
      'SELECT * FROM customer_packages WHERE customer_package_id = $1 FOR UPDATE', [id]
    );
    if (held.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    const row = held.rows[0];
    if (row.status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `That package is ${row.status.toLowerCase()}` });
    }
    if (Number(row.remaining_units) < units) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Not enough left on this package',
        data: { remaining: money(row.remaining_units), requested: money(units) }
      });
    }

    const remaining = money(Number(row.remaining_units) - units);
    // $1 is both assigned and compared, so it needs an explicit type or
    // Postgres deduces two conflicting ones and rejects the statement.
    await client.query(
      `UPDATE customer_packages
       SET remaining_units = $1::numeric,
           status = CASE WHEN $1::numeric <= 0 THEN 'EXHAUSTED' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE customer_package_id = $2`,
      [remaining, id]
    );
    await client.query('COMMIT');

    const full = await client.query(`${SELECT_CUSTOMER_PACKAGE} WHERE cp.customer_package_id = $1`, [id]);
    res.status(200).json({
      success: true,
      message: `${money(units)} used`,
      data: shapeCustomerPackage(full.rows[0])
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error consuming package units:', error);
    res.status(500).json({ success: false, message: 'Error updating package' });
  } finally {
    client.release();
  }
};

// POST /api/packages/customer-package/:id/cancel
export const cancelCustomerPackage = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE customer_packages SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE customer_package_id = $1 AND status = 'ACTIVE' RETURNING customer_package_id`,
      [parseInt(req.params.id, 10)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No active package with that id' });
    }
    res.status(200).json({ success: true, message: 'Package cancelled' });
  } catch (error) {
    console.error('Error cancelling package:', error);
    res.status(500).json({ success: false, message: 'Error cancelling package' });
  }
};
