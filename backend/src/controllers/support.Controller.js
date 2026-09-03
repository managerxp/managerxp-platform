/*
 * Support tickets — both ends of the same conversation.
 *
 * The café's handlers (portal*) are scoped to the organization on req.tenant,
 * never to an id from the request: a ticket that is not theirs answers "not
 * found", the same as one that does not exist, so this cannot be used to count
 * how many customers ManagerXP has.
 *
 * The staff handlers (admin*) see every ticket, and only they can write or read
 * an internal note. That exclusion is enforced here, in the query, rather than
 * by the portal choosing not to display them.
 */
import fs from 'fs';
import path from 'path';
import pool from '../config/database.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import { TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES } from '../config/schema.support.js';
import { SUPPORT_UPLOAD_DIR } from '../middleware/supportUpload.js';

const MAX_BODY = 8000;
const MAX_SUBJECT = 200;

const clean = (v, max) => {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
};

const shapeTicket = (r) => ({
  ticket_id: r.ticket_id,
  reference: r.reference,
  subject: r.subject,
  category: r.category,
  priority: r.priority,
  status: r.status,
  organization_id: r.organization_id,
  organization_name: r.organization_name || null,
  branch_id: r.branch_id || null,
  created_by_name: r.created_by_name || null,
  created_by_email: r.created_by_email || null,
  assigned_admin_id: r.assigned_admin_id || null,
  assigned_admin_name: r.assigned_admin_name || null,
  last_reply_at: r.last_reply_at,
  last_reply_by: r.last_reply_by,
  created_at: r.created_at,
  resolved_at: r.resolved_at || null,
  closed_at: r.closed_at || null,
  message_count: r.message_count !== undefined ? Number(r.message_count) : undefined,
  /* True when the other side spoke last — what a queue badge keys off. */
  awaiting_support: r.last_reply_by === 'customer' && !['RESOLVED', 'CLOSED'].includes(r.status),
  awaiting_customer: r.last_reply_by === 'support' && !['RESOLVED', 'CLOSED'].includes(r.status)
});

const shapeMessage = (r) => ({
  message_id: r.message_id,
  author_type: r.author_type,
  author_name: r.author_name || (r.author_type === 'support' ? 'ManagerXP Support' : 'Customer'),
  body: r.body,
  is_internal: !!r.is_internal,
  created_at: r.created_at,
  attachments: r.attachments || []
});

const shapeAttachment = (r) => ({
  attachment_id: r.attachment_id,
  name: r.original_name,
  mime_type: r.mime_type,
  size_bytes: Number(r.size_bytes),
  is_image: String(r.mime_type || '').startsWith('image/'),
  created_at: r.created_at
});

/**
 * Record the uploaded files against a message.
 *
 * The bytes are already on disk by the time this runs — multer wrote them —
 * so a failure here would leave an orphan file. Called inside the same
 * transaction as the message it belongs to, and the files are swept if that
 * transaction rolls back (see `discardFiles`).
 */
const saveAttachments = async (client, { ticketId, messageId, files, byType, byId, isInternal }) => {
  if (!files || !files.length) return [];
  const saved = [];
  for (const f of files) {
    const row = (await client.query(
      `INSERT INTO support_attachments
         (ticket_id, message_id, stored_name, original_name, mime_type, size_bytes,
          uploaded_by_type, uploaded_by_id, is_internal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ticketId, messageId, f.filename, String(f.originalname).slice(0, 255),
       f.mimetype, f.size, byType, byId ?? null, !!isInternal]
    )).rows[0];
    saved.push(shapeAttachment(row));
  }
  return saved;
};

/** Remove files multer wrote for a request that then failed. Never throws. */
const discardFiles = (files) => {
  (files || []).forEach((f) => {
    try { if (f?.path) fs.rmSync(f.path, { force: true }); } catch (e) { /* nothing to do */ }
  });
};

/**
 * Attach each message's files to it.
 *
 * `includeInternal` decides whether staff-only files are returned at all — the
 * portal passes false, so an internal attachment never reaches a café even as
 * a filename.
 */
const withAttachments = async (ticketId, messages, includeInternal) => {
  if (!messages.length) return messages;
  const { rows } = await pool.query(
    `SELECT * FROM support_attachments
      WHERE ticket_id = $1 ${includeInternal ? '' : 'AND NOT is_internal'}
      ORDER BY created_at ASC`, [ticketId]);
  const byMessage = new Map();
  rows.forEach((r) => {
    const key = String(r.message_id);
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(shapeAttachment(r));
  });
  return messages.map((m) => ({ ...m, attachments: byMessage.get(String(m.message_id)) || [] }));
};

/** Record a reply and move the ticket's clock and status with it. */
const addMessage = async (client, ticketId, { authorType, authorId, authorName, body, isInternal }) => {
  const message = (await client.query(
    `INSERT INTO support_messages (ticket_id, author_type, author_id, author_name, body, is_internal)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ticketId, authorType, authorId ?? null, authorName ?? null, body, !!isInternal]
  )).rows[0];

  /* An internal note is not a reply: it must not tell the café that support has
     answered, and it must not stop the ticket showing as awaiting an answer. */
  if (!isInternal) {
    await client.query(
      /* $2 is cast explicitly: it is used both as a value and inside a CASE
         comparison, and without the cast Postgres refuses the statement with
         "inconsistent types deduced for parameter $2". */
      `UPDATE support_tickets
          SET last_reply_at = CURRENT_TIMESTAMP,
              last_reply_by = $2::text,
              /* A reply reopens a resolved ticket rather than leaving somebody
                 talking into a closed thread. */
              status = CASE
                WHEN $2::text = 'support' THEN 'ANSWERED'
                WHEN status IN ('RESOLVED','CLOSED') THEN 'OPEN'
                ELSE 'PENDING'
              END,
              resolved_at = CASE WHEN status IN ('RESOLVED','CLOSED') THEN NULL ELSE resolved_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE ticket_id = $1`,
      [ticketId, authorType]
    );
  }
  return message;
};

