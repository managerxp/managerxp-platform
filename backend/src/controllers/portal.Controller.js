/*
 * The CafeXP customer portal — Phase 1.
 *
 * Everything a café owner does before they ever open the desktop app: create
 * an account, name their business, add branches, invite staff, register
 * installations and watch their trial.
 *
 * Every read and write here is scoped by req.tenant, which the tenancy
 * middleware derived from membership rows — never from an id in the request.
 * That is the whole multi-tenant guarantee, and this file relies on it rather
 * than re-checking, so the check lives in exactly one place.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import { recordTenantAudit, assertOwnership } from '../middleware/tenancy.js';
import { resolveLocation } from './locations.Controller.js';
import { issueVerificationCode } from './emailVerification.Controller.js';
import {
  getSubscription, getUsage, getEntitlements, checkLimit, can
} from '../modules/entitlements/entitlements.service.js';

const slugify = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ==========================================================================
   PROVISIONING

   Creating a business is the same work whether it happens during signup or
   later, from an account that already exists — organization, ownership,
   café, first branch, trial. It lives here once so the two entry points
   cannot drift into producing subtly different customers.

   The caller owns the transaction. Every statement below assumes it is inside
   one, because a half-provisioned business (an organization with no branch, a
   branch with no trial) is worse than no business at all.
   ========================================================================== */
const provisionOrganization = async (client, {
  userId, email, orgName, branchName, phone, pcCount,
  address1, address2, postalCode, location
}) => {
  /* Location arrives already resolved and verified by `resolveLocation` — the
     ids are stored, and the names are stored beside them so an invoice printed
     today still reads correctly if a city is later renamed in the master. */
  const country = location?.country || null;
  const state = location?.state || null;
  const city = location?.city || null;

  const org = (await client.query(`
    INSERT INTO organizations
      (name, slug, email, phone, address, address_line_1, address_line_2,
       city, state, country, postal_code, currency, timezone,
       country_id, state_id, city_id, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'INR'),COALESCE($13,'Asia/Kolkata'),$14,$15,$16,'ACTIVE')
    RETURNING *
  `, [
    orgName,
    // A collision just means a longer slug; it is a URL nicety, not identity.
    slugify(orgName) + '-' + crypto.randomBytes(2).toString('hex'),
    email || null, phone || null,
    address1 || null, address1 || null, address2 || null,
    city?.name || null, state?.name || null, country?.name || null,
    postalCode || null,
    /* Currency and timezone come from the country master, never from the
       request — a browser-supplied currency the billing run cannot price in
       would produce invoices nobody can settle. */
    country?.currency_code || null, country?.timezone || null,
    country?.id || null, state?.id || null, city?.id || null
  ])).rows[0];

  await client.query(`
    INSERT INTO organization_users (organization_id, user_id, role, status, accepted_at)
    VALUES ($1,$2,'OWNER','ACTIVE',CURRENT_TIMESTAMP)
  `, [org.organization_id, userId]);

  /* A café row is still created alongside the branch. Every existing
     feature — billing, sessions, the till, telemetry — is keyed on cafe_id,
     and a new customer whose branch had no café would find all of it empty.
     The café is the bridge until that code moves to branch_id. */
  const cafe = (await client.query(`
    INSERT INTO cafes (name, user_id, user_designation, organization_id, is_active)
    VALUES ($1,$2,'Owner',$3,TRUE) RETURNING cafe_id
  `, [orgName, userId, org.organization_id])).rows[0];

  /* Note there is no try/catch fallback here, deliberately. A failed
     statement inside a transaction aborts the whole block in Postgres, so
     catch-and-retry cannot work — the retry runs against a dead transaction
     and fails with a far more confusing error than the original. Use the
     columns that exist. */
  const branch = (await client.query(`
    INSERT INTO branches
      (organization_id, cafe_id, name, code, city, street, state, country, zip_code,
       address_line_1, address_line_2, country_id, state_id, city_id, status, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',TRUE)
    RETURNING *
  `, [
    org.organization_id, cafe.cafe_id,
    branchName || orgName, 'BR-001',
    city?.name || null, address1 || null, state?.name || null, country?.name || null,
    postalCode || null, address1 || null, address2 || null,
    country?.id || null, state?.id || null, city?.id || null
  ])).rows[0];

  await client.query(`
    INSERT INTO branch_users (branch_id, user_id, organization_id, role, status)
    VALUES ($1,$2,$3,'OWNER','ACTIVE')
  `, [branch.branch_id, userId, org.organization_id]);

  /* The trial. Duration and limits come from settings, never from constants
     here — the spec calls that out specifically, and it is what lets the
     trial be lengthened for one campaign without a deploy. */
  const [days, maxBranches, maxPcs, maxUsers, planRow] = await Promise.all([
    getSetting('trial.duration_days', 30),
    getSetting('trial.max_branches', 3),
    getSetting('trial.max_pcs', 50),
    getSetting('trial.max_users', 10),
    client.query(`SELECT sub_id FROM subscription_plans WHERE is_freetrial = TRUE ORDER BY sub_id LIMIT 1`)
  ]);

  const start = new Date();
  const end = new Date(start.getTime() + Number(days) * 86400000);
  const requestedPcs = Number(pcCount);
  const pcLimit = Number.isFinite(requestedPcs) && requestedPcs > 0
    ? Math.max(Number(maxPcs), requestedPcs)   // never sell them less than they asked for
    : Number(maxPcs);

  const subscription = (await client.query(`
    INSERT INTO subscriptions
      (organization_id, cafe_id, sub_id, type, status, max_pcs, max_branches, max_users,
       start_date, end_date, trial_ends_at, is_active)
    /* end_date and trial_ends_at hold the same instant but different types
       (timestamp vs timestamptz), so they need separate parameters — reusing
       one makes Postgres deduce two conflicting types for it and refuse the
       statement outright. */
    VALUES ($1,$2,$3,'TRIAL','ACTIVE',$4,$5,$6,$7,$8,$9,TRUE)
    RETURNING *
  `, [org.organization_id, cafe.cafe_id, planRow.rows[0]?.sub_id || null,
      pcLimit, Number(maxBranches), Number(maxUsers), start, end, end])).rows[0];

  return { org, cafe, branch, subscription, trialDays: Number(days) };
};

