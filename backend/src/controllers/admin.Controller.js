/*
 * ManagerXP admin console — customers, packages, features, add-ons.
 *
 * The rule that shapes this whole file, from spec section 57: there is ONE
 * source of truth for entitlements, and it is `entitlements.service.js`. The
 * admin console reads from it and writes to the tables it resolves over. It
 * never computes an answer of its own — an admin who is shown a different
 * verdict from the one CafeXP enforces cannot do their job.
 *
 * The other rule, from section 21: changing a customer must never change the
 * package. Every customer-specific write below goes to
 * `entitlement_overrides` or to a column on that customer's `subscriptions`
 * row, and never to `plan_features` or `subscription_plans`.
 */
import pool from '../config/database.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import {
  getSubscription, getUsage, getEntitlements, listModules, listFeatures,
  normalizeStationLimits
} from '../modules/entitlements/entitlements.service.js';

/* ==========================================================================
   DASHBOARD
   ========================================================================== */

/** GET /api/admin/dashboard */
export const dashboard = async (req, res) => {
  try {
    const warnAt = Number((await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'usage.warn_threshold'`
    )).rows[0]?.setting_value || 80);

    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM organizations)                                   AS organizations,
        (SELECT COUNT(*)::int FROM organizations WHERE status = 'ACTIVE')           AS organizations_active,
        (SELECT COUNT(*)::int FROM organizations WHERE status = 'SUSPENDED')        AS organizations_suspended,
        (SELECT COUNT(DISTINCT user_id)::int FROM organization_users
           WHERE role = 'OWNER' AND status = 'ACTIVE')                              AS cafe_owners,
        (SELECT COUNT(*)::int FROM branches WHERE status <> 'CLOSED')               AS branches,
        (SELECT COUNT(*)::int FROM pcs WHERE is_active AND device_type = 'GAMING_PC'
           AND (category = 'PC' OR category IS NULL))                       AS gaming_pcs,
        (SELECT COUNT(*)::int FROM installations WHERE status = 'ACTIVE')           AS installations,
        (SELECT COUNT(*)::int FROM subscriptions
           WHERE type = 'TRIAL' AND status IN ('TRIAL','ACTIVE') AND end_date > NOW()) AS trials,
        (SELECT COUNT(*)::int FROM subscriptions
           WHERE type = 'TRIAL' AND status IN ('TRIAL','ACTIVE')
             AND end_date BETWEEN NOW() AND NOW() + interval '7 days')              AS trials_expiring,
        (SELECT COUNT(*)::int FROM subscriptions
           WHERE type <> 'TRIAL' AND status = 'ACTIVE' AND end_date > NOW())        AS subscriptions_active,
        (SELECT COUNT(*)::int FROM subscriptions
           WHERE status = 'EXPIRED' OR (status IN ('TRIAL','ACTIVE') AND end_date <= NOW())) AS subscriptions_expired,
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'SUSPENDED')        AS subscriptions_suspended,
        /* MRR from what customers actually agreed to pay, normalised to a
           month. Reading it off the package price would overstate every
           discounted customer. */
        (SELECT COALESCE(SUM(
            COALESCE(net_price, list_price, 0) /
            CASE billing_period
              WHEN 'annual' THEN 12 WHEN 'half_yearly' THEN 6
              WHEN 'quarterly' THEN 3 ELSE 1 END
          ), 0)::numeric(12,2)
         FROM subscriptions
         WHERE status IN ('ACTIVE','PAST_DUE','GRACE_PERIOD') AND type <> 'TRIAL')  AS mrr
    `)).rows[0];

    /* Alerts are things somebody should act on today, each carrying the rows
       that triggered it so the console can link straight there. */
    const [expiringTrials, atLimit, offline, recentSignups, staleReleases] = await Promise.all([
      pool.query(`
        SELECT o.organization_id, o.name, s.end_date,
               GREATEST(0, CEIL(EXTRACT(EPOCH FROM (s.end_date - NOW())) / 86400))::int AS days_left
        FROM subscriptions s
        JOIN organizations o ON o.organization_id = s.organization_id
        WHERE s.type = 'TRIAL' AND s.status IN ('TRIAL','ACTIVE')
          AND s.end_date BETWEEN NOW() AND NOW() + interval '7 days'
        ORDER BY s.end_date LIMIT 10
      `).then((r) => r.rows),
      pool.query(`
        SELECT o.organization_id, o.name,
               COUNT(p.pc_id)::int AS used, s.max_pcs
        FROM organizations o
        JOIN subscriptions s ON s.organization_id = o.organization_id
        LEFT JOIN pcs p ON p.organization_id = o.organization_id
             AND p.is_active AND p.device_type = 'GAMING_PC'
             AND (p.category = 'PC' OR p.category IS NULL)
        WHERE s.max_pcs IS NOT NULL AND s.status IN ('TRIAL','ACTIVE')
        GROUP BY o.organization_id, o.name, s.max_pcs
        HAVING COUNT(p.pc_id) >= s.max_pcs * $1 / 100.0
        ORDER BY COUNT(p.pc_id)::float / NULLIF(s.max_pcs,0) DESC LIMIT 10
      `, [warnAt]).then((r) => r.rows),
      pool.query(`
        SELECT i.installation_id, i.public_id, i.name, o.name AS organization, i.last_seen_at
        FROM installations i
        JOIN organizations o ON o.organization_id = i.organization_id
        WHERE i.status = 'ACTIVE'
          AND (i.last_seen_at IS NULL OR i.last_seen_at < NOW() - interval '24 hours')
        ORDER BY i.last_seen_at NULLS FIRST LIMIT 10
      `).then((r) => r.rows),
      pool.query(`
        SELECT organization_id, name, created_at FROM organizations
        WHERE created_at > NOW() - interval '7 days'
        ORDER BY created_at DESC LIMIT 10
      `).then((r) => r.rows),
      pool.query(`
        SELECT product, component, channel, version, published_at
        FROM client_releases WHERE is_published
        ORDER BY version_sort DESC LIMIT 5
      `).then((r) => r.rows)
    ]);

    res.json({
      success: true,
      data: {
        stats,
        alerts: {
          trials_expiring: expiringTrials,
          usage_at_limit: atLimit,
          installations_offline: offline,
          new_customers: recentSignups
        },
        releases: staleReleases,
        warn_threshold: warnAt
      }
    });
  } catch (error) {
    console.error('Admin dashboard failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the dashboard' });
  }
};

