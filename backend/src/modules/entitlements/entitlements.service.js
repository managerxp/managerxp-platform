/*
 * Effective entitlements — the single source of truth.
 *
 * Everything that asks "may this customer use Inventory?" asks here: the
 * portal, the admin console, the CafeXP desktop sidebar, and every guarded
 * route. There is deliberately no second implementation anywhere, because two
 * answers to that question is how a customer ends up seeing a module they
 * cannot use, or paying for one they cannot see.
 *
 * Resolution order, most general first, most specific last:
 *
 *     1. PLAN            what the package includes
 *     2. ORG OVERRIDE    ManagerXP switching one feature for one customer
 *     3. BRANCH OVERRIDE the same, for one location
 *     4. ADD-ONS         purchased extras — these only ever grant
 *     5. STATUS          an expired or suspended subscription revokes all
 *
 * Two invariants worth stating because the rest of the file depends on them:
 *
 *   - A missing `plan_features` row means OFF, not ON. Adding a feature to the
 *     catalogue must never silently grant it to every package already sold.
 *
 *   - Add-ons are grant-only. They appear after the overrides so a purchase
 *     cannot be cancelled out by an older override, and they cannot revoke,
 *     so applying them in any order gives the same answer.
 */
import pool from '../../config/database.js';
import { getSetting } from '../../config/settings.js';

/* Statuses under which the product is usable. GRACE_PERIOD and PAST_DUE are
   deliberately live: a failed card should start a conversation, not shut a
   café's till mid-service. */
const LIVE_STATUSES = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD']);

/* ==========================================================================
   CATALOGUE
   ========================================================================== */

/** Every feature the product knows about, with its module. */
export const listFeatures = async () => {
  const { rows } = await pool.query(`
    SELECT f.feature_key, f.label, f.description, f.module_key, f.sort_order, f.is_core,
           m.label AS module_label, m.icon AS module_icon, m.sort_order AS module_sort
    FROM features f
    LEFT JOIN feature_modules m ON m.module_key = f.module_key
    WHERE f.is_active
    ORDER BY COALESCE(m.sort_order, 999), f.sort_order, f.feature_key
  `);
  return rows;
};

/** The catalogue grouped by module, for an admin editor or a sidebar. */
export const listModules = async () => {
  const features = await listFeatures();
  const modules = new Map();
  for (const f of features) {
    const key = f.module_key || 'OTHER';
    if (!modules.has(key)) {
      modules.set(key, {
        module_key: key,
        label: f.module_label || 'Other',
        icon: f.module_icon || null,
        sort_order: f.module_sort ?? 999,
        features: []
      });
    }
    modules.get(key).features.push({
      feature_key: f.feature_key, label: f.label, description: f.description, is_core: f.is_core
    });
  }
  return [...modules.values()].sort((a, b) => a.sort_order - b.sort_order);
};

/* ==========================================================================
   SUBSCRIPTION
   ========================================================================== */

/**
 * The organization's live subscription, with limits and price resolved.
 *
 * Limits resolve subscription column → plan → trial settings. The column is
 * the per-customer override from spec section 25: set it and this customer
 * gets a different ceiling without the package changing for anyone else.
 */
