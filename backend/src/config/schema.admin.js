/*
 * ManagerXP administrators — the vendor's own staff.
 *
 * Until now "admin" was a *value* in the `role` column of the `users` table,
 * which is the same table every café owner lives in. That has two problems the
 * spec calls out and one it does not:
 *
 *   1. There is no way to say "this person may refund payments but may not
 *      publish software releases" — a users row carries no permission set.
 *   2. Admin identity and customer identity share a password reset flow, a
 *      rate limiter, and a token shape. Anything that widens one widens both.
 *   3. Unstated but worse: promoting a customer to platform admin is a single
 *      UPDATE on a row that customer-facing code already writes to.
 *
 * So administrators get their own table, their own tokens and their own
 * permission model. Nothing here can be reached by editing a `users` row.
 *
 * The existing `role = 'admin'` users keep working — `requirePlatformAdmin`
 * still accepts them — because cutting them off mid-flight would lock the
 * operator out of their own console. They are a deprecated path, not a
 * supported one, and the migration below seeds a real admin account from the
 * first one it finds.
 */
import bcrypt from 'bcryptjs';

/* The permission catalogue, from spec section 40. Grouped by the resource
   they act on; the resource prefix is what the role templates below fan out
   over, so adding a resource does not mean editing five role definitions. */
const PERMISSIONS = [
  ['organizations.view',    'View customers and organizations'],
  ['organizations.create',  'Create a customer'],
  ['organizations.edit',    'Edit a customer'],
  ['organizations.suspend', 'Suspend or resume a customer'],

  ['branches.view',         'View branches'],
  ['branches.edit',         'Edit branches'],

  ['packages.view',         'View packages'],
  ['packages.create',       'Create a package'],
  ['packages.edit',         'Edit a package'],

  ['features.view',         'View the feature master'],
  ['features.create',       'Create a feature'],
  ['features.edit',         'Edit a feature'],

  ['subscriptions.view',    'View subscriptions'],
  ['subscriptions.create',  'Create a subscription'],
  ['subscriptions.edit',    'Edit a subscription, its limits and overrides'],
  ['subscriptions.cancel',  'Cancel a subscription'],

  ['addons.view',           'View add-ons'],
  ['addons.edit',           'Create and edit add-ons'],

  ['payments.view',         'View payments and invoices'],
  ['payments.refund',       'Issue a refund'],

  ['installations.view',    'View CafeXP installations'],
  ['installations.revoke',  'Revoke an installation'],

  ['devices.view',          'View devices and PCs'],
  ['devices.disable',       'Disable or re-enable a device'],

  ['software.view',         'View software and releases'],
  ['software.create',       'Create a software release'],
  ['software.edit',         'Edit a software release'],
  ['software.publish',      'Publish, deprecate or retire a release'],

  /* The master Game Catalog — every title's launcher, App ID and executable.
     A café only ever selects from this; only ManagerXP staff can author it. */
  ['catalogue.view',        'View the master game catalog'],
  ['catalogue.manage',      'Create and edit the master game catalog'],

  ['support.manage',        'Manage support tickets and announcements'],

  ['admins.view',           'View ManagerXP admin users'],
  ['admins.manage',         'Create and edit ManagerXP admin users'],

  ['audit.view',            'View the audit log'],
  ['settings.edit',         'Change system settings']
];

/* Role templates. SUPER_ADMIN is deliberately absent from this map — it is
   granted everything by the resolver rather than by a list, so a permission
   added next year is not silently missing from the one role that must have
   it. */
const ROLE_GRANTS = {
  ADMIN: [
    'organizations.', 'branches.', 'packages.', 'features.', 'subscriptions.',
    'addons.', 'payments.view', 'installations.', 'devices.', 'software.view',
    'catalogue.', 'support.manage', 'audit.view',
    /* Read-only. Someone running the platform day to day should be able to see
       who else has access — that is basic operational awareness, and it is the
       first thing anyone checks after a security scare. Changing who has
       access stays `admins.manage`, which this role does not hold. */
    'admins.view'
  ],
  SUPPORT: [
    'organizations.view', 'branches.view', 'subscriptions.view', 'packages.view',
    'features.view', 'installations.view', 'devices.view', 'devices.disable',
    'software.view', 'support.manage'
  ],
  FINANCE: [
    'organizations.view', 'subscriptions.view', 'subscriptions.edit',
    'packages.view', 'payments.view', 'payments.refund', 'audit.view'
  ],
  OPERATIONS: [
    'organizations.view', 'branches.view', 'branches.edit',
    'installations.', 'devices.', 'software.', 'audit.view'
  ]
};

