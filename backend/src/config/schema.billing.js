/*
 * SaaS billing — what a café pays ManagerXP.
 *
 * Deliberately separate tables from the café's own till. `payments`,
 * `refunds` and `bills` are a customer buying an hour of gaming; these are a
 * café buying a subscription. The spec calls this out and it is worth
 * repeating, because the two would be catastrophic to merge: a café's revenue
 * report would include its own subscription fee, and a refund issued to a
 * gamer would look like a credit against a subscription.
 *
 * Two rules shape everything below.
 *
 * Financial records are never destroyed. An invoice raised in error is
 * VOIDED, with a reason and a timestamp; the row survives because it was
 * numbered, and a gap in a numbered sequence is a question an accountant will
 * eventually ask.
 *
 * Every amount is a snapshot. An invoice copies the price, the discount and
 * the tax rate that applied on the day it was issued. Recomputing a historical
 * invoice from today's package price is how customers get billed for a
 * decision made after they paid.
 */

export const initializeBilling = async (client) => {
  /* ======================================================================
     INVOICES
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS subscription_invoices (
      invoice_id SERIAL PRIMARY KEY,
      invoice_no VARCHAR(32) UNIQUE NOT NULL,

      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE SET NULL,
      subscription_id INTEGER REFERENCES subscriptions(subscription_id) ON DELETE SET NULL,
      cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE SET NULL,

      -- The service window this invoice covers. Unique per subscription, which
      -- is what stops the monthly run billing the same month twice.
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      billing_period VARCHAR(16) NOT NULL DEFAULT 'monthly',

      currency VARCHAR(8) NOT NULL DEFAULT 'INR',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,

      -- Kept on the row rather than summed on every read: an invoice list is
      -- the commonest query in this module and it always wants the balance.
      amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount_refunded NUMERIC(12,2) NOT NULL DEFAULT 0,

      status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('DRAFT','OPEN','PARTIALLY_PAID','PAID','OVERDUE',
                          'PARTIALLY_REFUNDED','REFUNDED','VOID')),

      due_date DATE,
      issued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMPTZ,
      voided_at TIMESTAMPTZ,
      void_reason VARCHAR(255),
      notes VARCHAR(500),

      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* One invoice per subscription per period. This is the idempotency guard
     for the billing run: running it twice in a day, or twice by accident,
     cannot produce two invoices for the same month. A voided invoice is
     excluded so a corrected re-issue is possible. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_subscription_period
      ON subscription_invoices (subscription_id, period_start)
      WHERE status <> 'VOID'
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invoice_org ON subscription_invoices (organization_id, issued_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invoice_status ON subscription_invoices (status, due_date)
  `);

  /* Lines, so an invoice can show the package and each add-on separately
     rather than one unexplained figure. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS subscription_invoice_lines (
      line_id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES subscription_invoices(invoice_id) ON DELETE CASCADE,
      kind VARCHAR(16) NOT NULL DEFAULT 'PLAN'
        CHECK (kind IN ('PLAN','ADDON','ADJUSTMENT')),
      description VARCHAR(255) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invoice_lines ON subscription_invoice_lines (invoice_id, sort_order)
  `);

  /* ======================================================================
     PAYMENTS — extending the table that already records money received
     ====================================================================== */
  await client.query(`
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS invoice_id
      INTEGER REFERENCES subscription_invoices(invoice_id) ON DELETE SET NULL
  `);
  await client.query(`
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS organization_id
      INTEGER REFERENCES organizations(organization_id) ON DELETE SET NULL
  `);
  await client.query(`
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'SUCCESS'
  `);
  await client.query(`ALTER TABLE subscription_payments DROP CONSTRAINT IF EXISTS subpay_status_check`);
  await client.query(`
    ALTER TABLE subscription_payments ADD CONSTRAINT subpay_status_check
      CHECK (status IN ('PENDING','SUCCESS','FAILED','REFUNDED','PARTIALLY_REFUNDED'))
  `);
  await client.query(`
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS amount_refunded NUMERIC(12,2) NOT NULL DEFAULT 0
  `);

  /* Backfill the organization from the café, so the admin list can group by
     customer without a join through cafes for every row. */
  await client.query(`
    UPDATE subscription_payments sp SET organization_id = c.organization_id
    FROM cafes c WHERE c.cafe_id = sp.cafe_id AND sp.organization_id IS NULL
  `);

  /* ======================================================================
     REFUNDS

     Its own table, and its own numbering. The café-side `refunds` table is a
     gamer getting money back for a drink; this is ManagerXP returning
     subscription revenue. Section 38 is explicit that these must not be
     mixed, and a shared table would make every revenue report wrong.

     A refund always points at the payment it reverses, which is what keeps
     "how much of this invoice is still ours" answerable.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS subscription_refunds (
      refund_id SERIAL PRIMARY KEY,
      refund_no VARCHAR(32) UNIQUE NOT NULL,

      invoice_id INTEGER REFERENCES subscription_invoices(invoice_id) ON DELETE SET NULL,
      payment_id INTEGER REFERENCES subscription_payments(payment_id) ON DELETE SET NULL,
      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE SET NULL,

      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      currency VARCHAR(8) NOT NULL DEFAULT 'INR',
      reason VARCHAR(255) NOT NULL,
      method VARCHAR(32) NOT NULL DEFAULT 'original'
        CHECK (method IN ('original','bank_transfer','cash','cheque','credit','other')),
      reference VARCHAR(160),

      status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED'
        CHECK (status IN ('PENDING','COMPLETED','FAILED')),

      refunded_by INTEGER REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
      refunded_by_email VARCHAR(160),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_subrefund_invoice ON subscription_refunds (invoice_id)
  `);

  /* ======================================================================
     NUMBERING

     A sequence, not MAX(id)+1. Two invoices raised in the same instant by two
     requests would otherwise be handed the same number, and an invoice number
     is the one field a customer quotes back.
     ====================================================================== */
  await client.query(`CREATE SEQUENCE IF NOT EXISTS subscription_invoice_no_seq START 1000`);
  await client.query(`CREATE SEQUENCE IF NOT EXISTS subscription_refund_no_seq START 1000`);

  /* ======================================================================
     PAYMENT LINKS AGAINST AN INVOICE

     `payment_links` already exists and already carries a token, an amount and
     a provider order. It gains an invoice, so that paying a link settles the
     invoice it was raised for rather than floating free.
     ====================================================================== */
  await client.query(`
    ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS invoice_id
      INTEGER REFERENCES subscription_invoices(invoice_id) ON DELETE SET NULL
  `);
  await client.query(`
    ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS organization_id
      INTEGER REFERENCES organizations(organization_id) ON DELETE SET NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paylink_invoice ON payment_links (invoice_id)
  `);

  /* Who raised it. `created_by` points at `users`, which is where café owners
     live — a ManagerXP administrator is not in that table, so its id has
     nowhere to go and every admin-created link recorded a null. This is the
     column that answers "who sent this customer a bill". */
  await client.query(`
    ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS created_by_admin
      INTEGER REFERENCES admin_users(admin_user_id) ON DELETE SET NULL
  `);
  await client.query(`ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0`);

  /* Backfill the organization from the café so the new console, which thinks
     in organizations, can group links it did not create. */
  await client.query(`
    UPDATE payment_links l SET organization_id = c.organization_id
    FROM cafes c WHERE c.cafe_id = l.cafe_id AND l.organization_id IS NULL
  `);

  /* ManagerXP's own merchant account is the gateway row with no café attached.
     The table's UNIQUE (cafe_id, provider) does not constrain those rows,
     because Postgres treats NULLs as distinct — so two platform Razorpay rows
     could exist and `platformGateway` would silently pick whichever sorted
     first. This closes that. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_gateway_provider
      ON payment_gateways (provider) WHERE cafe_id IS NULL
  `);

  /* ======================================================================
     EMAIL OUTBOX

     Written before a message is handed to SMTP, and kept whether or not it
     went. Without it a failed send is invisible: the operator sees a button
     that did nothing and the customer sees no invoice. With it, the message
     survives to be retried or read out.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_outbox (
      outbox_id SERIAL PRIMARY KEY,
      to_email VARCHAR(255) NOT NULL,
      to_name VARCHAR(160),
      subject VARCHAR(255) NOT NULL,
      body_html TEXT,
      body_text TEXT,

      kind VARCHAR(32) NOT NULL DEFAULT 'other',
      related_type VARCHAR(32),
      related_id VARCHAR(64),
      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE SET NULL,

      status VARCHAR(16) NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED','SENT','FAILED')),
      error VARCHAR(500),
      attempts INTEGER NOT NULL DEFAULT 1,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox (status, created_at DESC)
  `);

  /* ======================================================================
     SETTING SCOPE

     `app_settings` began as one café's configuration — its hourly rate, its
     GST percentage — and the café-facing API reads it with `SELECT *`. Adding
     platform settings to the same table therefore handed every café owner the
     SMTP password and a way to edit their own trial length.

     Scope closes that. A café API may only see and write 'cafe' rows; the
     ManagerXP console owns 'platform'. Marking the platform rows explicitly,
     rather than filtering by key prefix, means a new setting is café-scoped
     unless somebody says otherwise — the safe direction to be wrong in.
     ====================================================================== */
  await client.query(`
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS scope VARCHAR(16) NOT NULL DEFAULT 'cafe'
  `);
  /* Values never returned in the clear, not even to an administrator. The
     console shows whether one is set, and can replace it. */
  await client.query(`
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS is_secret BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await client.query(`
    UPDATE app_settings SET scope = 'platform'
    WHERE category IN ('trial','mail','admin','entitlements','usage')
       OR setting_key LIKE 'platform.%'
       OR setting_key LIKE 'subscription.%'
  `);
  await client.query(`
    UPDATE app_settings SET is_secret = TRUE
    WHERE setting_key IN ('mail.smtp_password')
  `);

  /* ======================================================================
     SETTINGS

     `platform.tax_percent`, not `billing.tax_percent` — the latter already
     exists and is the café's GST on its own bills. Two different taxes on two
     different transactions; sharing the key would tie a café's menu pricing to
     what ManagerXP charges it.
     ====================================================================== */
  await client.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
      ('platform.tax_percent', '18', 'number', 'billing',
       'Tax added to ManagerXP subscription invoices, as a percentage'),
      ('platform.invoice_due_days', '7', 'number', 'billing',
       'How long a subscription invoice may go unpaid before it is overdue'),
      ('platform.invoice_prefix', 'INV', 'string', 'billing',
       'Prefix for subscription invoice numbers'),
      ('platform.auto_bill', 'false', 'boolean', 'billing',
       'Whether the monthly billing run issues invoices automatically'),
      ('platform.pay_base_url', '${process.env.PUBLIC_BASE_URL || 'http://localhost:5173'}', 'string', 'billing',
       'Where payment links point — the public address of the website'),
      ('platform.link_expiry_days', '14', 'number', 'billing',
       'How long a payment link stays usable'),

      /* SMTP. Empty by default, and the mailer treats that as "not configured"
         rather than failing — nothing is sent, and the caller is told so. */
      ('mail.smtp_host', '', 'string', 'mail', 'SMTP server hostname'),
      ('mail.smtp_port', '587', 'number', 'mail', 'SMTP port'),
      ('mail.smtp_secure', 'false', 'boolean', 'mail', 'Use TLS from the start (port 465)'),
      ('mail.smtp_user', '', 'string', 'mail', 'SMTP username'),
      ('mail.smtp_password', '', 'string', 'mail', 'SMTP password'),
      ('mail.from_address', 'no-reply@managerxp.com', 'string', 'mail', 'Address outbound email is sent from'),
      ('mail.from_name', 'ManagerXP', 'string', 'mail', 'Display name on outbound email')
    ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
  `);

  /* Repeated after the seed, because on a first boot the rows above did not
     exist when scope was first applied and would have defaulted to 'cafe'.
     Identical predicate, no AND/OR mixing: `billing` is deliberately absent
     from the category list, since the café's own GST lives there and is
     theirs — only the platform- and subscription-prefixed keys move. */
  await client.query(`
    UPDATE app_settings SET scope = 'platform'
    WHERE category IN ('trial','mail','admin','entitlements','usage')
       OR setting_key LIKE 'platform.%'
       OR setting_key LIKE 'subscription.%'
  `);
  await client.query(`
    UPDATE app_settings SET is_secret = TRUE WHERE setting_key = 'mail.smtp_password'
  `);
};