/* ==========================================================================
   CUSTOMERS / ORGANIZATIONS
   ========================================================================== */

/** GET /api/admin/organizations?q=&status=&page= */
export const listOrganizations = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Number(req.query.size) || 25);

    const where = [];
    const params = [];

    if (q) {
      /* Section 42's global search, applied to the customer list: one box
         that matches the business, its owner, a branch or a subscription id,
         because an admin on a support call has whichever of those the
         customer happened to say. */
      params.push(`%${q.toLowerCase()}%`);
      where.push(`(
        LOWER(o.name) LIKE $${params.length}
        OR LOWER(COALESCE(o.email,'')) LIKE $${params.length}
        OR COALESCE(o.phone,'') LIKE $${params.length}
        OR EXISTS (SELECT 1 FROM organization_users ou JOIN users u ON u.id = ou.user_id
                   WHERE ou.organization_id = o.organization_id
                     AND (LOWER(u.email) LIKE $${params.length} OR LOWER(u.name) LIKE $${params.length}
                          OR COALESCE(u.phone_number,'') LIKE $${params.length}))
        OR EXISTS (SELECT 1 FROM branches b WHERE b.organization_id = o.organization_id
                   AND LOWER(b.name) LIKE $${params.length})
        OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.organization_id
                   AND CAST(s.subscription_id AS TEXT) = $${params.length + 1})
      )`);
      params.push(q);
    }

    if (status) {
      params.push(status);
      where.push(`(
        o.status = $${params.length}
        OR EXISTS (SELECT 1 FROM subscriptions s
                   WHERE s.organization_id = o.organization_id AND s.status = $${params.length})
        OR ($${params.length} = 'TRIAL' AND EXISTS (SELECT 1 FROM subscriptions s
                   WHERE s.organization_id = o.organization_id AND s.type = 'TRIAL'))
      )`);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM organizations o ${clause}`, params
    )).rows[0].n;

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT o.organization_id, o.name, o.slug, o.status, o.email, o.phone,
             o.city, o.currency, o.created_at,
             owner.name AS owner_name, owner.email AS owner_email, owner.phone_number AS owner_phone,
             s.subscription_id, s.type AS subscription_type, s.status AS subscription_status,
             s.end_date, s.net_price, s.currency AS subscription_currency, s.billing_period,
             p.name AS plan_name, p.code AS plan_code,
             (SELECT COUNT(*)::int FROM branches b
               WHERE b.organization_id = o.organization_id AND b.status <> 'CLOSED') AS branches,
             (SELECT COUNT(*)::int FROM pcs pc
               WHERE pc.organization_id = o.organization_id AND pc.is_active
                 AND pc.device_type = 'GAMING_PC'
                 AND (pc.category = 'PC' OR pc.category IS NULL))                    AS pcs,
             s.max_pcs, s.max_branches
      FROM organizations o
      LEFT JOIN LATERAL (
        SELECT u.name, u.email, u.phone_number
        FROM organization_users ou JOIN users u ON u.id = ou.user_id
        WHERE ou.organization_id = o.organization_id AND ou.role = 'OWNER'
        ORDER BY ou.organization_user_id LIMIT 1
      ) owner ON TRUE
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions
        WHERE organization_id = o.organization_id
        ORDER BY (status IN ('TRIAL','ACTIVE')) DESC, end_date DESC NULLS LAST LIMIT 1
      ) s ON TRUE
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      ${clause}
      ORDER BY o.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, total, page, size } });
  } catch (error) {
    console.error('Admin organization list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load customers' });
  }
};

/** GET /api/admin/organizations/:id — the detail page's Overview tab. */
export const getOrganization = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const org = (await pool.query(
      'SELECT * FROM organizations WHERE organization_id = $1', [id]
    )).rows[0];
    if (!org) return res.status(404).json({ success: false, message: 'Not found' });

    const [subscription, usage, owners, branches, installations] = await Promise.all([
      getSubscription(id),
      getUsage(id),
      pool.query(`
        SELECT u.id, u.name, u.email, u.phone_number, ou.role, ou.status, ou.accepted_at
        FROM organization_users ou JOIN users u ON u.id = ou.user_id
        WHERE ou.organization_id = $1 ORDER BY ou.role, u.name
      `, [id]).then((r) => r.rows),
      pool.query(`
        SELECT b.branch_id, b.name, b.code, b.city, b.status, b.cafe_id,
               (SELECT COUNT(*)::int FROM pcs p WHERE p.branch_id = b.branch_id
                  AND p.is_active AND p.device_type = 'GAMING_PC'
                  AND (p.category = 'PC' OR p.category IS NULL)) AS pcs,
               (SELECT COUNT(*)::int FROM installations i WHERE i.branch_id = b.branch_id
                  AND i.status = 'ACTIVE') AS installations
        FROM branches b WHERE b.organization_id = $1 AND b.status <> 'CLOSED'
        ORDER BY b.name
      `, [id]).then((r) => r.rows),
      pool.query(`
        SELECT i.installation_id, i.public_id, i.name, i.status, i.version,
               i.last_seen_at, i.registered_at, b.name AS branch_name,
               (SELECT COUNT(*)::int FROM pcs p WHERE p.installation_id = i.installation_id) AS device_count
        FROM installations i
        LEFT JOIN branches b ON b.branch_id = i.branch_id
        WHERE i.organization_id = $1 ORDER BY i.registered_at DESC
      `, [id]).then((r) => r.rows)
    ]);

    res.json({
      success: true,
      data: { organization: org, subscription, usage, owners, branches, installations }
    });
  } catch (error) {
    console.error('Admin organization detail failed:', error);
    res.status(500).json({ success: false, message: 'Could not load this customer' });
  }
};

/**
 * GET /api/admin/organizations/:id/entitlements
 *
 * Section 25 and 49: the feature matrix, showing each layer separately —
 * what the package says, what the override says, what an add-on adds, and
 * what the customer therefore gets. Troubleshooting a "why can't they see
 * Inventory" call is exactly this table.
 */
export const getOrganizationEntitlements = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;

    const [effective, features, subscription] = await Promise.all([
      getEntitlements(id, branchId),
      listFeatures(),
      getSubscription(id)
    ]);

    const [planRows, overrides, addons] = await Promise.all([
      subscription?.plan_id
        ? pool.query('SELECT feature_key, enabled FROM plan_features WHERE plan_id = $1',
            [subscription.plan_id]).then((r) => r.rows)
        : Promise.resolve([]),
      pool.query(`
        SELECT o.feature_key, o.enabled, o.branch_id, o.note, o.expires_at, b.name AS branch_name
        FROM entitlement_overrides o
        LEFT JOIN branches b ON b.branch_id = o.branch_id
        WHERE o.organization_id = $1
      `, [id]).then((r) => r.rows),
      subscription?.subscription_id
        ? pool.query(`
            SELECT a.code, a.name, af.feature_key
            FROM subscription_addons sa
            JOIN addons a ON a.addon_id = sa.addon_id
            LEFT JOIN addon_features af ON af.addon_id = a.addon_id
            WHERE sa.subscription_id = $1 AND sa.status = 'ACTIVE'
          `, [subscription.subscription_id]).then((r) => r.rows)
        : Promise.resolve([])
    ]);

    const planMap = new Map(planRows.map((r) => [r.feature_key, r.enabled]));
    const noPlan = !subscription?.plan_id || planRows.length === 0;

    const matrix = features.map((f) => {
      const orgOverride = overrides.find((o) => o.feature_key === f.feature_key && o.branch_id === null);
      const branchOverrides = overrides.filter((o) => o.feature_key === f.feature_key && o.branch_id !== null);
      const grantingAddon = addons.find((a) => a.feature_key === f.feature_key);
      return {
        feature_key: f.feature_key,
        label: f.label,
        module_key: f.module_key,
        module_label: f.module_label,
        is_core: f.is_core,
        // null means "the package has no opinion", which is not the same as OFF.
        plan: noPlan ? null : (planMap.get(f.feature_key) ?? false),
        override: orgOverride ? orgOverride.enabled : null,
        override_note: orgOverride?.note || null,
        branch_overrides: branchOverrides.map((b) => ({
          branch_id: b.branch_id, branch_name: b.branch_name, enabled: b.enabled
        })),
        addon: grantingAddon ? grantingAddon.name : null,
        effective: effective.features[f.feature_key]?.enabled ?? false,
        reason: effective.features[f.feature_key]?.reason || null
      };
    });

    res.json({
      success: true,
      data: {
        subscription,
        matrix,
        modules: effective.modules,
        addons: [...new Map(addons.map((a) => [a.code, { code: a.code, name: a.name }])).values()]
      }
    });
  } catch (error) {
    console.error('Admin entitlement matrix failed:', error);
    res.status(500).json({ success: false, message: 'Could not load entitlements' });
  }
};

/**
 * PUT /api/admin/organizations/:id/overrides/:featureKey
 *
 * Section 21: this writes ONLY to `entitlement_overrides`. The package is
 * never touched, so switching Inventory on for one customer cannot leak into
 * every other customer on Basic.
 *
 * Body: { enabled: true|false|null, branch_id?, note?, expires_at? }
 * `enabled: null` removes the override and lets the package decide again.
 */
export const setOverride = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const featureKey = String(req.params.featureKey);
    const branchId = req.body?.branch_id ? Number(req.body.branch_id) : null;
    const { enabled } = req.body || {};

    const feature = (await pool.query(
      'SELECT feature_key FROM features WHERE feature_key = $1', [featureKey]
    )).rows[0];
    if (!feature) return res.status(404).json({ success: false, message: 'No such feature' });

    if (branchId) {
      const owns = (await pool.query(
        'SELECT 1 FROM branches WHERE branch_id = $1 AND organization_id = $2', [branchId, id]
      )).rows[0];
      if (!owns) return res.status(404).json({ success: false, message: 'No such branch for this customer' });
    }

    const before = (await pool.query(`
      SELECT enabled FROM entitlement_overrides
      WHERE organization_id = $1 AND feature_key = $2
        AND branch_id IS NOT DISTINCT FROM $3
    `, [id, featureKey, branchId])).rows[0];

    if (enabled === null || enabled === undefined) {
      await pool.query(`
        DELETE FROM entitlement_overrides
        WHERE organization_id = $1 AND feature_key = $2 AND branch_id IS NOT DISTINCT FROM $3
      `, [id, featureKey, branchId]);
    } else {
      /* Upsert by hand rather than ON CONFLICT: the unique constraint uses
         NULLS NOT DISTINCT on Postgres 15+ and falls back to no constraint at
         all on older versions, so inference cannot be relied on here. */
      await pool.query(`
        DELETE FROM entitlement_overrides
        WHERE organization_id = $1 AND feature_key = $2 AND branch_id IS NOT DISTINCT FROM $3
      `, [id, featureKey, branchId]);
      await pool.query(`
        INSERT INTO entitlement_overrides
          (organization_id, branch_id, feature_key, enabled, note, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [id, branchId, featureKey, !!enabled,
          req.body?.note ? String(req.body.note).slice(0, 255) : null,
          req.body?.expires_at || null]);
    }

    await recordAdminAudit(req, {
      action: enabled == null ? 'entitlement.override_removed' : 'entitlement.override_set',
      resource_type: 'feature', resource_id: featureKey,
      organization_id: id, branch_id: branchId,
      old_value: before ? { enabled: before.enabled } : null,
      new_value: enabled == null ? null : { enabled: !!enabled }
    });

    const effective = await getEntitlements(id, branchId);
    res.json({
      success: true,
      message: enabled == null
        ? `${featureKey} now follows the package`
        : `${featureKey} is ${enabled ? 'on' : 'off'} for this customer`,
      data: { feature: featureKey, effective: effective.features[featureKey] }
    });
  } catch (error) {
    console.error('Admin override write failed:', error);
    res.status(500).json({ success: false, message: 'Could not change that feature' });
  }
};

