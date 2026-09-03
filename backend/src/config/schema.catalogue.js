/*
 * The product catalogue — modules, features, packages, add-ons.
 *
 * This is the layer the whole entitlement system was built to wait for.
 * `entitlements.service.js` already resolved through
 *
 *     plan → org override → branch override → add-ons → subscription status
 *
 * but the plan layer had no source and answered "everything". These tables are
 * that source. Nothing about the resolution order changes; it simply stops
 * being a stub.
 *
 * Two deliberate reuses, because duplicating them would create a second truth:
 *
 *   - `features` is EXTENDED, not replaced. Its eleven keys are already the
 *     foreign key target of every `entitlement_overrides` row and every
 *     `requireFeature('BILLING')` guard in the codebase. Renaming them to fit a
 *     tidier catalogue would break live data to gain nothing.
 *
 *   - `subscription_plans` is EXTENDED, not replaced by a new `plans` table.
 *     It is what `subscriptions.sub_id` points at, what the admin console
 *     already lists, and what the trial is seeded from.
 *
 * The unit of entitlement is the MODULE-level feature, never the button. The
 * spec is explicit about this: "Do not make every button a subscription
 * feature. Use permissions for detailed authorization." Capabilities like
 * "may issue a refund" live in the existing `permissions` table and are a
 * different question from "does this customer's package include Billing".
 */