export const getSubscription = async (organizationId) => {
  const sub = (await pool.query(`
    SELECT s.*,
           p.code AS plan_code, p.name AS plan_name, p.is_freetrial,
           p.max_pcs AS plan_max_pcs, p.max_branches AS plan_max_branches,
           p.max_users AS plan_max_users, p.max_installations AS plan_max_installations,
           p.station_limits AS plan_station_limits
    FROM subscriptions s
    LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
    WHERE s.organization_id = $1
    ORDER BY (s.status IN ('TRIAL','ACTIVE')) DESC, s.end_date DESC NULLS LAST
    LIMIT 1
  `, [organizationId])).rows[0];

  if (!sub) return null;

  const [maxBranches, maxPcs, maxUsers, maxInstallations] = await Promise.all([
    getSetting('trial.max_branches', 3),
    getSetting('trial.max_pcs', 50),
    getSetting('trial.max_users', 10),
    getSetting('trial.max_installations', 3)
  ]);

  const endsAt = sub.trial_ends_at || sub.end_date;
  const daysRemaining = endsAt
    ? Math.ceil((new Date(endsAt) - Date.now()) / 86400000)
    : null;

  /* Expiry is a fact about the clock. Derived on read rather than waiting for
     a job to notice, so a lapsed trial is lapsed the moment it lapses. A
     status an operator set by hand — SUSPENDED, CANCELLED — is left alone,
     because that is a decision, not a date. */
  const lapsed = endsAt && new Date(endsAt) < new Date();
  const stored = sub.status || 'ACTIVE';
  const status = lapsed && LIVE_STATUSES.has(stored) ? 'EXPIRED' : stored;

  /* A promotional price that has run its course reverts. Section 36. */
  const promoOver = sub.promo_ends_at && new Date(sub.promo_ends_at) < new Date();
  const effectivePrice = promoOver && sub.price_after_promo != null
    ? Number(sub.price_after_promo)
    : (sub.net_price != null ? Number(sub.net_price) : null);

  const addonGrants = await getAddonGrants(sub.subscription_id);

  /* Subscription column, else the package, else the trial settings — and the
     add-on grants are added on top of whichever won. */
  const limit = (column, planValue, fallback, grant) =>
    Number(column ?? planValue ?? fallback) + grant;

  return {
    subscription_id: sub.subscription_id,
    organization_id: sub.organization_id,
    type: sub.type || (sub.is_freetrial ? 'TRIAL' : 'ACTIVE'),
    status,
    plan_id: sub.sub_id || null,
    plan_code: sub.plan_code || null,
    plan_name: sub.plan_name || null,
    started_at: sub.start_date,
    expires_at: endsAt,
    trial_ends_at: sub.trial_ends_at,
    days_remaining: daysRemaining,
    is_trial: (sub.type || '') === 'TRIAL' || !!sub.is_freetrial,
    billing_period: sub.billing_period || null,
    currency: sub.currency || 'INR',
    list_price: sub.list_price != null ? Number(sub.list_price) : null,
    discount_type: sub.discount_type || 'NO_DISCOUNT',
    discount_value: Number(sub.discount_value || 0),
    net_price: effectivePrice,
    promo_ends_at: sub.promo_ends_at || null,
    limits: {
      max_branches:      limit(sub.max_branches,      sub.plan_max_branches,      maxBranches,      addonGrants.branches),
      max_pcs:           limit(sub.max_pcs,           sub.plan_max_pcs,           maxPcs,           addonGrants.pcs),
      max_users:         limit(sub.max_users,         sub.plan_max_users,         maxUsers,         addonGrants.users),
      max_installations: limit(sub.max_installations, sub.plan_max_installations, maxInstallations, addonGrants.installations)
    },
    /* Per-type station ceilings. A whole-map override on the subscription
       replaces the plan's map (not a per-key merge) — so a customer given a
       custom set gets exactly that set, with no plan keys leaking back in. An
       absent/empty map means no type is capped beyond max_pcs. */
    station_limits: normalizeStationLimits(sub.station_limits ?? sub.plan_station_limits)
  };
};

/*
 * Coerce a stored station_limits value into a clean { CATEGORY: positiveInt }
 * map. Guards the enforcement path against a hand-edited row, a stringified
 * JSON, or stray non-numeric/zero entries — a zero or a negative is dropped
 * rather than treated as "cap of zero", which would lock a café out of a whole
 * station type by accident.
 */
export const normalizeStationLimits = (raw) => {
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = null; } }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    const name = String(key).trim();
    const n = Math.floor(Number(val));
    if (name && Number.isFinite(n) && n > 0) out[name] = n;
  }
  return out;
};

/* ==========================================================================
   ADD-ONS
   ========================================================================== */