/** POST /api/admin/organizations/:id/status — suspend or resume a customer. */
export const setOrganizationStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be ACTIVE or SUSPENDED' });
    }
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    if (status === 'SUSPENDED' && !reason) {
      // Suspending stops a café trading. Whoever does it says why.
      return res.status(400).json({ success: false, message: 'A reason is required to suspend a customer' });
    }

    const before = (await pool.query(
      'SELECT status FROM organizations WHERE organization_id = $1', [id]
    )).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    await pool.query(
      'UPDATE organizations SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
      [id, status]
    );
    /* The subscription follows, because that is what the entitlement resolver
       reads. Leaving it ACTIVE would suspend the customer in the admin list
       and nowhere that matters. */
    await pool.query(`
      UPDATE subscriptions SET status = $2
      WHERE organization_id = $1 AND status IN ('TRIAL','ACTIVE','SUSPENDED','PAST_DUE','GRACE_PERIOD')
    `, [id, status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE']);

    await recordAdminAudit(req, {
      action: status === 'SUSPENDED' ? 'organization.suspended' : 'organization.resumed',
      resource_type: 'organization', resource_id: id, organization_id: id,
      old_value: { status: before.status }, new_value: { status, reason }
    });

    res.json({ success: true, message: status === 'SUSPENDED' ? 'Customer suspended' : 'Customer resumed' });
  } catch (error) {
    console.error('Admin organization status change failed:', error);
    res.status(500).json({ success: false, message: 'Could not change that customer' });
  }
};

