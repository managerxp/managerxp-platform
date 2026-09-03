/*
 * Multi-tenant isolation.
 *
 * The rule this file exists to enforce, from the spec and worth repeating:
 * a user from Organization A must never reach Organization B, and a Hyderabad
 * manager must never reach Bangalore.
 *
 * The mechanism is simple and deliberately unbypassable: an organization_id
 * or branch_id arriving in a request body, query string or path is treated as
 * a *claim*, never as an instruction. Every one is checked against the
 * membership rows for the authenticated user before anything is read or
 * written. Code downstream reads req.tenant, which is derived here and cannot
 * be influenced by the caller.
 *
 * This is the single most security-sensitive file in Phase 1, because every
 * other endpoint trusts it.
 */
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(header.slice(7).trim(), process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

/** Roles that may act on the whole organization rather than one branch. */
const ORG_WIDE = ['OWNER'];

/**
 * Load everything the request needs to know about who this is.
 *
 * One query rather than several: an authorisation check that costs three
 * round trips gets cached or skipped by someone in a hurry, and a skipped
 * authorisation check is the bug this file exists to prevent.
 */
const loadMemberships = async (userId) => {
  const orgs = (await pool.query(`
    SELECT ou.organization_id, ou.role, ou.status,
           o.name, o.status AS org_status, o.currency, o.timezone
    FROM organization_users ou
    JOIN organizations o ON o.organization_id = ou.organization_id
    WHERE ou.user_id = $1 AND ou.status = 'ACTIVE'
  `, [userId])).rows;

  const branches = (await pool.query(`
    SELECT bu.branch_id, bu.organization_id, bu.role, b.name, b.cafe_id
    FROM branch_users bu
    JOIN branches b ON b.branch_id = bu.branch_id
    WHERE bu.user_id = $1 AND bu.status = 'ACTIVE'
  `, [userId])).rows;

  return { orgs, branches };
};

/**
 * Require a signed-in portal user and attach their tenancy.
 *
 * Does not choose an organization — that is `withOrganization`'s job, because
 * some endpoints (like /api/me) legitimately span all of them.
 */
export const requirePortalUser = async (req, res, next) => {
  const payload = readToken(req);
  if (!payload || !payload.id) {
    return res.status(401).json({ success: false, message: 'Sign in to continue' });
  }

  try {
    const { orgs, branches } = await loadMemberships(payload.id);

    req.tenant = {
      userId: payload.id,
      email: payload.email,
      organizations: orgs,
      branches,
      /* Convenience lookups, built once. Every guard below is a map read
         rather than another query. */
      orgRole: Object.fromEntries(orgs.map((o) => [String(o.organization_id), o.role])),
      branchRole: Object.fromEntries(branches.map((b) => [String(b.branch_id), b.role]))
    };

    next();
  } catch (error) {
    console.error('[tenancy] could not load memberships:', error.message);
    res.status(500).json({ success: false, message: 'Could not verify your access' });
  }
};

/**
 * Resolve and authorise the organization for this request.
 *
 * Takes the id from the header, the body, the query or the path — and then
 * ignores all of that unless the user is actually a member. A caller who
 * supplies someone else's organization gets the same answer as one who
 * supplies nothing: their own.
 */
export const withOrganization = (options = {}) => async (req, res, next) => {
  const t = req.tenant;
  if (!t) {
    return res.status(401).json({ success: false, message: 'Sign in to continue' });
  }

  const claimed =
    req.headers['x-organization-id'] ||
    req.body?.organization_id ||
    req.query?.organization_id ||
    req.params?.organizationId;

  let organizationId = null;

  if (claimed != null && String(claimed).trim() !== '') {
    const id = Number(claimed);
    if (!Number.isInteger(id) || !t.orgRole[String(id)]) {
      /* Deliberately the same answer as "does not exist". Confirming that an
         organization is real but not theirs tells an attacker which ids are
         worth trying. */
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    organizationId = id;
  } else if (t.organizations.length === 1) {
    // The common case: one business, no need to ask.
    organizationId = t.organizations[0].organization_id;
  } else if (t.organizations.length === 0) {
    return res.status(403).json({
      success: false,
      message: 'Your account is not linked to a business yet'
    });
  } else {
    return res.status(400).json({
      success: false,
      message: 'Choose which business this applies to',
      data: { organizations: t.organizations.map((o) => ({ id: o.organization_id, name: o.name })) }
    });
  }

  const org = t.organizations.find((o) => o.organization_id === organizationId);
  if (org.org_status !== 'ACTIVE' && !options.allowSuspended) {
    return res.status(403).json({
      success: false,
      message: 'This account is suspended. Contact ManagerXP.'
    });
  }

  req.tenant.organizationId = organizationId;
  req.tenant.organization = org;
  req.tenant.role = t.orgRole[String(organizationId)];
  req.tenant.isOwner = ORG_WIDE.includes(req.tenant.role);

  /* Which branches this user may act on inside this organization. An owner
     gets all of them; anyone else gets exactly what branch_users says. */
  const orgBranches = t.branches.filter((b) => b.organization_id === organizationId);
  if (req.tenant.isOwner) {
    const all = (await pool.query(
      `SELECT branch_id, name, cafe_id FROM branches
       WHERE organization_id = $1 AND status <> 'CLOSED' ORDER BY branch_id`,
      [organizationId]
    )).rows;
    req.tenant.allowedBranchIds = all.map((b) => b.branch_id);
    req.tenant.branchList = all;
  } else {
    req.tenant.allowedBranchIds = orgBranches.map((b) => b.branch_id);
    req.tenant.branchList = orgBranches.map((b) => ({
      branch_id: b.branch_id, name: b.name, cafe_id: b.cafe_id
    }));
  }

  next();
};

/**
 * Resolve and authorise a branch.
 *
 * `required: false` allows an "All branches" view for someone entitled to
 * more than one — the caller then filters by allowedBranchIds rather than by
 * a single id.
 */
export const withBranch = (options = {}) => (req, res, next) => {
  const t = req.tenant;
  if (!t || !t.organizationId) {
    return res.status(400).json({ success: false, message: 'No business selected' });
  }

  const claimed =
    req.headers['x-branch-id'] ||
    req.body?.branch_id ||
    req.query?.branch_id ||
    req.params?.branchId;

  if (claimed == null || String(claimed).trim() === '' || String(claimed) === 'all') {
    if (options.required) {
      return res.status(400).json({ success: false, message: 'Choose a branch' });
    }
    req.tenant.branchId = null;   // meaning: every branch they may see
    return next();
  }

  const id = Number(claimed);
  // The check that stops a Hyderabad manager reading Bangalore.
  if (!Number.isInteger(id) || t.allowedBranchIds.indexOf(id) === -1) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  req.tenant.branchId = id;
  next();
};

/** Only an owner may do this — organization settings, billing, invites. */
export const requireOwner = (req, res, next) => {
  if (!req.tenant?.isOwner) {
    return res.status(403).json({
      success: false,
      message: 'Only the account owner can do this'
    });
  }
  next();
};

/**
 * Confirm a record actually belongs to the resolved tenant.
 *
 * The last line of defence, for endpoints that take a resource id directly.
 * Authorising the organization is not enough on its own: /branches/57 has to
 * check that branch 57 is in THIS organization, or membership becomes a key
 * to every id in the table.
 */
export const assertOwnership = async (table, idColumn, id, organizationId) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE ${idColumn} = $1 AND organization_id = $2 LIMIT 1`,
    [id, organizationId]
  );
  return rows.length > 0;
};

/** Append to the tenant audit trail. Never throws — see the note. */
export const recordTenantAudit = async (req, entry) => {
  try {
    await pool.query(`
      INSERT INTO tenant_audit
        (actor_user_id, organization_id, branch_id, action, resource_type, resource_id, metadata, ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      req.tenant?.userId || null,
      entry.organization_id ?? req.tenant?.organizationId ?? null,
      entry.branch_id ?? req.tenant?.branchId ?? null,
      entry.action,
      entry.resource_type || null,
      entry.resource_id != null ? String(entry.resource_id) : null,
      JSON.stringify(entry.metadata || {}),
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    ]);
  } catch (error) {
    /* An audit failure must never fail the action it was recording. Losing a
       log line is bad; refusing to create a branch because the log line
       failed is worse. */
    console.error('[tenancy] audit write failed:', error.message);
  }
};