/** Capacity and features granted by the add-ons on one subscription. */
const getAddonGrants = async (subscriptionId) => {
  if (!subscriptionId) return { pcs: 0, branches: 0, users: 0, installations: 0, features: [] };

  const { rows } = await pool.query(`
    SELECT a.addon_id, sa.quantity,
           a.grant_pcs, a.grant_branches, a.grant_users, a.grant_installations
    FROM subscription_addons sa
    JOIN addons a ON a.addon_id = sa.addon_id
    WHERE sa.subscription_id = $1
      AND sa.status = 'ACTIVE'
      AND (sa.expires_at IS NULL OR sa.expires_at > NOW())
  `, [subscriptionId]);

  const grants = { pcs: 0, branches: 0, users: 0, installations: 0, features: [] };
  for (const r of rows) {
    const q = Number(r.quantity || 1);
    grants.pcs += Number(r.grant_pcs || 0) * q;
    grants.branches += Number(r.grant_branches || 0) * q;
    grants.users += Number(r.grant_users || 0) * q;
    grants.installations += Number(r.grant_installations || 0) * q;
  }

  if (rows.length) {
    const feats = await pool.query(`
      SELECT DISTINCT af.feature_key
      FROM subscription_addons sa
      JOIN addon_features af ON af.addon_id = sa.addon_id
      WHERE sa.subscription_id = $1
        AND sa.status = 'ACTIVE'
        AND (sa.expires_at IS NULL OR sa.expires_at > NOW())
    `, [subscriptionId]);
    grants.features = feats.rows.map((r) => r.feature_key);
  }

  return grants;
};

/* ==========================================================================
   USAGE
   ========================================================================== */

