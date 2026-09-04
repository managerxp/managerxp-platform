/*
 * The ManagerXP platform console.
 *
 * Every other controller in this codebase acts for a café. This one acts for
 * the company selling to cafés: it sees every tenant, sells subscriptions,
 * generates payment links and suspends installs that have not paid.
 *
 * The whole file sits behind requirePlatformAdmin. There is no per-café
 * scoping here on purpose — crossing tenants IS the job — which is exactly why
 * the guard checks the role value rather than merely that a role exists.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { getProvider } from '../modules/payments/payments.providers.js';
import { decryptSecret } from '../modules/payments/payments.crypto.js';
import { issueLicense } from './licenses.Controller.js';
import { recalcInvoice } from './adminBilling.Controller.js';

/* ==========================================================================
   HELPERS
   ========================================================================== */

const money = (v) => Number(Number(v || 0).toFixed(2));

/** Days a plan buys, from its own field with a sane fallback per period. */
const daysForPlan = (plan) => {
  if (plan?.no_of_days) return Number(plan.no_of_days);
  return { monthly: 30, quarterly: 90, yearly: 365, one_time: 365 }[plan?.billing_period] || 30;
};

/** Normalise a plan price to a monthly figure so MRR means one thing. */
const monthlyValue = (plan) => {
  const price = Number(plan.price || 0);
  switch (plan.billing_period) {
    case 'yearly': return price / 12;
    case 'quarterly': return price / 3;
    // A one-off sale is real revenue but not *recurring*, so it contributes
    // nothing to MRR. Counting it would flatter the number every time one
    // landed and then look like churn the following month.
    case 'one_time': return 0;
    default: return price;
  }
};

const shapeLink = (row, baseUrl) => ({
  link_id: row.link_id,
  token: row.token,
  url: `${baseUrl}/pay/${row.token}`,
  cafe_id: row.cafe_id,
  cafe_name: row.cafe_name || null,
  sub_id: row.sub_id,
  plan_name: row.plan_name || null,
  customer_name: row.customer_name,
  customer_email: row.customer_email,
  customer_phone: row.customer_phone,
  purpose: row.purpose,
  description: row.description,
  amount: money(row.amount),
  currency: row.currency,
  grants_days: row.grants_days,
  grants_max_pcs: row.grants_max_pcs,
  status: row.status,
  provider: row.provider,
  provider_payment_id: row.provider_payment_id,
  expires_at: row.expires_at,
  paid_at: row.paid_at,
  created_at: row.created_at
});

/** Where the pay page lives, for building shareable URLs. */
const publicBase = (req) =>
  process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

/* ==========================================================================
   OVERVIEW
   ========================================================================== */