/* ==========================================================================
   CAFÉ SIDE  (portal)
   ========================================================================== */

/** GET /api/portal/support/tickets */
export const portalListTickets = async (req, res) => {
  try {
    const orgId = req.tenant.organizationId;
    const { rows } = await pool.query(`
      SELECT t.*, o.name AS organization_name,
             (SELECT COUNT(*) FROM support_messages m
               WHERE m.ticket_id = t.ticket_id AND NOT m.is_internal) AS message_count
        FROM support_tickets t
        LEFT JOIN organizations o ON o.organization_id = t.organization_id
       WHERE t.organization_id = $1
       ORDER BY t.last_reply_at DESC
    `, [orgId]);
    res.json({ success: true, data: rows.map(shapeTicket) });
  } catch (error) {
    console.error('Portal ticket list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load your tickets' });
  }
};

/** POST /api/portal/support/tickets  { subject, category, priority, message } */
export const portalCreateTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const subject = clean(req.body?.subject, MAX_SUBJECT);
    const body = clean(req.body?.message, MAX_BODY);
    if (!subject) return res.status(400).json({ success: false, message: 'Give your ticket a subject' });
    if (!body) return res.status(400).json({ success: false, message: 'Describe the problem so we can help' });

    const category = TICKET_CATEGORIES.includes(String(req.body?.category || '').toUpperCase())
      ? String(req.body.category).toUpperCase() : 'OTHER';
    /* A café may say something is urgent; staff decide what it is worth in the
       queue. Accepted as given — a customer who cannot express urgency simply
       phones instead, which is worse for everyone. */
    const priority = TICKET_PRIORITIES.includes(String(req.body?.priority || '').toUpperCase())
      ? String(req.body.priority).toUpperCase() : 'NORMAL';

    await client.query('BEGIN');
    const ticket = (await client.query(
      `INSERT INTO support_tickets
         (organization_id, branch_id, subject, category, priority,
          created_by_user_id, created_by_name, created_by_email, last_reply_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'customer')
       RETURNING *`,
      [req.tenant.organizationId, req.tenant.branchId ?? null, subject, category, priority,
       req.tenant?.userId ?? null, req.tenant?.name ?? null, req.tenant?.email ?? null]
    )).rows[0];

    await client.query(
      `UPDATE support_tickets SET reference = 'TKT-' || LPAD(ticket_id::text, 6, '0')
        WHERE ticket_id = $1`, [ticket.ticket_id]);

    const first = await addMessage(client, ticket.ticket_id, {
      authorType: 'customer',
      authorId: req.tenant?.userId ?? null,
      authorName: req.tenant?.name || req.tenant?.email || 'Customer',
      body
    });
    await saveAttachments(client, {
      ticketId: ticket.ticket_id, messageId: first.message_id, files: req.files,
      byType: 'customer', byId: req.tenant?.userId ?? null, isInternal: false
    });
    await client.query('COMMIT');

    const fresh = (await client.query(
      'SELECT * FROM support_tickets WHERE ticket_id = $1', [ticket.ticket_id])).rows[0];
    res.status(201).json({
      success: true,
      message: `Ticket ${fresh.reference} raised — we will reply here.`,
      data: shapeTicket(fresh)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // The transaction is gone; the files multer wrote must go with it.
    discardFiles(req.files);
    console.error('Portal ticket create failed:', error);
    res.status(500).json({ success: false, message: 'Could not raise that ticket' });
  } finally {
    client.release();
  }
};

