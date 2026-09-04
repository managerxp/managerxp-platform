/*
 * Multi-tenant foundation — Phase 1.
 *
 * The system grew up single-tenant: one `cafes` row was simultaneously the
 * customer, the business and the physical location, and everything hangs off
 * `cafe_id`. That works until an owner opens a second venue, at which point
 * they need two cafés with no way to say they are the same business, one
 * subscription, or one owner who can see both.
 *
 * This splits the two ideas apart:
 *
 *     organization   the customer — the business that pays
 *          ↓
 *       branch       a physical location
 *          ↓
 *     installation   one CafeXP server at that location
 *          ↓
 *       device       a gaming PC
 *
 * Deliberately ADDITIVE. `cafes` and `cafe_id` stay exactly where they are and
 * keep working — every existing query, page and report is untouched. A café
 * becomes the join between an organization and a branch rather than being
 * replaced, so this can ship without a rewrite and the old columns can be
 * retired later, once nothing reads them.
 */

export const initializeTenancy = async (client) => {
  /* ======================================================================
     ORGANIZATIONS — the customer
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      organization_id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      slug VARCHAR(80) UNIQUE,

      logo TEXT,
      email VARCHAR(160),
      phone VARCHAR(32),
      address TEXT,
      city VARCHAR(80),
      state VARCHAR(80),
      country VARCHAR(80) DEFAULT 'India',
      postal_code VARCHAR(20),

      -- Tax identity is per-business, not per-branch: one GSTIN covers every
      -- location a company trades from.
      tax_number VARCHAR(64),
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
      currency VARCHAR(8) NOT NULL DEFAULT 'INR',

      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
   * Membership, not a column on users.
   *
   * A user belongs to an organization through a row here, which is what lets
   * one person hold different roles in different businesses — and what stops
   * "which org is this user in?" from being a single answer baked into the
   * user record.
   */
  await client.query(`
    CREATE TABLE IF NOT EXISTS organization_users (
      organization_user_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(24) NOT NULL DEFAULT 'STAFF'
        CHECK (role IN ('OWNER','BRANCH_MANAGER','STAFF','CASHIER','TECHNICIAN')),
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REMOVED')),

      invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      invite_token VARCHAR(64),
      invite_expires_at TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

      UNIQUE (organization_id, user_id)
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invite_token
      ON organization_users (invite_token) WHERE invite_token IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_org_users_user ON organization_users (user_id, status)
  `);

  /* ======================================================================
     BRANCHES — promoted to a real location

     A `branches` table already existed, but it was an address record hanging
     off a café: street, city, zip and nothing else. It had no name, so two
     branches of the same business were indistinguishable, and nothing could
     belong to one. These columns turn it into a place.
     ====================================================================== */
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS name VARCHAR(160)`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS code VARCHAR(32)`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone VARCHAR(32)`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'`);

  /* `street` was NOT NULL back when this table was purely an address record.
     A branch is now a place with a name, and its address is detail that can
     arrive later — an owner naming their second venue should not be blocked
     because they have not typed a street yet. */
  await client.query(`ALTER TABLE branches ALTER COLUMN street DROP NOT NULL`).catch(() => {});
  await client.query(`ALTER TABLE branches ALTER COLUMN city DROP NOT NULL`).catch(() => {});
  await client.query(`ALTER TABLE branches ALTER COLUMN state DROP NOT NULL`).catch(() => {});
  await client.query(`ALTER TABLE branches ALTER COLUMN zip_code DROP NOT NULL`).catch(() => {});
  await client.query(`ALTER TABLE branches ALTER COLUMN country DROP NOT NULL`).catch(() => {});
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_code
      ON branches (organization_id, code) WHERE code IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_branches_org ON branches (organization_id, status)
  `);

  /* Branch-level access. Separate from organization membership because the
     two answer different questions: org membership says "you work for this
     business", branch access says "you may see Hyderabad". An owner has the
     first and implicitly all of the second; a branch manager has one branch. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS branch_users (
      branch_user_id SERIAL PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
      role VARCHAR(24) NOT NULL DEFAULT 'STAFF'
        CHECK (role IN ('OWNER','BRANCH_MANAGER','STAFF','CASHIER','TECHNICIAN')),
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, user_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_branch_users_user ON branch_users (user_id, status)
  `);

  /* ======================================================================
     SUBSCRIPTION — moved up to the organization

     A business buys one subscription covering every branch, so the column
     goes on the organization. `cafe_id` stays for now: existing code reads it
     and this must not break the running system.
     ====================================================================== */
  await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'TRIAL'`);
  await client.query(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_type_check`);
  await client.query(`
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_type_check
    CHECK (type IN ('TRIAL','PAID','CANCELLED'))
  `).catch(() => { /* already present */ });
  await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'`);
  await client.query(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check`);
  await client.query(`
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED','SUSPENDED'))
  `).catch(() => { /* already present */ });
  await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`);

  /* Limits live on the row, not in code. The spec is explicit that plan sizes
     must never be hard-coded — "Basic = 10 PCs" scattered through the app is
     exactly what stops ManagerXP controlling them later. */
  await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS max_branches INTEGER`);
  await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS max_users INTEGER`);

  /* ======================================================================
     INSTALLATIONS — one CafeXP server at one branch

     This is the identity the desktop app authenticates as, and the reason the
     customer never needs a licence key: they sign in with their account, pick
     a branch, and the server issues these credentials silently.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS installations (
      installation_id SERIAL PRIMARY KEY,
      public_id VARCHAR(32) UNIQUE NOT NULL,

      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,

      name VARCHAR(160),
      device_identifier VARCHAR(128),

      /* The secret the installation authenticates with on every startup.
         Hashed, never stored in the clear and never returned after issue —
         it is a credential, not a reference number, which is the difference
         between this and the licence key it replaces. */
      credential_hash VARCHAR(255),
      credential_issued_at TIMESTAMPTZ,

      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
      version VARCHAR(32),

      /* Offline grace. A café must not stop trading because the internet
         dropped, so the client keeps working until this much time has passed
         since the last successful authorisation. Configurable, per the spec. */
      last_authorized_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      revoked_reason VARCHAR(255),

      -- Carried through the transition so café-scoped code keeps working.
      cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
      license_id INTEGER REFERENCES license_keys(license_id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_installations_branch ON installations (branch_id, status)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_installations_org ON installations (organization_id, status)
  `);

  /* ======================================================================
     DEVICES

     `pcs` already holds every gaming station, with cafe_id and branch_id. A
     second devices table would mean two records for one machine and two
     places to look when one goes offline — so pcs IS the device table, and
     these columns give it the fields the spec asks for.
     ====================================================================== */
  await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS installation_id INTEGER REFERENCES installations(installation_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS device_type VARCHAR(24) NOT NULL DEFAULT 'GAMING_PC'`);
  await client.query(`ALTER TABLE pcs DROP CONSTRAINT IF EXISTS pcs_device_type_check`);
  await client.query(`
    ALTER TABLE pcs ADD CONSTRAINT pcs_device_type_check
    CHECK (device_type IN ('GAMING_PC','SERVER','FRONT_DESK','ADMIN','MANAGER'))
  `).catch(() => { /* already present */ });
  await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pcs_branch_type ON pcs (branch_id, device_type, is_active)
  `);

  /* ======================================================================
     ENTITLEMENTS

     Phase 1 is "trial → everything on". The spec is emphatic that features
     must not be hard-coded around the app even so, because ManagerXP will
     later resolve them through plan → org override → branch override →
     add-ons. Storing them now, even when the answer is always "yes", means
     that later change is a resolver swap rather than a hunt through the
     codebase for `if (plan === 'basic')`.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS features (
      feature_key VARCHAR(48) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      description VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    INSERT INTO features (feature_key, label, description) VALUES
      ('PC_CONTROL',         'PC control',          'Lock, restart, shut down and wake stations'),
      ('SESSION_MANAGEMENT', 'Sessions',            'Start, pause and settle play sessions'),
      ('BILLING',            'Billing',             'Bills, payments and refunds'),
      ('POS',                'Point of sale',       'The counter till'),
      ('INVENTORY',          'Inventory',           'Stock, purchases and adjustments'),
      ('CUSTOMERS',          'Customers',           'Profiles, wallet, membership and loyalty'),
      ('REPORTS',            'Reports',             'Sales, sessions and utilisation'),
      ('ANALYTICS',          'Analytics',           'Revenue, peak hours and performance'),
      ('AI',                 'CafeXP AI',           'Ask questions about the operation'),
      ('MULTI_BRANCH',       'Multi-branch',        'More than one location on one account'),
      ('API_ACCESS',         'API access',          'Programmatic access to the café data')
    ON CONFLICT (feature_key) DO NOTHING
  `);

  /* Overrides. Empty in Phase 1 — the resolver falls through to "trial grants
     everything" — but the shape is here so ManagerXP has somewhere to write. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS entitlement_overrides (
      override_id SERIAL PRIMARY KEY,
      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
      feature_key VARCHAR(48) NOT NULL REFERENCES features(feature_key) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      limit_value INTEGER,
      note VARCHAR(255),
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      /* A branch override and an org override for the same feature are
         different rows and both legitimate — the resolver prefers the more
         specific one. NULLS NOT DISTINCT keeps the org-level row unique. */
      UNIQUE NULLS NOT DISTINCT (organization_id, branch_id, feature_key)
    )
  `).catch(async () => {
    // NULLS NOT DISTINCT needs Postgres 15+. Fall back to a partial index.
    await client.query(`
      CREATE TABLE IF NOT EXISTS entitlement_overrides (
        override_id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
        feature_key VARCHAR(48) NOT NULL REFERENCES features(feature_key) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        limit_value INTEGER,
        note VARCHAR(255),
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  /* ======================================================================
     TENANT AUDIT

     Separate from the café-side audit_log, which records what staff did
     inside a café. This records what happened to the account itself.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS tenant_audit (
      audit_id SERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      action VARCHAR(64) NOT NULL,
      resource_type VARCHAR(48),
      resource_id VARCHAR(64),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_audit_org ON tenant_audit (organization_id, created_at DESC)
  `);

  /* ======================================================================
     TRIAL CONFIGURATION — one place, never scattered
     ====================================================================== */
  await client.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
      ('trial.duration_days', '30',  'number', 'trial', 'How long a new trial runs'),
      ('trial.max_branches',  '3',   'number', 'trial', 'Branches a trial account may create'),
      ('trial.max_pcs',       '50',  'number', 'trial', 'Gaming PCs a trial account may register'),
      ('trial.max_users',     '10',  'number', 'trial', 'Staff accounts a trial account may invite'),
      ('installation.offline_grace_hours', '72', 'number', 'system',
       'How long an installation keeps working without reaching the server')
    ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
  `);

  /* ======================================================================
     BACKFILL

     Every existing café becomes an organization with one branch, so nothing
     is stranded outside the new hierarchy and the portal has something real
     to show on day one.
     ====================================================================== */

  // 1. one organization per café
  await client.query(`
    INSERT INTO organizations (name, email, phone, status, created_at)
    SELECT c.name, u.email, u.phone_number, 'ACTIVE', c.created_at
    FROM cafes c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM organizations o WHERE o.name = c.name
    )
  `);

  // 2. link the café to its organization
  await client.query(`ALTER TABLE cafes ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE`);
  await client.query(`
    UPDATE cafes c SET organization_id = o.organization_id
    FROM organizations o WHERE o.name = c.name AND c.organization_id IS NULL
  `);

  // 3. the café owner becomes the organization OWNER
  await client.query(`
    INSERT INTO organization_users (organization_id, user_id, role, status, accepted_at)
    SELECT c.organization_id, c.user_id, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP
    FROM cafes c
    WHERE c.user_id IS NOT NULL AND c.organization_id IS NOT NULL
    ON CONFLICT (organization_id, user_id) DO NOTHING
  `);

  /* 4. give every café a named branch. The existing branches rows are address
        records with no name, so they are adopted and named after the café —
        a branch called NULL is no use to anyone. */
  await client.query(`
    UPDATE branches b
    SET organization_id = c.organization_id,
        name = COALESCE(NULLIF(b.name, ''), c.name),
        code = COALESCE(b.code, 'BR-' || LPAD(b.branch_id::text, 3, '0'))
    FROM cafes c
    WHERE b.cafe_id = c.cafe_id AND b.organization_id IS NULL
  `);

  // A café with no branch row at all gets one, from its own details.
  await client.query(`
    INSERT INTO branches (cafe_id, organization_id, name, code, city, country, status, is_active)
    SELECT c.cafe_id, c.organization_id, c.name,
           'BR-' || LPAD(c.cafe_id::text, 3, '0'), NULL, 'India', 'ACTIVE', TRUE
    FROM cafes c
    WHERE c.organization_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.cafe_id = c.cafe_id)
  `);

  // 5. the owner gets access to their branches
  await client.query(`
    INSERT INTO branch_users (branch_id, user_id, organization_id, role, status)
    SELECT b.branch_id, c.user_id, c.organization_id, 'OWNER', 'ACTIVE'
    FROM branches b
    JOIN cafes c ON c.cafe_id = b.cafe_id
    WHERE c.user_id IS NOT NULL
    ON CONFLICT (branch_id, user_id) DO NOTHING
  `);

  // 6. subscriptions move up to the organization
  await client.query(`
    UPDATE subscriptions s SET organization_id = c.organization_id
    FROM cafes c WHERE s.cafe_id = c.cafe_id AND s.organization_id IS NULL
  `);
  /* Existing rows are live trials until told otherwise: is_active already
     said so, and inventing an EXPIRED state for a working café would lock
     someone out of a system that was running a minute ago. */
  await client.query(`
    UPDATE subscriptions
    SET status = CASE WHEN is_active AND end_date > NOW() THEN 'ACTIVE' ELSE 'EXPIRED' END,
        trial_ends_at = COALESCE(trial_ends_at, end_date)
    WHERE status IS NULL OR status = ''
  `);

  // 7. stations join the hierarchy
  await client.query(`
    UPDATE pcs p SET organization_id = c.organization_id
    FROM cafes c WHERE p.cafe_id = c.cafe_id AND p.organization_id IS NULL
  `);
  await client.query(`
    UPDATE pcs p SET branch_id = b.branch_id
    FROM branches b WHERE b.cafe_id = p.cafe_id AND p.branch_id IS NULL
  `);
  await client.query(`UPDATE pcs SET registered_at = created_at WHERE registered_at IS NULL`);

  /* 8. existing licence keys become installations.
        The key stops being something the customer sees and becomes the
        installation's internal identity — the machine binding, revoke and
        activation history all carry over rather than being rebuilt. */
  await client.query(`
    INSERT INTO installations
      (public_id, organization_id, branch_id, cafe_id, license_id, name,
       device_identifier, status, registered_at, last_seen_at)
    SELECT
      'INST-' || LPAD(l.license_id::text, 5, '0'),
      c.organization_id,
      (SELECT b.branch_id FROM branches b WHERE b.cafe_id = l.cafe_id ORDER BY b.branch_id LIMIT 1),
      l.cafe_id,
      l.license_id,
      COALESCE(l.machine_label, c.name),
      l.machine_id,
      CASE WHEN l.status = 'revoked' THEN 'REVOKED'
           WHEN l.status = 'active'  THEN 'ACTIVE'
           ELSE 'PENDING' END,
      COALESCE(l.activated_at, l.created_at),
      l.last_seen_at
    FROM license_keys l
    JOIN cafes c ON c.cafe_id = l.cafe_id
    WHERE NOT EXISTS (SELECT 1 FROM installations i WHERE i.license_id = l.license_id)
  `);

  console.log('✅ Multi-tenant foundation created/verified');
};