/* ==========================================================================
   PACKAGE MASTER
   ========================================================================== */

/**
 * GET /api/admin/station-types
 *
 * The station types a plan can cap, for the plan editor's dropdown.
 *
 * Drawn from what cafés actually run and price rather than a list baked into
 * the frontend: the set is café-extensible by design (one sells bowling,
 * another does not), so a hard-coded list is guaranteed to be wrong for
 * somebody — it would offer a cap on a type nobody has, and no way to cap the
 * type they do.
 *
 * Both sides are counted because either alone is incomplete: a type can be
 * priced before any station of it exists, and a station can exist before
 * anyone prices it. Unlike the café-facing category list this is deliberately
 * NOT scoped to one café — a plan applies across the platform, so capping a
 * type means capping it wherever it is run. Only the type names are returned,
 * never which café runs what.
 */
export const listStationTypes = async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT category FROM (
        SELECT category FROM pcs            WHERE category IS NOT NULL AND category <> ''
        UNION ALL
        SELECT category FROM software_master WHERE category IS NOT NULL AND category <> ''
      ) t
      ORDER BY category
    `);
    res.json({ success: true, data: rows.map((r) => r.category) });
  } catch (error) {
    console.error('Station type list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load station types' });
  }
};

/** GET /api/admin/packages */
export const listPackages = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.sub_id AS plan_id, p.code, p.name, p.description, p.status,
             p.max_branches, p.max_pcs, p.max_users, p.max_managers, p.max_installations,
             p.station_limits,
             p.is_freetrial, p.is_public, p.sort_order, p.no_of_days,
             COALESCE(json_agg(DISTINCT jsonb_build_object(
               'billing_period', pp.billing_period, 'currency', pp.currency, 'price', pp.price
             )) FILTER (WHERE pp.plan_price_id IS NOT NULL), '[]') AS prices,
             (SELECT COUNT(*)::int FROM plan_features pf
                WHERE pf.plan_id = p.sub_id AND pf.enabled)                    AS features_on,
             (SELECT COUNT(*)::int FROM subscriptions s WHERE s.sub_id = p.sub_id) AS subscriptions
      FROM subscription_plans p
      LEFT JOIN plan_prices pp ON pp.plan_id = p.sub_id
      GROUP BY p.sub_id
      ORDER BY p.sort_order, p.sub_id
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Admin package list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load packages' });
  }
};

/** GET /api/admin/packages/:id — the package editor's data. */
export const getPackage = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const plan = (await pool.query(
      'SELECT *, sub_id AS plan_id FROM subscription_plans WHERE sub_id = $1', [id]
    )).rows[0];
    if (!plan) return res.status(404).json({ success: false, message: 'Not found' });

    const [prices, planFeatures, modules, inUse] = await Promise.all([
      pool.query('SELECT * FROM plan_prices WHERE plan_id = $1 ORDER BY price', [id]).then((r) => r.rows),
      pool.query('SELECT feature_key, enabled, limit_value FROM plan_features WHERE plan_id = $1', [id])
        .then((r) => r.rows),
      listModules(),
      pool.query('SELECT COUNT(*)::int AS n FROM subscriptions WHERE sub_id = $1', [id])
        .then((r) => r.rows[0].n)
    ]);

    const enabled = new Map(planFeatures.map((f) => [f.feature_key, f]));
    /* Sent grouped, because that is how the editor renders it and how a human
       reasons about a package — "does Basic get the F&B module" rather than
       twenty independent switches. */
    const grouped = modules.map((m) => ({
      ...m,
      features: m.features.map((f) => ({
        ...f,
        enabled: !!enabled.get(f.feature_key)?.enabled,
        limit_value: enabled.get(f.feature_key)?.limit_value ?? null
      }))
    }));

    res.json({ success: true, data: { plan, prices, modules: grouped, subscriptions: inUse } });
  } catch (error) {
    console.error('Admin package detail failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that package' });
  }
};

const PLAN_FIELDS = [
  'name', 'description', 'status', 'max_branches', 'max_pcs', 'max_users',
  'max_managers', 'max_installations', 'no_of_days', 'sort_order', 'is_public',
  'station_limits'
];

/** POST /api/admin/packages */
export const createPackage = async (req, res) => {
  const client = await pool.connect();
  try {
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const name = String(req.body?.name || '').trim();
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'A code and a name are required' });
    }

    const clash = (await client.query('SELECT 1 FROM subscription_plans WHERE code = $1', [code])).rows[0];
    if (clash) return res.status(409).json({ success: false, message: 'That package code is already in use' });

    await client.query('BEGIN');
    const plan = (await client.query(`
      INSERT INTO subscription_plans
        (subs_software, code, name, description, status, max_branches, max_pcs, max_users,
         max_managers, max_installations, no_of_days, is_active, is_freetrial, sort_order, price)
      VALUES ('cafexp',$1,$2,$3,COALESCE($4,'DRAFT'),$5,$6,$7,$8,$9,COALESCE($10,30),TRUE,FALSE,COALESCE($11,100),0)
      RETURNING *, sub_id AS plan_id
    `, [code, name, req.body?.description || null, req.body?.status || null,
        req.body?.max_branches ?? 1, req.body?.max_pcs ?? 10, req.body?.max_users ?? 5,
        req.body?.max_managers ?? 1, req.body?.max_installations ?? 1,
        req.body?.no_of_days, req.body?.sort_order])).rows[0];

    /* Copy from another package when asked. Duplicating a package is section
       15's requirement and is how most new packages actually get made. */
    if (req.body?.copy_from) {
      await client.query(`
        INSERT INTO plan_features (plan_id, feature_key, enabled, limit_value)
        SELECT $1, feature_key, enabled, limit_value FROM plan_features WHERE plan_id = $2
      `, [plan.sub_id, Number(req.body.copy_from)]);
      await client.query(`
        INSERT INTO plan_prices (plan_id, billing_period, currency, price)
        SELECT $1, billing_period, currency, price FROM plan_prices WHERE plan_id = $2
      `, [plan.sub_id, Number(req.body.copy_from)]);
    }
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'package.created', resource_type: 'package', resource_id: plan.sub_id,
      new_value: { code, name }
    });

    res.status(201).json({ success: true, message: `${name} created`, data: plan });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin package create failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that package' });
  } finally {
    client.release();
  }
};

/** PATCH /api/admin/packages/:id */
export const updatePackage = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const before = (await pool.query('SELECT * FROM subscription_plans WHERE sub_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    /* The per-type map is cleaned before it is stored — zeros, negatives and
       non-numeric entries are dropped rather than saved, so a stray "0" can
       never become a cap that locks a café out of a whole station type.
       Serialised here so the generic writer below stores valid jsonb. */
    if (req.body.station_limits !== undefined) {
      req.body.station_limits = JSON.stringify(normalizeStationLimits(req.body.station_limits));
    }

    const sets = [];
    const params = [id];
    for (const field of PLAN_FIELDS) {
      if (req.body[field] === undefined) continue;
      params.push(req.body[field]);
      sets.push(`${field} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    /* Archiving is the closest thing to deletion this table allows. A package
       a subscription points at cannot be removed without destroying the
       record of what that customer bought. */
    if (req.body.status === 'ARCHIVED') {
      sets.push('archived_at = CURRENT_TIMESTAMP', 'is_active = FALSE');
    } else if (req.body.status === 'ACTIVE') {
      sets.push('archived_at = NULL', 'is_active = TRUE');
    }

    const updated = (await pool.query(`
      UPDATE subscription_plans SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE sub_id = $1 RETURNING *, sub_id AS plan_id
    `, params)).rows[0];

    await recordAdminAudit(req, {
      action: 'package.updated', resource_type: 'package', resource_id: id,
      old_value: Object.fromEntries(PLAN_FIELDS.filter((f) => req.body[f] !== undefined).map((f) => [f, before[f]])),
      new_value: Object.fromEntries(PLAN_FIELDS.filter((f) => req.body[f] !== undefined).map((f) => [f, req.body[f]]))
    });

    res.json({ success: true, message: 'Package saved', data: updated });
  } catch (error) {
    console.error('Admin package update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that package' });
  }
};