export const initializeCatalogue = async (client) => {
  /* ======================================================================
     MODULES — the top of the hierarchy

     A module groups features for display: it is what becomes a sidebar
     section in CafeXP and a row group in the admin's package editor. It
     carries no entitlement of its own; a module is available when any
     feature inside it is.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS feature_modules (
      module_key VARCHAR(48) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      description VARCHAR(255),
      icon VARCHAR(48),
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    INSERT INTO feature_modules (module_key, label, description, icon, sort_order) VALUES
      ('DASHBOARD',      'Dashboard',        'Overview, notifications and quick actions', 'dashboard',   10),
      ('FLOOR',          'Floor Management', 'Floors, zones, layout and PC placement',    'floor',       20),
      ('DEVICE_CONTROL', 'Device Control',   'Lock, restart, shut down and wake stations','devices',     30),
      ('SESSIONS',       'Gaming Sessions',  'Start, extend, transfer and settle play',   'sessions',    40),
      ('BILLING',        'Billing',          'Bills, payments, refunds and receipts',     'billing',     50),
      ('FNB',            'F&B',              'Menu, orders, KOT and kitchen display',     'fnb',         60),
      ('PRODUCTS',       'Products',         'Retail catalogue and product sales',        'packages',    70),
      ('INVENTORY',      'Inventory',        'Stock, purchases, suppliers and alerts',    'inventory',   80),
      ('CUSTOMERS',      'Customers',        'Profiles and visit history',                'customers',   90),
      ('MEMBERSHIP',     'Membership',       'Membership plans and enrolments',           'membership', 100),
      ('WALLET',         'Wallet',           'Balances, top-ups and transactions',        'wallet',     110),
      ('LOYALTY',        'Loyalty',          'Points, rewards and redemption',            'sparkle',    120),
      ('REPORTS',        'Reports',          'Sales, sessions, F&B, stock and PCs',       'reports',    130),
      ('ANALYTICS',      'Analytics',        'Revenue, utilisation and peak hours',       'reports',    140),
      ('AI',             'CafeXP AI',        'Insights and recommendations',              'sparkle',    150),
      ('STAFF',          'Staff Management', 'Staff accounts, roles and shifts',          'staff',      160),
      ('MULTI_BRANCH',   'Multi Branch',     'More than one location on one account',     'branch',     170),
      ('INTEGRATIONS',   'API / Integrations','API, webhooks and third-party links',      'plug',       180),
      ('SETTINGS',       'Settings',         'Configuration and preferences',             'settings',   190)
    ON CONFLICT (module_key) DO NOTHING
  `);

  /* ======================================================================
     FEATURES — the unit of entitlement

     Extending the existing table rather than creating a parallel one. The
     eleven original keys keep their meaning and their foreign keys; they
     gain a module and a sort order, and the catalogue is filled out around
     them.
     ====================================================================== */
  await client.query(`
    ALTER TABLE features ADD COLUMN IF NOT EXISTS module_key VARCHAR(48)
      REFERENCES feature_modules(module_key) ON DELETE SET NULL
  `);
  await client.query(`ALTER TABLE features ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100`);
  /* Some features are structural — Dashboard and Settings are not something a
     café can be sold without, and a package that switched them off would be a
     broken product rather than a cheaper one. Marked so the admin editor can
     refuse to turn them off rather than letting someone discover it later. */
  await client.query(`ALTER TABLE features ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT FALSE`);

  /* Place the eleven existing keys into the new hierarchy. UPDATE, not
     INSERT: these rows already exist and are referenced elsewhere. */
  await client.query(`
    UPDATE features SET module_key = v.module_key, sort_order = v.sort_order
    FROM (VALUES
      ('PC_CONTROL',         'DEVICE_CONTROL', 30),
      ('SESSION_MANAGEMENT', 'SESSIONS',       40),
      ('BILLING',            'BILLING',        50),
      ('POS',                'BILLING',        55),
      ('INVENTORY',          'INVENTORY',      80),
      ('CUSTOMERS',          'CUSTOMERS',      90),
      ('REPORTS',            'REPORTS',       130),
      ('ANALYTICS',          'ANALYTICS',     140),
      ('AI',                 'AI',            150),
      ('MULTI_BRANCH',       'MULTI_BRANCH',  170),
      ('API_ACCESS',         'INTEGRATIONS',  180)
    ) AS v(feature_key, module_key, sort_order)
    WHERE features.feature_key = v.feature_key
  `);

  /* The features the catalogue was missing. */
  await client.query(`
    INSERT INTO features (feature_key, label, description, module_key, sort_order, is_core) VALUES
      ('DASHBOARD',   'Dashboard',        'Overview and quick actions',              'DASHBOARD',    10, TRUE),
      ('FLOOR',       'Floor management', 'Floors, zones, layout and PC placement',  'FLOOR',        20, FALSE),
      ('FNB',         'F&B',              'Menu, orders, KOT and kitchen display',   'FNB',          60, FALSE),
      ('PRODUCTS',    'Products',         'Retail catalogue and product sales',      'PRODUCTS',     70, FALSE),
      ('MEMBERSHIP',  'Membership',       'Membership plans and enrolments',         'MEMBERSHIP',  100, FALSE),
      ('WALLET',      'Wallet',           'Balances, top-ups and transactions',      'WALLET',      110, FALSE),
      ('LOYALTY',     'Loyalty',          'Points, rewards and redemption',          'LOYALTY',     120, FALSE),
      ('STAFF',       'Staff management', 'Staff accounts, roles and shifts',        'STAFF',       160, FALSE),
      ('SETTINGS',    'Settings',         'Configuration and preferences',           'SETTINGS',    190, TRUE),
      /* Booking ahead of time — the admin console's Reservations page and the
         public managerxp.com/book/:slug page a café shares with customers.
         Grouped under Sessions rather than a new module of its own: booking a
         station and running one are the same underlying thing, one before the
         customer arrives and one after. */
      ('RESERVATIONS','Reservations',     'Bookings, check-in and the public booking page', 'SESSIONS', 45, FALSE)
    ON CONFLICT (feature_key) DO NOTHING
  `);

  /* Dashboard and Settings were seeded core above; make sure a re-run that
     found them already present still marks them, since ON CONFLICT skipped. */
  await client.query(`
    UPDATE features SET is_core = TRUE WHERE feature_key IN ('DASHBOARD','SETTINGS')
  `);

  /* ======================================================================
     PACKAGE MASTER

     `subscription_plans` is the package. It predates this work and is what
     `subscriptions.sub_id` references, so it is extended in place.

     Note there is no hard delete anywhere in this file. A package that a
     subscription points at cannot be removed without destroying the record
     of what that customer actually bought — the spec says so, and so does
     the foreign key. Archiving is the operation.
     ====================================================================== */
  const planColumns = [
    `code VARCHAR(32)`,
    `status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'`,
    `max_users INTEGER`,
    `max_managers INTEGER`,
    `max_installations INTEGER`,
    `sort_order INTEGER NOT NULL DEFAULT 100`,
    `is_public BOOLEAN NOT NULL DEFAULT TRUE`,
    `archived_at TIMESTAMPTZ`
  ];
  for (const column of planColumns) {
    await client.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS ${column}`);
  }
  await client.query(`
    ALTER TABLE subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_status_check
  `);
  await client.query(`
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_status_check
      CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED'))
  `);
  /* Codes are how a package is referred to from outside the database — an
     import, a CI script, a support conversation. Backfilled from the name so
     the unique index can be created on existing rows. */
  await client.query(`
    UPDATE subscription_plans
    SET code = UPPER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '_', 'g'))
    WHERE code IS NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_plans_code
      ON subscription_plans (code) WHERE code IS NOT NULL
  `);

  /* ----------------------------------------------------------------------
     PACKAGE PRICING — one row per billing cycle

     Kept in its own table rather than four columns because a package may be
     sold in some cycles and not others, in more than one currency, and the
     set of cycles is a product decision that should not need a migration.
     ---------------------------------------------------------------------- */
  await client.query(`
    CREATE TABLE IF NOT EXISTS plan_prices (
      plan_price_id SERIAL PRIMARY KEY,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(sub_id) ON DELETE CASCADE,
      billing_period VARCHAR(16) NOT NULL
        CHECK (billing_period IN ('monthly','quarterly','half_yearly','annual')),
      currency VARCHAR(8) NOT NULL DEFAULT 'INR',
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (plan_id, billing_period, currency)
    )
  `);

  /* ----------------------------------------------------------------------
     PACKAGE FEATURE CONFIGURATION

     The matrix from the spec: which features each package includes. Absence
     of a row means "not included" — the resolver treats a missing row as
     off rather than defaulting to on, so adding a new feature to the
     catalogue never silently grants it to every existing package.
     ---------------------------------------------------------------------- */
  await client.query(`
    CREATE TABLE IF NOT EXISTS plan_features (
      plan_feature_id SERIAL PRIMARY KEY,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(sub_id) ON DELETE CASCADE,
      feature_key VARCHAR(48) NOT NULL REFERENCES features(feature_key) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      limit_value INTEGER,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (plan_id, feature_key)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_plan_features_plan ON plan_features (plan_id)
  `);

  /* ======================================================================
     ADD-ONS

     An add-on only ever GRANTS. It can switch a feature on and it can raise
     a ceiling; it can never take either away. That asymmetry is deliberate:
     it makes an add-on safe to apply in any order, and it means a billing
     mistake can over-serve a customer but never lock them out of something
     they paid for.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS addons (
      addon_id SERIAL PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(255),

      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'INR',
      billing_period VARCHAR(16) NOT NULL DEFAULT 'monthly'
        CHECK (billing_period IN ('monthly','quarterly','half_yearly','annual','one_time')),

      -- Capacity this add-on grants, per unit purchased.
      grant_pcs INTEGER NOT NULL DEFAULT 0,
      grant_branches INTEGER NOT NULL DEFAULT 0,
      grant_users INTEGER NOT NULL DEFAULT 0,
      grant_installations INTEGER NOT NULL DEFAULT 0,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS addon_features (
      addon_feature_id SERIAL PRIMARY KEY,
      addon_id INTEGER NOT NULL REFERENCES addons(addon_id) ON DELETE CASCADE,
      feature_key VARCHAR(48) NOT NULL REFERENCES features(feature_key) ON DELETE CASCADE,
      UNIQUE (addon_id, feature_key)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS subscription_addons (
      subscription_addon_id SERIAL PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(subscription_id) ON DELETE CASCADE,
      addon_id INTEGER NOT NULL REFERENCES addons(addon_id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

      -- What it cost when it was added. The add-on's list price may move; what
      -- this customer agreed to pay may not.
      price_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'INR',

      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED')),
      starts_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_subscription_addons_sub
      ON subscription_addons (subscription_id) WHERE status = 'ACTIVE'
  `);

  await client.query(`
    INSERT INTO addons (code, name, description, price, grant_pcs, grant_branches, grant_users) VALUES
      ('EXTRA_10_PCS',  'Extra 10 PCs',  'Raises the gaming PC ceiling by 10', 499, 10, 0, 0),
      ('EXTRA_BRANCH',  'Extra Branch',  'One additional location',            999,  0, 1, 0),
      ('EXTRA_5_USERS', 'Extra 5 Users', 'Five more staff accounts',           299,  0, 0, 5)
    ON CONFLICT (code) DO NOTHING
  `);
  await client.query(`
    INSERT INTO addons (code, name, description, price) VALUES
      ('AI_PRO',            'AI Pro',            'CafeXP AI insights and recommendations', 799),
      ('ADVANCED_ANALYTICS','Advanced Analytics','Revenue, utilisation and peak hours',    599),
      ('API_ACCESS',        'API Access',        'Programmatic access and webhooks',       999)
    ON CONFLICT (code) DO NOTHING
  `);
  await client.query(`
    INSERT INTO addon_features (addon_id, feature_key)
    SELECT a.addon_id, v.feature_key
    FROM (VALUES
      ('AI_PRO',             'AI'),
      ('ADVANCED_ANALYTICS', 'ANALYTICS'),
      ('API_ACCESS',         'API_ACCESS')
    ) AS v(code, feature_key)
    JOIN addons a ON a.code = v.code
    ON CONFLICT (addon_id, feature_key) DO NOTHING
  `);

  /* ======================================================================
     SUBSCRIPTION — the commercial agreement

     A package is the product definition. A subscription is what one customer
     actually agreed to, and the two must be able to disagree: a discount, a
     raised PC ceiling, a promotional price that reverts in ten months.

     Every one of these is a SNAPSHOT. If the Advanced package's price changes
     next quarter, nobody already on it wakes up to a different bill.
     ====================================================================== */
  const subscriptionColumns = [
    `billing_period VARCHAR(16)`,
    `currency VARCHAR(8) NOT NULL DEFAULT 'INR'`,
    // What the package listed at the moment of sale.
    `list_price NUMERIC(12,2)`,
    `discount_type VARCHAR(16) NOT NULL DEFAULT 'NO_DISCOUNT'`,
    `discount_value NUMERIC(12,2) NOT NULL DEFAULT 0`,
    // What the customer actually pays.
    `net_price NUMERIC(12,2)`,
    // A promotional price reverts; after this date net_price becomes price_after_promo.
    `promo_ends_at TIMESTAMPTZ`,
    `price_after_promo NUMERIC(12,2)`,
    `max_installations INTEGER`,
    `max_managers INTEGER`,
    `cancelled_at TIMESTAMPTZ`,
    `cancel_reason VARCHAR(255)`
  ];
  for (const column of subscriptionColumns) {
    await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ${column}`);
  }
  await client.query(`
    ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_discount_type_check
  `);
  await client.query(`
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_discount_type_check
      CHECK (discount_type IN ('NO_DISCOUNT','PERCENTAGE','FIXED_AMOUNT','CUSTOM_PRICE'))
  `);

  /* The full status set from the spec. The existing column was narrower;
     widening first, because a CHECK that a stored row violates is refused. */
  await client.query(`ALTER TABLE subscriptions ALTER COLUMN status TYPE VARCHAR(24)`).catch(() => {});
  await client.query(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check`);
  await client.query(`
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','GRACE_PERIOD','EXPIRED','SUSPENDED','CANCELLED'))
  `);

  /* ======================================================================
     SEED — Basic, Advanced, Elite

     The spec's matrix, as the starting configuration only. Every value here
     is editable from the admin console afterwards; none of it is referenced
     from code. Seeded with ON CONFLICT DO NOTHING so an operator's later
     edits are never overwritten by a restart.
     ====================================================================== */
  await client.query(`
    INSERT INTO subscription_plans
      (subs_software, code, name, description, status, max_branches, max_pcs, max_users,
       max_managers, max_installations, no_of_days, is_active, is_freetrial, sort_order, price, billing_period)
    VALUES
      ('cafexp', 'BASIC',    'Basic',    'One location, the essentials to trade',      'ACTIVE',  1,  20,  5,  1,  1, 30, TRUE, FALSE, 10,  799, 'monthly'),
      ('cafexp', 'ADVANCED', 'Advanced', 'Retail, stock and membership',               'ACTIVE',  1,  50, 15,  3,  1, 30, TRUE, FALSE, 20, 1499, 'monthly'),
      ('cafexp', 'ELITE',    'Elite',    'Every module, multi-branch and AI',          'ACTIVE', 10, 250, 50, 10, 10, 30, TRUE, FALSE, 30, 2999, 'monthly')
    /* The index on code is partial — code stays nullable so a legacy plan row
       is never blocked from existing. Inferring a partial index requires
       repeating its predicate here, or Postgres cannot tell which index to
       use and refuses the statement. */
    ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING
  `);

  /* Prices for each cycle. The multipliers give the usual SaaS shape — a
     longer commitment costs less per month — and are a starting point the
     admin can overwrite per package. */
  await client.query(`
    INSERT INTO plan_prices (plan_id, billing_period, currency, price)
    SELECT p.sub_id, v.billing_period, 'INR', ROUND(p.price * v.multiplier)
    FROM subscription_plans p
    CROSS JOIN (VALUES
      ('monthly',      1),
      ('quarterly',    2.85),
      ('half_yearly',  5.40),
      ('annual',      10.20)
    ) AS v(billing_period, multiplier)
    WHERE p.code IN ('BASIC','ADVANCED','ELITE')
    ON CONFLICT (plan_id, billing_period, currency) DO NOTHING
  `);

  /* The feature matrix from spec section 23. One INSERT ... SELECT rather
     than three, so the three packages cannot drift out of the same shape. */
  await client.query(`
    INSERT INTO plan_features (plan_id, feature_key, enabled)
    SELECT p.sub_id, m.feature_key,
           CASE p.code
             WHEN 'BASIC'    THEN m.basic
             WHEN 'ADVANCED' THEN m.advanced
             WHEN 'ELITE'    THEN m.elite
           END
    FROM subscription_plans p
    CROSS JOIN (VALUES
      -- feature,             BASIC,  ADVANCED, ELITE
      ('DASHBOARD',           TRUE,   TRUE,     TRUE),
      ('FLOOR',               TRUE,   TRUE,     TRUE),
      ('PC_CONTROL',          TRUE,   TRUE,     TRUE),
      ('SESSION_MANAGEMENT',  TRUE,   TRUE,     TRUE),
      ('BILLING',             TRUE,   TRUE,     TRUE),
      ('POS',                 TRUE,   TRUE,     TRUE),
      ('FNB',                 TRUE,   TRUE,     TRUE),
      ('PRODUCTS',            FALSE,  TRUE,     TRUE),
      ('INVENTORY',           FALSE,  TRUE,     TRUE),
      ('CUSTOMERS',           TRUE,   TRUE,     TRUE),
      ('MEMBERSHIP',          FALSE,  TRUE,     TRUE),
      ('WALLET',              FALSE,  TRUE,     TRUE),
      ('LOYALTY',             FALSE,  FALSE,    TRUE),
      ('REPORTS',             TRUE,   TRUE,     TRUE),
      ('ANALYTICS',           FALSE,  TRUE,     TRUE),
      ('AI',                  FALSE,  FALSE,    TRUE),
      ('STAFF',               TRUE,   TRUE,     TRUE),
      ('MULTI_BRANCH',        FALSE,  FALSE,    TRUE),
      ('API_ACCESS',          FALSE,  FALSE,    TRUE),
      ('SETTINGS',            TRUE,   TRUE,     TRUE)
    ) AS m(feature_key, basic, advanced, elite)
    WHERE p.code IN ('BASIC','ADVANCED','ELITE')
    ON CONFLICT (plan_id, feature_key) DO NOTHING
  `);

  /* The trial package grants everything, which is section 51's requirement
     expressed as data rather than as a branch in the resolver. */
  await client.query(`
    INSERT INTO plan_features (plan_id, feature_key, enabled)
    SELECT p.sub_id, f.feature_key, TRUE
    FROM subscription_plans p
    CROSS JOIN features f
    WHERE p.is_freetrial = TRUE AND f.is_active
    ON CONFLICT (plan_id, feature_key) DO NOTHING
  `);

  /* ======================================================================
     BRANCH PC ALLOCATION

     Section 29 and 33: an organization buys a pool of gaming PCs and divides
     it between locations. Hyderabad gets 50 of the 250, Bangalore 50, and so
     on. The allocation is a ceiling for that branch; the sum of them may not
     exceed what the subscription entitles.

     NULL means "no allocation set", which is not the same as zero — it means
     this branch draws on the pool without a local cap, which is the right
     default for a single-branch café and the only sane behaviour for the
     branches that already exist.
     ====================================================================== */
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS max_pcs INTEGER`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS notes VARCHAR(255)`);

  /* ======================================================================
     TRIAL DURATION

     Section 10 sets the default to 15 days. The value is a setting, not a
     constant, and it is only corrected here when it still holds the earlier
     default of 30 — an operator who deliberately chose a different number
     keeps it.
     ====================================================================== */
  await client.query(`
    UPDATE app_settings SET setting_value = '15'
    WHERE setting_key = 'trial.duration_days' AND setting_value = '30'
  `);
  await client.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
      ('trial.max_installations', '3', 'number', 'trial', 'CafeXP installations a trial account may register'),
      ('trial.plan_code', 'TRIAL', 'string', 'trial', 'Package code a new trial is issued against'),
      ('entitlements.offline_grace_hours', '72', 'number', 'entitlements',
       'How long CafeXP keeps running on its last successful authorisation')
    ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
  `);
};
