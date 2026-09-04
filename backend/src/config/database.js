import pg from 'pg';
import dotenv from './env.js';
import { initializeTenancy } from './schema.tenancy.js';
import { initializeCatalogue } from './schema.catalogue.js';
import { initializeAdmin } from './schema.admin.js';
import { initializeBilling } from './schema.billing.js';
import { initializeLocations } from './schema.locations.js';
import { initializeExpenses } from './schema.expenses.js';
import { initializePricingRules } from './schema.pricingRules.js';
import { initializeCatalogueTenancy } from './schema.catalogueTenancy.js';
import { initializeAccountReset } from './schema.accountReset.js';
import { initializeCafeScoping } from './schema.cafeScoping.js';
import { initializeSettingsScoping } from './schema.settingsScoping.js';
import { initializeCustomerTiers } from './schema.customerTiers.js';
import { initializeSoftwareCategories } from './schema.softwareCategories.js';
import { initializeGameCatalog } from './schema.gameCatalog.js';
import { initializeGamePlatforms } from './schema.gamePlatforms.js';
import { initializeSupport } from './schema.support.js';
import { initializeReservations } from './schema.reservations.js';
import { initializeCafeSlugs } from './schema.cafeSlugs.js';

const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// Test database connection and create tables
export const initializeDatabase = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        name VARCHAR(255) NOT NULL,
        address JSONB NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /*
     * Email verification for new accounts.
     *
     * A code is emailed on sign-up and the address is not trusted until it
     * comes back. Only the hash of the code is stored, it expires, and attempts
     * are counted — the same discipline the password-reset OTP uses.
     *
     * The two-step default is deliberate: adding the column with DEFAULT TRUE
     * marks every account that already existed as verified, then the default
     * flips to FALSE for everyone who signs up from now on. Adding it as FALSE
     * would have locked out every existing customer on the next deploy.
     */
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS verify_otp_hash VARCHAR(128),
        ADD COLUMN IF NOT EXISTS verify_otp_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS verify_otp_attempts SMALLINT NOT NULL DEFAULT 0
    `);
    await client.query(`ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE`);

    /* "Sign in with Google". A Google account is linked to a users row by its
       stable subject id, and the profile picture is kept so the app can show
       it. auth_provider records how the row was first created — a password
       account and a Google one are both just users rows, but knowing which is
       which is what lets "you signed up with Google, use that button" be an
       accurate message rather than a guess. A Google-created row still has a
       password column (NOT NULL): it is filled with a random unusable hash,
       the same pattern admin_users uses, so nobody can sign into it with a
       password nobody set. */
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS google_id VARCHAR(64),
        ADD COLUMN IF NOT EXISTS avatar_url TEXT,
        ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(16) NOT NULL DEFAULT 'local'
    `);
    /* Partial unique index, not a UNIQUE column: every password account has a
       NULL google_id, and a UNIQUE column would still let those coexist, but a
       partial index states the intent — at most one row per Google identity. */
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
        ON users (google_id) WHERE google_id IS NOT NULL
    `);

    /* DPDP Act, 2023 self-service erasure. Anonymize-in-place rather than a
       real DELETE — cafes.user_id, organization_users.user_id and audit rows
       all FK to this table — so this is a flag, following the is_active
       convention every other table here already uses, not a new pattern. */
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ
    `);

    // subscription plans table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        sub_id SERIAL PRIMARY KEY,
        subs_software VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        max_branches INTEGER NOT NULL,
        is_single_pc_price BOOLEAN DEFAULT FALSE,
        max_pcs INTEGER NOT NULL,
        games_allowed JSONB,
        is_telmetry_enabled BOOLEAN DEFAULT FALSE,
        no_of_days INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        is_freeTrial BOOLEAN DEFAULT FALSE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //cafe table
    await client.query(`
      CREATE TABLE IF NOT EXISTS cafes (
        cafe_id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user_designation VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //branch table
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        branch_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        street VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        state VARCHAR(255) NOT NULL,
        country VARCHAR(255) NOT NULL,
        zip_code VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //subscription table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        subscription_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        sub_id INTEGER REFERENCES subscription_plans(sub_id) ON DELETE CASCADE,
        max_pcs INTEGER NOT NULL,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //pcs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pcs (
        pc_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        ip_address VARCHAR(255) NOT NULL,
        mac_address VARCHAR(255) NOT NULL,
        port INTEGER DEFAULT 9090,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //pc_software Master table
    await client.query(`
      CREATE TABLE IF NOT EXISTS software_master (
        software_id SERIAL PRIMARY KEY,
        software_name VARCHAR(255) NOT NULL,
        software_icon TEXT,
        software_video TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /* What kind of thing this is: "PC", "PS5", "Pool", "Darts".
       Free text rather than a lookup table, because the list is the café's own
       and differs between them — one has racing rigs, another has a snooker
       table — and making them administer a category master before they can
       price a dartboard is a gate, not a feature. Existing rows keep NULL and
       are shown as uncategorised; nothing has to be migrated.

       Added separately from CREATE TABLE so an existing install gains the
       column too. */
    await client.query(`
      ALTER TABLE software_master ADD COLUMN IF NOT EXISTS category VARCHAR(60)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_software_master_category
        ON software_master (category)
    `);

    /* A house activity is one the café added itself — a pool table, a
       dartboard, a racing rig. It sits in the same table as the published
       titles because the price master, the till and the bill all treat it
       identically; what differs is who may change it.

       Published titles are ManagerXP's: only an administrator may rename or
       remove one. House activities belong to the café that created them, and
       the café may do as it likes with its own dartboard. */
    await client.query(`
      ALTER TABLE software_master ADD COLUMN IF NOT EXISTS is_house BOOLEAN NOT NULL DEFAULT FALSE
    `);


    //pc_software table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pc_software (
        pc_software_id SERIAL PRIMARY KEY,
        pc_id INTEGER REFERENCES pcs(pc_id) ON DELETE CASCADE,
        software_name VARCHAR(255) NOT NULL,
        software_path TEXT NOT NULL,
        software_icon TEXT,
        software_video TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //customer table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        customer_id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        password VARCHAR(255) NOT NULL,
        address JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /* Email verification for new customers — the same discipline as `users`
       above: a code is emailed on sign-up and the address is not trusted
       until it comes back. The two-step default is the same trick for the
       same reason — adding the column as DEFAULT TRUE marks every customer
       who already existed as verified, then the default flips to FALSE for
       everyone who registers from here on, so this migration cannot lock out
       a café's existing customer base the moment it runs. */
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS verify_otp_hash VARCHAR(128),
        ADD COLUMN IF NOT EXISTS verify_otp_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS verify_otp_attempts SMALLINT NOT NULL DEFAULT 0
    `);
    await client.query(`ALTER TABLE customers ALTER COLUMN email_verified SET DEFAULT FALSE`);

    /* DPDP Act, 2023 self-service erasure — same is_active + anonymized_at
       pair as `users`. wallets/wallet_transactions/sessions/bills/orders/
       reservations all FK to customer_id and are financial or booking
       history a café may need to retain, so this anonymizes the row rather
       than deleting it. */
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ
    `);

    // wallet — one row per customer, holding the authoritative balance.
    // Money is NUMERIC, never floating point.
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        wallet_id SERIAL PRIMARY KEY,
        customer_id INTEGER UNIQUE NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= -999999),
        currency VARCHAR(8) NOT NULL DEFAULT 'XP',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /*
     * Widened to let a REGULAR customer's balance go negative up to their
     * own credit_limit — see customerTier.js's checkCredit. A CHECK here
     * can't reference customers.credit_limit (no cross-table checks in
     * Postgres), so the real per-customer limit is enforced in application
     * code exactly like credit_limit already was; this constraint is only a
     * sanity backstop against a runaway bug, not the actual limit. Dropped
     * and recreated every boot, same as customers_type_check, since it has
     * already changed once and a database created before this change would
     * otherwise keep the old CHECK (balance >= 0) forever.
     */
    await client.query(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_check`);
    await client.query(`ALTER TABLE wallets ADD CONSTRAINT wallets_balance_check CHECK (balance >= -999999)`);

    // wallet ledger — append-only. balance_after is recorded so history can be
    // read back without replaying every row.
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        transaction_id SERIAL PRIMARY KEY,
        wallet_id INTEGER NOT NULL REFERENCES wallets(wallet_id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit','debit')),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        balance_after NUMERIC(12,2) NOT NULL,
        category VARCHAR(32) NOT NULL DEFAULT 'other',
        method VARCHAR(32),
        note TEXT,
        performed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_customer_created
        ON wallet_transactions (customer_id, created_at DESC)
    `);

    console.log('✅ Wallet tables created/verified');

    // session master — the sellable durations (30 Minutes, 1 Hour, Any Time…)
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_master (
        id SERIAL PRIMARY KEY,
        session_name VARCHAR(255) NOT NULL,
        duration_type VARCHAR(16) NOT NULL
          CHECK (duration_type IN ('MINUTES','HOURS','CUSTOM','UNLIMITED')),
        duration INTEGER,
        duration_minutes INTEGER,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        -- An unlimited session has no duration; every other type must have one.
        CONSTRAINT session_master_duration_shape CHECK (
          (duration_type = 'UNLIMITED' AND duration IS NULL AND duration_minutes IS NULL)
          OR (duration_type <> 'UNLIMITED' AND duration IS NOT NULL AND duration_minutes IS NOT NULL)
        )
      )
    `);

    // Session names are the label staff pick from, so keep them unique
    // regardless of casing.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_master_name
        ON session_master (LOWER(session_name))
    `);

    // gaming price master — one price per game + session pair.
    // The game catalogue is software_master, so software_id plays the game_id
    // role described in the spec. No names or durations are duplicated here;
    // they are read back through the joins.
    await client.query(`
      CREATE TABLE IF NOT EXISTS gaming_prices (
        id SERIAL PRIMARY KEY,
        software_id INTEGER NOT NULL REFERENCES software_master(software_id) ON DELETE CASCADE,
        session_master_id INTEGER NOT NULL REFERENCES session_master(id) ON DELETE CASCADE,
        price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT gaming_prices_unique_pair UNIQUE (software_id, session_master_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_gaming_prices_software
        ON gaming_prices (software_id)
    `);

    console.log('✅ Pricing tables created/verified');

    // play sessions — a customer (or a guest) on a station for a period of time
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
        pc_id INTEGER NOT NULL REFERENCES pcs(pc_id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
        guest_name VARCHAR(255),
        guest_phone VARCHAR(20),
        status VARCHAR(10) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','paused','ended')),
        planned_minutes INTEGER,
        rate_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        paused_at TIMESTAMP,
        paused_seconds INTEGER NOT NULL DEFAULT 0,
        ended_at TIMESTAMP,
        billable_seconds INTEGER,
        amount_charged NUMERIC(12,2),
        payment_status VARCHAR(16) NOT NULL DEFAULT 'pending'
          CHECK (payment_status IN ('pending','paid','unpaid','waived','not_applicable')),
        wallet_transaction_id INTEGER REFERENCES wallet_transactions(transaction_id) ON DELETE SET NULL,
        end_reason VARCHAR(32),
        started_by VARCHAR(255),
        ended_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // A station can only have one session running or paused at a time. The
    // database enforces this, so two staff members cannot double-book a PC.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_open_per_pc
        ON sessions (pc_id) WHERE status IN ('active','paused')
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_customer_started
        ON sessions (customer_id, started_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status_started
        ON sessions (status, started_at DESC)
    `);

    /* ----------------------------------------------------------------------
       Gaming price snapshot on the session.

       A session already captured `rate_per_hour` so a later price change could
       not rewrite history. That stays the engine — these columns record which
       Gaming Price row the rate came from, and cover the shapes an hourly rate
       alone cannot express.

       pricing_unit:
         HOUR  charged pro-rata from rate_per_hour, as before. A block price
               such as "₹200 / 30 minutes" is converted to its hourly
               equivalent when the session starts, so there is exactly one
               calculation path rather than one per pricing shape.
         FLAT  an unlimited session: flat_amount regardless of duration, so
               there is no hourly rate to derive.

       price_label is the human sentence the price was sold under — "PS5 · 1
       Hour · ₹400". Stored rather than re-joined so a receipt reprinted next
       year still reads the way it did on the day, even if the game or the
       duration has since been renamed.
       ---------------------------------------------------------------------- */
    await client.query(`
      ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS gaming_price_id INTEGER REFERENCES gaming_prices(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS pricing_unit VARCHAR(16) NOT NULL DEFAULT 'HOUR',
        ADD COLUMN IF NOT EXISTS flat_amount NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS price_label VARCHAR(255),
        ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255),
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
        -- A membership's "% off gaming" perk, snapshotted the same way the
        -- gaming price itself is: at start, never touched again. A membership
        -- that lapses or is cancelled mid-session must not reach back and
        -- raise the price on someone already playing under the old terms.
        ADD COLUMN IF NOT EXISTS membership_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS membership_label VARCHAR(80),
        -- One block's price and length, for a BLOCK session. flat_amount and
        -- planned_minutes hold the running totals and grow with every
        -- extension, so the size of a single "add another block" cannot be
        -- read back from them once the first extension has landed. These two
        -- keep the unit fixed at the price it was sold at — an extension is
        -- always another block at the original terms, never today's price.
        ADD COLUMN IF NOT EXISTS block_unit_amount NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS block_unit_minutes INTEGER
    `);

    /* 'cancelled' joins the existing statuses. A session started by mistake is
       recorded and released, never deleted — the row is the evidence that a
       station was briefly held. */
    await client.query(`
      ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check
    `);
    await client.query(`
      ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
        CHECK (status IN ('active','paused','ended','cancelled'))
    `);

    /* ----------------------------------------------------------------------
       Stations: what kind of play they host, and whether they can host it.

       `category` is the gaming type — "PS5", "VR", "Pool" — and matches the
       category on software_master, so picking a type narrows the stations and
       the prices from the same vocabulary. It is deliberately not device_type,
       which describes the machine's role in the network (GAMING_PC, SERVER,
       FRONT_DESK) and answers a different question.

       `status` covers the states a station can be put into. OCCUPIED is
       deliberately absent: occupancy is whether an open session exists, and
       storing it here as well would be a second copy of that truth, free to
       drift the moment a session ends and an update fails. It is derived on
       read instead.
       ---------------------------------------------------------------------- */
    await client.query(`
      ALTER TABLE pcs
        ADD COLUMN IF NOT EXISTS category VARCHAR(60),
        ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
        -- Staff-facing note: "corner table", "left of the counter". A station
        -- that is hard to find is a station a customer is sent to twice.
        ADD COLUMN IF NOT EXISTS description VARCHAR(160)
    `);
    /* Not every station is a networked machine.
       A pool table, a dartboard and a PS5 without the client installed are all
       things a café sells time on, and none of them has an IP address. These
       columns were NOT NULL from when a station could only be a gaming PC, so
       the only way to register a pool table was to invent an address for it —
       fake data in the one table the network code trusts. */
    await client.query(`ALTER TABLE pcs ALTER COLUMN ip_address DROP NOT NULL`);
    await client.query(`ALTER TABLE pcs ALTER COLUMN mac_address DROP NOT NULL`);

    await client.query(`ALTER TABLE pcs DROP CONSTRAINT IF EXISTS pcs_status_check`);
    await client.query(`
      ALTER TABLE pcs ADD CONSTRAINT pcs_status_check
        CHECK (status IN ('AVAILABLE','MAINTENANCE','INACTIVE'))
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pcs_category ON pcs (category)
    `);

    console.log('✅ Session tables created/verified');

    // application settings — values that used to be hardcoded in controllers.
    // Typed so callers can coerce safely instead of guessing.
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(64) PRIMARY KEY,
        setting_value TEXT,
        value_type VARCHAR(16) NOT NULL DEFAULT 'string'
          CHECK (value_type IN ('string','number','boolean','json')),
        category VARCHAR(32) NOT NULL DEFAULT 'general',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /*
     * Per-café shape, applied before anything seeds a default.
     *
     * The seeds below all use `ON CONFLICT (setting_key) WHERE cafe_id IS
     * NULL`, which needs the partial index to already exist — so this cannot
     * wait for the tenancy migrations at the end of this function. The
     * foreign key to cafes is added there instead, once that table exists.
     */
    await client.query(`
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS cafe_id INTEGER
    `);
    await client.query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_default
        ON app_settings (setting_key) WHERE cafe_id IS NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_cafe
        ON app_settings (setting_key, cafe_id) WHERE cafe_id IS NOT NULL
    `);

    // Seed the defaults. ON CONFLICT DO NOTHING means an operator's edits are
    // never overwritten by a restart.
    await client.query(`
      INSERT INTO app_settings (setting_key, setting_value, value_type, category, description)
      VALUES
        ('session.default_rate_per_hour', '60',  'number',  'session',
         'Fallback hourly rate when a session has no game/session price configured'),
        ('session.warn_minutes',          '15',  'number',  'session',
         'Minutes remaining at which a session is flagged as ending soon'),
        ('session.critical_minutes',      '5',   'number',  'session',
         'Minutes remaining at which a session is flagged as critical'),
        ('session.grace_minutes',         '5',   'number',  'session',
         'Buffer at the start of a session for the game to load before the timer starts and billing begins'),
        ('wallet.currency',               'XP',  'string',  'wallet',
         'Currency code used for customer wallets'),
        ('wallet.max_transaction',        '1000000', 'number', 'wallet',
         'Largest single credit or debit permitted'),
        ('station.default_port',          '9090','number',  'station',
         'Port the client agent listens on when none is supplied'),
        ('station.default_cafe_id',       '1',   'number',  'station',
         'Cafe assigned to auto-discovered stations that arrive without one'),
        ('station.default_branch_id',     '1',   'number',  'station',
         'Branch assigned to auto-discovered stations that arrive without one'),
        ('floor.layout',                  'grid','string',  'floor',
         'How the Floor page arranges stations: grid, rows, zones or list'),
        ('floor.card_size',               'normal','string','floor',
         'Station card size on the Floor page: compact, normal or large')
      ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
    `);

    console.log('✅ Settings table created/verified');

    // bills — one per settlement. Totals are stored, not recomputed on read,
    // so a historical bill never changes when prices or tax rates move.
    await client.query(`
      CREATE TABLE IF NOT EXISTS bills (
        bill_id SERIAL PRIMARY KEY,
        bill_number VARCHAR(32) UNIQUE NOT NULL,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
        session_id INTEGER REFERENCES sessions(session_id) ON DELETE SET NULL,
        guest_name VARCHAR(255),
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
        discount_reason TEXT,
        tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
        total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
        paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
        currency VARCHAR(8) NOT NULL DEFAULT 'XP',
        status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
          CHECK (status IN ('OPEN','PARTIAL','PAID','VOID')),
        notes TEXT,
        created_by VARCHAR(255),
        settled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // A session settles once — the partial index lets voided bills be reissued.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_one_live_per_session
        ON bills (session_id) WHERE session_id IS NOT NULL AND status <> 'VOID'
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bills_customer_created
        ON bills (customer_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bills_status_created
        ON bills (status, created_at DESC)
    `);

    // line items — gaming time, food, shop goods
    await client.query(`
      CREATE TABLE IF NOT EXISTS bill_items (
        bill_item_id SERIAL PRIMARY KEY,
        bill_id INTEGER NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
        item_type VARCHAR(16) NOT NULL DEFAULT 'other'
          CHECK (item_type IN ('gaming','fnb','shop','other')),
        reference_id INTEGER,
        description VARCHAR(255) NOT NULL,
        quantity NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items (bill_id)
    `);

    // payments — append-only; a bill can be settled in parts
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id SERIAL PRIMARY KEY,
        bill_id INTEGER NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
        method VARCHAR(16) NOT NULL
          CHECK (method IN ('wallet','cash','card','upi','other')),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        reference VARCHAR(255),
        wallet_transaction_id INTEGER REFERENCES wallet_transactions(transaction_id) ON DELETE SET NULL,
        received_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments (bill_id)
    `);

    // Bill numbers come from a sequence so two tills cannot collide.
    await client.query(`CREATE SEQUENCE IF NOT EXISTS bill_number_seq START 1`);

    console.log('✅ Billing tables created/verified');

    // package master — prepaid bundles of playing time or coins
    await client.query(`
      CREATE TABLE IF NOT EXISTS packages (
        package_id SERIAL PRIMARY KEY,
        package_name VARCHAR(255) NOT NULL,
        description TEXT,
        package_type VARCHAR(16) NOT NULL DEFAULT 'HOURS'
          CHECK (package_type IN ('HOURS','CREDIT','SESSIONS')),
        -- Units mean minutes for HOURS, coins for CREDIT, plays for SESSIONS.
        units NUMERIC(12,2) NOT NULL CHECK (units > 0),
        bonus_units NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (bonus_units >= 0),
        price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
        currency VARCHAR(8) NOT NULL DEFAULT 'XP',
        validity_days INTEGER CHECK (validity_days IS NULL OR validity_days > 0),
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_name
        ON packages (LOWER(package_name))
    `);

    // what a customer bought. remaining_units is the live balance.
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_packages (
        customer_package_id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
        package_id INTEGER NOT NULL REFERENCES packages(package_id) ON DELETE RESTRICT,
        bill_id INTEGER REFERENCES bills(bill_id) ON DELETE SET NULL,
        total_units NUMERIC(12,2) NOT NULL CHECK (total_units > 0),
        remaining_units NUMERIC(12,2) NOT NULL CHECK (remaining_units >= 0),
        price_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED','CANCELLED')),
        sold_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_packages_customer
        ON customer_packages (customer_id, status)
    `);

    // membership plan master — recurring tiers with perks
    await client.query(`
      CREATE TABLE IF NOT EXISTS membership_plans (
        plan_id SERIAL PRIMARY KEY,
        plan_name VARCHAR(255) NOT NULL,
        tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
        description TEXT,
        price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
        currency VARCHAR(8) NOT NULL DEFAULT 'XP',
        duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
          CHECK (discount_percent >= 0 AND discount_percent <= 100),
        bonus_credit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (bonus_credit >= 0),
        perks JSONB,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_plans_name
        ON membership_plans (LOWER(plan_name))
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_memberships (
        customer_membership_id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES membership_plans(plan_id) ON DELETE RESTRICT,
        bill_id INTEGER REFERENCES bills(bill_id) ON DELETE SET NULL,
        price_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED')),
        sold_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // A customer holds at most one live membership at a time.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_membership
        ON customer_memberships (customer_id) WHERE status = 'ACTIVE'
    `);

    console.log('✅ Package and membership tables created/verified');

    // product categories — food, drinks, snacks, accessories…
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_categories (
        category_id SERIAL PRIMARY KEY,
        category_name VARCHAR(120) NOT NULL,
        kind VARCHAR(16) NOT NULL DEFAULT 'FNB' CHECK (kind IN ('FNB','SHOP')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_name
        ON product_categories (LOWER(category_name))
    `);

    // products. stock_quantity is the live count; is_available is the switch
    // staff use to hide something without zeroing its stock.
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        product_id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES product_categories(category_id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        sku VARCHAR(64),
        description TEXT,
        image_url TEXT,
        price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
        cost_price NUMERIC(12,2) CHECK (cost_price IS NULL OR cost_price >= 0),
        tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0
          CHECK (tax_percent >= 0 AND tax_percent <= 100),
        currency VARCHAR(8) NOT NULL DEFAULT 'XP',
        track_stock BOOLEAN NOT NULL DEFAULT TRUE,
        stock_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
        low_stock_threshold NUMERIC(12,2) NOT NULL DEFAULT 5,
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku
        ON products (LOWER(sku)) WHERE sku IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id, status)
    `);

    // stock ledger — append-only, so every change to a count is explainable
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        movement_id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
        direction VARCHAR(8) NOT NULL CHECK (direction IN ('in','out')),
        quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
        stock_after NUMERIC(12,2) NOT NULL,
        reason VARCHAR(32) NOT NULL DEFAULT 'adjustment',
        reference_id INTEGER,
        note TEXT,
        performed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_movements_product
        ON stock_movements (product_id, created_at DESC)
    `);

    // orders placed from a station
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id SERIAL PRIMARY KEY,
        order_number VARCHAR(32) UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
        session_id INTEGER REFERENCES sessions(session_id) ON DELETE SET NULL,
        pc_id INTEGER REFERENCES pcs(pc_id) ON DELETE SET NULL,
        pc_name VARCHAR(255),
        bill_id INTEGER REFERENCES bills(bill_id) ON DELETE SET NULL,
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax NUMERIC(12,2) NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'XP',
        status VARCHAR(16) NOT NULL DEFAULT 'PLACED'
          CHECK (status IN ('PLACED','CONFIRMED','PREPARING','READY','DELIVERED','CANCELLED')),
        payment_status VARCHAR(16) NOT NULL DEFAULT 'UNPAID'
          CHECK (payment_status IN ('UNPAID','PAID')),
        note TEXT,
        placed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_status_created
        ON orders (status, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_customer
        ON orders (customer_id, created_at DESC)
    `);

    // Line items copy the name and price at the time of ordering, so a later
    // price change never rewrites what someone was charged.
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        order_item_id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
        tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000`);

    console.log('✅ F&B, inventory and order tables created/verified');

    // ---- Access control ----
    // permissions are a fixed catalogue defined by the application, not by
    // operators, so a role can never grant something the code does not check.
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        permission_id SERIAL PRIMARY KEY,
        permission_key VARCHAR(64) UNIQUE NOT NULL,
        category VARCHAR(32) NOT NULL DEFAULT 'general',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        role_id SERIAL PRIMARY KEY,
        role_name VARCHAR(64) NOT NULL,
        description TEXT,
        -- System roles ship with the product and cannot be deleted.
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name
        ON roles (LOWER(role_name), COALESCE(cafe_id, 0))
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staff (
        staff_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
        staff_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(20),
        password VARCHAR(255) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INACTIVE')),
        last_login_at TIMESTAMP,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_staff_cafe ON staff (cafe_id, status)
    `);

    // Seed the permission catalogue. New keys are added on upgrade; existing
    // rows are left alone so their role grants survive.
    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('floor.view',        'floor',    'See the station floor'),
        ('floor.manage',      'floor',    'Register, edit and control stations'),
        ('sessions.view',     'sessions', 'See play sessions'),
        ('sessions.start',    'sessions', 'Start a session for a customer or guest'),
        ('sessions.manage',   'sessions', 'Pause, resume, extend and transfer sessions'),
        ('sessions.end',      'sessions', 'End a session and settle it'),
        ('customers.view',    'customers','See the customer directory'),
        ('customers.manage',  'customers','Edit customer records'),
        ('wallet.view',       'wallet',   'See customer wallet balances'),
        ('wallet.credit',     'wallet',   'Add coins to a wallet'),
        ('wallet.debit',      'wallet',   'Deduct coins from a wallet'),
        ('billing.view',      'billing',  'See bills'),
        ('billing.payment',   'billing',  'Take payment against a bill'),
        ('billing.discount',  'billing',  'Apply discounts'),
        ('billing.void',      'billing',  'Void a bill'),
        ('products.view',     'catalogue','See products and the menu'),
        ('products.manage',   'catalogue','Add and edit products and categories'),
        ('inventory.adjust',  'catalogue','Adjust stock levels'),
        ('orders.view',       'orders',   'See the order queue'),
        ('orders.manage',     'orders',   'Advance and cancel orders'),
        ('pricing.manage',    'catalogue','Manage sessions and gaming prices'),
        ('packages.manage',   'catalogue','Manage and sell packages and memberships'),
        ('staff.view',        'staff',    'See the staff list'),
        ('staff.manage',      'staff',    'Add, edit and deactivate staff and roles'),
        ('settings.view',     'system',   'See system settings'),
        ('settings.manage',   'system',   'Change system settings'),
        ('reports.view',      'system',   'See reports')
      ON CONFLICT (permission_key) DO NOTHING
    `);

    // Seed the four system roles.
    await client.query(`
      INSERT INTO roles (role_name, description, is_system) VALUES
        ('Owner',     'Full access to everything', TRUE),
        ('Manager',   'Runs the floor day to day, without staff or system settings', TRUE),
        ('Cashier',   'Takes payment, manages sessions and customers', TRUE),
        ('Attendant', 'Works the floor and the order queue', TRUE)
      ON CONFLICT DO NOTHING
    `);

    // Grant the default permission sets, only where a role has none yet, so an
    // operator's edits are never overwritten by a restart.
    const grant = async (roleName, keys) => {
      const role = await client.query(
        'SELECT role_id FROM roles WHERE LOWER(role_name) = LOWER($1) AND cafe_id IS NULL',
        [roleName]
      );
      if (role.rows.length === 0) return;
      const roleId = role.rows[0].role_id;

      const existing = await client.query(
        'SELECT COUNT(*)::int AS count FROM role_permissions WHERE role_id = $1', [roleId]
      );
      if (existing.rows[0].count > 0) return;

      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM permissions WHERE permission_key = ANY($2)
         ON CONFLICT DO NOTHING`,
        [roleId, keys]
      );
    };

    const ALL = ['floor.view','floor.manage','sessions.view','sessions.start','sessions.manage',
      'sessions.end','customers.view','customers.manage','wallet.view','wallet.credit','wallet.debit',
      'billing.view','billing.payment','billing.discount','billing.void','products.view',
      'products.manage','inventory.adjust','orders.view','orders.manage','pricing.manage',
      'packages.manage','staff.view','staff.manage','settings.view','settings.manage','reports.view'];

    await grant('Owner', ALL);
    // A manager may read every setting but not change one: the rate a session
    // bills at is an owner's decision, while being unable to see it makes the
    // rest of the console unreadable.
    await grant('Manager', ALL.filter((k) => !['staff.manage', 'settings.manage'].includes(k)));

    /*
     * grant() deliberately skips a role that already holds permissions, so it
     * never clobbers an operator's edits — which also means a key added after
     * first boot never reaches an existing role. settings.view was added later
     * than the original seed, so it needs the additive form.
     */
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'settings.view'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager')
      ON CONFLICT DO NOTHING
    `);
    await grant('Cashier', ['floor.view','sessions.view','sessions.start','sessions.manage','sessions.end',
      'customers.view','wallet.view','wallet.credit','billing.view','billing.payment','billing.discount',
      'products.view','orders.view','orders.manage','packages.manage']);
    await grant('Attendant', ['floor.view','sessions.view','sessions.start','sessions.end',
      'products.view','orders.view','orders.manage','customers.view']);

    // Operators may add their own permission keys. Flagged so the built-in
    // catalogue stays distinguishable from anything added by hand.
    await client.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE
    `);

    console.log('✅ Roles, permissions and staff tables created/verified');

    /* ======================================================================
       FLOOR ZONES
       A café is rarely one undifferentiated room — there is a VIP booth, a
       console corner, a streaming desk. Zones let the Floor page mirror the
       actual layout instead of one flat grid.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS floor_zones (
        zone_id SERIAL PRIMARY KEY,
        cafe_id INTEGER,
        zone_name VARCHAR(80) NOT NULL,
        description VARCHAR(255),
        accent VARCHAR(16) NOT NULL DEFAULT 'accent',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Zone names are per café, so two cafés may both have a "VIP Room".
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_zone_name_per_cafe
        ON floor_zones (COALESCE(cafe_id, 0), LOWER(zone_name))
    `);

    // Deleting a zone must never take its stations with it.
    await client.query(`
      ALTER TABLE pcs ADD COLUMN IF NOT EXISTS zone_id INTEGER
        REFERENCES floor_zones(zone_id) ON DELETE SET NULL
    `);
    await client.query(`
      ALTER TABLE pcs ADD COLUMN IF NOT EXISTS floor_order INTEGER NOT NULL DEFAULT 0
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pcs_zone ON pcs (zone_id, floor_order)
    `);

    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('floor.layout', 'floor', 'Change the floor layout and zones')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    // Whoever may edit stations may arrange them.
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'floor.layout'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Floor zone tables created/verified');

    // Staff registering a walk-in at the counter rarely have an address, and
    // "not recorded" is a truthful state. Self-registration still asks for one.
    await client.query('ALTER TABLE customers ALTER COLUMN address DROP NOT NULL');

    /* ======================================================================
       TELEMETRY
       Hardware counters sampled on each station and relayed by the admin
       console. Every column is nullable on purpose: a counter that cannot be
       read on a given machine is recorded as unknown rather than as zero,
       because a zero would read as a healthy idle machine.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS station_telemetry (
        telemetry_id BIGSERIAL PRIMARY KEY,
        pc_id INTEGER REFERENCES pcs(pc_id) ON DELETE CASCADE,
        pc_name VARCHAR(120) NOT NULL,
        cpu_percent NUMERIC(5,2),
        cpu_model VARCHAR(160),
        cpu_cores INTEGER,
        mem_total_bytes BIGINT,
        mem_used_bytes BIGINT,
        mem_percent NUMERIC(5,2),
        disk_total_bytes BIGINT,
        disk_free_bytes BIGINT,
        disk_percent NUMERIC(5,2),
        gpu_name VARCHAR(160),
        gpu_vram_bytes BIGINT,
        temperature_c NUMERIC(5,2),
        uptime_seconds BIGINT,
        latency_ms INTEGER,
        platform VARCHAR(40),
        os_release VARCHAR(80),
        running_app VARCHAR(200),
        -- "How long ago" is the whole point of a sample, so these two carry a
        -- zone. A bare TIMESTAMP round-trips through the driver with the local
        -- offset applied on write but not on read, which makes a fresh sample
        -- look hours stale.
        sampled_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Pre-existing installs created these as bare TIMESTAMP; move them over.
    await client.query(`
      ALTER TABLE station_telemetry
        ALTER COLUMN sampled_at TYPE TIMESTAMPTZ,
        ALTER COLUMN received_at TYPE TIMESTAMPTZ
    `);

    // Every read is "this station, most recent first" — one index serves both
    // the latest-per-station lookup and the history window.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_telemetry_station_time
        ON station_telemetry (pc_name, sampled_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_telemetry_time ON station_telemetry (sampled_at DESC)
    `);

    await client.query(`
      INSERT INTO app_settings (setting_key, setting_value, value_type, category, description)
      VALUES
        ('telemetry.sample_seconds', '15',  'number', 'telemetry',
         'How often each station samples its hardware counters'),
        ('telemetry.retention_days', '7',   'number', 'telemetry',
         'How long telemetry samples are kept before being pruned'),
        ('telemetry.cpu_warn',       '85',  'number', 'telemetry',
         'CPU percentage at which a station is flagged'),
        ('telemetry.mem_warn',       '90',  'number', 'telemetry',
         'Memory percentage at which a station is flagged'),
        ('telemetry.disk_warn',      '90',  'number', 'telemetry',
         'Disk usage percentage at which a station is flagged'),
        ('telemetry.temp_warn',      '85',  'number', 'telemetry',
         'Temperature in Celsius at which a station is flagged'),
        ('telemetry.stale_seconds',  '90',  'number', 'telemetry',
         'Seconds without a sample after which a station is treated as not reporting')
      ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
    `);

    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('telemetry.view', 'floor', 'See station hardware telemetry')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'telemetry.view'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager','cashier','attendant')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Telemetry tables created/verified');

    /* ======================================================================
       AUDIT LOG
       Append-only. Nothing updates or deletes a row here, because the value
       of the trail is that it cannot be tidied up after the fact. Actor
       details are copied in rather than joined, so deleting a staff account
       never erases what that account did.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id BIGSERIAL PRIMARY KEY,
        actor_kind VARCHAR(16) NOT NULL DEFAULT 'staff',
        actor_id INTEGER,
        actor_name VARCHAR(160),
        actor_role VARCHAR(80),
        action VARCHAR(64) NOT NULL,
        category VARCHAR(32) NOT NULL DEFAULT 'general',
        entity VARCHAR(48),
        entity_id VARCHAR(64),
        summary VARCHAR(400) NOT NULL,
        -- Amounts are pulled out of meta so money can be filtered and totalled
        -- without unpacking JSON on every read.
        amount NUMERIC(12,2),
        sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        meta JSONB,
        ip_address VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log (created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log (category, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id)
    `);

    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('audit.view',   'system', 'Read the audit trail'),
        ('reports.view', 'system', 'See revenue and usage reports'),
        ('station.power','floor',  'Restart, shut down or lock a station remotely')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key IN ('audit.view','reports.view','station.power')
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Audit log created/verified');

    /* ======================================================================
       DISCOUNT CODES
       A code is either open to anyone, restricted to a membership tier, or
       locked to named customers. Redemptions are recorded rather than counted
       on the code row, so "who used this, and on which bill" always has an
       answer and per-customer limits can be enforced honestly.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS discount_codes (
        code_id SERIAL PRIMARY KEY,
        cafe_id INTEGER,
        code VARCHAR(40) NOT NULL,
        description VARCHAR(255),
        -- 'percent' takes value as 0-100, 'amount' as a flat sum.
        discount_type VARCHAR(10) NOT NULL DEFAULT 'percent'
          CHECK (discount_type IN ('percent','amount')),
        value NUMERIC(10,2) NOT NULL CHECK (value > 0),
        -- Caps a percentage discount, so "20% off" cannot become unlimited.
        max_discount NUMERIC(10,2),
        min_bill_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        audience VARCHAR(12) NOT NULL DEFAULT 'public'
          CHECK (audience IN ('public','tier','customers')),
        -- Set when audience = 'tier'; matched against membership_plans.tier.
        tier VARCHAR(40),
        total_limit INTEGER,
        per_customer_limit INTEGER NOT NULL DEFAULT 1,
        starts_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','PAUSED','EXPIRED')),
        created_by VARCHAR(160),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Codes are typed by hand at a counter, so matching ignores case.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_discount_code
        ON discount_codes (COALESCE(cafe_id, 0), UPPER(code))
    `);

    // Which named customers may use a 'customers' code.
    await client.query(`
      CREATE TABLE IF NOT EXISTS discount_code_customers (
        code_id INTEGER NOT NULL REFERENCES discount_codes(code_id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
        PRIMARY KEY (code_id, customer_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS discount_code_redemptions (
        redemption_id SERIAL PRIMARY KEY,
        code_id INTEGER NOT NULL REFERENCES discount_codes(code_id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
        bill_id INTEGER REFERENCES bills(bill_id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        redeemed_by VARCHAR(160),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_redemption_code ON discount_code_redemptions (code_id)
    `);
    // One code per bill: re-applying replaces rather than stacks.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_redemption_bill
        ON discount_code_redemptions (bill_id) WHERE bill_id IS NOT NULL
    `);

    // Which code produced a bill's discount, so a receipt can name it.
    await client.query(`
      ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_code_id INTEGER
        REFERENCES discount_codes(code_id) ON DELETE SET NULL
    `);

    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('discounts.manage', 'billing', 'Create and edit discount codes'),
        ('billing.counter',  'billing', 'Use the cashier counter screen')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'discounts.manage'
        AND r.is_system = TRUE AND LOWER(r.role_name) IN ('owner','manager')
      ON CONFLICT DO NOTHING
    `);
    // The counter is the cashier's whole job, so they get it too.
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'billing.counter'
        AND r.is_system = TRUE AND LOWER(r.role_name) IN ('owner','manager','cashier')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Discount code tables created/verified');

    /* ======================================================================
       REFUNDS
       A refund is a negative tender, not a separate concept. Keeping it in
       `payments` means recalculate() — which sums that table — reduces the
       paid amount and moves the bill back through PARTIAL/OPEN without
       knowing refunds exist. A parallel table would need every reader to
       remember to subtract it.
       ====================================================================== */
    await client.query(`
      ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_check
    `);
    await client.query(`
      ALTER TABLE payments ADD CONSTRAINT payments_amount_nonzero
        CHECK (amount <> 0)
    `).catch(() => { /* already present */ });

    await client.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_refund BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await client.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS note VARCHAR(255)
    `);

    // A refund is at least as sensitive as a void, so it gets its own key
    // rather than riding on billing.payment.
    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('billing.refund', 'billing', 'Return money against a settled bill')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'billing.refund'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Refund support created/verified');

    /* ======================================================================
       CAFEXP AI
       Usage only. No conversation transcript, no raw analysis, no provider
       payload — the question and what it cost are enough to bill, rate-limit
       and debug, and everything else would be business data sitting in a
       second place for no operational reason.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        usage_id BIGSERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        actor_label VARCHAR(160),
        actor_kind VARCHAR(16),
        staff_id INTEGER REFERENCES staff(staff_id) ON DELETE SET NULL,
        question VARCHAR(500),
        intent_tools VARCHAR(400),
        provider VARCHAR(32),
        model VARCHAR(64),
        confidence VARCHAR(12),
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        error_message VARCHAR(300),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_cafe_time
        ON ai_usage (cafe_id, created_at DESC)
    `);

    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('ai.ask', 'system', 'Ask CafeXP AI about the operation')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    // The AI crosses revenue, sessions, stations and customers in one answer,
    // so it is granted at the level that already sees the whole picture.
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'ai.ask'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ CafeXP AI tables created/verified');

    /* ======================================================================
       PAYMENT GATEWAYS & WALLET TOP-UPS

       A customer topping up their own coins is the first time this system
       takes money from someone who is not standing at the counter, so the
       trust model changes. Two rules shape these tables:

       1. Provider secrets never leave the server. `key_id` is the publishable
          half and is handed to the client; `key_secret_enc` and
          `webhook_secret_enc` are encrypted at rest and are never selected
          into any response.
       2. The credited amount is whatever the *provider* confirms, never what
          the client claims. `amount` is written when the order is created
          server-side and re-checked against the provider's payload before a
          single coin moves.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_gateways (
        gateway_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        provider VARCHAR(32) NOT NULL
          CHECK (provider IN ('razorpay','cashfree','payu','stripe','phonepe')),
        display_name VARCHAR(64),
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        mode VARCHAR(8) NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
        key_id VARCHAR(255),
        key_secret_enc TEXT,
        webhook_secret_enc TEXT,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_verified_at TIMESTAMPTZ,
        last_error VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (cafe_id, provider)
      )
    `);

    /* One row per attempt, created before the customer ever reaches the
       provider. Without this row there is nothing to verify a callback
       against, and a forged callback would be indistinguishable from a real
       one. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS topup_orders (
        topup_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
        customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
        provider VARCHAR(32) NOT NULL,
        mode VARCHAR(8) NOT NULL DEFAULT 'test',
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        coins NUMERIC(12,2) NOT NULL CHECK (coins > 0),
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(16) NOT NULL DEFAULT 'created'
          CHECK (status IN ('created','pending','paid','credited','failed','expired','refunded')),
        provider_order_id VARCHAR(128),
        provider_payment_id VARCHAR(128),
        wallet_transaction_id INTEGER REFERENCES wallet_transactions(transaction_id) ON DELETE SET NULL,
        failure_reason VARCHAR(255),
        source VARCHAR(16) NOT NULL DEFAULT 'client',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMPTZ,
        credited_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /*
     * Cash top-ups.
     *
     * A customer with no card, or a café with no gateway, still needs a way to
     * put coins in a wallet. The customer raises the request from the station,
     * hands notes across the counter, and a member of staff approves it — so
     * the approval IS the payment confirmation, exactly as a signature is for
     * a gateway. Nothing is credited until a person with the permission says
     * the money arrived.
     *
     * 'awaiting_approval' and 'rejected' are added to the existing check
     * constraint rather than replacing it, so rows already written stay valid.
     */
    /* 'awaiting_approval' is 17 characters and the column was declared
       VARCHAR(16), so the widening has to happen before the constraint that
       permits the value — otherwise every cash request fails on insert with a
       type error rather than a constraint violation. */
    await client.query(`ALTER TABLE topup_orders ALTER COLUMN status TYPE VARCHAR(24)`);

    await client.query(`ALTER TABLE topup_orders DROP CONSTRAINT IF EXISTS topup_orders_status_check`);
    await client.query(`
      ALTER TABLE topup_orders ADD CONSTRAINT topup_orders_status_check
      CHECK (status IN ('created','pending','awaiting_approval','paid','credited',
                        'failed','rejected','expired','refunded'))
    `).catch(() => { /* already present */ });

    await client.query(`
      ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255)
    `);
    await client.query(`
      ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS customer_note VARCHAR(255)
    `);

    /* Staff who take money at the till are the ones who confirm cash arrived,
       so this rides with the existing wallet-credit authority rather than
       inventing a second one an owner would have to remember to grant. */
    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('payments.topup.approve', 'wallet', 'Approve or reject cash wallet top-ups')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'payments.topup.approve'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner','manager','cashier')
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
        ('topup.cash_enabled', 'true', 'boolean', 'wallet',
         'Let customers request a cash top-up for staff to approve at the counter')
      ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
    `);

    /*
     * The checkout capability.
     *
     * The station renderer runs over file:// and cannot host a provider's
     * checkout SDK, so the payment happens in a separate window pointed at a
     * server-rendered page. That page needs to be reachable without a bearer
     * token — a JWT in a URL ends up in logs and history — so an unguessable
     * single-use nonce is the credential instead, and it expires.
     */
    await client.query(`
      ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS checkout_nonce VARCHAR(64)
    `);
    await client.query(`
      ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS checkout_expires_at TIMESTAMPTZ
    `);
    /* Provider-specific material the checkout page needs but cannot recompute:
       Cashfree's per-order session id, PayU's signed form. Both are derived
       from the gateway secret at order time, and the page is rendered in a
       later request that must never touch that secret. Nothing sensitive of
       its own — a signature over public fields, useful only for this order. */
    await client.query(`
      ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_topup_checkout_nonce
        ON topup_orders (checkout_nonce) WHERE checkout_nonce IS NOT NULL
    `);

    /* The idempotency guard. A gateway may deliver the same webhook several
       times, and the customer's browser callback can race it. A unique index
       on the provider's payment id means the second writer fails on the
       constraint instead of crediting the coins twice. Partial, because
       provider_payment_id is null until the payment actually happens. */
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_topup_provider_payment
        ON topup_orders (provider, provider_payment_id)
        WHERE provider_payment_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_topup_provider_order
        ON topup_orders (provider, provider_order_id)
        WHERE provider_order_id IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_topup_customer_created
        ON topup_orders (customer_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_topup_cafe_created
        ON topup_orders (cafe_id, created_at DESC)
    `);

    await client.query(`
      INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
        ('topup.enabled',      'true', 'boolean', 'wallet',
         'Let customers top up their own wallet from the station'),
        ('topup.min_amount',   '50',   'number',  'wallet',
         'Smallest self-service top-up allowed'),
        ('topup.max_amount',   '10000','number',  'wallet',
         'Largest self-service top-up allowed'),
        ('topup.coin_rate',    '1',    'number',  'wallet',
         'Coins credited per unit of currency paid'),
        ('topup.presets',      '100,250,500,1000', 'string', 'wallet',
         'Quick-pick top-up amounts shown on the station'),
        ('topup.bonus_tiers',  '[]',   'json',    'wallet',
         'Bonus top-up amounts — e.g. pay 1000, get 1100 XP. Array of {pay_amount, credit_amount}; a top-up matching pay_amount exactly credits credit_amount instead of the flat coin rate.')
      ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
    `);

    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('payments.gateway.view',   'system', 'See payment gateway configuration'),
        ('payments.gateway.manage', 'system', 'Configure payment gateways and credentials'),
        ('payments.topup.view',     'wallet', 'See customer wallet top-ups')
      ON CONFLICT (permission_key) DO NOTHING
    `);

    /* Gateway credentials are the keys to the café's bank account, so only the
       owner gets them. A manager may see that top-ups are arriving without
       being able to change where the money lands. */
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key IN ('payments.gateway.view','payments.gateway.manage','payments.topup.view')
        AND r.is_system = TRUE
        AND LOWER(r.role_name) = 'owner'
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key = 'payments.topup.view'
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('manager','cashier')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Payment gateway tables created/verified');

    /* ======================================================================
       PLATFORM BILLING  (ManagerXP selling CafeXP to cafés)

       Everything above this line is a café charging its customers. This is the
       other direction: ManagerXP charging the café. The two never share a
       table, because they answer to different people — a café owner may read
       every row of their own billing and none of this.

       A plan could not be sold before now: subscription_plans described what a
       plan *allows* (branches, PCs, telemetry) but never what it *costs*, so
       there was no amount to put on an invoice or a payment link.
       ====================================================================== */
    await client.query(`
      ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'INR'
    `);
    /* Derived from no_of_days for display and MRR, but stored, because an
       operator may sell a 365-day plan billed monthly. */
    await client.query(`
      ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS billing_period VARCHAR(16) NOT NULL DEFAULT 'monthly'
        CHECK (billing_period IN ('monthly','quarterly','yearly','one_time'))
    `).catch(() => { /* constraint already present */ });
    await client.query(`
      ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    /* Per-station-type ceilings, on top of the single max_pcs total.
       A JSON map of { "<category>": <max> } — e.g. {"PS5": 4, "Pool": 2}.
       The categories are the café-defined station types (PS5, Pool, VR, Dart,
       …), so this is a free map rather than fixed columns: a type nobody caps
       simply is not a key here and is bounded only by max_pcs. Lives on the
       plan as the default; a subscription can override it per customer, the
       same way max_pcs does. */
    await client.query(`
      ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS station_limits JSONB
    `);
    await client.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS station_limits JSONB
    `);

    /*
     * Payment links.
     *
     * The admin generates one, sends it to a café owner, and the owner pays
     * without ever signing in. The token in the URL is therefore the only
     * credential, so it is long, random, single-purpose and expiring — and it
     * grants exactly one thing: the ability to pay this amount. It never
     * reveals the café's data or admits anyone to the console.
     *
     * `amount` is fixed at creation. The pay page renders it; it never accepts
     * one, so a customer cannot pay ₹1 for a ₹12,000 plan by editing the page.
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_links (
        link_id SERIAL PRIMARY KEY,
        token VARCHAR(64) UNIQUE NOT NULL,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
        sub_id INTEGER REFERENCES subscription_plans(sub_id) ON DELETE SET NULL,
        subscription_id INTEGER REFERENCES subscriptions(subscription_id) ON DELETE SET NULL,

        customer_name VARCHAR(160),
        customer_email VARCHAR(160),
        customer_phone VARCHAR(32),

        purpose VARCHAR(32) NOT NULL DEFAULT 'subscription'
          CHECK (purpose IN ('subscription','renewal','upgrade','addon','other')),
        description VARCHAR(255),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',

        -- How many days of service this payment buys, copied from the plan at
        -- creation so a later plan edit cannot silently change what was sold.
        grants_days INTEGER,
        grants_max_pcs INTEGER,

        status VARCHAR(16) NOT NULL DEFAULT 'open'
          CHECK (status IN ('open','paid','expired','cancelled')),
        provider VARCHAR(32),
        provider_order_id VARCHAR(128),
        provider_payment_id VARCHAR(128),

        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /* Same idempotency guard as the café-side top-ups: a provider may deliver
       the same webhook repeatedly, and the payer's browser can race it. */
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_paylink_provider_payment
        ON payment_links (provider, provider_payment_id)
        WHERE provider_payment_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_paylink_provider_order
        ON payment_links (provider, provider_order_id)
        WHERE provider_order_id IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_paylink_status_created
        ON payment_links (status, created_at DESC)
    `);

    /* The money actually received, kept separately from the link that invited
       it: a link is an intention, a payment is a fact, and reports should read
       facts. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        payment_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
        subscription_id INTEGER REFERENCES subscriptions(subscription_id) ON DELETE SET NULL,
        link_id INTEGER REFERENCES payment_links(link_id) ON DELETE SET NULL,
        amount NUMERIC(12,2) NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        method VARCHAR(32) NOT NULL DEFAULT 'link'
          CHECK (method IN ('link','bank_transfer','cash','cheque','other')),
        provider VARCHAR(32),
        provider_payment_id VARCHAR(128),
        reference VARCHAR(160),
        note VARCHAR(255),
        recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subpay_received
        ON subscription_payments (received_at DESC)
    `);

    /* A café install can be suspended for non-payment without deleting
       anything. cafes.is_active already exists; these say why and since when,
       so support can answer "why is my console locked?" without guessing. */
    await client.query(`
      ALTER TABLE cafes ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(255)
    `);
    await client.query(`
      ALTER TABLE cafes ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ
    `);

    /* ======================================================================
       PRODUCT NAMES

       ManagerXP sells two products: CafeXP (gaming-café management) and
       RaceXP (racing simulators). The column was seeded with 'gamingxp',
       which is neither — an early name that never got renamed, and which the
       admin UI was already half-migrated away from: its radio buttons offered
       'gamingxp' and 'cafexp' as if they were different products.

       Renamed in place so there is one vocabulary. Existing rows move to
       'cafexp' because that is what they always were.
       ====================================================================== */
    await client.query(`
      UPDATE subscription_plans SET subs_software = 'cafexp'
      WHERE subs_software IN ('gamingxp', 'gamingXP', 'GamingXP')
    `);

    /* ======================================================================
       LICENCE KEYS

       A subscription is a commercial fact; a licence key is what makes a
       specific install run. Keeping them apart matters because they do not
       map one-to-one — a customer with one subscription may run two branches,
       and a key can be reissued after a machine dies without touching what
       they have paid for.

       The key is stored in the clear on purpose, unlike a password or a
       gateway secret: support has to be able to read a customer their key
       back over the phone, and it is a licence identifier, not a credential
       that protects anything else.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS license_keys (
        license_id SERIAL PRIMARY KEY,
        license_key VARCHAR(64) UNIQUE NOT NULL,
        product VARCHAR(16) NOT NULL DEFAULT 'cafexp'
          CHECK (product IN ('cafexp','racexp')),

        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        subscription_id INTEGER REFERENCES subscriptions(subscription_id) ON DELETE SET NULL,

        -- What the key permits, copied from the plan at issue so a later plan
        -- edit cannot silently change what an install is allowed to run.
        max_pcs INTEGER,
        max_branches INTEGER,

        status VARCHAR(16) NOT NULL DEFAULT 'issued'
          CHECK (status IN ('issued','active','suspended','revoked','expired')),

        -- Bound to one machine on first activation. A key that could be
        -- activated anywhere is a key that gets shared.
        machine_id VARCHAR(128),
        machine_label VARCHAR(160),
        activated_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ,
        activation_count INTEGER NOT NULL DEFAULT 0,

        expires_at TIMESTAMPTZ,
        revoked_reason VARCHAR(255),
        revoked_at TIMESTAMPTZ,
        notes VARCHAR(255),
        issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_license_cafe ON license_keys (cafe_id, status)
    `);

    /* An append-only record of every activation attempt, successful or not.
       "It says my key is already in use" is unanswerable without it. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS license_activations (
        activation_id SERIAL PRIMARY KEY,
        license_id INTEGER REFERENCES license_keys(license_id) ON DELETE CASCADE,
        license_key VARCHAR(64),
        machine_id VARCHAR(128),
        machine_label VARCHAR(160),
        ip_address VARCHAR(64),
        outcome VARCHAR(24) NOT NULL,
        detail VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_license_act_time
        ON license_activations (license_id, created_at DESC)
    `);

    /* ======================================================================
       CLIENT RELEASES

       What version a station is allowed to run, and where to get it.

       The client is never believed about any of this. It reports the version
       it thinks it is running so the console can show an inventory, but the
       decision "may this station update, and to what" is made here from the
       licence and the subscription — because a station is a PC in a café that
       ManagerXP does not control, and a compromised one claiming to be on an
       ancient version must not be able to talk the server into handing it
       something it should not have.

       sha512 rather than sha256 because that is what electron-updater's
       latest.yml carries; storing the same digest means the value published
       here and the value the updater verifies are the same string, and cannot
       drift.
       ====================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_releases (
        release_id SERIAL PRIMARY KEY,
        product VARCHAR(16) NOT NULL DEFAULT 'cafexp'
          CHECK (product IN ('cafexp','racexp')),
        component VARCHAR(16) NOT NULL DEFAULT 'client'
          CHECK (component IN ('client','server')),

        version VARCHAR(32) NOT NULL,
        channel VARCHAR(16) NOT NULL DEFAULT 'stable'
          CHECK (channel IN ('stable','beta')),

        -- Sortable form of the semver, so "is 1.10.0 newer than 1.9.0" is a
        -- comparison the database can do. Text ordering gets that wrong.
        version_sort BIGINT NOT NULL DEFAULT 0,

        release_notes TEXT,
        download_url VARCHAR(512),
        file_name VARCHAR(255),
        file_size BIGINT,
        sha512 VARCHAR(255),

        -- A release can be pulled without deleting it, so an install that is
        -- mid-download stops rather than completing a rollout you cancelled.
        is_published BOOLEAN NOT NULL DEFAULT FALSE,
        is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,

        -- Below this, a station must update before it may run at all.
        min_supported_version VARCHAR(32),

        published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (product, component, version, channel)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_release_lookup
        ON client_releases (product, component, channel, is_published, version_sort DESC)
    `);

    /* What each station is actually running, as last reported. Kept on the pc
       row rather than a side table because it is a current-state fact, not a
       history — and the console reads it alongside everything else about a
       station. */
    await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS client_version VARCHAR(32)`);
    await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS client_version_seen_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS update_state VARCHAR(24)`);
    await client.query(`ALTER TABLE pcs ADD COLUMN IF NOT EXISTS update_detail VARCHAR(255)`);

    /* Every rollout step, so "why is PC-03 still on the old version" has an
       answer that is not a shrug. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS update_events (
        event_id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
        pc_id INTEGER REFERENCES pcs(pc_id) ON DELETE CASCADE,
        pc_name VARCHAR(160),
        from_version VARCHAR(32),
        to_version VARCHAR(32),
        state VARCHAR(24) NOT NULL,
        detail VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_update_events_time
        ON update_events (cafe_id, created_at DESC)
    `);

    /*
     * Update scheduling.
     *
     * The two components need different rules because the consequences of
     * getting it wrong differ. A station is one seat: waiting for it to be
     * idle is enough, and it can be updated at any hour once it is free. The
     * console is the machine coordinating every station and holding the WS
     * link to all of them — restarting it drops every station briefly, so it
     * gets a fixed time chosen by the café rather than "whenever it is quiet".
     *
     * Downloading is not scheduled at all. It writes to a cache and interrupts
     * nobody, so it happens as soon as an update exists; only the apply step
     * waits for a window.
     */
    await client.query(`
      INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
        ('updates.auto_check',      'true',  'boolean', 'system',
         'Check ManagerXP for newer versions in the background'),
        ('updates.check_interval_hours', '6', 'number', 'system',
         'How often the console asks ManagerXP for a newer version'),
        ('updates.channel',         'stable','string',  'system',
         'Which release channel this café follows'),

        -- Clients: idle-gated. 'manual' means staged and left for an operator.
        ('updates.client_apply_mode', 'idle', 'string', 'system',
         'When to apply a staged client update: idle or manual'),
        ('updates.client_window_start', '', 'string', 'system',
         'Earliest time of day a client may apply an update (HH:MM, blank = any time once idle)'),
        ('updates.client_window_end',   '', 'string', 'system',
         'Latest time of day a client may apply an update (HH:MM, blank = any time once idle)'),

        -- The console: a fixed time, because it cannot wait for itself to be
        -- idle in any meaningful sense.
        ('updates.server_apply_mode', 'manual', 'string', 'system',
         'When to apply a staged console update: start_of_day, end_of_day or manual'),
        ('updates.server_apply_at',   '04:00', 'string', 'system',
         'Time of day the console applies its own staged update (HH:MM)')
      ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
    `);

    /* The old key, superseded by the per-component modes above. Left in place
       rather than dropped: an operator who had switched it on should not have
       that silently reinterpreted by the new scheduler. */
    await client.query(`
      UPDATE app_settings
      SET description = 'Superseded by updates.client_apply_mode — no longer read'
      WHERE setting_key = 'updates.auto_apply'
    `);

    console.log('✅ Client release tables created/verified');

    /* ======================================================================
       REFUNDS

       Refunds already worked, after a fashion: a negative row in `payments`
       with is_refund = true. That records *that* money went back, and it is
       what keeps bills.paid_amount arithmetic correct — but it cannot record
       *which items* were returned, so item-level refunds, partial-quantity
       refunds and "how much of this line is still refundable" were all
       impossible.

       So this adds a document layer rather than replacing the money layer:

         bills → payments → refunds → refund_items

       The negative payment row stays; it is still how the money is tracked.
       `refunds` explains it, and `refund_items` says what came back. A refund
       therefore has two links: `payment_id` is the ORIGINAL payment being
       reversed, `refund_payment_id` is the negative row this refund created.

       The original bill is never touched. Nothing here updates bills.subtotal,
       bills.total, or any bill_item — a refunded invoice still reads exactly
       what the customer was charged, which is the whole point.
       ====================================================================== */

    /* payments gains the fields the refund flow needs to reference a specific
       tender. Additive: the 32 existing rows keep working untouched. */
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_no VARCHAR(32)`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_no
        ON payments (payment_no) WHERE payment_no IS NOT NULL
    `);
    await client.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16)
        NOT NULL DEFAULT 'COMPLETED'
    `);
    await client.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check`);
    await client.query(`
      ALTER TABLE payments ADD CONSTRAINT payments_status_check
      CHECK (payment_status IN ('PENDING','COMPLETED','FAILED','CANCELLED'))
    `).catch(() => { /* already present */ });
    /* COMPLETED is the honest backfill: every existing row is money that
       actually changed hands. PENDING would retroactively call settled
       payments unsettled. */
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
    await client.query(`UPDATE payments SET paid_at = created_at WHERE paid_at IS NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        refund_id SERIAL PRIMARY KEY,
        refund_no VARCHAR(32) UNIQUE NOT NULL,

        cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,
        bill_id INTEGER NOT NULL REFERENCES bills(bill_id) ON DELETE RESTRICT,

        -- The original tender being reversed. RESTRICT, not CASCADE: deleting
        -- a payment must never silently erase the record of refunding it.
        payment_id INTEGER REFERENCES payments(payment_id) ON DELETE RESTRICT,
        -- The negative payment row this refund produced.
        refund_payment_id INTEGER REFERENCES payments(payment_id) ON DELETE SET NULL,

        refund_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount > 0),
        refund_method VARCHAR(16) NOT NULL
          CHECK (refund_method IN ('wallet','cash','card','upi','other')),
        refund_reason VARCHAR(255),
        refund_status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED'
          CHECK (refund_status IN ('PENDING','COMPLETED','CANCELLED')),

        /* Idempotency. A cashier double-clicking PROCESS REFUND must not
           produce two refunds, and a retry after a dropped connection must
           return the first result rather than refunding twice. The unique
           index below makes the second insert fail rather than relying on the
           UI to be careful. */
        idempotency_key VARCHAR(64),

        processed_by VARCHAR(255),
        processed_by_staff_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_idempotency
        ON refunds (idempotency_key) WHERE idempotency_key IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_refunds_bill ON refunds (bill_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_refunds_cafe_date ON refunds (cafe_id, refund_date DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refund_items (
        refund_item_id SERIAL PRIMARY KEY,
        refund_id INTEGER NOT NULL REFERENCES refunds(refund_id) ON DELETE CASCADE,
        bill_item_id INTEGER NOT NULL REFERENCES bill_items(bill_item_id) ON DELETE RESTRICT,

        quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),

        /* Copied from the bill_item, never from products or gaming_prices.
           A t-shirt sold at 799 is refunded at 799 even after the master price
           becomes 899 — the refund is a reversal of what happened, not a
           fresh transaction at today's price. */
        unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
        refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount >= 0),
        description VARCHAR(255),
        reason VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON refund_items (refund_id)
    `);
    /* The lookup behind "how much of this line is still refundable" — asked
       once per line every time the refund dialog opens. */
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_refund_items_bill_item ON refund_items (bill_item_id)
    `);

    /*
     * Backfill the refunds that already happened as bare negative payments.
     * Without this they would be invisible to the new refund history and to
     * reporting, and the "already refunded" arithmetic would understate what
     * has gone back — which would let staff refund the same money twice.
     *
     * No refund_items: nobody recorded which items those covered, and
     * inventing lines would be worse than admitting the gap.
     */
    await client.query(`
      INSERT INTO refunds
        (refund_no, cafe_id, bill_id, refund_payment_id, refund_date, refund_amount,
         refund_method, refund_reason, refund_status, processed_by)
      SELECT
        'RF-LEGACY-' || p.payment_id,
        b.cafe_id,
        p.bill_id,
        p.payment_id,
        p.created_at,
        ABS(p.amount),
        p.method,
        COALESCE(p.note, 'Recorded before itemised refunds existed'),
        'COMPLETED',
        p.received_by
      FROM payments p
      JOIN bills b ON b.bill_id = p.bill_id
      WHERE p.is_refund = TRUE
        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.refund_payment_id = p.payment_id)
      ON CONFLICT (refund_no) DO NOTHING
    `);

    /* ======================================================================
       CONTACT ON A BILL

       A registered customer's number is on their record; a guest's was
       nowhere, so a walk-in bill had no way to reach the person who paid it.
       That blocks sending a receipt by WhatsApp or SMS — the commonest reason
       a café wants a phone number at all.

       Stored on the bill rather than only on the customer, because the number
       given at the counter is a fact about that transaction: a guest may give
       a different number next time, and a receipt should go where it was
       asked to go on the day.
       ====================================================================== */
    await client.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(32)`);
    await client.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS contact_channel VARCHAR(16)`);
    await client.query(`
      ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_contact_channel_check
    `);
    await client.query(`
      ALTER TABLE bills ADD CONSTRAINT bills_contact_channel_check
      CHECK (contact_channel IS NULL OR contact_channel IN ('whatsapp','sms','none'))
    `).catch(() => { /* already present */ });
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bills_guest_phone
        ON bills (guest_phone) WHERE guest_phone IS NOT NULL
    `);

    /* ======================================================================
       THE CAFÉ'S OWN BILLING IDENTITY

       Receipts were headed with the name ManagerXP typed when the
       subscription was created — an internal label, not the trading name the
       café prints on a customer's receipt. Those are two different things:
       "Riverside Arena Pvt Ltd" is who signed up; "Riverside Gaming Café" is
       what the customer should see.

       Kept in app_settings because it belongs to the café and is edited from
       their own console, not from the platform admin.
       ====================================================================== */
    await client.query(`
      INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
        ('billing.business_name', '', 'string', 'billing',
         'Trading name printed on receipts. Blank falls back to the café name on the subscription.'),
        ('billing.address',       '', 'string', 'billing', 'Address block printed under the name'),
        ('billing.phone',         '', 'string', 'billing', 'Contact number printed on receipts'),
        ('billing.email',         '', 'string', 'billing', 'Contact email printed on receipts'),
        ('billing.tax_number',    '', 'string', 'billing', 'GSTIN or tax registration number'),
        ('billing.receipt_footer','Thank you for playing', 'string', 'billing',
         'Line printed at the bottom of every receipt'),

        -- Tax. Applied at bill level from this rate; a zero rate means the
        -- café is not registered and no tax line is shown at all.
        ('billing.tax_enabled',  'false', 'boolean', 'billing',
         'Charge tax on bills'),
        ('billing.tax_label',    'GST',   'string',  'billing',
         'What the tax is called on the receipt (GST, VAT, Sales Tax)'),
        ('billing.tax_percent',  '0',     'number',  'billing',
         'Tax percentage applied to the discounted subtotal'),
        ('billing.tax_inclusive','false', 'boolean', 'billing',
         'Prices already include tax — the receipt shows the tax contained rather than adding it'),

        -- The printed template.
        ('billing.logo',         '',      'string',  'billing',
         'Café logo for the receipt head, stored as a data URI'),
        ('billing.receipt_width','80mm',  'string',  'billing',
         'Paper width: 58mm, 80mm or a4'),
        ('billing.receipt_show', 'logo,address,phone,tax_number,cashier,customer,footer', 'string', 'billing',
         'Which optional blocks the receipt prints'),
        ('billing.receipt_header_note','', 'string', 'billing',
         'Optional line under the café name, e.g. a tagline'),

        /* The ManagerXP mark under the café's own footer.
           A separate key rather than another entry in receipt_show, because
           that column already exists on every install with its own value —
           adding a name to the default list would not switch it on for
           anybody who had ever opened the editor. This defaults to true on
           its own terms, and turning it off is one click. */
        ('billing.receipt_powered_by','true', 'boolean', 'billing',
         'Print the small "Powered by ManagerXP" line at the foot of receipts'),

        /* The PIN that unlocks a station's kiosk from the keyboard.
           Blank means the Ctrl+Alt+Shift+Q escape hatch is refused outright —
           safe by default, because a station that ships with a known PIN is
           a station every customer can unlock. Set one in Settings to enable
           it. Staff can always minimise a client from the console instead,
           which needs no PIN because it is already an authenticated action. */
        ('client.staff_unlock_pin','', 'string', 'client',
         'Four-digit PIN staff type after Ctrl+Alt+Shift+Q to unlock a station kiosk'),

        /* What happens on a station when a session ends.

           The three that are on by default are housekeeping: the game stops,
           CafeXP forgets the customer, the machine goes back on the floor.

           The two that are off by default touch the customer's own launcher
           accounts. Signing a launcher out is what stops the next customer
           inheriting the last one's Steam or Riot login — it is the point of
           the feature — but it also clears saved credentials on that machine,
           so it is switched on deliberately per launcher rather than assumed.
           The signout field is a per-launcher map, e.g. Steam true, Riot true. */
        ('session.cleanup',
         '{"close_game":true,"close_launcher":false,"clear_session":true,"return_available":true,"signout":{}}',
         'json', 'client',
         'What a station does when a session ends: close the game, close or sign out of launchers, free the PC')
      ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
    `);

    console.log('✅ Refund tables created/verified');

    /* The multi-tenant foundation runs last, because its backfill reads
       cafes, branches, subscriptions, pcs and license_keys — every one of
       which has to exist and be up to date first. */
    await initializeTenancy(client);

    /* The catalogue runs after tenancy because it extends `features`, which
       tenancy creates, and seeds packages that reference organizations'
       subscriptions. */
    await initializeCatalogue(client);

    /* The admin schema last: its audit table references organizations and
       branches, and its bootstrap reads the legacy admin user. */
    await initializeAdmin(client);

    /* Billing last: its refunds reference admin_users, and its invoices
       reference organizations and subscriptions. */
    await initializeBilling(client);

    /* The location master last: its backfill reads the organizations it is
       matching, and its columns hang off tables created above. */
    await initializeLocations(client);

    // Expenses reference cafes only, so any point after tenancy is safe —
    // placed last simply because it is the newest addition.
    await initializeExpenses(client);

    /* Pricing rules reference cafes and software_master, and add columns to
       sessions — all of which exist by this point. */
    await initializePricingRules(client);

    /* Last: it backfills using sessions and pcs, so every table it reads to
       decide ownership must already exist and be populated. */
    await initializeCatalogueTenancy(client);

    // References software_master and cafes, both settled by now.
    await initializeSoftwareCategories(client);

    // Adds columns to users and customers, both created at the top of this function.
    await initializeAccountReset(client);

    /* Last of the tenancy work: it traces ownership through bills, sessions
       and stations, so every one of those must already be in place. */
    await initializeCafeScoping(client);

    /* Settings last: it drops app_settings' primary key, so anything that
       seeds a setting must already have run. */
    await initializeSettingsScoping(client);

    // Adds columns to customers, which by now carries its cafe_id.
    await initializeCustomerTiers(client);

    console.log('✅ Platform billing tables created/verified');

    /* The game catalog depends on pcs (for pc_games) and, for its one-time
       migration off the first version of this feature, on the old `games`
       table already existing — so it runs here near the end. */
    await initializeGameCatalog(client);
    console.log('✅ Game catalog created/verified');

    /* Corrects manager_games' "one game = one launcher" assumption — depends
       on manager_games/cafe_games/pc_games (migrated from, above) and on
       sessions (gains game_id/game_platform_id/game_account_id) already
       existing. */
    await initializeGamePlatforms(client);

    /* Depends on organizations, branches, users and admin_users. */
    await initializeSupport(client);
    console.log('✅ Support tickets created/verified');

    /* Depends on cafes. */
    await initializeCafeSlugs(client);

    /* Depends on cafes, pcs, customers and sessions. */
    await initializeReservations(client);

    /* ======================================================================
       NAV-VISIBILITY PERMISSIONS

       Game Credentials, Discovery, Server Log and Expenses were gated on the
       nearest existing permission key (sessions.manage, floor.manage,
       settings.manage, reports.view) when Roles-based sidebar visibility
       first shipped — real, purpose-built keys are cleaner and let an owner
       grant each independently rather than as a side effect of a broader
       permission. Owner and Manager only by default, same as every other
       sensitive key added after the original seed (floor.layout, ai.ask,
       station.power): a role that already had the old proxy key does not
       automatically inherit these, so an owner who does want a Cashier
       managing game logins or reading expenses grants it explicitly.
       ====================================================================== */
    await client.query(`
      INSERT INTO permissions (permission_key, category, description) VALUES
        ('games.credentials', 'catalogue', 'Manage game account credentials'),
        ('floor.discovery',   'floor',     'See and register stations discovered on the network'),
        ('system.logs',       'system',    'See the console server log'),
        ('expenses.view',     'expenses',  'See café expenses')
      ON CONFLICT (permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r CROSS JOIN permissions p
      WHERE p.permission_key IN ('games.credentials', 'floor.discovery', 'system.logs', 'expenses.view')
        AND r.is_system = TRUE
        AND LOWER(r.role_name) IN ('owner', 'manager')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Nav-visibility permissions seeded');

    console.log('✅ Users table created/verified');

    // Seed subscription_plans table with default data if empty
    const planCheck = await client.query('SELECT COUNT(*) FROM subscription_plans');
    if (planCheck.rows[0].count === '0') {
      await client.query(`
        INSERT INTO subscription_plans (
          subs_software,
          name,
          max_branches,
          is_single_pc_price,
          max_pcs,
          is_telmetry_enabled,
          no_of_days,
          is_active,
          is_freeTrial,
          description
        )
        VALUES (
          'cafexp',
          'Free Trial Plan',
          1,
          FALSE,
          5,
          TRUE,
          15,
          TRUE,
          TRUE,
          '15-day free trial with limited PCs and basic game access'
        )
      `);
      console.log('✅ Default subscription plan seeded');
    }
    
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

export default pool;