/** PUT /api/admin/packages/:id/features — the whole matrix in one write. */
export const setPackageFeatures = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const features = req.body?.features;
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ success: false, message: 'Send a features map' });
    }

    const plan = (await client.query('SELECT code, name FROM subscription_plans WHERE sub_id = $1', [id])).rows[0];
    if (!plan) return res.status(404).json({ success: false, message: 'Not found' });

    const before = (await client.query(
      'SELECT feature_key, enabled FROM plan_features WHERE plan_id = $1', [id]
    )).rows;

    /* Core features cannot be switched off. A package without Dashboard or
       Settings is a broken product, not a cheaper one, and finding that out
       from a customer is worse than being refused here. */
    const core = (await client.query('SELECT feature_key FROM features WHERE is_core')).rows
      .map((r) => r.feature_key);

    await client.query('BEGIN');
    for (const [key, enabled] of Object.entries(features)) {
      const on = core.includes(key) ? true : !!enabled;
      await client.query(`
        INSERT INTO plan_features (plan_id, feature_key, enabled)
        VALUES ($1,$2,$3)
        ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled
      `, [id, key, on]);
    }
    await client.query('COMMIT');

    const after = (await client.query(
      'SELECT feature_key, enabled FROM plan_features WHERE plan_id = $1', [id]
    )).rows;

    const beforeMap = Object.fromEntries(before.map((r) => [r.feature_key, r.enabled]));
    const changed = after
      .filter((r) => beforeMap[r.feature_key] !== r.enabled)
      .map((r) => `${r.feature_key}=${r.enabled ? 'ON' : 'OFF'}`);

    await recordAdminAudit(req, {
      action: 'package.features_changed', resource_type: 'package', resource_id: id,
      old_value: beforeMap,
      new_value: Object.fromEntries(after.map((r) => [r.feature_key, r.enabled]))
    });

    res.json({
      success: true,
      message: changed.length
        ? `${plan.name}: ${changed.length} feature${changed.length === 1 ? '' : 's'} changed`
        : 'No changes',
      data: { changed }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin package feature write failed:', error);
    res.status(500).json({ success: false, message: 'Could not save those features' });
  } finally {
    client.release();
  }
};