/** GET /api/portal/support/tickets/:id */
export const portalGetTicket = async (req, res) => {
  try {
    const ticket = (await pool.query(
      `SELECT t.*, o.name AS organization_name
         FROM support_tickets t
         LEFT JOIN organizations o ON o.organization_id = t.organization_id
        WHERE t.ticket_id = $1 AND t.organization_id = $2`,
      [parseInt(req.params.id, 10), req.tenant.organizationId])).rows[0];
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });

    /* Internal notes are excluded in SQL. The café's client never receives one,
       so no bug in it can ever reveal one. */
    const messages = (await pool.query(
      `SELECT * FROM support_messages
        WHERE ticket_id = $1 AND NOT is_internal
        ORDER BY created_at ASC`, [ticket.ticket_id])).rows;

    // includeInternal false: a staff-only file is not even named to the café.
    const withFiles = await withAttachments(ticket.ticket_id, messages.map(shapeMessage), false);
    res.json({ success: true, data: { ticket: shapeTicket(ticket), messages: withFiles } });
  } catch (error) {
    console.error('Portal ticket read failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that ticket' });
  }
};

/** POST /api/portal/support/tickets/:id/reply  { message } */
export const portalReply = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = clean(req.body?.message, MAX_BODY);
    const files = req.files || [];
    /* A screenshot on its own is a legitimate reply — "here is what I see" —
       so text is only required when nothing is attached. */
    if (!body && !files.length) {
      return res.status(400).json({ success: false, message: 'Write a reply or attach a file' });
    }

    const ticket = (await client.query(
      'SELECT * FROM support_tickets WHERE ticket_id = $1 AND organization_id = $2',
      [parseInt(req.params.id, 10), req.tenant.organizationId])).rows[0];
    if (!ticket) {
      discardFiles(files);
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    await client.query('BEGIN');
    const message = await addMessage(client, ticket.ticket_id, {
      authorType: 'customer',
      authorId: req.tenant?.userId ?? null,
      authorName: req.tenant?.name || req.tenant?.email || 'Customer',
      body: body || '(attached a file)'
    });
    const attachments = await saveAttachments(client, {
      ticketId: ticket.ticket_id, messageId: message.message_id, files,
      byType: 'customer', byId: req.tenant?.userId ?? null, isInternal: false
    });
    await client.query('COMMIT');

    res.status(201).json({
      success: true, message: 'Reply sent',
      data: { ...shapeMessage(message), attachments }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    discardFiles(req.files);
    console.error('Portal reply failed:', error);
    res.status(500).json({ success: false, message: 'Could not send that reply' });
  } finally {
    client.release();
  }
};

/** POST /api/portal/support/tickets/:id/close — the café is satisfied. */
export const portalCloseTicket = async (req, res) => {
  try {
    const ticket = (await pool.query(
      `UPDATE support_tickets
          SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE ticket_id = $1 AND organization_id = $2 AND status <> 'CLOSED'
        RETURNING *`,
      [parseInt(req.params.id, 10), req.tenant.organizationId])).rows[0];
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: `${ticket.reference} closed`, data: shapeTicket(ticket) });
  } catch (error) {
    console.error('Portal close failed:', error);
    res.status(500).json({ success: false, message: 'Could not close that ticket' });
  }
};

/* ==========================================================================
   MANAGERXP SIDE  (admin console)
   ========================================================================== */