// GET /api/platform/overview
export const getOverview = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafes = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active) ::int AS active,
        COUNT(*) FILTER (WHERE NOT is_active)::int AS suspended
      FROM cafes
    `);

    /* "Active users" is ambiguous enough to be worth being explicit about, so
       all three readings are returned rather than picking one and hoping the
       reader means the same thing: accounts on the platform, café staff, and
       the end customers those cafés serve. */
    const users = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users)                              AS accounts,
        (SELECT COUNT(*)::int FROM staff WHERE UPPER(status) = 'ACTIVE') AS active_staff,
        (SELECT COUNT(*)::int FROM customers)                          AS end_customers,
        (SELECT COUNT(*)::int FROM pcs WHERE is_active)                AS active_stations
    `);

    const subs = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_active AND end_date > NOW())::int          AS active,
        COUNT(*) FILTER (WHERE end_date <= NOW())::int                       AS expired,
        COUNT(*) FILTER (WHERE is_active AND end_date > NOW()
                          AND end_date <= NOW() + INTERVAL '14 days')::int   AS expiring_soon
      FROM subscriptions
    `);

    // MRR from what is actually live, not from the price list.
    const mrr = await client.query(`
      SELECT COALESCE(SUM(
        CASE p.billing_period
          WHEN 'yearly'    THEN p.price / 12
          WHEN 'quarterly' THEN p.price / 3
          WHEN 'one_time'  THEN 0
          ELSE p.price
        END), 0) AS mrr
      FROM subscriptions s
      JOIN subscription_plans p ON p.sub_id = s.sub_id
      WHERE s.is_active AND s.end_date > NOW()
    `);

    const revenue = await client.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE received_at >= date_trunc('month', NOW())), 0) AS this_month,
        COALESCE(SUM(amount) FILTER (WHERE received_at >= NOW() - INTERVAL '30 days'), 0) AS last_30d,
        COALESCE(SUM(amount), 0) AS lifetime
      FROM subscription_payments
    `);

    const links = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COALESCE(SUM(amount) FILTER (WHERE status = 'open'), 0) AS open_value,
        COUNT(*) FILTER (WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days')::int AS paid_30d
      FROM payment_links
    `);

    res.json({
      success: true,
      data: {
        cafes: cafes.rows[0],
        users: users.rows[0],
        subscriptions: subs.rows[0],
        mrr: money(mrr.rows[0].mrr),
        revenue: {
          this_month: money(revenue.rows[0].this_month),
          last_30d: money(revenue.rows[0].last_30d),
          lifetime: money(revenue.rows[0].lifetime)
        },
        payment_links: {
          open: links.rows[0].open,
          open_value: money(links.rows[0].open_value),
          paid_30d: links.rows[0].paid_30d
        }
      }
    });
  } catch (error) {
    console.error('Error building platform overview:', error);
    res.status(500).json({ success: false, message: 'Error loading the overview' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CUSTOMERS / INSTALLS
   ========================================================================== */

// GET /api/platform/cafes
export const listCafes = async (req, res) => {
  const client = await pool.connect();
  try {
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;

    const { rows } = await client.query(`
      SELECT
        c.cafe_id, c.name, c.is_active, c.suspended_reason, c.suspended_at, c.created_at,
        u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.phone_number AS owner_phone,

        s.subscription_id, s.start_date, s.end_date, s.max_pcs AS licensed_pcs,
        s.is_active AS subscription_active,
        p.sub_id, p.name AS plan_name, p.price, p.currency, p.billing_period, p.is_freetrial,

        (SELECT COUNT(*)::int FROM pcs WHERE cafe_id = c.cafe_id)                       AS stations,
        (SELECT COUNT(*)::int FROM pcs WHERE cafe_id = c.cafe_id AND is_active)         AS stations_active,
        (SELECT COUNT(*)::int FROM staff
           WHERE cafe_id = c.cafe_id AND UPPER(status) = 'ACTIVE')                       AS staff_active,
        (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments WHERE cafe_id = c.cafe_id) AS paid_lifetime,

        -- Last sign of life, so a silent install is visible without opening it.
        (SELECT MAX(t.received_at) FROM station_telemetry t
           JOIN pcs pp ON pp.pc_id = t.pc_id WHERE pp.cafe_id = c.cafe_id)              AS last_seen
      FROM cafes c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions sub
        WHERE sub.cafe_id = c.cafe_id
        ORDER BY sub.end_date DESC NULLS LAST LIMIT 1
      ) s ON TRUE
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      WHERE $1::text IS NULL OR c.name ILIKE $1 OR u.email ILIKE $1 OR u.name ILIKE $1
      ORDER BY c.created_at DESC
    `, [search]);

    res.json({
      success: true,
      data: rows.map((r) => ({
        cafe_id: r.cafe_id,
        name: r.name,
        is_active: r.is_active,
        suspended_reason: r.suspended_reason,
        suspended_at: r.suspended_at,
        created_at: r.created_at,
        owner: r.owner_id
          ? { id: r.owner_id, name: r.owner_name, email: r.owner_email, phone: r.owner_phone }
          : null,
        subscription: r.subscription_id
          ? {
            subscription_id: r.subscription_id,
            sub_id: r.sub_id,
            plan_name: r.plan_name,
            price: money(r.price),
            currency: r.currency,
            billing_period: r.billing_period,
            is_freetrial: r.is_freetrial,
            start_date: r.start_date,
            end_date: r.end_date,
            licensed_pcs: r.licensed_pcs,
            is_active: r.subscription_active,
            // Computed here rather than in the browser so every surface agrees
            // on when a subscription has lapsed.
            days_remaining: r.end_date
              ? Math.ceil((new Date(r.end_date) - Date.now()) / 86400000)
              : null
          }
          : null,
        usage: {
          stations: r.stations,
          stations_active: r.stations_active,
          staff_active: r.staff_active,
          // Over-provisioning is the commonest upsell trigger, so it is stated
          // rather than left to be worked out.
          over_licence: r.licensed_pcs != null && r.stations > r.licensed_pcs
        },
        paid_lifetime: money(r.paid_lifetime),
        last_seen: r.last_seen
      }))
    });
  } catch (error) {
    console.error('Error listing cafés:', error);
    res.status(500).json({ success: false, message: 'Error loading customers' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/platform/cafes — onboard a new customer.
 *
 * One call, one transaction, four things created: the owner's account, the
 * café, its subscription, and its licence key. Doing this as four separate
 * admin actions is how you end up with a café that has no owner, or an owner
 * who cannot activate because nobody issued a key — and every one of those
 * half-states is a support call on the customer's first day.
 */
export const createCafe = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeName = String(req.body?.cafe_name || '').trim();
    const ownerName = String(req.body?.owner_name || '').trim();
    const ownerEmail = String(req.body?.owner_email || '').trim().toLowerCase();

    if (!cafeName || !ownerName || !ownerEmail) {
      return res.status(400).json({
        success: false,
        message: 'The café name, owner name and owner email are all required'
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      return res.status(400).json({ success: false, message: 'That email address does not look right' });
    }

    await client.query('BEGIN');

    /* Reuse an existing account rather than failing. A café chain opening a
       second venue is the same person, and refusing them because the email is
       taken would force an admin to invent a fake address. */
    let owner = (await client.query(
      'SELECT id, email, name, role FROM users WHERE LOWER(email) = $1', [ownerEmail])).rows[0];

    let temporaryPassword = null;
    if (!owner) {
      /*
       * A password the admin can read once and pass on. Generated here rather
       * than chosen by the admin: an admin-chosen password is invariably
       * weak and invariably reused across customers.
       */
      temporaryPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
      const hashed = await bcrypt.hash(temporaryPassword, 10);

      // Verified immediately: a ManagerXP admin is creating and vouching for
      // this account directly, the same reasoning a staff-created customer
      // gets — there is no self-service code screen in this admin tool to
      // clear it with, so leaving the default FALSE would lock the owner out
      // the first time they tried the ordinary sign-in door.
      owner = (await client.query(`
        INSERT INTO users (email, phone_number, name, address, password, role, email_verified)
        VALUES ($1,$2,$3,$4,$5,'user',TRUE)
        RETURNING id, email, name, role
      `, [
        ownerEmail,
        // NOT NULL on this column; see the note in createUser.
        req.body?.owner_phone ? String(req.body.owner_phone).trim() : '',
        ownerName,
        JSON.stringify(req.body?.address || {}),
        hashed
      ])).rows[0];
    }

    const cafe = (await client.query(`
      INSERT INTO cafes (name, user_id, user_designation, description, is_active)
      VALUES ($1,$2,$3,$4,TRUE)
      RETURNING *
    `, [
      cafeName, owner.id,
      req.body?.owner_designation ? String(req.body.owner_designation).trim() : 'Owner',
      req.body?.description ? String(req.body.description).trim() : null
    ])).rows[0];

    /* Optional subscription. A customer being set up before they have paid is
       normal — the admin can start one later, or send them a payment link. */
    let subscription = null;
    let plan = null;
    if (req.body?.sub_id) {
      plan = (await client.query(
        'SELECT * FROM subscription_plans WHERE sub_id = $1', [Number(req.body.sub_id)])).rows[0];

      if (!plan) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'That plan does not exist' });
      }

      const days = Number(req.body?.days) > 0 ? Number(req.body.days) : daysForPlan(plan);
      const maxPcs = Number(req.body?.max_pcs) > 0 ? Number(req.body.max_pcs) : plan.max_pcs;
      const start = new Date();
      const end = new Date(start.getTime() + days * 86400000);

      subscription = (await client.query(`
        INSERT INTO subscriptions (cafe_id, sub_id, max_pcs, start_date, end_date, is_active)
        VALUES ($1,$2,$3,$4,$5,TRUE)
        RETURNING *
      `, [cafe.cafe_id, plan.sub_id, maxPcs, start, end])).rows[0];
    }

    /* The licence key. Issued by default — a customer set up without one
       cannot run the software, which is rarely what anybody intended. */
    let license = null;
    if (req.body?.issue_license !== false) {
      license = await issueLicense(client, {
        cafeId: cafe.cafe_id,
        subscriptionId: subscription?.subscription_id,
        product: ['cafexp', 'racexp'].includes(req.body?.product) ? req.body.product : 'cafexp',
        maxPcs: subscription?.max_pcs || plan?.max_pcs || null,
        maxBranches: plan?.max_branches || null,
        expiresAt: subscription?.end_date || null,
        notes: `Issued when ${cafeName} was set up`,
        issuedBy: req.actor?.id
      });
    }

    await client.query('COMMIT');

    await recordAudit(req, {
      action: 'platform.cafe.create',
      category: 'system',
      entity: 'cafe',
      entity_id: cafe.cafe_id,
      sensitive: true,
      summary: `Onboarded ${cafeName} for ${ownerName} <${ownerEmail}>`,
      // The temporary password is deliberately absent from the audit trail.
      meta: {
        owner_id: owner.id,
        new_account: !!temporaryPassword,
        sub_id: plan?.sub_id || null,
        license_issued: !!license
      }
    });

    res.status(201).json({
      success: true,
      message: `${cafeName} is set up`,
      data: {
        cafe,
        owner: { id: owner.id, name: owner.name, email: owner.email },
        // Shown once, on this response, and never retrievable again.
        temporary_password: temporaryPassword,
        subscription,
        license: license
          ? { license_id: license.license_id, license_key: license.license_key, product: license.product }
          : null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A café with those details already exists' });
    }
    console.error('Error onboarding café:', error);
    res.status(500).json({ success: false, message: 'Error setting up the customer' });
  } finally {
    client.release();
  }
};

// PATCH /api/platform/cafes/:id/status
export const setCafeStatus = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = Number(req.params.id);
    if (!Number.isInteger(cafeId)) {
      return res.status(400).json({ success: false, message: 'Invalid café' });
    }

    const activate = req.body?.is_active === true || req.body?.is_active === 'true';
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;

    if (!activate && !reason) {
      // A suspension with no stated reason is unanswerable when the customer
      // rings up asking why their console stopped.
      return res.status(400).json({ success: false, message: 'Give a reason for suspending this install' });
    }

    const { rows } = await client.query(`
      UPDATE cafes
      SET is_active = $2,
          suspended_reason = CASE WHEN $2 THEN NULL ELSE $3 END,
          suspended_at     = CASE WHEN $2 THEN NULL ELSE CURRENT_TIMESTAMP END,
          updated_at = CURRENT_TIMESTAMP
      WHERE cafe_id = $1
      RETURNING *
    `, [cafeId, activate, reason]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Café not found' });

    await recordAudit(req, {
      action: activate ? 'platform.cafe.activate' : 'platform.cafe.suspend',
      category: 'system',
      entity: 'cafe',
      entity_id: cafeId,
      sensitive: true,
      summary: activate
        ? `Reactivated the install for ${rows[0].name}`
        : `Suspended the install for ${rows[0].name} — ${reason}`,
      meta: { reason }
    });

    res.json({
      success: true,
      message: activate ? 'Install reactivated' : 'Install suspended',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error setting café status:', error);
    res.status(500).json({ success: false, message: 'Error updating the install' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   USERS

   Platform accounts — café owners and other admins. Distinct from café staff,
   who belong to a café and live in the `staff` table with their own roles.
   ========================================================================== */

// GET /api/platform/users
export const listUsers = async (req, res) => {
  const client = await pool.connect();
  try {
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;

    const { rows } = await client.query(`
      SELECT u.id, u.name, u.email, u.phone_number, u.address, u.role, u.created_at,
             COUNT(c.cafe_id)::int AS cafe_count,
             COALESCE(
               JSON_AGG(JSON_BUILD_OBJECT('cafe_id', c.cafe_id, 'name', c.name))
                 FILTER (WHERE c.cafe_id IS NOT NULL), '[]'
             ) AS cafes
      FROM users u
      LEFT JOIN cafes c ON c.user_id = u.id
      WHERE $1::text IS NULL OR u.name ILIKE $1 OR u.email ILIKE $1
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `, [search]);

    res.json({
      success: true,
      data: rows.map((r) => {
        // address is stored as JSON text by signup and as an object elsewhere;
        // normalise so the UI never has to guess.
        let address = r.address;
        if (typeof address === 'string') {
          try { address = JSON.parse(address); } catch { address = null; }
        }
        return { ...r, address, password: undefined };
      })
    });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ success: false, message: 'Error loading users' });
  } finally {
    client.release();
  }
};

// POST /api/platform/users
export const createUser = async (req, res) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'That email address does not look right' });
    }

    const exists = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({ success: false, message: 'An account with that email already exists' });
    }

    /* Only two roles exist on this table: 'admin' is ManagerXP staff, 'user'
       is a café owner. Anything else would silently fail every guard. */
    const role = req.body?.role === 'admin' ? 'admin' : 'user';

    // Generated, never chosen — see the note in createCafe.
    const temporaryPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    const hashed = await bcrypt.hash(temporaryPassword, 10);

    /* users.phone_number is NOT NULL, so an account created without one fails
       at the database rather than in validation. Empty string keeps the column
       honest — it records "we do not have a number", which is true — without
       inventing a placeholder that looks like a real one. */
    // Verified immediately — same reasoning as createCafe above: a ManagerXP
    // admin is vouching for this account directly, and this tool has no
    // self-service code screen to clear the default FALSE with.
    const { rows } = await client.query(`
      INSERT INTO users (email, phone_number, name, address, password, role, email_verified)
      VALUES ($1,$2,$3,$4,$5,$6,TRUE)
      RETURNING id, email, name, phone_number, role, created_at
    `, [
      email,
      req.body?.phone_number ? String(req.body.phone_number).trim() : '',
      name,
      JSON.stringify(req.body?.address || {}),
      hashed,
      role
    ]);

    await recordAudit(req, {
      action: 'platform.user.create',
      category: 'system',
      entity: 'user',
      entity_id: rows[0].id,
      sensitive: true,
      summary: `Created ${role} account for ${name} <${email}>`,
      meta: { role }
    });

    res.status(201).json({
      success: true,
      message: 'Account created',
      // Shown once. There is no endpoint that will return it again.
      data: { ...rows[0], temporary_password: temporaryPassword }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, message: 'Error creating the account' });
  } finally {
    client.release();
  }
};

// POST /api/platform/users/:id/reset-password
export const resetUserPassword = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const temporaryPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    const hashed = await bcrypt.hash(temporaryPassword, 10);

    const { rows } = await client.query(`
      UPDATE users SET password = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING id, name, email
    `, [id, hashed]);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Account not found' });

    await recordAudit(req, {
      action: 'platform.user.reset_password',
      category: 'system',
      entity: 'user',
      entity_id: id,
      sensitive: true,
      summary: `Reset the password for ${rows[0].email}`
    });

    res.json({
      success: true,
      message: 'Password reset',
      data: { ...rows[0], temporary_password: temporaryPassword }
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: 'Error resetting the password' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   SUBSCRIPTIONS
   ========================================================================== */

// GET /api/platform/subscriptions
export const listSubscriptions = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT s.*, c.name AS cafe_name, c.is_active AS cafe_active,
             p.name AS plan_name, p.price, p.currency, p.billing_period, p.is_freetrial,
             u.email AS owner_email, u.name AS owner_name
      FROM subscriptions s
      LEFT JOIN cafes c ON c.cafe_id = s.cafe_id
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      LEFT JOIN users u ON u.id = c.user_id
      ORDER BY s.end_date DESC NULLS LAST
    `);

    res.json({
      success: true,
      data: rows.map((r) => ({
        subscription_id: r.subscription_id,
        cafe_id: r.cafe_id,
        cafe_name: r.cafe_name,
        cafe_active: r.cafe_active,
        owner_name: r.owner_name,
        owner_email: r.owner_email,
        sub_id: r.sub_id,
        plan_name: r.plan_name,
        price: money(r.price),
        currency: r.currency,
        billing_period: r.billing_period,
        is_freetrial: r.is_freetrial,
        max_pcs: r.max_pcs,
        start_date: r.start_date,
        end_date: r.end_date,
        is_active: r.is_active,
        days_remaining: r.end_date
          ? Math.ceil((new Date(r.end_date) - Date.now()) / 86400000)
          : null
      }))
    });
  } catch (error) {
    console.error('Error listing subscriptions:', error);
    res.status(500).json({ success: false, message: 'Error loading subscriptions' });
  } finally {
    client.release();
  }
};

