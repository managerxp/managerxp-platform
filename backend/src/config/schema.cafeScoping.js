/* ==========================================================================
   Café scoping for the tables that never had it.

   customers, products, product_categories, packages, orders, wallets and
   wallet_transactions all predate multi-tenancy. Every café on the platform
   shared one customer list, one product catalogue, one set of wallets — so a
   second café signing up would see the first café's customers by name, and
   its own till would spend their balances.

   ── Backfill ──────────────────────────────────────────────────────────────
   Ownership is traced through the records that already carry a café rather
   than assumed: a customer through the bills and sessions raised against
   them, an order through its bill or its station, a wallet through its
   customer. Anything untraceable falls to the café that actually trades —
   the one with stations on the floor — because on a single-café install that
   is provably right, and on a multi-café install there is nothing older to
   contradict it.

   ── Uniqueness ────────────────────────────────────────────────────────────
   Every unique rule here was written for one tenant and would now stop a
   second café from having a customer with a common email address, a product
   with the same SKU, or a category called "Snacks". Each becomes unique
   *within* a café, which is where it was always meant to apply.
   ========================================================================== */

const SCOPED = [
  { table: 'customers', pk: 'customer_id' },
  { table: 'product_categories', pk: 'category_id' },
  { table: 'products', pk: 'product_id' },
  { table: 'packages', pk: 'package_id' },
  { table: 'orders', pk: 'order_id' },
  { table: 'wallets', pk: 'wallet_id' },
  { table: 'wallet_transactions', pk: 'transaction_id' }
];