/** GET /api/admin/support/tickets?status=&priority=&search=&organization_id= */
export const adminListTickets = async (req, res) => {
  try {
    const filters = [];
    const params = [];

    if (req.query.status) {
      const wanted = String(req.query.status).split(',')
        .map((s) => s.trim().toUpperCase()).filter((s) => TICKET_STATUSES.includes(s));
      if (wanted.length) { params.push(wanted); filters.push(`t.status = ANY($${params.length})`); }
    }
    if (req.query.priority) {
      const p = String(req.query.priority).toUpperCase();
      if (TICKET_PRIORITIES.includes(p)) { params.push(p); filters.push(`t.priority = $${params.length}`); }
    }
    if (req.query.organization_id) {
      params.push(parseInt(req.query.organization_id, 10));
      filters.push(`t.organization_id = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`(t.subject ILIKE $${params.length} OR t.reference ILIKE $${params.length}
                     OR o.name ILIKE $${params.length})`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(`
      SELECT t.*, o.name AS organization_name, a.name AS assigned_admin_name,
             (SELECT COUNT(*) FROM support_messages m
               WHERE m.ticket_id = t.ticket_id AND NOT m.is_internal) AS message_count
        FROM support_tickets t
        LEFT JOIN organizations o ON o.organization_id = t.organization_id
        LEFT JOIN admin_users a ON a.admin_user_id = t.assigned_admin_id
        ${where}
       ORDER BY
         /* Waiting on us first, then by how loud it is, then oldest-waiting. */
         (t.last_reply_by = 'customer' AND t.status NOT IN ('RESOLVED','CLOSED')) DESC,
         CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
         t.last_reply_at ASC
       LIMIT 300
    `, params);

    const counts = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int AS open,
        COUNT(*) FILTER (WHERE last_reply_by = 'customer'
                           AND status NOT IN ('RESOLVED','CLOSED'))::int AS awaiting,
        COUNT(*) FILTER (WHERE priority = 'URGENT'
                           AND status NOT IN ('RESOLVED','CLOSED'))::int AS urgent
        FROM support_tickets
    `)).rows[0];

    res.json({ success: true, data: { items: rows.map(shapeTicket), counts } });
  } catch (error) {
    console.error('Admin ticket list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load tickets' });
  }
};

/** GET /api/admin/support/tickets/:id — the whole thread, notes included. */
export const adminGetTicket = async (req, res) => {
  try {
    const ticket = (await pool.query(`
      SELECT t.*, o.name AS organization_name, a.name AS assigned_admin_name
        FROM support_tickets t
        LEFT JOIN organizations o ON o.organization_id = t.organization_id
        LEFT JOIN admin_users a ON a.admin_user_id = t.assigned_admin_id
       WHERE t.ticket_id = $1`, [parseInt(req.params.id, 10)])).rows[0];
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });

    const messages = (await pool.query(
      'SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticket.ticket_id])).rows;

    // Staff see everything, internal files included.
    const withFiles = await withAttachments(ticket.ticket_id, messages.map(shapeMessage), true);
    res.json({ success: true, data: { ticket: shapeTicket(ticket), messages: withFiles } });
  } catch (error) {
    console.error('Admin ticket read failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that ticket' });
  }
};

/** POST /api/admin/support/tickets/:id/reply  { message, internal? } */
export const adminReply = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = clean(req.body?.message, MAX_BODY);
    const files = req.files || [];
    if (!body && !files.length) {
      return res.status(400).json({ success: false, message: 'Write a reply or attach a file' });
    }
    /* Sent as multipart when files are attached, so the flag arrives as the
       string "true" rather than a boolean. Both forms are accepted. */
    const internal = req.body?.internal === true || req.body?.internal === 'true';

    const ticket = (await client.query(
      'SELECT * FROM support_tickets WHERE ticket_id = $1', [parseInt(req.params.id, 10)])).rows[0];
    if (!ticket) {
      discardFiles(files);
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    await client.query('BEGIN');
    const message = await addMessage(client, ticket.ticket_id, {
      authorType: 'support',
      authorId: req.admin?.admin_user_id ?? null,
      authorName: req.admin?.name || 'ManagerXP Support',
      body: body || '(attached a file)',
      isInternal: internal
    });
    /* An attachment inherits the message's privacy: a file on an internal note
       is internal too, or the café would receive the very thing the note was
       written to keep from them. */
    await saveAttachments(client, {
      ticketId: ticket.ticket_id, messageId: message.message_id, files,
      byType: 'support', byId: req.admin?.admin_user_id ?? null, isInternal: internal
    });
    /* Answering a ticket nobody owns takes ownership of it — otherwise a queue
       fills with tickets three people have each half-answered. */
    if (!internal && !ticket.assigned_admin_id && req.admin?.admin_user_id) {
      await client.query(
        'UPDATE support_tickets SET assigned_admin_id = $1 WHERE ticket_id = $2',
        [req.admin.admin_user_id, ticket.ticket_id]);
    }
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: internal ? 'support.note' : 'support.reply',
      resource_type: 'ticket', resource_id: ticket.ticket_id,
      organization_id: ticket.organization_id,
      new_value: { reference: ticket.reference, internal }
    });

    res.status(201).json({
      success: true,
      message: internal ? 'Internal note added' : 'Reply sent',
      data: shapeMessage(message)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    discardFiles(req.files);
    console.error('Admin reply failed:', error);
    res.status(500).json({ success: false, message: 'Could not send that reply' });
  } finally {
    client.release();
  }
};