export const initializeAdmin = async (client) => {
  /* ======================================================================
     ROLES
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      admin_role_id SERIAL PRIMARY KEY,
      role_key VARCHAR(32) UNIQUE NOT NULL,
      label VARCHAR(80) NOT NULL,
      description VARCHAR(255),
      -- A built-in role cannot be deleted or renamed; the code refers to it.
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      -- SUPER_ADMIN holds every permission, including ones added after it was
      -- created. A flag rather than a filled-in grant list, so the set cannot
      -- go stale.
      is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    INSERT INTO admin_roles (role_key, label, description, is_system, is_superuser) VALUES
      ('SUPER_ADMIN', 'Super Admin', 'Unrestricted access, including admin management', TRUE, TRUE),
      ('ADMIN',       'Admin',       'Runs the platform day to day',                    TRUE, FALSE),
      ('SUPPORT',     'Support',     'Helps customers; cannot change commercial terms', TRUE, FALSE),
      ('FINANCE',     'Finance',     'Subscriptions, payments and refunds',             TRUE, FALSE),
      ('OPERATIONS',  'Operations',  'Installations, devices and software releases',    TRUE, FALSE)
    ON CONFLICT (role_key) DO NOTHING
  `);

  /* ======================================================================
     PERMISSIONS
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      permission_key VARCHAR(48) PRIMARY KEY,
      label VARCHAR(160) NOT NULL,
      resource VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const [key, label] of PERMISSIONS) {
    await client.query(`
      INSERT INTO admin_permissions (permission_key, label, resource)
      VALUES ($1, $2, $3) ON CONFLICT (permission_key) DO UPDATE SET label = EXCLUDED.label
    `, [key, label, key.split('.')[0]]);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_role_permissions (
      admin_role_id INTEGER NOT NULL REFERENCES admin_roles(admin_role_id) ON DELETE CASCADE,
      permission_key VARCHAR(48) NOT NULL REFERENCES admin_permissions(permission_key) ON DELETE CASCADE,
      PRIMARY KEY (admin_role_id, permission_key)
    )
  `);

  /* Fan the prefixes out into concrete grants. Idempotent, and re-running
     after a new permission is added tops up the built-in roles. */
  for (const [roleKey, prefixes] of Object.entries(ROLE_GRANTS)) {
    for (const prefix of prefixes) {
      await client.query(`
        INSERT INTO admin_role_permissions (admin_role_id, permission_key)
        SELECT r.admin_role_id, p.permission_key
        FROM admin_roles r, admin_permissions p
        WHERE r.role_key = $1
          AND (
            /* A trailing dot means "every permission on this resource".
               Parenthesised explicitly: without the inner brackets the OR
               would escape the role filter and grant the permission to every
               role in the table. */
            ($2::text LIKE '%.' AND p.resource = LEFT($2::text, LENGTH($2::text) - 1))
            OR p.permission_key = $2::text
          )
        ON CONFLICT DO NOTHING
      `, [roleKey, prefix]);
    }
  }

  /* ======================================================================
     ADMIN USERS
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      admin_user_id SERIAL PRIMARY KEY,
      email VARCHAR(160) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      admin_role_id INTEGER NOT NULL REFERENCES admin_roles(admin_role_id) ON DELETE RESTRICT,

      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED')),

      -- Rate limiting lives on the row rather than in memory so it survives a
      -- restart. An attacker who can crash the process must not get a fresh
      -- allowance for doing so.
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,

      last_login_at TIMESTAMPTZ,
      last_login_ip VARCHAR(64),

      -- Reset tokens are stored hashed. A leaked database backup should not
      -- hand over a working password reset for every administrator.
      reset_token_hash VARCHAR(128),
      reset_expires_at TIMESTAMPTZ,

      -- 2FA is not implemented; the columns exist so enabling it later is a
      -- feature, not a migration of the authentication table.
      totp_secret VARCHAR(128),
      totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,

      created_by INTEGER REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users (LOWER(email))
  `);

  /* Every sign-in attempt, successful or not. This is what answers "who
     changed that customer's package at 2am" and "is someone grinding the
     login page". */
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_login_events (
      event_id BIGSERIAL PRIMARY KEY,
      admin_user_id INTEGER REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
      -- Kept even when no account matched, which is exactly the case worth
      -- looking at.
      email_attempted VARCHAR(160),
      outcome VARCHAR(24) NOT NULL
        CHECK (outcome IN ('SUCCESS','BAD_PASSWORD','NO_SUCH_USER','LOCKED','SUSPENDED','RESET_REQUESTED','RESET_COMPLETED')),
      ip VARCHAR(64),
      user_agent VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_login_events_time
      ON admin_login_events (created_at DESC)
  `);

  /* ======================================================================
     ADMIN AUDIT

     Separate from `tenant_audit`, which records what a *customer* did inside
     their own account. This records what the vendor did to a customer, which
     is a different question asked by different people for different reasons.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      audit_id BIGSERIAL PRIMARY KEY,
      admin_user_id INTEGER REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
      admin_email VARCHAR(160),

      action VARCHAR(64) NOT NULL,
      resource_type VARCHAR(48),
      resource_id VARCHAR(64),

      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE SET NULL,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,

      -- Before and after, so a change can be read and reversed without
      -- reconstructing it from the current state.
      old_value JSONB,
      new_value JSONB,

      ip VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit (created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_org ON admin_audit (organization_id, created_at DESC)
  `);

  /* ======================================================================
     BOOTSTRAP

     A console nobody can sign in to is not a console. If there is no admin
     account, one is created from the existing legacy `users` row with
     role = 'admin' — same email, same password hash, so whoever runs this
     signs in with the credentials they already have.

     If there is no such row either, a SUPER_ADMIN is created from ADMIN_EMAIL
     with a random password that is never printed; the operator recovers it
     through the reset flow. Seeding a known default password would be worse
     than having no account at all.
     ====================================================================== */
  const existing = (await client.query('SELECT COUNT(*)::int AS n FROM admin_users')).rows[0].n;
  if (existing === 0) {
    const superRole = (await client.query(
      `SELECT admin_role_id FROM admin_roles WHERE role_key = 'SUPER_ADMIN'`
    )).rows[0];

    const legacy = (await client.query(`
      SELECT email, name, password FROM users
      WHERE role = 'admin' ORDER BY id LIMIT 1
    `)).rows[0];

    if (legacy) {
      await client.query(`
        INSERT INTO admin_users (email, name, password_hash, admin_role_id)
        VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING
      `, [legacy.email, legacy.name || 'ManagerXP Admin', legacy.password, superRole.admin_role_id]);
      console.log(`✅ ManagerXP admin seeded from existing account: ${legacy.email}`);
    } else {
      const email = process.env.ADMIN_EMAIL || 'admin@managerxp.com';
      const hash = await bcrypt.hash(`${Date.now()}-${Math.random()}`, 10);
      await client.query(`
        INSERT INTO admin_users (email, name, password_hash, admin_role_id)
        VALUES ($1,'ManagerXP Admin',$2,$3) ON CONFLICT (email) DO NOTHING
      `, [email, hash, superRole.admin_role_id]);
      console.log(`✅ ManagerXP admin created: ${email} — use "forgot password" to set a password`);
    }
  }

  /* ----------------------------------------------------------------------
     SYNC THE ENVIRONMENT CREDENTIAL

     `/api/auth/login` had a second admin path: it compared the request's
     password to process.env.ADMIN_PASSWORD with `===` and, on a match, issued
     an admin token carrying no user id. Plaintext, not timing-safe, no
     lockout, no audit, and no way to revoke it short of a redeploy.

     Retiring it cannot mean locking the operator out, so the credential is
     moved rather than deleted: an admin_users row is created for ADMIN_EMAIL
     with a bcrypt hash of ADMIN_PASSWORD. The same email and password keep
     working, but now through the path that has a lockout, an audit trail and
     a password that can be changed.

     Kept in sync on every boot, not just the first: this is a development
     credential edited directly in a text file, and a hash that silently stops
     matching the file next to it is a worse failure mode than one that stays
     current. bcrypt.compare decides whether a rehash is needed rather than
     rehashing unconditionally — hashing is deliberately slow, and comparing is
     the same cost every other sign-in already pays on every boot regardless.
     A changed password also clears any lockout, since a lockout that survives
     the very fix meant to end it helps no one.

     This can overwrite a password set through the admin console's own
     change-password screen with whatever ADMIN_PASSWORD says — acceptable
     here because this row exists FOR that env pair, but it is why this is not
     how a real production administrator's password should ever be managed.
     ---------------------------------------------------------------------- */
  const envEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const envPassword = String(process.env.ADMIN_PASSWORD || '');
  if (envEmail && envPassword) {
    const existing = (await client.query(
      'SELECT admin_user_id, password_hash FROM admin_users WHERE LOWER(email) = $1', [envEmail]
    )).rows[0];

    if (!existing) {
      const superRole = (await client.query(
        `SELECT admin_role_id FROM admin_roles WHERE role_key = 'SUPER_ADMIN'`
      )).rows[0];
      await client.query(`
        INSERT INTO admin_users (email, name, password_hash, admin_role_id)
        VALUES ($1,'ManagerXP Admin',$2,$3) ON CONFLICT (email) DO NOTHING
      `, [envEmail, await bcrypt.hash(envPassword, 10), superRole.admin_role_id]);
      console.log(`✅ ManagerXP admin created from ADMIN_EMAIL: ${envEmail}`);
    } else if (!(await bcrypt.compare(envPassword, existing.password_hash))) {
      await client.query(`
        UPDATE admin_users
        SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE admin_user_id = $1
      `, [existing.admin_user_id, await bcrypt.hash(envPassword, 10)]);
      console.log(`✅ ManagerXP admin password re-synced from ADMIN_PASSWORD: ${envEmail}`);
    }
  }

  /* Same idea, for the café-owner test account (CAFE_TEST_EMAIL/PASSWORD).
     Only resyncs an EXISTING `users` row — this does not create one, since
     that needs a cafe to scope it to, which .env has no way to say. */
  const cafeEmail = String(process.env.CAFE_TEST_EMAIL || '').trim().toLowerCase();
  const cafePassword = String(process.env.CAFE_TEST_PASSWORD || '');
  if (cafeEmail && cafePassword) {
    const cafeUser = (await client.query(
      'SELECT id, password FROM users WHERE LOWER(email) = $1', [cafeEmail]
    )).rows[0];
    if (cafeUser && !(await bcrypt.compare(cafePassword, cafeUser.password))) {
      await client.query(
        'UPDATE users SET password = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [cafeUser.id, await bcrypt.hash(cafePassword, 10)]
      );
      console.log(`✅ Café test account password re-synced from CAFE_TEST_PASSWORD: ${cafeEmail}`);
    }
  }

  /* ======================================================================
     SETTINGS the admin console owns
     ====================================================================== */
  await client.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
      ('admin.max_login_attempts', '5',  'number', 'admin', 'Failed sign-ins before an admin account locks'),
      ('admin.lockout_minutes',    '15', 'number', 'admin', 'How long an admin account stays locked'),
      ('admin.session_hours',      '8',  'number', 'admin', 'How long an admin session lasts'),
      ('usage.warn_threshold',     '80', 'number', 'usage',  'Percent of a limit at which the console warns'),
      ('subscription.grace_days',  '7',  'number', 'billing','Days a lapsed subscription keeps working')
    ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
  `);
};