/** What the organization is actually using, for limit checks and the dashboard. */
export const getUsage = async (organizationId) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM branches
        WHERE organization_id = $1 AND status <> 'CLOSED')                  AS branches,
      /* Gaming PCs only. device_type says "customer device, not the till";
         category says "what kind of play" — a PS5 or a pool table is also
         device_type GAMING_PC, so both must hold. A station with no category
         set predates the multi-type feature and was always a PC. */
      (SELECT COUNT(*)::int FROM pcs
        WHERE organization_id = $1 AND is_active AND device_type = 'GAMING_PC'
          AND (category = 'PC' OR category IS NULL))                       AS pcs,
      (SELECT COUNT(*)::int FROM pcs
        WHERE organization_id = $1 AND is_active)                            AS devices,
      (SELECT COUNT(*)::int FROM organization_users
        WHERE organization_id = $1 AND status IN ('ACTIVE','INVITED'))       AS users,
      (SELECT COUNT(*)::int FROM installations
        WHERE organization_id = $1 AND status = 'ACTIVE')                    AS installations
  `, [organizationId]);
  return rows[0];
};

/* ==========================================================================
   THE RESOLVER
   ========================================================================== */

/**
 * The effective entitlement set for an organization, optionally narrowed to
 * one branch.
 *
 * Returns every feature in the catalogue with a verdict and — for anything
 * switched off — the reason, so the caller can say "not on your plan" rather
 * than showing a locked door with no explanation.
 */
export const getEntitlements = async (organizationId, branchId = null) => {
  const [features, subscription] = await Promise.all([
    listFeatures(),
    getSubscription(organizationId)
  ]);

  const [planRows, overrides, addonGrants] = await Promise.all([
    subscription?.plan_id
      ? pool.query(
          `SELECT feature_key, enabled, limit_value FROM plan_features WHERE plan_id = $1`,
          [subscription.plan_id]
        ).then((r) => r.rows)
      : Promise.resolve([]),
    pool.query(`
      SELECT feature_key, enabled, limit_value, branch_id
      FROM entitlement_overrides
      WHERE organization_id = $1
        AND (branch_id IS NULL OR branch_id = $2)
        AND (expires_at IS NULL OR expires_at > NOW())
    `, [organizationId, branchId]).then((r) => r.rows),
    getAddonGrants(subscription?.subscription_id)
  ]);

  const planMap = new Map(planRows.map((r) => [r.feature_key, r]));
  const addonSet = new Set(addonGrants.features);
  const live = !!subscription && LIVE_STATUSES.has(subscription.status);

  /* A subscription with no package attached is the trial, or a record made
     before packages existed. Falling through to "everything" there is the
     right answer for both, and it is why section 51 needs no special case. */
  const planIsOpen = !subscription?.plan_id || planRows.length === 0;

  const result = {};
  for (const f of features) {
    let enabled;
    let limit = null;
    let reason = null;

    // 1. plan
    if (planIsOpen) {
      enabled = true;
    } else {
      const row = planMap.get(f.feature_key);
      // Absence means off — never a silent grant.
      enabled = !!row?.enabled;
      if (row?.limit_value != null) limit = row.limit_value;
      if (!enabled) reason = 'not_in_plan';
    }

    // 2 & 3. overrides — org first, then branch, so the more specific wins
    const orgOverride = overrides.find((o) => o.feature_key === f.feature_key && o.branch_id === null);
    const branchOverride = branchId
      ? overrides.find((o) => o.feature_key === f.feature_key && String(o.branch_id) === String(branchId))
      : null;
    for (const o of [orgOverride, branchOverride]) {
      if (!o) continue;
      enabled = o.enabled;
      reason = o.enabled ? null : 'disabled_for_account';
      if (o.limit_value != null) limit = o.limit_value;
    }

    // 4. add-ons — grant only, so they can raise but never lower
    if (addonSet.has(f.feature_key)) {
      enabled = true;
      reason = null;
    }

    /* 5. An expired, suspended or cancelled subscription overrides everything
          above it. Nothing is deleted — the customer simply cannot use the
          product until they renew, which is what section 11 asks for. A core
          feature stays on so the app can still render the screen that
          explains why everything else is off. */
    if (!live && !f.is_core) {
      enabled = false;
      reason = subscription ? `subscription_${String(subscription.status).toLowerCase()}` : 'no_subscription';
    }

    result[f.feature_key] = {
      enabled,
      limit,
      reason,
      label: f.label,
      module_key: f.module_key,
      module_label: f.module_label
    };
  }

  return {
    organization_id: organizationId,
    branch_id: branchId,
    subscription,
    features: result,
    // Convenience for clients, which mostly want the on-list.
    enabled: Object.keys(result).filter((k) => result[k].enabled),
    modules: moduleSummary(features, result)
  };
};

/**
 * Module-level verdicts, derived rather than stored.
 *
 * A module is available when any feature inside it is. This is what the
 * CafeXP sidebar renders from — never a hard-coded list per plan.
 */
const moduleSummary = (features, verdicts) => {
  const modules = new Map();
  for (const f of features) {
    const key = f.module_key || 'OTHER';
    if (!modules.has(key)) {
      modules.set(key, {
        module_key: key,
        label: f.module_label || 'Other',
        icon: f.module_icon || null,
        sort_order: f.module_sort ?? 999,
        enabled: false,
        features: []
      });
    }
    const m = modules.get(key);
    const v = verdicts[f.feature_key];
    if (v?.enabled) m.enabled = true;
    m.features.push({ feature_key: f.feature_key, enabled: !!v?.enabled, reason: v?.reason || null });
  }
  return [...modules.values()].sort((a, b) => a.sort_order - b.sort_order);
};

/** Single-feature check, for a guard on a route. */
export const can = async (organizationId, featureKey, branchId = null) => {
  const ent = await getEntitlements(organizationId, branchId);
  return !!ent.features[featureKey]?.enabled;
};

/**
 * Enforce a limit before creating something.
 *
 * Returns a refusal rather than throwing, so the caller can answer with a
 * sentence naming the limit and what to do — the spec is explicit that the
 * backend, not the frontend, is what enforces this.
 */
export const checkLimit = async (organizationId, kind) => {
  const [subscription, usage] = await Promise.all([
    getSubscription(organizationId),
    getUsage(organizationId)
  ]);

  if (!subscription) {
    return { ok: false, message: 'This account has no active subscription' };
  }
  if (!LIVE_STATUSES.has(subscription.status)) {
    return {
      ok: false,
      message: subscription.is_trial
        ? 'Your trial has ended. Choose a subscription to continue.'
        : 'Your subscription is not active. Renew to continue.',
      reason: 'subscription_expired'
    };
  }

  const map = {
    branch:       { used: usage.branches,      max: subscription.limits.max_branches,      noun: 'branches' },
    pc:           { used: usage.pcs,           max: subscription.limits.max_pcs,           noun: 'gaming PCs' },
    user:         { used: usage.users,         max: subscription.limits.max_users,         noun: 'users' },
    installation: { used: usage.installations, max: subscription.limits.max_installations, noun: 'CafeXP installations' }
  }[kind];

  if (!map) return { ok: true };

  if (map.max != null && map.used >= map.max) {
    return {
      ok: false,
      reason: 'limit_reached',
      message: `You have reached your limit of ${map.max} ${map.noun}. ` +
        'Upgrade your subscription or purchase additional capacity.',
      used: map.used,
      max: map.max
    };
  }

  return { ok: true, used: map.used, max: map.max };
};

/**
 * Is there room for one more station of a given type?
 *
 * Independent of max_pcs, not layered on it: max_pcs/getUsage count only
 * category 'PC' (see getUsage above), so a PS5 or Pool cap here is the only
 * limit that type has. A type with no entry in station_limits is uncapped —
 * there is no shared total for it to fall back to. `excludePcId` lets a
 * category change on an existing station not count itself.
 *
 * Returns the same refusal shape as checkLimit so a caller can answer with a
 * sentence naming the type and the number.
 */
export const checkStationLimit = async (organizationId, category, excludePcId = null) => {
  const name = String(category || '').trim();
  if (!name) return { ok: true };

  const subscription = await getSubscription(organizationId);
  if (!subscription) return { ok: false, message: 'This account has no active subscription' };

  const max = subscription.station_limits[name];
  if (max == null) return { ok: true };     // this type is not capped

  /* Active gaming PCs of this type, this organization. Counted at the moment
     of the check under the same rules getUsage counts the overall total. */
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS used FROM pcs
      WHERE organization_id = $1 AND is_active AND device_type = 'GAMING_PC'
        AND category = $2 AND ($3::int IS NULL OR pc_id <> $3::int)`,
    [organizationId, name, excludePcId]
  );
  const used = rows[0].used;

  if (used >= max) {
    return {
      ok: false,
      reason: 'station_limit_reached',
      message: `You have reached your limit of ${max} ${name} station${max === 1 ? '' : 's'} on this plan. ` +
        'Upgrade your subscription or purchase additional capacity.',
      category: name,
      used,
      max
    };
  }
  return { ok: true, category: name, used, max };
};

