import pool from '../config/database.js';

/*
 * Reading the audit trail.
 *
 * There is no create, update or delete here on purpose — rows are written by
 * the actions themselves through config/audit.js, and nothing may edit them
 * afterwards.
 */

const shape = (row) => ({
  audit_id: Number(row.audit_id),
  actor_kind: row.actor_kind,
  actor_id: row.actor_id,
  actor_name: row.actor_name,
  actor_role: row.actor_role,
  action: row.action,
  category: row.category,
  entity: row.entity,
  entity_id: row.entity_id,
  summary: row.summary,
  amount: row.amount === null ? null : Number(row.amount),
  sensitive: row.sensitive,
  meta: row.meta,
  ip_address: row.ip_address,
  created_at: row.created_at
});

/*
 * GET /api/audit
 *   ?search= &category= &actor_id= &entity= &entity_id=
 *   &sensitive=true &from= &to= &limit= &offset=
 */
export const listAudit = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const where = [];
    const params = [];
    const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

    if (req.query.category) add('category = ?', String(req.query.category));
    if (req.query.action) add('action = ?', String(req.query.action));
    if (req.query.entity) add('entity = ?', String(req.query.entity));
    if (req.query.entity_id) add('entity_id = ?', String(req.query.entity_id));
    if (req.query.actor_id) add('actor_id = ?', parseInt(req.query.actor_id, 10));
    if (req.query.sensitive === 'true') where.push('sensitive = TRUE');
    if (req.query.from) add('created_at >= ?', new Date(req.query.from).toISOString());
    if (req.query.to) add('created_at <= ?', new Date(req.query.to).toISOString());

    if (req.query.search) {
      // One box over the human-readable fields — how anyone actually looks
      // something up after the fact.
      params.push(`%${String(req.query.search).trim()}%`);
      where.push(`(summary ILIKE $${params.length} OR actor_name ILIKE $${params.length} ` +
        `OR action ILIKE $${params.length})`);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await pool.query(
      `SELECT * FROM audit_log ${clause}
       ORDER BY created_at DESC, audit_id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM audit_log ${clause}`, params
    );

    res.status(200).json({
      success: true,
      data: rows.rows.map(shape),
      pagination: { limit, offset, total: total.rows[0].count }
    });
  } catch (error) {
    console.error('Error reading audit log:', error);
    res.status(500).json({ success: false, message: 'Error reading the audit log' });
  }
};

/** GET /api/audit/facets — what the filter controls should offer. */
export const auditFacets = async (req, res) => {
  try {
    const [categories, actors, actions, counts] = await Promise.all([
      pool.query(`SELECT category, COUNT(*)::int AS count FROM audit_log
                  GROUP BY category ORDER BY count DESC`),
      pool.query(`SELECT actor_id, actor_name, actor_kind, COUNT(*)::int AS count
                  FROM audit_log GROUP BY actor_id, actor_name, actor_kind
                  ORDER BY count DESC LIMIT 50`),
      pool.query(`SELECT action, COUNT(*)::int AS count FROM audit_log
                  GROUP BY action ORDER BY count DESC LIMIT 60`),
      pool.query(`SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE sensitive)::int AS sensitive,
                    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
                    MIN(created_at) AS first_entry
                  FROM audit_log`)
    ]);

    res.status(200).json({
      success: true,
      data: {
        categories: categories.rows,
        actors: actors.rows,
        actions: actions.rows,
        summary: counts.rows[0]
      }
    });
  } catch (error) {
    console.error('Error reading audit facets:', error);
    res.status(500).json({ success: false, message: 'Error reading audit filters' });
  }
};

/** GET /api/audit/entity/:entity/:id — the history of one record. */
export const entityHistory = async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT * FROM audit_log
       WHERE entity = $1 AND entity_id = $2
       ORDER BY created_at DESC LIMIT 200`,
      [String(req.params.entity), String(req.params.id)]
    );
    res.status(200).json({ success: true, data: rows.rows.map(shape) });
  } catch (error) {
    console.error('Error reading entity history:', error);
    res.status(500).json({ success: false, message: 'Error reading history' });
  }
};