/** PUT /api/admin/packages/:id/prices */
export const setPackagePrices = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const prices = Array.isArray(req.body?.prices) ? req.body.prices : null;
    if (!prices) return res.status(400).json({ success: false, message: 'Send a prices array' });

    await client.query('BEGIN');
    for (const p of prices) {
      const period = String(p.billing_period || '');
      if (!['monthly', 'quarterly', 'half_yearly', 'annual'].includes(period)) continue;
      await client.query(`
        INSERT INTO plan_prices (plan_id, billing_period, currency, price, setup_fee)
        VALUES ($1,$2,COALESCE($3,'INR'),$4,COALESCE($5,0))
        ON CONFLICT (plan_id, billing_period, currency)
        DO UPDATE SET price = EXCLUDED.price, setup_fee = EXCLUDED.setup_fee,
                      updated_at = CURRENT_TIMESTAMP
      `, [id, period, p.currency || 'INR', Number(p.price) || 0, Number(p.setup_fee) || 0]);
    }
    /* The headline `price` column stays in step with the monthly figure —
       older screens and the public site still read it. */
    await client.query(`
      UPDATE subscription_plans SET price = COALESCE((
        SELECT price FROM plan_prices
        WHERE plan_id = $1 AND billing_period = 'monthly' AND currency = 'INR'
      ), price) WHERE sub_id = $1
    `, [id]);
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'package.prices_changed', resource_type: 'package', resource_id: id,
      new_value: prices
    });

    res.json({ success: true, message: 'Pricing saved' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin package price write failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that pricing' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   FEATURE MASTER
   ========================================================================== */

/** GET /api/admin/features */
export const listFeatureMaster = async (req, res) => {
  try {
    const modules = await listModules();
    const usage = (await pool.query(`
      SELECT feature_key,
             COUNT(*) FILTER (WHERE enabled)::int AS packages_on,
             COUNT(*)::int AS packages_total
      FROM plan_features GROUP BY feature_key
    `)).rows;
    const usageMap = Object.fromEntries(usage.map((u) => [u.feature_key, u]));

    res.json({
      success: true,
      data: modules.map((m) => ({
        ...m,
        features: m.features.map((f) => ({ ...f, usage: usageMap[f.feature_key] || null }))
      }))
    });
  } catch (error) {
    console.error('Admin feature master failed:', error);
    res.status(500).json({ success: false, message: 'Could not load features' });
  }
};

/**
 * POST /api/admin/features
 *
 * Section 58: adding a CafeXP module should be "create feature → assign to
 * package → customer gets it", with no schema change. This is that first step.
 * A new feature is off everywhere until a package grants it, which is why the
 * resolver treats a missing plan_features row as OFF.
 */
export const createFeature = async (req, res) => {
  try {
    const key = String(req.body?.feature_key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const label = String(req.body?.label || '').trim();
    const moduleKey = req.body?.module_key ? String(req.body.module_key) : null;

    if (!key || !label) {
      return res.status(400).json({ success: false, message: 'A key and a label are required' });
    }
    if (moduleKey) {
      const mod = (await pool.query(
        'SELECT 1 FROM feature_modules WHERE module_key = $1', [moduleKey]
      )).rows[0];
      if (!mod) return res.status(400).json({ success: false, message: 'No such module' });
    }

    const clash = (await pool.query('SELECT 1 FROM features WHERE feature_key = $1', [key])).rows[0];
    if (clash) return res.status(409).json({ success: false, message: 'That feature key already exists' });

    const feature = (await pool.query(`
      INSERT INTO features (feature_key, label, description, module_key, sort_order)
      VALUES ($1,$2,$3,$4,COALESCE($5,100)) RETURNING *
    `, [key, label, req.body?.description || null, moduleKey, req.body?.sort_order])).rows[0];

    await recordAdminAudit(req, {
      action: 'feature.created', resource_type: 'feature', resource_id: key, new_value: feature
    });

    res.status(201).json({
      success: true,
      message: `${label} created. It is off on every package until you switch it on.`,
      data: feature
    });
  } catch (error) {
    console.error('Admin feature create failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that feature' });
  }
};

/** PATCH /api/admin/features/:key */
export const updateFeature = async (req, res) => {
  try {
    const key = String(req.params.key);
    const before = (await pool.query('SELECT * FROM features WHERE feature_key = $1', [key])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const sets = [];
    const params = [key];
    for (const field of ['label', 'description', 'module_key', 'sort_order', 'is_active']) {
      if (req.body[field] === undefined) continue;
      params.push(req.body[field]);
      sets.push(`${field} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const updated = (await pool.query(
      `UPDATE features SET ${sets.join(', ')} WHERE feature_key = $1 RETURNING *`, params
    )).rows[0];

    await recordAdminAudit(req, {
      action: 'feature.updated', resource_type: 'feature', resource_id: key,
      old_value: before, new_value: updated
    });

    res.json({ success: true, message: 'Feature saved', data: updated });
  } catch (error) {
    console.error('Admin feature update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that feature' });
  }
};

/* ==========================================================================
   ADD-ONS
   ========================================================================== */

/** GET /api/admin/addons */
export const listAddons = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*,
             COALESCE(json_agg(af.feature_key) FILTER (WHERE af.feature_key IS NOT NULL), '[]') AS features,
             (SELECT COUNT(*)::int FROM subscription_addons sa
                WHERE sa.addon_id = a.addon_id AND sa.status = 'ACTIVE') AS active_subscriptions
      FROM addons a
      LEFT JOIN addon_features af ON af.addon_id = a.addon_id
      GROUP BY a.addon_id ORDER BY a.name
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Admin add-on list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load add-ons' });
  }
};

/** POST /api/admin/addons */
export const createAddon = async (req, res) => {
  const client = await pool.connect();
  try {
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const name = String(req.body?.name || '').trim();
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'A code and a name are required' });
    }

    await client.query('BEGIN');
    const addon = (await client.query(`
      INSERT INTO addons (code, name, description, price, currency, billing_period,
                          grant_pcs, grant_branches, grant_users, grant_installations)
      VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,'INR'),COALESCE($6,'monthly'),
              COALESCE($7,0),COALESCE($8,0),COALESCE($9,0),COALESCE($10,0))
      RETURNING *
    `, [code, name, req.body?.description || null, req.body?.price, req.body?.currency,
        req.body?.billing_period, req.body?.grant_pcs, req.body?.grant_branches,
        req.body?.grant_users, req.body?.grant_installations])).rows[0];

    for (const key of (req.body?.features || [])) {
      await client.query(
        'INSERT INTO addon_features (addon_id, feature_key) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [addon.addon_id, String(key)]
      );
    }
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'addon.created', resource_type: 'addon', resource_id: addon.addon_id, new_value: addon
    });
    res.status(201).json({ success: true, message: `${name} created`, data: addon });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That add-on code is already in use' });
    }
    console.error('Admin add-on create failed:', error);
    res.status(500).json({ success: false, message: 'Could not create that add-on' });
  } finally {
    client.release();
  }
};

/*
 * PATCH /api/admin/addons/:id
 *
 * Everything about an add-on is editable after it exists, including which
 * features it grants — the code is the one thing that never changes, because
 * an existing `subscription_addons` row and every audit entry referring to
 * this add-on point at the id, not the code, so nothing downstream breaks
 * when the price or the feature list changes under it.
 *
 * Feature grants are replaced wholesale rather than diffed: the caller sends
 * the complete set it wants, matching how a station's type limits are
 * replaced rather than merged elsewhere in this file — a partial update
 * silently leaving an old grant in place would be a worse bug than requiring
 * the full set every time.
 */
export const updateAddon = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const before = (await client.query('SELECT * FROM addons WHERE addon_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Add-on not found' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : before.name;
    if (!name) return res.status(400).json({ success: false, message: 'A name is required' });

    await client.query('BEGIN');
    const addon = (await client.query(`
      UPDATE addons SET
        name = $2,
        description = $3,
        price = $4,
        currency = $5,
        billing_period = $6,
        grant_pcs = $7,
        grant_branches = $8,
        grant_users = $9,
        grant_installations = $10,
        is_active = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE addon_id = $1
      RETURNING *
    `, [
      id, name,
      req.body?.description !== undefined ? (req.body.description || null) : before.description,
      req.body?.price !== undefined ? Number(req.body.price) || 0 : before.price,
      req.body?.currency || before.currency,
      req.body?.billing_period || before.billing_period,
      req.body?.grant_pcs !== undefined ? Number(req.body.grant_pcs) || 0 : before.grant_pcs,
      req.body?.grant_branches !== undefined ? Number(req.body.grant_branches) || 0 : before.grant_branches,
      req.body?.grant_users !== undefined ? Number(req.body.grant_users) || 0 : before.grant_users,
      req.body?.grant_installations !== undefined ? Number(req.body.grant_installations) || 0 : before.grant_installations,
      req.body?.is_active !== undefined ? !!req.body.is_active : before.is_active
    ])).rows[0];

    if (Array.isArray(req.body?.features)) {
      await client.query('DELETE FROM addon_features WHERE addon_id = $1', [id]);
      for (const key of req.body.features) {
        await client.query(
          'INSERT INTO addon_features (addon_id, feature_key) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, String(key)]
        );
      }
    }
    await client.query('COMMIT');

    await recordAdminAudit(req, {
      action: 'addon.updated', resource_type: 'addon', resource_id: id,
      old_value: before, new_value: addon
    });
    res.json({ success: true, message: `${addon.name} saved`, data: addon });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin add-on update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that add-on' });
  } finally {
    client.release();
  }
};

/*
 * DELETE /api/admin/addons/:id
 *
 * `subscription_addons.addon_id` is ON DELETE RESTRICT — deliberately, so a
 * café's billing history can never be silently erased by removing something
 * from the catalogue. Any café that has ever bought this add-on, even one
 * long since cancelled or expired, blocks the delete at the database rather
 * than this code having to reason about it. is_active already exists for
 * "stop selling this" (via the same PATCH the Edit form uses); this is only
 * for an add-on nobody has ever actually bought.
 */
export const deleteAddon = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const before = (await pool.query('SELECT * FROM addons WHERE addon_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Add-on not found' });

    await pool.query('DELETE FROM addons WHERE addon_id = $1', [id]);

    await recordAdminAudit(req, {
      action: 'addon.deleted', resource_type: 'addon', resource_id: id, old_value: before
    });
    res.json({ success: true, message: `${before.name} deleted` });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'This add-on has been sold to at least one café and cannot be deleted. ' +
          'Turn it off instead — Edit and switch it to inactive — so it stops appearing for new sales.'
      });
    }
    console.error('Admin add-on delete failed:', error);
    res.status(500).json({ success: false, message: 'Could not delete that add-on' });
  }
};

/* ==========================================================================
   AUDIT
   ========================================================================== */

/** GET /api/admin/audit */
export const listAudit = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Number(req.query.size) || 50);
    const params = [];
    const where = [];

    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`a.organization_id = $${params.length}`);
    }
    if (req.query.action) {
      params.push(`${String(req.query.action)}%`);
      where.push(`a.action LIKE $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM admin_audit a ${clause}`, params
    )).rows[0].n;

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT a.*, o.name AS organization_name
      FROM admin_audit a
      LEFT JOIN organizations o ON o.organization_id = a.organization_id
      ${clause}
      ORDER BY a.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, total, page, size } });
  } catch (error) {
    console.error('Admin audit list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the audit log' });
  }
};