/* ==========================================================================
   SIGNUP

   One call creates the user, the organization, the membership, the first
   branch and the trial. The spec is explicit that the owner should not have
   to create these by hand — and doing it in one transaction means there is no
   state where an account exists without a business to belong to.
   ========================================================================== */

// POST /api/portal/signup
export const signup = async (req, res) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');
    const orgName = String(req.body?.organization_name || '').trim();
    const branchName = String(req.body?.branch_name || '').trim();

    if (!name || !email || !password || !orgName) {
      return res.status(400).json({
        success: false,
        message: 'Your name, email, password and business name are all required'
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'That email address does not look right' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Use a password of at least 8 characters' });
    }

    const exists = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({
        success: false,
        message: 'An account with that email already exists. Sign in instead.'
      });
    }

    /* The location chain is re-read from the master and checked here, before
       anything is written. A dropdown is a convenience for the person filling
       the form, never evidence: "India / Telangana / Mumbai" arrives looking
       exactly like a valid submission and has to be refused. */
    const location = await resolveLocation(req.body, { required: false });
    if (location.error) {
      return res.status(400).json({ success: false, message: location.error });
    }

    await client.query('BEGIN');

    const hashed = await bcrypt.hash(password, 10);
    const user = (await client.query(`
      INSERT INTO users (email, phone_number, name, address, password, role)
      VALUES ($1,$2,$3,$4,$5,'user')
      RETURNING id, email, name, phone_number
    `, [email, phone || '', name, JSON.stringify({}), hashed])).rows[0];

    const { org, cafe, branch, subscription, trialDays } = await provisionOrganization(client, {
      userId: user.id,
      email,
      phone,
      orgName,
      branchName,
      address1: req.body?.address_line_1 ? String(req.body.address_line_1).trim() : null,
      address2: req.body?.address_line_2 ? String(req.body.address_line_2).trim() : null,
      postalCode: req.body?.postal_code ? String(req.body.postal_code).trim() : null,
      location,
      pcCount: req.body?.pc_count
    });

    await client.query('COMMIT');

    /*
     * The address is not trusted yet. The business exists from this moment —
     * deferring that until the code comes back would mean holding a whole
     * signup (account + organization + branch + trial) in limbo somewhere
     * outside the database — but no token is issued, so nobody can act as
     * this owner until they prove the address is theirs. `auth.Controller.js`'s
     * `login` already refuses an unverified `users` row; this is what makes
     * that refusal reachable for the signup path real owners actually use,
     * rather than one nothing ever sends a code through.
     */
    const verification = await issueVerificationCode(user);

    /* `trialDays` comes back from the provisioning helper. It used to be a
       local called `days`, and the rename was missed here — which threw a
       ReferenceError AFTER the commit, so every signup created the account and
       then answered 500. The customer saw a failure, retried, and was told the
       email was already taken.

       The audit is also no longer allowed to take the response down with it:
       past this point the account exists, and a failed log line must not be
       reported to the customer as a failed signup. */
    try {
      await recordTenantAudit(
        { tenant: { userId: user.id, organizationId: org.organization_id }, headers: req.headers, socket: req.socket },
        { action: 'account.created', resource_type: 'organization', resource_id: org.organization_id,
          metadata: { organization: orgName, branch: branch.name, trial_days: trialDays } }
      );
    } catch (auditError) {
      console.error('Signup succeeded but the audit entry failed:', auditError.message);
    }

    return res.status(201).json({
      success: true,
      message: verification.sent
        ? `Account created. We sent a six-digit code to ${user.email} — enter it to finish signing up.`
        : `Account created, but the verification email could not be sent (${verification.message}). Try “Resend code”.`,
      data: {
        // What the frontend keys off to show the code screen instead of the
        // dashboard — no token yet, so there is nothing to act as this owner
        // with until the address is verified.
        verification_required: true,
        verification_sent: verification.sent,
        user: { id: user.id, name: user.name, email: user.email },
        organization: { id: org.organization_id, name: org.name },
        branch: { id: branch.branch_id, name: branch.name },
        subscription: {
          type: 'TRIAL', status: 'ACTIVE',
          expires_at: subscription.end_date,
          days_remaining: trialDays
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'An account with those details already exists' });
    }
    console.error('Error during signup:', error);
    res.status(500).json({ success: false, message: 'Could not create your account. Please try again.' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CREATE A BUSINESS FROM AN EXISTING ACCOUNT

   The other half of signup. Someone who registered on the ManagerXP site, or
   whose only membership was revoked, signs in with an account that owns no
   business. Rather than sending them back out to the public signup form —
   which would refuse them, their email already exists — they name their
   business on the dashboard and land in it.
   ========================================================================== */

// POST /api/portal/organizations
export const createOrganization = async (req, res) => {
  const client = await pool.connect();
  try {
    const orgName = String(req.body?.organization_name || '').trim();
    if (!orgName) {
      return res.status(400).json({ success: false, message: 'What is your business called?' });
    }

    /* One business per account, for now. Multi-org owners exist — the switcher
       supports them — but they are created by invitation, not by a customer
       spinning up businesses at will against a single trial. */
    if (req.tenant.organizations.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This account already belongs to a business'
      });
    }

    const account = (await client.query(
      'SELECT id, email, phone_number FROM users WHERE id = $1', [req.tenant.userId]
    )).rows[0];
    if (!account) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    /* Same check as signup, for the same reason — this endpoint creates a
       business too, and a location chain is only trustworthy once the server
       has re-read it. */
    const location = await resolveLocation(req.body, { required: false });
    if (location.error) {
      return res.status(400).json({ success: false, message: location.error });
    }

    await client.query('BEGIN');
    const { org, branch, subscription, trialDays } = await provisionOrganization(client, {
      userId: account.id,
      email: account.email,
      phone: account.phone_number,
      orgName,
      branchName: String(req.body?.branch_name || '').trim(),
      address1: req.body?.address_line_1 ? String(req.body.address_line_1).trim() : null,
      address2: req.body?.address_line_2 ? String(req.body.address_line_2).trim() : null,
      postalCode: req.body?.postal_code ? String(req.body.postal_code).trim() : null,
      location,
      pcCount: req.body?.pc_count
    });
    await client.query('COMMIT');

    await recordTenantAudit(
      { tenant: { userId: account.id, organizationId: org.organization_id },
        headers: req.headers, socket: req.socket },
      { action: 'organization.created', resource_type: 'organization',
        resource_id: org.organization_id,
        metadata: { organization: orgName, branch: branch.name, trial_days: trialDays } }
    );

    res.status(201).json({
      success: true,
      message: `${org.name} is ready`,
      data: {
        organization: { id: org.organization_id, name: org.name },
        branch: { id: branch.branch_id, name: branch.name },
        subscription: {
          type: 'TRIAL', status: 'ACTIVE',
          expires_at: subscription.end_date,
          days_remaining: trialDays
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating organization:', error);
    res.status(500).json({ success: false, message: 'Could not create your business. Please try again.' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   ME — who am I, what can I see
   ========================================================================== */

// GET /api/portal/me
export const me = async (req, res) => {
  try {
    const t = req.tenant;
    const user = (await pool.query(
      'SELECT id, name, email, phone_number FROM users WHERE id = $1', [t.userId]
    )).rows[0];

    res.json({
      success: true,
      data: {
        user,
        /* Every business this person belongs to. The portal shows a switcher
           when there is more than one; with a single org it selects silently. */
        organizations: t.organizations.map((o) => ({
          id: o.organization_id, name: o.name, role: o.role, status: o.org_status
        })),
        branches: t.branches.map((b) => ({
          id: b.branch_id, organization_id: b.organization_id, name: b.name, role: b.role
        }))
      }
    });
  } catch (error) {
    console.error('Error loading me:', error);
    res.status(500).json({ success: false, message: 'Could not load your account' });
  }
};

/* ==========================================================================
   DATA RIGHTS — DPDP Act, 2023

   A café owner's own right to export or erase their data. Deliberately not
   scoped by organization — like /me, this is about the person, not any one
   business they belong to.
   ========================================================================== */

// GET /api/portal/me/export
export const exportMyData = async (req, res) => {
  try {
    const t = req.tenant;
    const [user, orgs, branches] = await Promise.all([
      pool.query(
        `SELECT id, name, email, phone_number, address, created_at, updated_at
           FROM users WHERE id = $1`, [t.userId]),
      pool.query(
        `SELECT ou.role, ou.status AS membership_status, ou.created_at AS joined_at,
                o.organization_id, o.name, o.status AS organization_status,
                o.email, o.phone, o.address, o.city, o.state, o.country, o.postal_code
           FROM organization_users ou JOIN organizations o ON o.organization_id = ou.organization_id
          WHERE ou.user_id = $1`, [t.userId]),
      pool.query(
        `SELECT bu.role, bu.status AS membership_status, b.branch_id, b.organization_id, b.name
           FROM branch_users bu JOIN branches b ON b.branch_id = bu.branch_id
          WHERE bu.user_id = $1`, [t.userId])
    ]);

    if (user.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    res.json({
      success: true,
      data: {
        exported_at: new Date().toISOString(),
        profile: user.rows[0],
        organization_memberships: orgs.rows,
        branch_memberships: branches.rows
      }
    });
  } catch (error) {
    console.error('Owner data export failed:', error);
    res.status(500).json({ success: false, message: 'Could not export your data' });
  }
};

/*
 * DELETE /api/portal/me
 *
 * Self-service erasure for the account — except when it owns a live
 * business. Deleting the one login an active organization depends on would
 * strand its billing and its staff with no warning, so that case opens a
 * support ticket for a human to sort out (transfer ownership, close the
 * business) instead of anonymizing on the spot. Anyone not an active OWNER
 * of an active organization can delete immediately.
 */
export const deleteMyAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const t = req.tenant;
    const user = (await client.query(
      'SELECT id, name, email, is_active FROM users WHERE id = $1', [t.userId]
    )).rows[0];
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    if (user.is_active === false) {
      return res.status(409).json({ success: false, message: 'This account is already deleted' });
    }

    const blockedBy = t.organizations.find((o) => o.role === 'OWNER' && o.org_status === 'ACTIVE');
    if (blockedBy) {
      await client.query('BEGIN');
      const ticket = (await client.query(
        `INSERT INTO support_tickets
           (organization_id, subject, category, priority,
            created_by_user_id, created_by_name, created_by_email, last_reply_by)
         VALUES ($1,$2,'ACCOUNT','HIGH',$3,$4,$5,'customer')
         RETURNING ticket_id`,
        [blockedBy.organization_id, 'Account deletion request', user.id, user.name, user.email]
      )).rows[0];
      await client.query(
        `UPDATE support_tickets SET reference = 'TKT-' || LPAD(ticket_id::text, 6, '0') WHERE ticket_id = $1`,
        [ticket.ticket_id]
      );
      await client.query(
        `INSERT INTO support_messages (ticket_id, author_type, author_id, author_name, body)
         VALUES ($1, 'customer', $2, $3, $4)`,
        [ticket.ticket_id, user.id, user.name,
         `This account requested self-service deletion but owns an active organization ` +
         `(${blockedBy.name}). Please help them transfer ownership or close the business, ` +
         `then complete the deletion.`]
      );
      const ref = (await client.query(
        'SELECT reference FROM support_tickets WHERE ticket_id = $1', [ticket.ticket_id]
      )).rows[0].reference;
      await client.query('COMMIT');

      return res.status(409).json({
        success: false,
        message: `Your account owns an active organization (${blockedBy.name}), so it can't be ` +
          `deleted immediately. We've opened ticket ${ref} — our team will help you transfer ` +
          `ownership or close the business first.`,
        data: { ticket_reference: ref }
      });
    }

    await client.query('BEGIN');
    // Same "nobody can sign in with this" pattern createCustomer uses for an
    // account given no password of its own.
    const randomPassword = await bcrypt.hash(Math.random().toString(36).slice(2) + Date.now(), 10);
    // google_id is cleared too — otherwise "Sign in with Google" would still
    // find this row by that id (it doesn't check a password at all) and log
    // the deleted account straight back in, even with its email overwritten.
    await client.query(
      `UPDATE users SET
         name = 'Deleted user', email = $2, phone_number = '0000000000',
         address = '{}'::jsonb, password = $3, google_id = NULL, auth_provider = 'local',
         is_active = FALSE, anonymized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [user.id, `deleted-${user.id}@managerxp.invalid`, randomPassword]
    );
    await client.query('COMMIT');

    await recordTenantAudit(req, {
      action: 'account.delete', resource_type: 'user', resource_id: user.id,
      metadata: { reason: 'DPDP self-service erasure' }
    });

    res.json({ success: true, message: 'Your account has been deleted.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Owner self-delete failed:', error);
    res.status(500).json({ success: false, message: 'Could not delete your account' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   DASHBOARD
   ========================================================================== */

// GET /api/portal/dashboard
export const dashboard = async (req, res) => {
  try {
    const orgId = req.tenant.organizationId;
    const branchId = req.tenant.branchId;
    const scope = branchId ? [branchId] : req.tenant.allowedBranchIds;

    const [subscription, usage, entitlements] = await Promise.all([
      getSubscription(orgId), getUsage(orgId), getEntitlements(orgId, branchId)
    ]);

    /* Today's trading, scoped to the branches this user may see. An empty
       scope means no branches yet, and SUM over nothing is zero — which is
       the right answer for a brand new account, not an error. */
    const cafeIds = (await pool.query(
      `SELECT cafe_id FROM branches WHERE branch_id = ANY($1::int[]) AND cafe_id IS NOT NULL`,
      [scope.length ? scope : [0]]
    )).rows.map((r) => r.cafe_id);

    const today = (await pool.query(`
      SELECT
        COALESCE(SUM(b.total) FILTER (WHERE b.created_at >= CURRENT_DATE), 0) AS revenue_today,
        COUNT(*) FILTER (WHERE b.created_at >= CURRENT_DATE)::int             AS bills_today
      FROM bills b
      LEFT JOIN customers c ON c.customer_id = b.customer_id
      WHERE b.cafe_id = ANY($1::int[]) AND COALESCE(c.customer_type, 'NORMAL') <> 'STAFF'
    `, [cafeIds.length ? cafeIds : [0]])).rows[0];

    const sessions = (await pool.query(`
      SELECT COUNT(*)::int AS active FROM sessions
      WHERE status = 'active' AND cafe_id = ANY($1::int[])
    `, [cafeIds.length ? cafeIds : [0]])).rows[0];

    const installations = (await pool.query(`
      SELECT installation_id, public_id, branch_id, name, status, version, last_seen_at
      FROM installations WHERE organization_id = $1
        AND ($2::int IS NULL OR branch_id = $2)
      ORDER BY installation_id
    `, [orgId, branchId])).rows;

    /* The setup checklist. Derived from what actually exists rather than a
       stored flag, so it cannot drift out of step with reality — a customer
       who deletes their last PC correctly sees that step reopen. */
    const setup = {
      account_created: true,
      business_created: true,
      branch_created: usage.branches > 0,
      installed: installations.length > 0,
      connected: installations.some((i) => i.status === 'ACTIVE'),
      pcs_registered: usage.pcs > 0,
      staff_invited: usage.users > 1,
      first_session: false
    };
    const firstSession = (await pool.query(
      `SELECT 1 FROM sessions WHERE cafe_id = ANY($1::int[]) LIMIT 1`,
      [cafeIds.length ? cafeIds : [0]]
    ));
    setup.first_session = firstSession.rows.length > 0;

    res.json({
      success: true,
      data: {
        organization: {
          id: orgId,
          name: req.tenant.organization.name,
          currency: req.tenant.organization.currency,
          timezone: req.tenant.organization.timezone
        },
        branch_scope: branchId ? 'single' : 'all',
        branches: req.tenant.branchList,
        subscription,
        usage,
        setup,
        today: {
          revenue: Number(today.revenue_today),
          bills: today.bills_today,
          active_sessions: sessions.active
        },
        installations: installations.map((i) => ({
          ...i,
          // "Online" is a judgement about recency, made once here so the
          // portal and the branch page cannot disagree about it.
          online: i.last_seen_at
            ? (Date.now() - new Date(i.last_seen_at).getTime()) < 5 * 60 * 1000
            : false
        })),
        features: entitlements.enabled
      }
    });
  } catch (error) {
    console.error('Error building dashboard:', error);
    res.status(500).json({ success: false, message: 'Could not load your dashboard' });
  }
};

/* ==========================================================================
   ORGANIZATION
   ========================================================================== */

// GET /api/portal/organization
export const getOrganization = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM organizations WHERE organization_id = $1', [req.tenant.organizationId]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error loading organization:', error);
    res.status(500).json({ success: false, message: 'Could not load your business' });
  }
};

// PATCH /api/portal/organization
export const updateOrganization = async (req, res) => {
  try {
    const allowed = ['name', 'logo', 'email', 'phone', 'address', 'city', 'state',
                     'country', 'postal_code', 'tax_number', 'timezone', 'currency'];
    const fields = [];
    const values = [req.tenant.organizationId];

    for (const key of allowed) {
      if (req.body?.[key] === undefined) continue;
      values.push(req.body[key]);
      fields.push(`${key} = $${values.length}`);
    }
    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Nothing to change' });
    }

    const { rows } = await pool.query(
      `UPDATE organizations SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1 RETURNING *`, values
    );

    await recordTenantAudit(req, {
      action: 'organization.updated', resource_type: 'organization',
      resource_id: req.tenant.organizationId,
      metadata: { fields: Object.keys(req.body || {}).filter((k) => allowed.includes(k)) }
    });

    res.json({ success: true, message: 'Business details saved', data: rows[0] });
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ success: false, message: 'Could not save your business details' });
  }
};

/* ==========================================================================
   BRANCHES
   ========================================================================== */

// GET /api/portal/branches
export const listBranches = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, c.slug AS cafe_slug,
             (SELECT COUNT(*)::int FROM pcs p
               WHERE p.branch_id = b.branch_id AND p.is_active
                 AND p.device_type = 'GAMING_PC'
                 AND (p.category = 'PC' OR p.category IS NULL))          AS pc_count,
             (SELECT COUNT(*)::int FROM branch_users bu
               WHERE bu.branch_id = b.branch_id AND bu.status = 'ACTIVE') AS user_count,
             (SELECT i.status FROM installations i
               WHERE i.branch_id = b.branch_id ORDER BY i.installation_id DESC LIMIT 1) AS installation_status,
             (SELECT i.last_seen_at FROM installations i
               WHERE i.branch_id = b.branch_id ORDER BY i.installation_id DESC LIMIT 1) AS installation_last_seen
      FROM branches b
      LEFT JOIN cafes c ON c.cafe_id = b.cafe_id
      WHERE b.organization_id = $1
        AND b.branch_id = ANY($2::int[])
        AND b.status <> 'CLOSED'
      ORDER BY b.branch_id
    `, [req.tenant.organizationId, req.tenant.allowedBranchIds.length ? req.tenant.allowedBranchIds : [0]]);

    const subscription = await getSubscription(req.tenant.organizationId);

    res.json({
      success: true,
      data: rows.map((b) => ({
        branch_id: b.branch_id,
        name: b.name,
        code: b.code,
        city: b.city,
        address: b.street,
        phone: b.phone,
        status: b.status,
        pc_count: b.pc_count,
        user_count: b.user_count,
        installation_status: b.installation_status || 'NOT_INSTALLED',
        installation_online: b.installation_last_seen
          ? (Date.now() - new Date(b.installation_last_seen).getTime()) < 5 * 60 * 1000
          : false,
        // The public booking page for this branch's café — null until the
        // slug backfill has reached it, which happens on the next restart.
        cafe_slug: b.cafe_slug || null,
        // Reservations are refused outside this window. Null means never set
        // — treated as open around the clock, not as "always closed".
        opening_time: b.opening_time ? String(b.opening_time).slice(0, 5) : null,
        closing_time: b.closing_time ? String(b.closing_time).slice(0, 5) : null
      })),
      meta: { max_branches: subscription?.limits.max_branches ?? null }
    });
  } catch (error) {
    console.error('Error listing branches:', error);
    res.status(500).json({ success: false, message: 'Could not load your branches' });
  }
};

// POST /api/portal/branches
export const createBranch = async (req, res) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Give the branch a name' });

    // The backend enforces the limit — never the frontend alone.
    const limit = await checkLimit(req.tenant.organizationId, 'branch');
    if (!limit.ok) {
      return res.status(403).json({ success: false, message: limit.message, data: limit });
    }

    /* The numeric ceiling above says how many; this says whether more than one
       is allowed at all. Every organization gets its first branch at signup
       regardless — this only stops a second, so a package without
       MULTI_BRANCH cannot be worked around by simply staying under whatever
       trial/default ceiling checkLimit happens to allow. */
    if (limit.used > 0 && !(await can(req.tenant.organizationId, 'MULTI_BRANCH'))) {
      return res.status(403).json({
        success: false,
        message: 'Multiple branches are not included in your current subscription',
        data: { feature: 'MULTI_BRANCH', reason: 'disabled_for_account' }
      });
    }

    await client.query('BEGIN');

    const orgName = req.tenant.organization.name;
    /* Each branch gets its own café row, because every existing feature is
       keyed on cafe_id — a branch without one would have no till, no sessions
       and no stock of its own. */
    const cafe = (await client.query(`
      INSERT INTO cafes (name, user_id, user_designation, organization_id, is_active)
      VALUES ($1,$2,'Owner',$3,TRUE) RETURNING cafe_id
    `, [`${orgName} — ${name}`, req.tenant.userId, req.tenant.organizationId])).rows[0];

    const count = (await client.query(
      'SELECT COUNT(*)::int n FROM branches WHERE organization_id = $1', [req.tenant.organizationId]
    )).rows[0].n;

    const branch = (await client.query(`
      INSERT INTO branches (organization_id, cafe_id, name, code, city, street, phone, status, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',TRUE) RETURNING *
    `, [
      req.tenant.organizationId, cafe.cafe_id, name,
      String(req.body?.code || `BR-${String(count + 1).padStart(3, '0')}`).trim(),
      req.body?.city ? String(req.body.city).trim() : null,
      req.body?.address ? String(req.body.address).trim() : null,
      req.body?.phone ? String(req.body.phone).trim() : null
    ])).rows[0];

    // Whoever created it can see it; owners get every branch anyway.
    await client.query(`
      INSERT INTO branch_users (branch_id, user_id, organization_id, role, status)
      VALUES ($1,$2,$3,'OWNER','ACTIVE') ON CONFLICT DO NOTHING
    `, [branch.branch_id, req.tenant.userId, req.tenant.organizationId]);

    await client.query('COMMIT');

    await recordTenantAudit(req, {
      action: 'branch.created', resource_type: 'branch', resource_id: branch.branch_id,
      branch_id: branch.branch_id, metadata: { name }
    });

    res.status(201).json({ success: true, message: `${name} added`, data: branch });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A branch with that code already exists' });
    }
    console.error('Error creating branch:', error);
    res.status(500).json({ success: false, message: 'Could not add the branch' });
  } finally {
    client.release();
  }
};

// PATCH /api/portal/branches/:branchId
export const updateBranch = async (req, res) => {
  try {
    const id = Number(req.params.branchId);
    // Membership is not enough: the branch must be in THIS organization.
    if (!(await assertOwnership('branches', 'branch_id', id, req.tenant.organizationId))) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const map = { name: 'name', code: 'code', city: 'city', address: 'street',
                  phone: 'phone', status: 'status',
                  opening_time: 'opening_time', closing_time: 'closing_time' };
    const fields = [];
    const values = [id];
    for (const [key, column] of Object.entries(map)) {
      if (req.body?.[key] === undefined) continue;
      values.push(req.body[key]);
      fields.push(`${column} = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const { rows } = await pool.query(
      `UPDATE branches SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE branch_id = $1 RETURNING *`, values
    );

    await recordTenantAudit(req, {
      action: 'branch.updated', resource_type: 'branch', resource_id: id, branch_id: id,
      metadata: { fields: Object.keys(req.body || {}) }
    });

    res.json({ success: true, message: 'Branch saved', data: rows[0] });
  } catch (error) {
    console.error('Error updating branch:', error);
    res.status(500).json({ success: false, message: 'Could not save the branch' });
  }
};

/* ==========================================================================
   SUBSCRIPTION
   ========================================================================== */

// GET /api/portal/subscription
export const subscription = async (req, res) => {
  try {
    const orgId = req.tenant.organizationId;
    const [sub, usage, entitlements] = await Promise.all([
      getSubscription(orgId), getUsage(orgId), getEntitlements(orgId)
    ]);

    /* The warning ladder from the spec. Computed here so every surface —
       portal banner, dashboard, the desktop app — says the same thing on the
       same day. */
    let warning = null;
    if (sub && sub.status === 'ACTIVE' && sub.days_remaining != null) {
      const d = sub.days_remaining;
      if (d <= 0) warning = { level: 'critical', message: 'Your trial ends today' };
      else if (d === 1) warning = { level: 'critical', message: 'Your trial expires tomorrow' };
      else if (d <= 3) warning = { level: 'critical', message: `Your trial expires in ${d} days` };
      else if (d <= 7) warning = { level: 'warning', message: `Your trial expires in ${d} days` };
      else if (d <= 14) warning = { level: 'info', message: `Your trial expires in ${d} days` };
    } else if (sub && sub.status === 'EXPIRED') {
      warning = {
        level: 'expired',
        message: 'Your CafeXP trial has ended. Choose a subscription to continue.'
      };
    }

    res.json({
      success: true,
      data: {
        subscription: sub,
        usage,
        warning,
        /* `reason` travels with each feature so the page can say why something
           is locked — "not in your package" and "your trial has ended" want
           different buttons underneath them. */
        features: Object.entries(entitlements.features).map(([key, v]) => ({
          key, label: v.label, enabled: v.enabled, reason: v.reason,
          module: v.module_label
        })),
        modules: entitlements.modules,
        plans: (await pool.query(`
          SELECT p.sub_id, p.code, p.name, p.description, p.max_pcs, p.max_branches,
                 p.max_users, p.no_of_days, p.price, p.currency, p.billing_period,
                 COALESCE(json_agg(
                   json_build_object('billing_period', pp.billing_period, 'price', pp.price)
                   ORDER BY pp.price
                 ) FILTER (WHERE pp.plan_price_id IS NOT NULL), '[]') AS prices
          FROM subscription_plans p
          LEFT JOIN plan_prices pp ON pp.plan_id = p.sub_id AND pp.is_active
          WHERE p.is_active AND NOT p.is_freetrial AND p.status = 'ACTIVE' AND p.is_public
          GROUP BY p.sub_id
          ORDER BY p.sort_order, p.price
        `)).rows
      }
    });
  } catch (error) {
    console.error('Error loading subscription:', error);
    res.status(500).json({ success: false, message: 'Could not load your subscription' });
  }
};

/* ==========================================================================
   DEVICES
   ========================================================================== */

// GET /api/portal/devices
export const listDevices = async (req, res) => {
  try {
    const scope = req.tenant.branchId ? [req.tenant.branchId] : req.tenant.allowedBranchIds;
    const { rows } = await pool.query(`
      SELECT p.pc_id, p.name, p.device_type, p.is_active, p.branch_id, p.installation_id,
             p.last_seen_at, p.registered_at, p.ip_address, p.mac_address,
             b.name AS branch_name
      FROM pcs p
      LEFT JOIN branches b ON b.branch_id = p.branch_id
      WHERE p.organization_id = $1 AND p.branch_id = ANY($2::int[])
      ORDER BY b.name, p.name
    `, [req.tenant.organizationId, scope.length ? scope : [0]]);

    const [sub, usage] = await Promise.all([
      getSubscription(req.tenant.organizationId), getUsage(req.tenant.organizationId)
    ]);

    res.json({
      success: true,
      data: rows.map((d) => ({
        ...d,
        online: d.last_seen_at
          ? (Date.now() - new Date(d.last_seen_at).getTime()) < 5 * 60 * 1000
          : false
      })),
      meta: {
        gaming_pcs: usage.pcs,
        max_pcs: sub?.limits.max_pcs ?? null,
        // Stated so the portal can show "18 / 50" without doing the sum
        // itself and getting a different answer from the backend.
        remaining: sub?.limits.max_pcs != null ? Math.max(0, sub.limits.max_pcs - usage.pcs) : null
      }
    });
  } catch (error) {
    console.error('Error listing devices:', error);
    res.status(500).json({ success: false, message: 'Could not load your devices' });
  }
};

/* ==========================================================================
   INSTALLATIONS
   ========================================================================== */

// GET /api/portal/installations
export const listInstallations = async (req, res) => {
  try {
    const scope = req.tenant.branchId ? [req.tenant.branchId] : req.tenant.allowedBranchIds;
    const { rows } = await pool.query(`
      SELECT i.*, b.name AS branch_name,
             (SELECT COUNT(*)::int FROM pcs p WHERE p.installation_id = i.installation_id) AS device_count
      FROM installations i
      LEFT JOIN branches b ON b.branch_id = i.branch_id
      WHERE i.organization_id = $1
        AND (i.branch_id IS NULL OR i.branch_id = ANY($2::int[]))
      ORDER BY i.installation_id DESC
    `, [req.tenant.organizationId, scope.length ? scope : [0]]);

    res.json({
      success: true,
      data: rows.map((i) => ({
        installation_id: i.installation_id,
        public_id: i.public_id,
        branch_id: i.branch_id,
        branch_name: i.branch_name,
        name: i.name,
        status: i.status,
        version: i.version,
        device_count: i.device_count,
        last_seen_at: i.last_seen_at,
        registered_at: i.registered_at,
        online: i.last_seen_at
          ? (Date.now() - new Date(i.last_seen_at).getTime()) < 5 * 60 * 1000
          : false
        // credential_hash is deliberately absent — it never leaves the server.
      }))
    });
  } catch (error) {
    console.error('Error listing installations:', error);
    res.status(500).json({ success: false, message: 'Could not load your installations' });
  }
};

/**
 * POST /api/portal/installations/:installationId/revoke
 *
 * Cuts an installation off — a stolen server, a closed branch, a machine
 * being replaced. The device rows stay: their history is the café's trading
 * record, and deleting it to tidy up an installation would be data loss.
 */
export const revokeInstallation = async (req, res) => {
  try {
    const id = Number(req.params.installationId);
    if (!(await assertOwnership('installations', 'installation_id', id, req.tenant.organizationId))) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : 'Revoked from the portal';

    const { rows } = await pool.query(`
      UPDATE installations
      SET status = 'REVOKED', revoked_reason = $2, credential_hash = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1 AND status <> 'REVOKED'
      RETURNING *
    `, [id, reason]);

    if (!rows.length) {
      return res.status(409).json({ success: false, message: 'That installation is already revoked' });
    }

    await recordTenantAudit(req, {
      action: 'installation.revoked', resource_type: 'installation', resource_id: id,
      branch_id: rows[0].branch_id, metadata: { reason }
    });

    res.json({ success: true, message: 'Installation revoked', data: { installation_id: id } });
  } catch (error) {
    console.error('Error revoking installation:', error);
    res.status(500).json({ success: false, message: 'Could not revoke the installation' });
  }
};

/* ==========================================================================
   USERS & STAFF
   ========================================================================== */

// GET /api/portal/users
export const listUsers = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ou.organization_user_id, ou.user_id, ou.role, ou.status, ou.created_at, ou.accepted_at,
             u.name, u.email, u.phone_number,
             COALESCE(
               JSON_AGG(JSON_BUILD_OBJECT('branch_id', bu.branch_id, 'name', b.name))
                 FILTER (WHERE bu.branch_id IS NOT NULL), '[]'
             ) AS branches
      FROM organization_users ou
      JOIN users u ON u.id = ou.user_id
      LEFT JOIN branch_users bu ON bu.user_id = ou.user_id AND bu.organization_id = ou.organization_id
      LEFT JOIN branches b ON b.branch_id = bu.branch_id
      WHERE ou.organization_id = $1 AND ou.status <> 'REMOVED'
      GROUP BY ou.organization_user_id, u.id
      ORDER BY ou.created_at
    `, [req.tenant.organizationId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ success: false, message: 'Could not load your team' });
  }
};

/**
 * POST /api/portal/users/invite
 *
 * An invitation, not an account creation. The person sets their own password
 * when they accept, so nobody — including the owner — ever knows it.
 */
export const inviteUser = async (req, res) => {
  const client = await pool.connect();
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = ['BRANCH_MANAGER', 'STAFF', 'CASHIER', 'TECHNICIAN'].includes(req.body?.role)
      ? req.body.role : 'STAFF';
    const branchIds = Array.isArray(req.body?.branch_ids) ? req.body.branch_ids.map(Number) : [];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }

    // Every branch named must be one the inviter can actually reach.
    for (const b of branchIds) {
      if (req.tenant.allowedBranchIds.indexOf(b) === -1) {
        return res.status(403).json({ success: false, message: 'You cannot assign a branch you do not manage' });
      }
    }

    const limit = await checkLimit(req.tenant.organizationId, 'user');
    if (!limit.ok) {
      return res.status(403).json({ success: false, message: limit.message, data: limit });
    }

    await client.query('BEGIN');

    let user = (await client.query('SELECT id, name FROM users WHERE LOWER(email) = $1', [email])).rows[0];
    if (!user) {
      /* A placeholder account with no usable password. They cannot sign in
         until they accept, and the random hash means no password works in the
         meantime rather than an empty one working. */
      user = (await client.query(`
        INSERT INTO users (email, phone_number, name, address, password, role)
        VALUES ($1,'',$2,'{}',$3,'user') RETURNING id, name
      `, [email, String(req.body?.name || email.split('@')[0]).trim(),
          await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)])).rows[0];
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const membership = (await client.query(`
      INSERT INTO organization_users
        (organization_id, user_id, role, status, invited_by, invite_token, invite_expires_at)
      VALUES ($1,$2,$3,'INVITED',$4,$5, CURRENT_TIMESTAMP + INTERVAL '14 days')
      ON CONFLICT (organization_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, status = 'INVITED',
            invite_token = EXCLUDED.invite_token,
            invite_expires_at = EXCLUDED.invite_expires_at
      RETURNING *
    `, [req.tenant.organizationId, user.id, role, req.tenant.userId, token])).rows[0];

    for (const b of branchIds) {
      await client.query(`
        INSERT INTO branch_users (branch_id, user_id, organization_id, role, status)
        VALUES ($1,$2,$3,$4,'ACTIVE')
        ON CONFLICT (branch_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `, [b, user.id, req.tenant.organizationId, role]);
    }

    await client.query('COMMIT');

    await recordTenantAudit(req, {
      action: 'user.invited', resource_type: 'user', resource_id: user.id,
      metadata: { email, role, branches: branchIds }
    });

    res.status(201).json({
      success: true,
      message: `Invitation created for ${email}`,
      data: {
        organization_user_id: membership.organization_user_id,
        email, role,
        /* Returned so the portal can show a copyable link. Sending the email
           is a later piece; handing the owner the link means the flow works
           today rather than waiting on mail delivery. */
        invite_token: token,
        expires_at: membership.invite_expires_at
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error inviting user:', error);
    res.status(500).json({ success: false, message: 'Could not send the invitation' });
  } finally {
    client.release();
  }
};

/** POST /api/portal/invites/accept — public; the token is the credential. */
export const acceptInvite = async (req, res) => {
  const client = await pool.connect();
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'A valid invitation and a password of at least 8 characters are required'
      });
    }

    const invite = (await client.query(`
      SELECT ou.*, o.name AS organization_name, u.email
      FROM organization_users ou
      JOIN organizations o ON o.organization_id = ou.organization_id
      JOIN users u ON u.id = ou.user_id
      WHERE ou.invite_token = $1 AND ou.status = 'INVITED'
        AND ou.invite_expires_at > NOW()
    `, [token])).rows[0];

    if (!invite) {
      return res.status(410).json({ success: false, message: 'That invitation is no longer valid' });
    }

    await client.query('BEGIN');
    /*
     * Verified in the same statement — accepting an invite already proves the
     * address, the same way a Google sign-in does: the invite token only
     * reached them because they control the inbox it was sent to. Leaving
     * `email_verified` at the column's default FALSE would work for this
     * request (the token below is minted regardless) but silently lock them
     * out the next time they sign in through the ordinary password door,
     * which never sent them a code to clear it with.
     */
    await client.query('UPDATE users SET password = $2, email_verified = TRUE WHERE id = $1',
      [invite.user_id, await bcrypt.hash(password, 10)]);
    await client.query(`
      UPDATE organization_users
      SET status = 'ACTIVE', accepted_at = CURRENT_TIMESTAMP, invite_token = NULL
      WHERE organization_user_id = $1
    `, [invite.organization_user_id]);
    await client.query('COMMIT');

    const authToken = jwt.sign(
      { id: invite.user_id, email: invite.email, role: 'user', organization_id: invite.organization_id },
      process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      success: true,
      message: `Welcome to ${invite.organization_name}`,
      data: {
        token: authToken,
        /* The id as well as the name: the portal stores it as the active scope
           so the invitee lands in the business they were invited to rather
           than whichever one happens to sort first. */
        organization_id: invite.organization_id,
        organization: invite.organization_name,
        role: invite.role
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error accepting invite:', error);
    res.status(500).json({ success: false, message: 'Could not accept the invitation' });
  } finally {
    client.release();
  }
};