// POST /api/platform/subscriptions
export const createSubscription = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = Number(req.body?.cafe_id);
    const subId = Number(req.body?.sub_id);
    if (!Number.isInteger(cafeId) || !Number.isInteger(subId)) {
      return res.status(400).json({ success: false, message: 'Choose a customer and a plan' });
    }

    const plan = (await client.query(
      'SELECT * FROM subscription_plans WHERE sub_id = $1', [subId])).rows[0];
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const cafe = (await client.query(
      'SELECT * FROM cafes WHERE cafe_id = $1', [cafeId])).rows[0];
    if (!cafe) return res.status(404).json({ success: false, message: 'Customer not found' });

    const days = Number(req.body?.days) > 0 ? Number(req.body.days) : daysForPlan(plan);
    const maxPcs = Number(req.body?.max_pcs) > 0 ? Number(req.body.max_pcs) : plan.max_pcs;

    /*
     * Renewals extend from the existing end date, not from today. Starting
     * from today would silently confiscate the days a customer had already
     * paid for whenever they renewed early — which is precisely when a
     * well-organised customer renews.
     */
    const existing = (await client.query(`
      SELECT * FROM subscriptions
      WHERE cafe_id = $1 AND is_active AND end_date > NOW()
      ORDER BY end_date DESC LIMIT 1
    `, [cafeId])).rows[0];

    const startFrom = existing && req.body?.extend !== false
      ? new Date(existing.end_date)
      : new Date();
    const endDate = new Date(startFrom.getTime() + days * 86400000);

    await client.query('BEGIN');

    let subscription;
    if (existing && req.body?.extend !== false && Number(existing.sub_id) === subId) {
      // Same plan: extend the row rather than stacking a duplicate, so
      // "active subscriptions" counts customers and not renewals.
      subscription = (await client.query(`
        UPDATE subscriptions
        SET end_date = $2, max_pcs = $3, is_active = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE subscription_id = $1
        RETURNING *
      `, [existing.subscription_id, endDate, maxPcs])).rows[0];
    } else {
      if (existing) {
        // Switching plans: close the old one so two do not run at once.
        await client.query(
          'UPDATE subscriptions SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE subscription_id = $1',
          [existing.subscription_id]);
      }
      subscription = (await client.query(`
        INSERT INTO subscriptions (cafe_id, sub_id, max_pcs, start_date, end_date, is_active)
        VALUES ($1,$2,$3,$4,$5,TRUE)
        RETURNING *
      `, [cafeId, subId, maxPcs, startFrom, endDate])).rows[0];
    }

    // Selling a subscription reactivates a suspended install: the reason it
    // was suspended has just been resolved.
    if (!cafe.is_active) {
      await client.query(`
        UPDATE cafes SET is_active = TRUE, suspended_reason = NULL, suspended_at = NULL,
               updated_at = CURRENT_TIMESTAMP
        WHERE cafe_id = $1
      `, [cafeId]);
    }

    /* Money the admin says they already collected (bank transfer, cash). A
       payment link records its own payment when it settles. */
    if (req.body?.record_payment && Number(req.body.amount) > 0) {
      await client.query(`
        INSERT INTO subscription_payments
          (cafe_id, subscription_id, amount, currency, method, reference, note, recorded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [cafeId, subscription.subscription_id, money(req.body.amount), plan.currency || 'INR',
          ['bank_transfer', 'cash', 'cheque', 'other'].includes(req.body.method) ? req.body.method : 'other',
          req.body?.reference ? String(req.body.reference).slice(0, 160) : null,
          req.body?.note ? String(req.body.note).slice(0, 255) : null,
          req.actor?.id || null]);
    }

    await client.query('COMMIT');

    await recordAudit(req, {
      action: 'platform.subscription.create',
      category: 'system',
      entity: 'subscription',
      entity_id: subscription.subscription_id,
      amount: money(plan.price),
      sensitive: true,
      summary: `${existing ? 'Renewed' : 'Started'} ${plan.name} for ${cafe.name} — ${days} days`,
      meta: { cafe_id: cafeId, sub_id: subId, days, max_pcs: maxPcs }
    });

    res.status(201).json({
      success: true,
      message: existing ? 'Subscription renewed' : 'Subscription created',
      data: subscription
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating subscription:', error);
    res.status(500).json({ success: false, message: 'Error saving the subscription' });
  } finally {
    client.release();
  }
};

// PATCH /api/platform/subscriptions/:id
export const updateSubscription = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const fields = [];
    const values = [id];

    if (req.body?.max_pcs !== undefined && Number(req.body.max_pcs) > 0) {
      values.push(Number(req.body.max_pcs));
      fields.push(`max_pcs = $${values.length}`);
    }
    if (req.body?.end_date) {
      values.push(new Date(req.body.end_date));
      fields.push(`end_date = $${values.length}`);
    }
    if (req.body?.is_active !== undefined) {
      values.push(req.body.is_active === true || req.body.is_active === 'true');
      fields.push(`is_active = $${values.length}`);
    }
    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Nothing to change' });
    }

    const { rows } = await client.query(
      `UPDATE subscriptions SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE subscription_id = $1 RETURNING *`, values);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Subscription not found' });

    await recordAudit(req, {
      action: 'platform.subscription.update',
      category: 'system',
      entity: 'subscription',
      entity_id: id,
      sensitive: true,
      summary: `Updated subscription ${id}`,
      meta: req.body
    });

    res.json({ success: true, message: 'Subscription updated', data: rows[0] });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ success: false, message: 'Error updating the subscription' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PAYMENTS RECORDED BY HAND
   ========================================================================== */

// POST /api/platform/payments
export const recordPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter an amount' });
    }

    const { rows } = await client.query(`
      INSERT INTO subscription_payments
        (cafe_id, subscription_id, amount, currency, method, reference, note, recorded_by, received_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, CURRENT_TIMESTAMP))
      RETURNING *
    `, [
      req.body?.cafe_id ? Number(req.body.cafe_id) : null,
      req.body?.subscription_id ? Number(req.body.subscription_id) : null,
      money(amount),
      req.body?.currency || 'INR',
      ['bank_transfer', 'cash', 'cheque', 'other', 'link'].includes(req.body?.method) ? req.body.method : 'other',
      req.body?.reference ? String(req.body.reference).slice(0, 160) : null,
      req.body?.note ? String(req.body.note).slice(0, 255) : null,
      req.actor?.id || null,
      req.body?.received_at ? new Date(req.body.received_at) : null
    ]);

    await recordAudit(req, {
      action: 'platform.payment.record',
      category: 'system',
      entity: 'subscription_payment',
      entity_id: rows[0].payment_id,
      amount: money(amount),
      sensitive: true,
      summary: `Recorded ${money(amount)} received by ${rows[0].method}`,
      meta: { reference: rows[0].reference }
    });

    res.status(201).json({ success: true, message: 'Payment recorded', data: rows[0] });
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ success: false, message: 'Error recording the payment' });
  } finally {
    client.release();
  }
};

// GET /api/platform/payments
export const listPayments = async (req, res) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { rows } = await client.query(`
      SELECT sp.*, c.name AS cafe_name
      FROM subscription_payments sp
      LEFT JOIN cafes c ON c.cafe_id = sp.cafe_id
      ORDER BY sp.received_at DESC
      LIMIT $1
    `, [limit]);

    res.json({
      success: true,
      data: rows.map((r) => ({
        payment_id: r.payment_id,
        cafe_id: r.cafe_id,
        cafe_name: r.cafe_name,
        amount: money(r.amount),
        currency: r.currency,
        method: r.method,
        provider: r.provider,
        reference: r.reference,
        note: r.note,
        received_at: r.received_at
      }))
    });
  } catch (error) {
    console.error('Error listing payments:', error);
    res.status(500).json({ success: false, message: 'Error loading payments' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PAYMENT LINKS
   ========================================================================== */

// POST /api/platform/payment-links
export const createPaymentLink = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = req.body?.cafe_id ? Number(req.body.cafe_id) : null;
    const subId = req.body?.sub_id ? Number(req.body.sub_id) : null;

    let amount = Number(req.body?.amount);
    let currency = req.body?.currency || 'INR';
    let grantsDays = req.body?.grants_days ? Number(req.body.grants_days) : null;
    let grantsMaxPcs = req.body?.grants_max_pcs ? Number(req.body.grants_max_pcs) : null;

    /*
     * When a plan is chosen, its price and entitlements are copied onto the
     * link rather than referenced. A link is a quote the customer may pay days
     * later; if the price list changed in between, they must still get what
     * they were quoted, and we must not charge a figure they never saw.
     */
    let plan = null;
    if (subId) {
      plan = (await client.query('SELECT * FROM subscription_plans WHERE sub_id = $1', [subId])).rows[0];
      if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
      if (!Number.isFinite(amount) || amount <= 0) amount = Number(plan.price) + Number(plan.setup_fee || 0);
      currency = plan.currency || currency;
      if (!grantsDays) grantsDays = daysForPlan(plan);
      if (!grantsMaxPcs) grantsMaxPcs = plan.max_pcs;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter an amount, or choose a plan' });
    }

    let customerName = req.body?.customer_name || null;
    let customerEmail = req.body?.customer_email || null;
    let customerPhone = req.body?.customer_phone || null;

    // Fill the customer's details from the café record when not supplied, so
    // the pay page can greet them and the gateway gets a contact.
    if (cafeId && (!customerName || !customerEmail)) {
      const owner = (await client.query(`
        SELECT c.name AS cafe_name, u.name, u.email, u.phone_number
        FROM cafes c LEFT JOIN users u ON u.id = c.user_id WHERE c.cafe_id = $1
      `, [cafeId])).rows[0];
      if (owner) {
        customerName = customerName || owner.name || owner.cafe_name;
        customerEmail = customerEmail || owner.email;
        customerPhone = customerPhone || owner.phone_number;
      }
    }

    const days = Number(req.body?.expires_in_days) > 0 ? Number(req.body.expires_in_days) : 14;
    const token = crypto.randomBytes(24).toString('base64url');

    const { rows } = await client.query(`
      INSERT INTO payment_links
        (token, cafe_id, sub_id, customer_name, customer_email, customer_phone,
         purpose, description, amount, currency, grants_days, grants_max_pcs,
         created_by, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CURRENT_TIMESTAMP + ($14 || ' days')::interval)
      RETURNING *
    `, [
      token, cafeId, subId, customerName, customerEmail, customerPhone,
      ['subscription', 'renewal', 'upgrade', 'addon', 'other'].includes(req.body?.purpose)
        ? req.body.purpose : 'subscription',
      req.body?.description
        ? String(req.body.description).slice(0, 255)
        : (plan ? `${plan.name} — ${grantsDays} days` : null),
      money(amount), currency, grantsDays, grantsMaxPcs,
      req.actor?.id || null, String(days)
    ]);

    await recordAudit(req, {
      action: 'platform.paylink.create',
      category: 'system',
      entity: 'payment_link',
      entity_id: rows[0].link_id,
      amount: money(amount),
      sensitive: true,
      summary: `Created a ${currency} ${money(amount)} payment link` +
        (customerEmail ? ` for ${customerEmail}` : ''),
      meta: { cafe_id: cafeId, sub_id: subId, expires_in_days: days }
    });

    res.status(201).json({
      success: true,
      message: 'Payment link created',
      data: shapeLink({ ...rows[0], plan_name: plan?.name }, publicBase(req))
    });
  } catch (error) {
    console.error('Error creating payment link:', error);
    res.status(500).json({ success: false, message: 'Error creating the payment link' });
  } finally {
    client.release();
  }
};

// GET /api/platform/payment-links
export const listPaymentLinks = async (req, res) => {
  const client = await pool.connect();
  try {
    const status = ['open', 'paid', 'expired', 'cancelled'].includes(req.query.status)
      ? req.query.status : null;

    /* Expiry is a wall-clock fact, not an event anyone fires, so it is applied
       on read. Without this a link shows "open" forever and the outstanding
       total is quietly wrong. */
    await client.query(`
      UPDATE payment_links SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at < NOW()
    `);

    const { rows } = await client.query(`
      SELECT l.*, c.name AS cafe_name, p.name AS plan_name
      FROM payment_links l
      LEFT JOIN cafes c ON c.cafe_id = l.cafe_id
      LEFT JOIN subscription_plans p ON p.sub_id = l.sub_id
      WHERE $1::text IS NULL OR l.status = $1
      ORDER BY l.created_at DESC
      LIMIT 200
    `, [status]);

    res.json({ success: true, data: rows.map((r) => shapeLink(r, publicBase(req))) });
  } catch (error) {
    console.error('Error listing payment links:', error);
    res.status(500).json({ success: false, message: 'Error loading payment links' });
  } finally {
    client.release();
  }
};

// POST /api/platform/payment-links/:id/cancel
export const cancelPaymentLink = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      UPDATE payment_links SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE link_id = $1 AND status = 'open'
      RETURNING *
    `, [Number(req.params.id)]);

    if (!rows.length) {
      return res.status(409).json({ success: false, message: 'That link is no longer open' });
    }

    await recordAudit(req, {
      action: 'platform.paylink.cancel',
      category: 'system',
      entity: 'payment_link',
      entity_id: rows[0].link_id,
      sensitive: true,
      summary: `Cancelled a ${rows[0].currency} ${money(rows[0].amount)} payment link`
    });

    res.json({ success: true, message: 'Link cancelled' });
  } catch (error) {
    console.error('Error cancelling payment link:', error);
    res.status(500).json({ success: false, message: 'Error cancelling the link' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PLANS  (pricing lives here now, so the platform console owns it)
   ========================================================================== */

// GET /api/platform/plans
export const listPlans = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT p.*,
             (SELECT COUNT(*)::int FROM subscriptions s
               WHERE s.sub_id = p.sub_id AND s.is_active AND s.end_date > NOW()) AS active_subscriptions
      FROM subscription_plans p
      ORDER BY p.price ASC, p.sub_id ASC
    `);

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        price: money(r.price),
        setup_fee: money(r.setup_fee),
        monthly_value: money(monthlyValue(r))
      }))
    });
  } catch (error) {
    console.error('Error listing plans:', error);
    res.status(500).json({ success: false, message: 'Error loading plans' });
  } finally {
    client.release();
  }
};

// PATCH /api/platform/plans/:id/pricing
export const updatePlanPricing = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ success: false, message: 'Enter a price' });
    }

    const period = ['monthly', 'quarterly', 'yearly', 'one_time'].includes(req.body?.billing_period)
      ? req.body.billing_period : 'monthly';

    const { rows } = await client.query(`
      UPDATE subscription_plans
      SET price = $2, currency = $3, billing_period = $4, setup_fee = $5, updated_at = CURRENT_TIMESTAMP
      WHERE sub_id = $1
      RETURNING *
    `, [id, money(price), req.body?.currency || 'INR', period, money(req.body?.setup_fee || 0)]);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Plan not found' });

    await recordAudit(req, {
      action: 'platform.plan.pricing',
      category: 'system',
      entity: 'subscription_plan',
      entity_id: id,
      amount: money(price),
      sensitive: true,
      summary: `Set ${rows[0].name} to ${rows[0].currency} ${money(price)} ${period}`
    });

    res.json({ success: true, message: 'Pricing updated', data: rows[0] });
  } catch (error) {
    console.error('Error updating plan pricing:', error);
    res.status(500).json({ success: false, message: 'Error updating pricing' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   THE PUBLIC PAY PAGE

   Reached by anyone holding the link. No session, no sign-in: the token is
   the credential and it buys exactly one thing.
   ========================================================================== */

const loadLink = async (client, token) => {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { rows } = await client.query(`
    SELECT l.*, c.name AS cafe_name, p.name AS plan_name
    FROM payment_links l
    LEFT JOIN cafes c ON c.cafe_id = l.cafe_id
    LEFT JOIN subscription_plans p ON p.sub_id = l.sub_id
    WHERE l.token = $1
  `, [token]);
  return rows[0] || null;
};

/** The gateway ManagerXP itself collects with. */
const platformGateway = async (client) => {
  /* The platform's own merchant account is stored as the gateway row with no
     café attached, which keeps it clearly apart from every café's own
     credentials in the same table. */
  const { rows } = await client.query(`
    SELECT * FROM payment_gateways
    WHERE cafe_id IS NULL AND is_enabled = TRUE
    ORDER BY gateway_id LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    row,
    provider: getProvider(row.provider),
    keyId: row.key_id,
    keySecret: decryptSecret(row.key_secret_enc),
    mode: row.mode
  };
};

// GET /api/platform/pay/:token  — details for the public page
export const getPayLink = async (req, res) => {
  const client = await pool.connect();
  try {
    const link = await loadLink(client, req.params.token);
    if (!link) return res.status(404).json({ success: false, message: 'This payment link was not found' });

    if (link.status === 'paid') {
      return res.json({
        success: true,
        data: {
          status: 'paid',
          amount: money(link.amount),
          currency: link.currency,
          description: link.description,
          paid_at: link.paid_at
        }
      });
    }
    if (link.status !== 'open') {
      return res.status(410).json({ success: false, message: `This link has been ${link.status}` });
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      await client.query(`UPDATE payment_links SET status = 'expired' WHERE link_id = $1`, [link.link_id]);
      return res.status(410).json({ success: false, message: 'This link has expired' });
    }

    const gateway = await platformGateway(client);

    /* Only what the payer needs to see. No café id, no subscription internals,
       no gateway secret — the token identifies the bill, it does not admit the
       holder to anything else. */
    res.json({
      success: true,
      data: {
        status: 'open',
        amount: money(link.amount),
        currency: link.currency,
        description: link.description,
        plan_name: link.plan_name,
        purpose: link.purpose,
        customer_name: link.customer_name,
        billed_to: link.cafe_name,
        grants_days: link.grants_days,
        expires_at: link.expires_at,
        payable: !!gateway,
        // Without a configured gateway the page must say so rather than show a
        // button that cannot work.
        provider: gateway ? gateway.row.provider : null,
        mode: gateway ? gateway.mode : null
      }
    });
  } catch (error) {
    console.error('Error loading payment link:', error);
    res.status(500).json({ success: false, message: 'Error loading this payment' });
  } finally {
    client.release();
  }
};

// POST /api/platform/pay/:token/order — start the payment
export const startLinkPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const link = await loadLink(client, req.params.token);
    if (!link || link.status !== 'open') {
      return res.status(410).json({ success: false, message: 'This link is no longer payable' });
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      await client.query(`UPDATE payment_links SET status = 'expired' WHERE link_id = $1`, [link.link_id]);
      return res.status(410).json({ success: false, message: 'This link has expired' });
    }

    const gateway = await platformGateway(client);
    if (!gateway || !gateway.provider || !gateway.keySecret) {
      return res.status(503).json({
        success: false,
        message: 'Online payment is not available. Please contact ManagerXP.'
      });
    }

    let created;
    try {
      created = await gateway.provider.createOrder({
        keyId: gateway.keyId,
        keySecret: gateway.keySecret,
        // The amount comes from the row, never from the request body.
        amount: Number(link.amount),
        currency: link.currency,
        receipt: `mxp_${link.link_id}_${Date.now().toString(36)}`,
        mode: gateway.mode,
        notes: { link_id: String(link.link_id), purpose: link.purpose },
        customer: {
          id: link.cafe_id || link.link_id,
          name: link.customer_name || 'Customer',
          email: link.customer_email || 'billing@managerxp.local',
          phone: link.customer_phone || ''
        },
        returnUrl: `${publicBase(req)}/pay/${link.token}`
      });
    } catch (err) {
      console.error('[platform] provider rejected order:', err.message);
      return res.status(502).json({
        success: false,
        message: 'The payment provider could not start this payment. Please try again shortly.'
      });
    }

    await client.query(`
      UPDATE payment_links
      SET provider = $2, provider_order_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE link_id = $1
    `, [link.link_id, gateway.row.provider, created.orderId]);

    res.json({
      success: true,
      data: {
        provider: gateway.row.provider,
        key_id: gateway.keyId,          // publishable half only
        order_id: created.orderId,
        session_id: created.sessionId || null,
        form: created.form || null,
        amount: money(link.amount),
        currency: link.currency,
        description: link.description,
        customer: {
          name: link.customer_name,
          email: link.customer_email,
          phone: link.customer_phone
        }
      }
    });
  } catch (error) {
    console.error('Error starting link payment:', error);
    res.status(500).json({ success: false, message: 'Error starting the payment' });
  } finally {
    client.release();
  }
};

