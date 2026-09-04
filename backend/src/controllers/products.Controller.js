import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import fs from 'fs/promises';
import path from 'path';
import { optimizeLogo } from '../middleware/catalogAssetUpload.js';

/*
 * Products, categories and stock.
 *
 * stock_quantity is the live count; stock_movements is the append-only ledger
 * explaining how it got there. Every write to the count goes through
 * applyMovement so the two can never drift apart.
 */

const STATUSES = ['ACTIVE', 'INACTIVE'];
const KINDS = ['FNB', 'SHOP'];
const money = (v) => Number(Number(v || 0).toFixed(2));

const shapeCategory = (row) => ({
  category_id: row.category_id,
  category_name: row.category_name,
  kind: row.kind,
  sort_order: row.sort_order,
  status: row.status,
  product_count: row.product_count === undefined ? undefined : Number(row.product_count)
});

const shapeProduct = (row) => {
  const tracks = row.track_stock !== false;
  const stock = Number(row.stock_quantity);
  const threshold = Number(row.low_stock_threshold);
  return {
    product_id: row.product_id,
    category_id: row.category_id,
    category_name: row.category_name || null,
    kind: row.kind || null,
    product_name: row.product_name,
    sku: row.sku,
    description: row.description,
    image_url: row.image_url,
    price: money(row.price),
    cost_price: row.cost_price === null ? null : money(row.cost_price),
    tax_percent: Number(row.tax_percent),
    currency: row.currency,
    track_stock: tracks,
    stock_quantity: tracks ? stock : null,
    low_stock_threshold: threshold,
    // Derived so the UI and the customer menu agree on one definition.
    stock_state: !tracks ? 'untracked'
      : stock <= 0 ? 'out'
      : stock <= threshold ? 'low'
      : 'ok',
    is_available: row.is_available,
    // What the customer actually sees: on sale, active, and in stock.
    orderable: row.is_available && row.status === 'ACTIVE' && (!tracks || stock > 0),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

/* Takes the parameter position holding the café id, because callers build
   their parameter lists differently. Every read of this table is one café's
   shelf — a product list is a price list, and a competitor's price list is
   not something to hand out. */
const selectProduct = (cafeParam) => `
  SELECT p.*, c.category_name, c.kind
  FROM products p
  LEFT JOIN product_categories c ON c.category_id = p.category_id
  WHERE p.cafe_id IS NOT DISTINCT FROM $${cafeParam}
`;

/* ==========================================================================
   CATEGORIES
   ========================================================================== */
// GET /api/products/categories
export const listCategories = async (req, res) => {
  try {
    const params = [];
    const filters = [];
    if (req.query.kind) {
      params.push(String(req.query.kind).toUpperCase());
      filters.push(`c.kind = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`c.status = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT c.*, COUNT(p.product_id)::int AS product_count
       FROM product_categories c
       LEFT JOIN products p ON p.category_id = c.category_id AND p.status = 'ACTIVE'
         AND p.cafe_id IS NOT DISTINCT FROM c.cafe_id
       ${where}
       GROUP BY c.category_id
       ORDER BY c.sort_order ASC, c.category_name ASC`,
      params
    );
    res.status(200).json({ success: true, data: result.rows.map(shapeCategory) });
  } catch (error) {
    console.error('Error listing categories:', error);
    res.status(500).json({ success: false, message: 'Error fetching categories' });
  }
};

// POST /api/products/categories
export const createCategory = async (req, res) => {
  try {
    const name = (req.body?.category_name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'A category name is required' });

    const kind = KINDS.includes(String(req.body?.kind || '').toUpperCase())
      ? String(req.body.kind).toUpperCase() : 'FNB';

    const result = await pool.query(
      `INSERT INTO product_categories (category_name, kind, sort_order, cafe_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, kind, parseInt(req.body?.sort_order, 10) || 0, req.actor?.cafe_id ?? null]
    );
    res.status(201).json({ success: true, message: 'Category created', data: shapeCategory(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That category already exists' });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ success: false, message: 'Error creating category' });
  }
};

// PUT /api/products/categories/:id
export const updateCategory = async (req, res) => {
  try {
    const name = (req.body?.category_name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'A category name is required' });

    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase() : null;

    const result = await pool.query(
      `UPDATE product_categories
       SET category_name = $1, kind = COALESCE($2::varchar, kind),
           sort_order = COALESCE($3::int, sort_order),
           status = COALESCE($4::varchar, status), updated_at = CURRENT_TIMESTAMP
       WHERE category_id = $5 RETURNING *`,
      [name,
       KINDS.includes(String(req.body?.kind || '').toUpperCase()) ? String(req.body.kind).toUpperCase() : null,
       req.body?.sort_order === undefined ? null : parseInt(req.body.sort_order, 10),
       status, parseInt(req.params.id, 10)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.status(200).json({ success: true, message: 'Category updated', data: shapeCategory(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That category already exists' });
    }
    console.error('Error updating category:', error);
    res.status(500).json({ success: false, message: 'Error updating category' });
  }
};

// DELETE /api/products/categories/:id
export const deleteCategory = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const used = await pool.query(`SELECT COUNT(*)::int AS count FROM products
        WHERE category_id = $1 AND cafe_id IS NOT DISTINCT FROM $2`,
      [id, req.actor?.cafe_id ?? null]);
    if (used.rows[0].count > 0) {
      return res.status(409).json({
        success: false,
        message: `${used.rows[0].count} product(s) use this category. Move them first, or deactivate it.`
      });
    }
    const result = await pool.query(
      `DELETE FROM product_categories
        WHERE category_id = $1 AND cafe_id IS NOT DISTINCT FROM $2 RETURNING category_id`,
      [id, req.actor?.cafe_id ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.status(200).json({ success: true, message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, message: 'Error deleting category' });
  }
};

/* ==========================================================================
   PRODUCTS
   ========================================================================== */
const validateProduct = (body) => {
  const name = (body.product_name || '').trim();
  if (!name) return { error: 'A product name is required' };

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be zero or more' };

  const cost = body.cost_price === undefined || body.cost_price === null || body.cost_price === ''
    ? null : Number(body.cost_price);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    return { error: 'Cost price must be zero or more' };
  }

  const tax = body.tax_percent === undefined || body.tax_percent === '' ? 0 : Number(body.tax_percent);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
    return { error: 'Tax must be between 0 and 100 percent' };
  }

  const threshold = body.low_stock_threshold === undefined || body.low_stock_threshold === ''
    ? 5 : Number(body.low_stock_threshold);
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { error: 'Low-stock threshold cannot be negative' };
  }

  return {
    name, price: money(price), cost: cost === null ? null : money(cost),
    tax: Number(tax.toFixed(2)), threshold: money(threshold),
    sku: body.sku ? String(body.sku).trim().slice(0, 64) : null,
    trackStock: body.track_stock === undefined ? true : !!body.track_stock,
    isAvailable: body.is_available === undefined ? true : !!body.is_available
  };
};

// GET /api/products
export const listProducts = async (req, res) => {
  try {
    const filters = [];
    /* $1 is always the café — selectProduct's WHERE reads it, and the
       optional filters below append from $2 onwards. */
    const params = [req.actor?.cafe_id ?? null];

    if (req.query.category_id) {
      params.push(parseInt(req.query.category_id, 10));
      filters.push(`p.category_id = $${params.length}`);
    }
    if (req.query.kind) {
      params.push(String(req.query.kind).toUpperCase());
      filters.push(`c.kind = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      filters.push(`p.status = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`(p.product_name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }
    if (req.query.low_stock === 'true') {
      filters.push(`p.track_stock = TRUE AND p.stock_quantity <= p.low_stock_threshold`);
    }

    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const result = await pool.query(
      `${selectProduct(1)} ${where} ORDER BY c.sort_order ASC NULLS LAST, p.product_name ASC`,
      params
    );

    res.status(200).json({ success: true, data: result.rows.map(shapeProduct) });
  } catch (error) {
    console.error('Error listing products:', error);
    res.status(500).json({ success: false, message: 'Error fetching products' });
  }
};

/**
 * GET /api/products/menu — what a customer may order right now.
 * Grouped by category, and only orderable items are returned, so the client
 * cannot show something that would be rejected on submit.
 */
export const customerMenu = async (req, res) => {
  try {
    const kind = KINDS.includes(String(req.query.kind || '').toUpperCase())
      ? String(req.query.kind).toUpperCase() : 'FNB';

    /*
     * Which café's menu.
     *
     * A staff token carries the café. A customer's does not — they belong to
     * a café through their own record, which is where this looks. Somebody
     * with neither sees nothing rather than everything: an empty menu is a
     * confusing screen, but another café's menu is a leak.
     */
    let menuCafeId = req.actor?.cafe_id ?? null;
    if (menuCafeId === null && req.actor?.customer_id) {
      const owner = await pool.query(
        'SELECT cafe_id FROM customers WHERE customer_id = $1', [req.actor.customer_id]);
      menuCafeId = owner.rows[0]?.cafe_id ?? null;
    }

    const result = await pool.query(
      `${selectProduct(1)}
         AND p.status = 'ACTIVE' AND p.is_available = TRUE
         AND (p.track_stock = FALSE OR p.stock_quantity > 0)
         AND (c.kind = $2 OR c.kind IS NULL)
         AND (c.status = 'ACTIVE' OR c.category_id IS NULL)
       ORDER BY c.sort_order ASC NULLS LAST, p.product_name ASC`,
      [menuCafeId, kind]
    );

    const grouped = {};
    result.rows.map(shapeProduct).forEach((p) => {
      const key = p.category_name || 'Other';
      (grouped[key] = grouped[key] || []).push(p);
    });

    res.status(200).json({
      success: true,
      data: result.rows.map(shapeProduct),
      grouped,
      categories: Object.keys(grouped)
    });
  } catch (error) {
    console.error('Error building menu:', error);
    res.status(500).json({ success: false, message: 'Error fetching menu' });
  }
};

/*
 * POST /api/products/upload-image — multipart, field name "image".
 *
 * Standalone rather than tied to a product id, because a brand-new product
 * doesn't have one yet: staff pick a file while filling in the create form,
 * this hands back the URL to include in that same create/update payload —
 * the same two-step a browser file input already implies, just against our
 * own storage instead of asking staff to host the picture themselves and
 * paste a link.
 */
export const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image was uploaded' });
    const optimizedName = `optimized-${path.basename(req.file.filename, path.extname(req.file.filename))}.png`;
    const optimizedPath = path.join(path.dirname(req.file.path), optimizedName);
    await optimizeLogo(req.file.path, optimizedPath);
    res.json({ success: true, data: { image_url: `/uploads/${optimizedName}` } });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    console.error('Product image upload failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that image' });
  }
};

// POST /api/products
export const createProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const parsed = validateProduct(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const currency = await getSetting('wallet.currency', 'XP');
    const openingStock = Number(req.body?.stock_quantity || 0);

    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO products (category_id, product_name, sku, description, image_url,
                             price, cost_price, tax_percent, currency, track_stock,
                             stock_quantity, low_stock_threshold, is_available, cafe_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING product_id`,
      [
        req.body?.category_id || null, parsed.name, parsed.sku,
        req.body?.description || null, req.body?.image_url || null,
        parsed.price, parsed.cost, parsed.tax, currency, parsed.trackStock,
        parsed.trackStock ? money(openingStock) : 0, parsed.threshold, parsed.isAvailable,
        req.actor?.cafe_id ?? null
      ]
    );
    const productId = inserted.rows[0].product_id;

    // Opening stock is a ledger entry too, so the count always has a history.
    if (parsed.trackStock && openingStock > 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, direction, quantity, stock_after, reason, note, performed_by)
         VALUES ($1,'in',$2,$2,'opening','Opening stock',$3)`,
        [productId, money(openingStock), req.actor?.label || null]
      );
    }

    await client.query('COMMIT');

    const full = await client.query(`${selectProduct(2)} AND p.product_id = $1`, [productId, req.actor?.cafe_id ?? null]);
    res.status(201).json({ success: true, message: 'Product created', data: shapeProduct(full.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That SKU is already in use' });
    }
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: 'Error creating product' });
  } finally {
    client.release();
  }
};

// PUT /api/products/:id
export const updateProduct = async (req, res) => {
  try {
    const parsed = validateProduct(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const status = STATUSES.includes(String(req.body?.status || '').toUpperCase())
      ? String(req.body.status).toUpperCase() : null;

    // Stock is deliberately not editable here — it moves only through the
    // inventory endpoints, so the ledger stays complete.
    const result = await pool.query(
      `UPDATE products
       SET category_id = $1, product_name = $2, sku = $3, description = $4, image_url = $5,
           price = $6, cost_price = $7, tax_percent = $8, track_stock = $9,
           low_stock_threshold = $10, is_available = $11,
           status = COALESCE($12::varchar, status), updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $13 AND cafe_id IS NOT DISTINCT FROM $14
       RETURNING product_id`,
      [
        req.body?.category_id || null, parsed.name, parsed.sku,
        req.body?.description || null, req.body?.image_url || null,
        parsed.price, parsed.cost, parsed.tax, parsed.trackStock,
        parsed.threshold, parsed.isAvailable, status, parseInt(req.params.id, 10),
        req.actor?.cafe_id ?? null
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const full = await pool.query(`${selectProduct(2)} AND p.product_id = $1`, [result.rows[0].product_id, req.actor?.cafe_id ?? null]);
    res.status(200).json({ success: true, message: 'Product updated', data: shapeProduct(full.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That SKU is already in use' });
    }
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: 'Error updating product' });
  }
};

// PATCH /api/products/:id/availability   { is_available }
export const setAvailability = async (req, res) => {
  try {
    const available = !!req.body?.is_available;
    const result = await pool.query(
      `UPDATE products SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $2 AND cafe_id IS NOT DISTINCT FROM $3 RETURNING product_id`,
      [available, parseInt(req.params.id, 10), req.actor?.cafe_id ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    const full = await pool.query(`${selectProduct(2)} AND p.product_id = $1`, [result.rows[0].product_id, req.actor?.cafe_id ?? null]);
    res.status(200).json({
      success: true,
      message: available ? 'Product is now on the menu' : 'Product hidden from the menu',
      data: shapeProduct(full.rows[0])
    });
  } catch (error) {
    console.error('Error updating availability:', error);
    res.status(500).json({ success: false, message: 'Error updating availability' });
  }
};

// DELETE /api/products/:id
export const deleteProduct = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ordered = await pool.query(
      'SELECT COUNT(*)::int AS count FROM order_items WHERE product_id = $1', [id]
    );
    // Deleting would rewrite order history, so deactivating is the answer.
    if (ordered.rows[0].count > 0) {
      return res.status(409).json({
        success: false,
        message: `This product appears on ${ordered.rows[0].count} order(s). Deactivate it instead.`
      });
    }
    const result = await pool.query(`DELETE FROM products WHERE product_id = $1 AND cafe_id IS NOT DISTINCT FROM $2
        RETURNING product_id`, [id, req.actor?.cafe_id ?? null]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.status(200).json({ success: true, message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Error deleting product' });
  }
};

/* ==========================================================================
   STOCK
   ========================================================================== */
/**
 * Move stock and write the ledger entry in one transaction. Exported so the
 * order controller can deduct stock on the same connection.
 */
export const applyMovement = async (client, { productId, direction, quantity, reason, referenceId, note, actor }) => {
  const product = await client.query(
    'SELECT * FROM products WHERE product_id = $1 FOR UPDATE', [productId]
  );
  if (product.rows.length === 0) return { error: 'Product not found', status: 404 };
  if (product.rows[0].track_stock === false) return { skipped: true, product: product.rows[0] };

  const current = Number(product.rows[0].stock_quantity);
  const next = direction === 'in'
    ? money(current + quantity)
    : money(current - quantity);

  if (next < 0) {
    return {
      error: `Only ${current} of ${product.rows[0].product_name} left`,
      status: 409
    };
  }

  await client.query(
    'UPDATE products SET stock_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
    [next, productId]
  );
  await client.query(
    `INSERT INTO stock_movements (product_id, direction, quantity, stock_after, reason, reference_id, note, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [productId, direction, money(quantity), next, reason || 'adjustment', referenceId || null,
     note || null, actor || null]
  );

  return { stock_after: next, product: product.rows[0] };
};

// POST /api/products/:id/stock   { direction, quantity, note }
export const adjustStock = async (req, res) => {
  const client = await pool.connect();
  try {
    const productId = parseInt(req.params.id, 10);
    const direction = String(req.body?.direction || '').toLowerCase();
    const quantity = Number(req.body?.quantity);

    if (!['in', 'out'].includes(direction)) {
      return res.status(400).json({ success: false, message: 'Direction must be in or out' });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than zero' });
    }

    await client.query('BEGIN');
    const outcome = await applyMovement(client, {
      productId, direction, quantity,
      reason: req.body?.reason || (direction === 'in' ? 'restock' : 'adjustment'),
      note: req.body?.note, actor: req.actor?.label
    });

    if (outcome.error) {
      await client.query('ROLLBACK');
      return res.status(outcome.status || 400).json({ success: false, message: outcome.error });
    }
    if (outcome.skipped) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'This product does not track stock' });
    }

    await client.query('COMMIT');

    const full = await client.query(`${selectProduct(2)} AND p.product_id = $1`, [productId, req.actor?.cafe_id ?? null]);
    res.status(200).json({
      success: true,
      message: `Stock ${direction === 'in' ? 'added' : 'removed'}`,
      data: shapeProduct(full.rows[0])
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error adjusting stock:', error);
    res.status(500).json({ success: false, message: 'Error adjusting stock' });
  } finally {
    client.release();
  }
};

// GET /api/products/:id/movements
export const listMovements = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM stock_movements WHERE product_id = $1
       ORDER BY created_at DESC, movement_id DESC LIMIT 50`,
      [parseInt(req.params.id, 10)]
    );
    res.status(200).json({
      success: true,
      data: result.rows.map((r) => ({
        movement_id: r.movement_id,
        direction: r.direction,
        quantity: Number(r.quantity),
        stock_after: Number(r.stock_after),
        reason: r.reason,
        note: r.note,
        performed_by: r.performed_by,
        created_at: r.created_at
      }))
    });
  } catch (error) {
    console.error('Error listing movements:', error);
    res.status(500).json({ success: false, message: 'Error fetching movements' });
  }
};

// GET /api/products/inventory/summary
export const inventorySummary = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE track_stock)::int AS tracked,
         COUNT(*) FILTER (WHERE track_stock AND stock_quantity <= 0)::int AS out_of_stock,
         COUNT(*) FILTER (WHERE track_stock AND stock_quantity > 0
                            AND stock_quantity <= low_stock_threshold)::int AS low_stock,
         COALESCE(SUM(stock_quantity * COALESCE(cost_price, 0)) FILTER (WHERE track_stock), 0) AS stock_value
       FROM products WHERE status = 'ACTIVE'`
    );
    const row = result.rows[0];
    res.status(200).json({
      success: true,
      data: {
        tracked: row.tracked,
        out_of_stock: row.out_of_stock,
        low_stock: row.low_stock,
        stock_value: money(row.stock_value)
      }
    });
  } catch (error) {
    console.error('Error building inventory summary:', error);
    res.status(500).json({ success: false, message: 'Error fetching summary' });
  }
};