/**
 * Route guard.
 *
 * `requireFeature('INVENTORY')` on a route means the check cannot be forgotten
 * in the handler. This is the half of section 29 that actually secures
 * anything — hiding a sidebar entry is presentation, not authorization.
 */
export const requireFeature = (featureKey) => async (req, res, next) => {
  const organizationId = req.tenant?.organizationId;
  if (!organizationId) {
    return res.status(400).json({ success: false, message: 'No business selected' });
  }

  const ent = await getEntitlements(organizationId, req.tenant?.branchId || null);
  const verdict = ent.features[featureKey];
  if (!verdict?.enabled) {
    return res.status(403).json({
      success: false,
      message: verdict?.reason === 'not_in_plan'
        ? 'This feature is not included in your current package'
        : 'This feature is not available on your account',
      data: { feature: featureKey, reason: verdict?.reason || 'unknown' }
    });
  }
  next();
};

/**
 * Route guard for the older café/staff-token surface.
 *
 * `requireFeature` above assumes `req.tenant.organizationId`, which only the
 * newer portal/organization routes carry. Every café-console and client-app
 * route still runs on `req.actor.cafe_id` instead, so this is the same idea
 * translated through `resolveOrganizationForCafe`. Without it, a feature
 * switched off for one customer stays reachable through its API — the sidebar
 * hides the button, but nothing stops the request that skips the button.
 */
export const requireCafeFeature = (featureKey) => async (req, res, next) => {
  const scope = await resolveOrganizationForCafe(req.actor?.cafe_id);
  if (!scope) return next(); // pre-tenancy install: no organization to check against

  const allowed = await can(scope.organizationId, featureKey, scope.branchId);
  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: 'This feature is not included in your current subscription',
      data: { feature: featureKey, reason: 'disabled_for_account' }
    });
  }
  next();
};

/**
 * Which organization is a café-token caller's café part of?
 *
 * The desktop app and its stations carry `cafe_id`, not `organization_id` —
 * this is the one place that translation happens, so every route built on
 * the older café token asks the same question the entitlements endpoint
 * does, rather than each re-deriving it.
 */
export const resolveOrganizationForCafe = async (cafeId) => {
  const id = Number(cafeId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const row = (await pool.query(`
    SELECT c.cafe_id, c.organization_id, b.branch_id
    FROM cafes c
    LEFT JOIN branches b ON b.cafe_id = c.cafe_id AND b.status <> 'CLOSED'
    WHERE c.cafe_id = $1
    ORDER BY b.branch_id
    LIMIT 1
  `, [id])).rows[0];

  if (!row?.organization_id) return null;
  return { cafeId: row.cafe_id, organizationId: row.organization_id, branchId: row.branch_id || null };
};

export { getAddonGrants };
