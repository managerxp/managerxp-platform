/*
 * Support tickets.
 *
 * One conversation between a café and ManagerXP. The café raises it from their
 * portal; ManagerXP staff answer it from the admin console. Both sides read the
 * same thread, with one exception: an internal note is written by staff, stored
 * on the thread, and never returned to the café — somewhere to record "this
 * customer is three invoices behind" without saying it to them.
 *
 * A ticket belongs to an organization, not to a person. Whoever from that café
 * signs in can see it, which is what a café with two owners and a manager
 * actually needs; the alternative — tickets visible only to whoever typed them
 * — leaves a café unable to follow up when that person is off shift.
 */

export const TICKET_STATUSES = ['OPEN', 'PENDING', 'ANSWERED', 'RESOLVED', 'CLOSED'];
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const TICKET_CATEGORIES = ['BILLING', 'TECHNICAL', 'ACCOUNT', 'FEATURE', 'OTHER'];

export const initializeSupport = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      ticket_id       SERIAL PRIMARY KEY,
      -- A short human reference for "I'm calling about TKT-000042".
      reference       VARCHAR(16) UNIQUE,
      organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
      branch_id       INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,

      subject         VARCHAR(200) NOT NULL,
      category        VARCHAR(16) NOT NULL DEFAULT 'OTHER'
        CHECK (category IN ('BILLING','TECHNICAL','ACCOUNT','FEATURE','OTHER')),
      priority        VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
      status          VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','PENDING','ANSWERED','RESOLVED','CLOSED')),

      -- Who raised it, captured at the time. Kept as text as well as an id so a
      -- closed ticket still names its author after that user is removed.
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name    VARCHAR(160),
      created_by_email   VARCHAR(160),

      assigned_admin_id  INTEGER REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,

      /* Which side spoke last, and when. This is what sorts a support queue
         usefully: a ticket the customer answered an hour ago matters more than
         one nobody has touched since staff replied last week. */
      last_reply_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_reply_by   VARCHAR(16) NOT NULL DEFAULT 'customer'
        CHECK (last_reply_by IN ('customer','support')),

      created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      resolved_at     TIMESTAMPTZ,
      closed_at       TIMESTAMPTZ
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_org
      ON support_tickets (organization_id, last_reply_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
      ON support_tickets (status, priority, last_reply_at DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      message_id  SERIAL PRIMARY KEY,
      ticket_id   INTEGER NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,

      -- 'customer' is the café, 'support' is ManagerXP.
      author_type VARCHAR(16) NOT NULL CHECK (author_type IN ('customer','support')),
      author_id   INTEGER,
      author_name VARCHAR(160),

      body        TEXT NOT NULL,
      /* A staff-only note. Never included in anything the portal returns —
         enforced in the controller, not merely by the UI declining to draw it. */
      is_internal BOOLEAN NOT NULL DEFAULT FALSE,

      created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
      ON support_messages (ticket_id, created_at ASC)
  `);

  /*
   * Files on a ticket — the screenshot that explains the problem faster than
   * three paragraphs.
   *
   * The bytes are NOT written to `src/uploads`, which express serves statically
   * with no authentication: a café's screenshot may show their takings, their
   * customers or their error logs, and anything under that folder is readable
   * by anyone who guesses the URL. They go to `storage/support` instead, are
   * given a random name on disk so the original filename can never steer a
   * path, and are handed out only by an endpoint that checks who is asking.
   */
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_attachments (
      attachment_id  SERIAL PRIMARY KEY,
      ticket_id      INTEGER NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,
      message_id     INTEGER REFERENCES support_messages(message_id) ON DELETE CASCADE,

      -- What it is called on disk (random) versus what the customer called it.
      stored_name    VARCHAR(128) NOT NULL,
      original_name  VARCHAR(255) NOT NULL,
      mime_type      VARCHAR(128) NOT NULL,
      size_bytes     INTEGER NOT NULL,

      uploaded_by_type VARCHAR(16) NOT NULL CHECK (uploaded_by_type IN ('customer','support')),
      uploaded_by_id   INTEGER,
      /* An attachment on an internal note is itself internal — the café must
         not receive it, and this is what the portal query filters on. */
      is_internal    BOOLEAN NOT NULL DEFAULT FALSE,

      created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_support_attachments_ticket
      ON support_attachments (ticket_id, created_at ASC)
  `);

  /* The reference is derived from the id, so it cannot collide and needs no
     counter of its own. Applied to any row that predates this. */
  await client.query(`
    UPDATE support_tickets
       SET reference = 'TKT-' || LPAD(ticket_id::text, 6, '0')
     WHERE reference IS NULL
  `);
};