export const initializeCafeScoping = async (client) => {
  for (const { table } of SCOPED) {
    await client.query(`
      ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE
    `);
  }

  /* The café that actually trades, for rows nothing else can attribute. */
  const fallback = (await client.query(`
    SELECT COALESCE(
      (SELECT p.cafe_id FROM pcs p WHERE p.cafe_id IS NOT NULL
        GROUP BY p.cafe_id ORDER BY COUNT(*) DESC, p.cafe_id ASC LIMIT 1),
      (SELECT c.cafe_id FROM cafes c ORDER BY c.cafe_id ASC LIMIT 1)
    ) AS cafe_id
  `)).rows[0]?.cafe_id ?? null;

  if (fallback) {
    /* Customers: whoever they have traded with. A customer who has a bill at
       one café and a session at another is a genuine ambiguity — the oldest
       bill wins, because that is where the account was first used. */
    await client.query(`
      UPDATE customers c SET cafe_id = COALESCE(
        (SELECT b.cafe_id FROM bills b
          WHERE b.customer_id = c.customer_id AND b.cafe_id IS NOT NULL
          ORDER BY b.created_at ASC LIMIT 1),
        (SELECT s.cafe_id FROM sessions s
          WHERE s.customer_id = c.customer_id AND s.cafe_id IS NOT NULL
          ORDER BY s.created_at ASC LIMIT 1),
        $1::int
      ) WHERE c.cafe_id IS NULL
    `, [fallback]);

    // Wallets and their ledger follow the customer they belong to.
    await client.query(`
      UPDATE wallets w SET cafe_id = COALESCE(
        (SELECT c.cafe_id FROM customers c WHERE c.customer_id = w.customer_id), $1::int
      ) WHERE w.cafe_id IS NULL
    `, [fallback]);

    await client.query(`
      UPDATE wallet_transactions t SET cafe_id = COALESCE(
        (SELECT w.cafe_id FROM wallets w WHERE w.wallet_id = t.wallet_id),
        (SELECT c.cafe_id FROM customers c WHERE c.customer_id = t.customer_id),
        $1::int
      ) WHERE t.cafe_id IS NULL
    `, [fallback]);

    /* Orders: the bill they were charged to, then the station they were
       ordered from, then the session. */
    await client.query(`
      UPDATE orders o SET cafe_id = COALESCE(
        (SELECT b.cafe_id FROM bills b WHERE b.bill_id = o.bill_id),
        (SELECT p.cafe_id FROM pcs p WHERE p.pc_id = o.pc_id),
        (SELECT s.cafe_id FROM sessions s WHERE s.session_id = o.session_id),
        $1::int
      ) WHERE o.cafe_id IS NULL
    `, [fallback]);

    // The catalogue tables have nothing to trace through — they are simply
    // the trading café's, since no other café has ever been able to sell.
    for (const t of ['product_categories', 'products', 'packages']) {
      await client.query(`UPDATE ${t} SET cafe_id = $1 WHERE cafe_id IS NULL`, [fallback]);
    }
  }

  /* ── Uniqueness, re-scoped to the café ──────────────────────────────── */
  await client.query(`ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_cafe_email
      ON customers (cafe_id, LOWER(email)) WHERE email IS NOT NULL
  `);

  /* Order numbers come from one sequence, so they are unique platform-wide
     already; the index is re-scoped anyway so a café importing historical
     numbers cannot collide with a neighbour's. */
  await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_cafe_number
      ON orders (cafe_id, order_number)
  `);

  // One wallet per customer, still — but a customer now belongs to a café.
  await client.query(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_customer_id_key`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_customer
      ON wallets (customer_id)
  `);

  await client.query(`DROP INDEX IF EXISTS idx_products_sku`);
  /* Case-insensitive, as the index it replaces was — "COKE-330" and
     "coke-330" are the same shelf item, not two. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_cafe_sku
      ON products (cafe_id, LOWER(sku)) WHERE sku IS NOT NULL
  `);

  await client.query(`DROP INDEX IF EXISTS idx_product_categories_name`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_cafe_name
      ON product_categories (cafe_id, LOWER(category_name))
  `);

  await client.query(`DROP INDEX IF EXISTS idx_packages_name`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_cafe_name
      ON packages (cafe_id, LOWER(package_name))
  `);

  /*
   * A wallet's café is the customer's, always — derived here rather than at
   * the call sites.
   *
   * Wallets are opened from four different places today (a staff-created
   * walk-in, a membership starting, a payment landing, the wallet endpoint
   * itself) and nothing stops a fifth being added. Every one of them would
   * have to remember to stamp the café, and the one that forgot would create
   * a wallet belonging to nobody — invisible to the café whose customer owns
   * it, and holding real money. Deriving it in the database means it cannot
   * be forgotten.
   *
   * The same for the ledger: a transaction belongs wherever its wallet does.
   */
  await client.query(`
    CREATE OR REPLACE FUNCTION wallet_inherit_cafe() RETURNS trigger AS $$
    BEGIN
      IF NEW.cafe_id IS NULL THEN
        SELECT c.cafe_id INTO NEW.cafe_id FROM customers c
         WHERE c.customer_id = NEW.customer_id;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `);
  await client.query(`DROP TRIGGER IF EXISTS trg_wallet_inherit_cafe ON wallets`);
  await client.query(`
    CREATE TRIGGER trg_wallet_inherit_cafe
      BEFORE INSERT OR UPDATE OF customer_id ON wallets
      FOR EACH ROW EXECUTE FUNCTION wallet_inherit_cafe()
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION wallet_txn_inherit_cafe() RETURNS trigger AS $$
    BEGIN
      IF NEW.cafe_id IS NULL THEN
        SELECT w.cafe_id INTO NEW.cafe_id FROM wallets w
         WHERE w.wallet_id = NEW.wallet_id;
        IF NEW.cafe_id IS NULL THEN
          SELECT c.cafe_id INTO NEW.cafe_id FROM customers c
           WHERE c.customer_id = NEW.customer_id;
        END IF;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `);
  await client.query(`DROP TRIGGER IF EXISTS trg_wallet_txn_inherit_cafe ON wallet_transactions`);
  await client.query(`
    CREATE TRIGGER trg_wallet_txn_inherit_cafe
      BEFORE INSERT ON wallet_transactions
      FOR EACH ROW EXECUTE FUNCTION wallet_txn_inherit_cafe()
  `);

  /*
   * A customer who signed up at a station has no café until they trade.
   *
   * Self-registration from the client app cannot know which café it is —
   * the endpoint is public and the page has no token yet. Rather than guess,
   * the account is claimed by the first café that actually serves them: the
   * session or bill raised against it stamps the customer. Until then they
   * can sign in and see their own wallet, and appear on no café's list.
   */
  await client.query(`
    CREATE OR REPLACE FUNCTION customer_claim_cafe() RETURNS trigger AS $$
    BEGIN
      IF NEW.customer_id IS NOT NULL AND NEW.cafe_id IS NOT NULL THEN
        UPDATE customers SET cafe_id = NEW.cafe_id
         WHERE customer_id = NEW.customer_id AND cafe_id IS NULL;
        UPDATE wallets SET cafe_id = NEW.cafe_id
         WHERE customer_id = NEW.customer_id AND cafe_id IS NULL;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `);
  for (const t of ['sessions', 'bills']) {
    await client.query(`DROP TRIGGER IF EXISTS trg_${t}_claim_customer ON ${t}`);
    await client.query(`
      CREATE TRIGGER trg_${t}_claim_customer
        AFTER INSERT ON ${t}
        FOR EACH ROW EXECUTE FUNCTION customer_claim_cafe()
    `);
  }

  // Every read is "this café's rows", so each gets the index for it.
  for (const { table } of SCOPED) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${table}_cafe ON ${table} (cafe_id)
    `);
  }

  const counts = await client.query(`
    SELECT 'customers' AS t, COUNT(*) FILTER (WHERE cafe_id IS NULL) AS orphans FROM customers
    UNION ALL SELECT 'products', COUNT(*) FILTER (WHERE cafe_id IS NULL) FROM products
    UNION ALL SELECT 'packages', COUNT(*) FILTER (WHERE cafe_id IS NULL) FROM packages
    UNION ALL SELECT 'orders', COUNT(*) FILTER (WHERE cafe_id IS NULL) FROM orders
    UNION ALL SELECT 'wallets', COUNT(*) FILTER (WHERE cafe_id IS NULL) FROM wallets
    UNION ALL SELECT 'wallet_transactions', COUNT(*) FILTER (WHERE cafe_id IS NULL) FROM wallet_transactions
  `);
  const orphaned = counts.rows.filter((r) => Number(r.orphans) > 0);
  if (orphaned.length) {
    console.log('   ↳ still unattributed:', orphaned.map((r) => `${r.t}=${r.orphans}`).join(', '));
  }

  console.log('✅ Café scoping (customers, catalogue, wallets) created/verified');
};

export default { initializeCafeScoping };