/** PATCH /api/admin/support/tickets/:id  { status?, priority?, assigned_admin_id? } */
export const adminUpdateTicket = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const before = (await pool.query('SELECT * FROM support_tickets WHERE ticket_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const sets = [];
    const params = [id];

    if (req.body?.status !== undefined) {
      const s = String(req.body.status).toUpperCase();
      if (!TICKET_STATUSES.includes(s)) {
        return res.status(400).json({ success: false, message: `Status must be one of ${TICKET_STATUSES.join(', ')}` });
      }
      params.push(s); sets.push(`status = $${params.length}`);
      sets.push(`resolved_at = ${s === 'RESOLVED' ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
      sets.push(`closed_at = ${s === 'CLOSED' ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
    }
    if (req.body?.priority !== undefined) {
      const p = String(req.body.priority).toUpperCase();
      if (!TICKET_PRIORITIES.includes(p)) {
        return res.status(400).json({ success: false, message: `Priority must be one of ${TICKET_PRIORITIES.join(', ')}` });
      }
      params.push(p); sets.push(`priority = $${params.length}`);
    }
    if (req.body?.assigned_admin_id !== undefined) {
      const a = req.body.assigned_admin_id === null ? null : parseInt(req.body.assigned_admin_id, 10);
      params.push(a); sets.push(`assigned_admin_id = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const updated = (await pool.query(
      `UPDATE support_tickets SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE ticket_id = $1 RETURNING *`, params)).rows[0];

    await recordAdminAudit(req, {
      action: 'support.updated', resource_type: 'ticket', resource_id: id,
      organization_id: before.organization_id,
      old_value: { status: before.status, priority: before.priority },
      new_value: { status: updated.status, priority: updated.priority }
    });

    res.json({ success: true, message: `${updated.reference} updated`, data: shapeTicket(updated) });
  } catch (error) {
    console.error('Admin ticket update failed:', error);
    res.status(500).json({ success: false, message: 'Could not update that ticket' });
  }
};

/* ==========================================================================
   ATTACHMENT DOWNLOAD

   Never served statically. Each request is answered only after checking that
   the caller is entitled to this particular file, because the alternative —
   a public URL under /uploads — means any café that guesses a filename reads
   another café's screenshot.
   ========================================================================== */

/** Read an attachment row, or null. */
const loadAttachment = async (id) => {
  if (!Number.isInteger(id)) return null;
  return (await pool.query(
    `SELECT a.*, t.organization_id
       FROM support_attachments a
       JOIN support_tickets t ON t.ticket_id = a.ticket_id
      WHERE a.attachment_id = $1`, [id])).rows[0] || null;
};

/**
 * Stream a file back.
 *
 * The path is rebuilt from the upload directory and the stored (random) name —
 * never from anything the caller sent — and then checked to be inside that
 * directory, so a crafted stored_name could not escape it even if one were
 * somehow written.
 */
const streamAttachment = (res, row) => {
  const full = path.join(SUPPORT_UPLOAD_DIR, row.stored_name);
  const root = path.resolve(SUPPORT_UPLOAD_DIR);
  if (!path.resolve(full).startsWith(root + path.sep)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  if (!fs.existsSync(full)) {
    return res.status(404).json({ success: false, message: 'That file is no longer stored' });
  }

  /* An image is shown in place; anything else downloads. nosniff stops a
     browser second-guessing the type we declare and running it as something
     else. */
  const inline = String(row.mime_type || '').startsWith('image/');
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(row.original_name)}"`
  );
  fs.createReadStream(full).pipe(res);
};

/** GET /api/portal/support/attachments/:id — the café's own files only. */
export const portalGetAttachment = async (req, res) => {
  try {
    const row = await loadAttachment(parseInt(req.params.id, 10));
    /* Three refusals, one answer. Not theirs, does not exist, or internal —
       all "not found", so this cannot be used to probe what exists. */
    if (!row || row.organization_id !== req.tenant.organizationId || row.is_internal) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    streamAttachment(res, row);
  } catch (error) {
    console.error('Portal attachment failed:', error);
    res.status(500).json({ success: false, message: 'Could not fetch that file' });
  }
};

/** GET /api/admin/support/attachments/:id — staff see every file. */
export const adminGetAttachment = async (req, res) => {
  try {
    const row = await loadAttachment(parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    streamAttachment(res, row);
  } catch (error) {
    console.error('Admin attachment failed:', error);
    res.status(500).json({ success: false, message: 'Could not fetch that file' });
  }
};