// POST /api/platform/pay/:token/complete — verify and apply
export const completeLinkPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const link = await loadLink(client, req.params.token);
    if (!link) return res.status(404).json({ success: false, message: 'Not found' });

    if (link.status === 'paid') {
      return res.json({ success: true, message: 'Already paid', data: { status: 'paid' } });
    }

    const gateway = await platformGateway(client);
    if (!gateway || !gateway.provider) {
      return res.status(503).json({ success: false, message: 'Payment cannot be confirmed right now' });
    }

    /* The browser's claim is evidence; the signature is what makes it true.
       Identical reasoning to the café-side top-ups — a payer who edits the
       response gets a failed verification, not free service. */
    const verdict = await gateway.provider.verifyReturn({
      keyId: gateway.keyId,
      keySecret: gateway.keySecret,
      mode: gateway.mode,
      order: { provider_order_id: link.provider_order_id, amount: link.amount },
      payload: req.body?.payload || {}
    });

    if (!verdict.ok) {
      return res.status(400).json({ success: false, message: verdict.reason });
    }
    if (verdict.amount != null && Math.abs(Number(verdict.amount) - Number(link.amount)) > 0.01) {
      return res.status(409).json({ success: false, message: 'The amount paid does not match this link' });
    }

    await client.query('BEGIN');

    /* Claim the link first. The unique index on (provider, provider_payment_id)
       plus this guarded UPDATE mean a second caller finds nothing to update
       and applies nothing — the subscription is extended exactly once. */
    const claimed = await client.query(`
      UPDATE payment_links
      SET status = 'paid', provider_payment_id = $2, paid_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE link_id = $1 AND status = 'open'
      RETURNING *
    `, [link.link_id, verdict.paymentId]);

    if (claimed.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, message: 'Already paid', data: { status: 'paid' } });
    }

    const recorded = (await client.query(`
      INSERT INTO subscription_payments
        (cafe_id, organization_id, invoice_id, link_id, amount, currency, method,
         provider, provider_payment_id, note, status)
      VALUES ($1,$2,$3,$4,$5,$6,'link',$7,$8,$9,'SUCCESS')
      RETURNING *
    `, [link.cafe_id, link.organization_id || null, link.invoice_id || null, link.link_id,
        money(link.amount), link.currency,
        gateway.row.provider, verdict.paymentId, link.description])).rows[0];

    /* A link raised against an invoice settles that invoice. Without this the
       money would arrive, be recorded, and the invoice would still read as
       outstanding — the customer having paid and the ledger disagreeing is the
       one outcome worse than not taking the payment at all. */
    if (link.invoice_id) {
      await recalcInvoice(client, link.invoice_id);
    }

    /* Apply what was bought. A link with no café attached is a plain invoice —
       money recorded, nothing provisioned — which is the right behaviour for a
       prospect who has not been set up yet. */
    let applied = null;
    if (link.cafe_id && link.grants_days) {
      const existing = (await client.query(`
        SELECT * FROM subscriptions WHERE cafe_id = $1 AND is_active AND end_date > NOW()
        ORDER BY end_date DESC LIMIT 1
      `, [link.cafe_id])).rows[0];

      const startFrom = existing ? new Date(existing.end_date) : new Date();
      const endDate = new Date(startFrom.getTime() + Number(link.grants_days) * 86400000);

      if (existing && (!link.sub_id || Number(existing.sub_id) === Number(link.sub_id))) {
        applied = (await client.query(`
          UPDATE subscriptions SET end_date = $2, max_pcs = COALESCE($3, max_pcs),
                 is_active = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE subscription_id = $1 RETURNING *
        `, [existing.subscription_id, endDate, link.grants_max_pcs])).rows[0];
      } else if (link.sub_id) {
        if (existing) {
          await client.query(
            'UPDATE subscriptions SET is_active = FALSE WHERE subscription_id = $1',
            [existing.subscription_id]);
        }
        applied = (await client.query(`
          INSERT INTO subscriptions (cafe_id, sub_id, max_pcs, start_date, end_date, is_active)
          VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING *
        `, [link.cafe_id, link.sub_id, link.grants_max_pcs, startFrom, endDate])).rows[0];
      }

      if (applied) {
        await client.query(
          'UPDATE subscription_payments SET subscription_id = $2 WHERE link_id = $1',
          [link.link_id, applied.subscription_id]);
      }

      // Paying clears a suspension: the reason for it has just gone away.
      await client.query(`
        UPDATE cafes SET is_active = TRUE, suspended_reason = NULL, suspended_at = NULL,
               updated_at = CURRENT_TIMESTAMP
        WHERE cafe_id = $1 AND NOT is_active
      `, [link.cafe_id]);
    }

    await client.query('COMMIT');

    console.log(`[platform] payment link ${link.link_id} paid — ${link.currency} ${money(link.amount)}`);

    res.json({
      success: true,
      message: 'Payment received',
      data: {
        status: 'paid',
        amount: money(link.amount),
        currency: link.currency,
        valid_until: applied ? applied.end_date : null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error completing link payment:', error);
    res.status(500).json({ success: false, message: 'Error confirming the payment' });
  } finally {
    client.release();
  }
};
