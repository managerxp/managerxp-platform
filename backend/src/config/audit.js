import pool from './database.js';

/*
 * The audit trail.
 *
 * Two properties matter more than anything else here:
 *
 *   1. It is append-only. There is no update and no delete, because a trail
 *      that can be tidied up afterwards is not evidence of anything.
 *
 *   2. Writing to it never breaks the action it describes. If the insert
 *      fails, the failure is logged to the console and the caller carries on.
 *      Losing the record of a refund is bad; refusing the refund because the
 *      record could not be written is worse, and would make the audit table an
 *      outage risk for the whole café.
 *
 * Actor details are copied in rather than referenced, so deleting a staff
 * account never erases the history of what that account did.
 */

/** Who is doing this, from whichever guard populated the request. */
const actorOf = (req) => {
  const actor = (req && req.actor) || (req && req.user) || {};

  if (actor.customer_id && !actor.role) {
    return {
      kind: 'customer',
      id: actor.customer_id,
      name: actor.customer_name || actor.email || `Customer ${actor.customer_id}`,
      role: null
    };
  }

  // The café-owner token predates the staff system: it carries a role but no
  // staff_id, and holds full authority.
  const isOwnerToken = actor.role && !actor.staff_id;
  return {
    kind: isOwnerToken ? 'owner' : (actor.role ? 'staff' : 'system'),
    id: actor.staff_id || actor.id || null,
    name: actor.staff_name || actor.email || (actor.role ? 'Café owner' : 'System'),
    role: actor.role_name || actor.role || null
  };
};

/** Best guess at where the request came from, for the trail. */
const ipOf = (req) => {
  if (!req) return null;
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  const raw = (typeof forwarded === 'string' ? forwarded.split(',')[0] : null) ||
    req.ip || (req.socket && req.socket.remoteAddress) || null;
  return raw ? String(raw).replace(/^::ffff:/, '').slice(0, 64) : null;
};

/**
 * Record one action.
 *
 * @param {object} req      the request, for actor and IP; may be null
 * @param {object} entry
 * @param {string} entry.action    verb-ish key, e.g. 'wallet.credit'
 * @param {string} entry.category  grouping for the audit screen
 * @param {string} entry.summary   one plain sentence a café owner can read
 * @param {string} [entry.entity]  what was touched, e.g. 'customer'
 * @param {string|number} [entry.entity_id]
 * @param {number} [entry.amount]  money involved, if any
 * @param {boolean} [entry.sensitive] refunds, discounts, overrides, power
 * @param {object} [entry.meta]    anything else worth keeping
 */
export const recordAudit = async (req, entry) => {
  try {
    if (!entry || !entry.action || !entry.summary) return;

    const actor = actorOf(req);

    await pool.query(
      `INSERT INTO audit_log
         (actor_kind, actor_id, actor_name, actor_role, action, category,
          entity, entity_id, summary, amount, sensitive, meta, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        actor.kind,
        actor.id,
        actor.name ? String(actor.name).slice(0, 160) : null,
        actor.role ? String(actor.role).slice(0, 80) : null,
        String(entry.action).slice(0, 64),
        String(entry.category || 'general').slice(0, 32),
        entry.entity ? String(entry.entity).slice(0, 48) : null,
        entry.entity_id === null || entry.entity_id === undefined
          ? null
          : String(entry.entity_id).slice(0, 64),
        String(entry.summary).slice(0, 400),
        entry.amount === null || entry.amount === undefined ? null : Number(entry.amount),
        !!entry.sensitive,
        entry.meta ? JSON.stringify(entry.meta) : null,
        ipOf(req)
      ]
    );
  } catch (error) {
    // Deliberately swallowed — see the note at the top of this file.
    console.error('Audit write failed:', error.message);
  }
};

export default recordAudit;
