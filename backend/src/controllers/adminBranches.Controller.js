/*
 * Branches and subscriptions, from the vendor's side.
 *
 * Two rules govern nearly every line here.
 *
 * The first is the pricing snapshot (sections 35 and 47). A package is the
 * product; a subscription is what one customer agreed to. When those two
 * disagree — a discount, a raised ceiling, a promotional rate — the
 * subscription wins, and it keeps winning after the package changes. So every
 * commercial term is COPIED onto the subscription at the moment it is agreed,
 * never read back through the package later. A customer must never wake up to
 * a different bill because marketing repriced a plan.
 *
 * The second is that changing one customer never changes the product. Nothing
 * in this file writes to `subscription_plans` or `plan_features`.
 */
import pool from '../config/database.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import { getSubscription, getUsage, getEntitlements } from '../modules/entitlements/entitlements.service.js';

/* ==========================================================================
   BRANCHES
   ========================================================================== */

/** GET /api/admin/branches?q=&status=&organization_id=&page= */
export const listBranches = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Number(req.query.size) || 25);
    const params = [];
    const where = [`b.status <> 'CLOSED'`];

    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(b.name) LIKE $${params.length}
                   OR LOWER(COALESCE(b.city,'')) LIKE $${params.length}
                   OR LOWER(COALESCE(b.code,'')) LIKE $${params.length}
                   OR LOWER(o.name) LIKE $${params.length})`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where.push(`b.status = $${params.length}`);
    }
    if (req.query.organization_id) {
      params.push(Number(req.query.organization_id));
      where.push(`b.organization_id = $${params.length}`);
    }

    const clause = `WHERE ${where.join(' AND ')}`;
    const total = (await pool.query(`
      SELECT COUNT(*)::int AS n FROM branches b
      LEFT JOIN organizations o ON o.organization_id = b.organization_id ${clause}
    `, params)).rows[0].n;

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT b.branch_id, b.name, b.code, b.city, b.street, b.status, b.max_pcs, b.cafe_id,
             b.organization_id, o.name AS organization_name, o.status AS organization_status,
             p.name AS plan_name, p.code AS plan_code,
             s.status AS subscription_status, s.max_pcs AS org_max_pcs,
             (SELECT COUNT(*)::int FROM pcs pc
               WHERE pc.branch_id = b.branch_id AND pc.is_active
                 AND pc.device_type = 'GAMING_PC'
                 AND (pc.category = 'PC' OR pc.category IS NULL))          AS pcs,
             (SELECT COUNT(*)::int FROM pcs pc
               WHERE pc.branch_id = b.branch_id AND pc.is_active)          AS devices,
             (SELECT COUNT(*)::int FROM branch_users bu
               WHERE bu.branch_id = b.branch_id AND bu.status = 'ACTIVE')  AS users,
             i.installation_id, i.status AS installation_status, i.last_seen_at, i.version
      FROM branches b
      LEFT JOIN organizations o ON o.organization_id = b.organization_id
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions
        WHERE organization_id = b.organization_id
        ORDER BY (status IN ('TRIAL','ACTIVE')) DESC, end_date DESC NULLS LAST LIMIT 1
      ) s ON TRUE
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      LEFT JOIN LATERAL (
        SELECT * FROM installations
        WHERE branch_id = b.branch_id AND status = 'ACTIVE'
        ORDER BY last_seen_at DESC NULLS LAST LIMIT 1
      ) i ON TRUE
      ${clause}
      ORDER BY o.name, b.name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, total, page, size } });
  } catch (error) {
    console.error('Admin branch list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load branches' });
  }
};

/**
 * GET /api/admin/organizations/:id/pool
 *
 * The PC pool for one organization: what the subscription entitles, what each
 * branch has been allocated, and what is actually plugged in. Section 29's
 * table, which is unreadable unless all three numbers sit together.
 */
export const getPcPool = async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const [subscription, usage, branches] = await Promise.all([
      getSubscription(orgId),
      getUsage(orgId),
      pool.query(`
        SELECT b.branch_id, b.name, b.max_pcs AS allocated,
               (SELECT COUNT(*)::int FROM pcs p
                 WHERE p.branch_id = b.branch_id AND p.is_active
                   AND p.device_type = 'GAMING_PC'
                   AND (p.category = 'PC' OR p.category IS NULL)) AS used
        FROM branches b
        WHERE b.organization_id = $1 AND b.status <> 'CLOSED'
        ORDER BY b.name
      `, [orgId]).then((r) => r.rows)
    ]);

    if (!subscription) return res.status(404).json({ success: false, message: 'Not found' });

    const entitled = subscription.limits.max_pcs;
    const allocated = branches.reduce((n, b) => n + Number(b.allocated || 0), 0);

    res.json({
      success: true,
      data: {
        entitled,
        allocated,
        /* Unallocated capacity, floored at zero. A negative number here would
           mean the pool is oversubscribed, which the writer below refuses to
           create but historical data might still contain. */
        unallocated: Math.max(0, entitled - allocated),
        oversubscribed: allocated > entitled,
        used: usage.pcs,
        available: Math.max(0, entitled - usage.pcs),
        branches
      }
    });
  } catch (error) {
    console.error('Admin PC pool failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the PC pool' });
  }
};

/** PATCH /api/admin/branches/:id */
export const updateBranch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const before = (await pool.query(`
      SELECT b.*, o.name AS organization_name FROM branches b
      LEFT JOIN organizations o ON o.organization_id = b.organization_id
      WHERE b.branch_id = $1
    `, [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    /* An allocation that exceeds the pool is refused rather than clamped.
       Silently reducing a number an operator typed is worse than saying no:
       they would leave believing a branch had capacity it does not. */
    if (req.body.max_pcs !== undefined && req.body.max_pcs !== null && before.organization_id) {
      const wanted = Number(req.body.max_pcs);
      if (!Number.isFinite(wanted) || wanted < 0) {
        return res.status(400).json({ success: false, message: 'PC allocation must be a positive number' });
      }
      const subscription = await getSubscription(before.organization_id);
      const others = (await pool.query(`
        SELECT COALESCE(SUM(max_pcs), 0)::int AS n FROM branches
        WHERE organization_id = $1 AND branch_id <> $2 AND status <> 'CLOSED'
      `, [before.organization_id, id])).rows[0].n;

      const entitled = subscription?.limits.max_pcs ?? null;
      if (entitled != null && others + wanted > entitled) {
        return res.status(409).json({
          success: false,
          message: `That would allocate ${others + wanted} PCs against an entitlement of ${entitled}. ` +
            `${Math.max(0, entitled - others)} remain unallocated.`,
          data: { entitled, allocated_elsewhere: others, requested: wanted }
        });
      }

      /* A branch cannot be allocated fewer PCs than it already has running.
         The machines exist; a number that says otherwise is a lie the reports
         would repeat. */
      const inUse = (await pool.query(`
        SELECT COUNT(*)::int AS n FROM pcs
        WHERE branch_id = $1 AND is_active AND device_type = 'GAMING_PC'
          AND (category = 'PC' OR category IS NULL)
      `, [id])).rows[0].n;
      if (wanted < inUse) {
        return res.status(409).json({
          success: false,
          message: `This branch already has ${inUse} gaming PCs registered. ` +
            'Remove some before lowering its allocation.'
        });
      }
    }

    const fields = ['name', 'code', 'city', 'street', 'state', 'country', 'phone', 'status', 'max_pcs', 'notes'];
    const sets = [];
    const params = [id];
    for (const f of fields) {
      if (req.body[f] === undefined) continue;
      params.push(req.body[f] === '' ? null : req.body[f]);
      sets.push(`${f} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    if (req.body.status) {
      sets.push(`is_active = ${req.body.status === 'ACTIVE' ? 'TRUE' : 'FALSE'}`);
    }

    const updated = (await pool.query(
      `UPDATE branches SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE branch_id = $1 RETURNING *`, params
    )).rows[0];

    await recordAdminAudit(req, {
      action: 'branch.updated', resource_type: 'branch', resource_id: id,
      organization_id: before.organization_id, branch_id: id,
      old_value: Object.fromEntries(fields.filter((f) => req.body[f] !== undefined).map((f) => [f, before[f]])),
      new_value: Object.fromEntries(fields.filter((f) => req.body[f] !== undefined).map((f) => [f, req.body[f]]))
    });

    res.json({ success: true, message: 'Branch saved', data: updated });
  } catch (error) {
    console.error('Admin branch update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that branch' });
  }
};

/* ==========================================================================
   SUBSCRIPTIONS
   ========================================================================== */

/** GET /api/admin/subscriptions?q=&status=&page= */
export const listSubscriptions = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Number(req.query.size) || 25);
    const params = [];
    const where = [];

    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(LOWER(o.name) LIKE $${params.length} OR LOWER(COALESCE(p.name,'')) LIKE $${params.length})`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      where.push(`s.status = $${params.length}`);
    }
    if (req.query.type) {
      params.push(String(req.query.type).toUpperCase());
      where.push(`s.type = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await pool.query(`
      SELECT COUNT(*)::int AS n FROM subscriptions s
      LEFT JOIN organizations o ON o.organization_id = s.organization_id
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id ${clause}
    `, params)).rows[0].n;

    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(`
      SELECT s.subscription_id, s.organization_id, s.type, s.status,
             s.billing_period, s.currency, s.list_price, s.discount_type,
             s.discount_value, s.net_price, s.start_date, s.end_date, s.trial_ends_at,
             s.max_pcs, s.max_branches, s.max_users,
             o.name AS organization_name, o.status AS organization_status,
             p.name AS plan_name, p.code AS plan_code,
             GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(s.trial_ends_at, s.end_date) - NOW())) / 86400))::int AS days_left,
             (SELECT COUNT(*)::int FROM subscription_addons sa
               WHERE sa.subscription_id = s.subscription_id AND sa.status = 'ACTIVE') AS addons
      FROM subscriptions s
      LEFT JOIN organizations o ON o.organization_id = s.organization_id
      LEFT JOIN subscription_plans p ON p.sub_id = s.sub_id
      ${clause}
      ORDER BY COALESCE(s.trial_ends_at, s.end_date) ASC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: { items: rows, total, page, size } });
  } catch (error) {
    console.error('Admin subscription list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load subscriptions' });
  }
};

/** GET /api/admin/subscriptions/:id — everything the editor in section 48 needs. */
export const getSubscriptionDetail = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = (await pool.query(`
      SELECT s.*, o.name AS organization_name, o.currency AS org_currency
      FROM subscriptions s
      LEFT JOIN organizations o ON o.organization_id = s.organization_id
      WHERE s.subscription_id = $1
    `, [id])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });

    const [resolved, usage, entitlements, plans, addons, mine] = await Promise.all([
      getSubscription(row.organization_id),
      getUsage(row.organization_id),
      getEntitlements(row.organization_id),
      pool.query(`
        SELECT p.sub_id AS plan_id, p.code, p.name, p.max_pcs, p.max_branches, p.max_users,
               p.max_installations,
               COALESCE(json_agg(json_build_object(
                 'billing_period', pp.billing_period, 'currency', pp.currency, 'price', pp.price
               )) FILTER (WHERE pp.plan_price_id IS NOT NULL), '[]') AS prices
        FROM subscription_plans p
        LEFT JOIN plan_prices pp ON pp.plan_id = p.sub_id AND pp.is_active
        WHERE p.status <> 'ARCHIVED'
        GROUP BY p.sub_id ORDER BY p.sort_order, p.sub_id
      `).then((r) => r.rows),
      pool.query('SELECT * FROM addons WHERE is_active ORDER BY name').then((r) => r.rows),
      pool.query(`
        SELECT sa.*, a.code, a.name, a.grant_pcs, a.grant_branches, a.grant_users
        FROM subscription_addons sa JOIN addons a ON a.addon_id = sa.addon_id
        WHERE sa.subscription_id = $1 ORDER BY a.name
      `, [id]).then((r) => r.rows)
    ]);

    res.json({
      success: true,
      data: {
        subscription: row,
        resolved,
        usage,
        features: entitlements.matrix || Object.entries(entitlements.features).map(([key, v]) => ({
          feature_key: key, label: v.label, enabled: v.enabled, reason: v.reason
        })),
        plans,
        addons,
        subscription_addons: mine
      }
    });
  } catch (error) {
    console.error('Admin subscription detail failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that subscription' });
  }
};

/** Work out what a customer pays, given a list price and a discount. */
const computeNet = (listPrice, discountType, discountValue) => {
  const list = Number(listPrice || 0);
  const value = Number(discountValue || 0);
  switch (discountType) {
    case 'PERCENTAGE':   return Math.max(0, Math.round(list * (1 - value / 100)));
    case 'FIXED_AMOUNT': return Math.max(0, list - value);
    case 'CUSTOM_PRICE': return Math.max(0, value);
    default:             return list;
  }
};

/**
 * PATCH /api/admin/subscriptions/:id
 *
 * The subscription editor. Everything commercial is written here as a value on
 * the subscription row, not as a pointer at the package — see the note at the
 * top of this file.
 */
export const updateSubscription = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const before = (await client.query('SELECT * FROM subscriptions WHERE subscription_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const sets = [];
    const params = [id];
    const push = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

    let listPrice = before.list_price;
    let planId = before.sub_id;

    /* Changing the package. The new package's price for the chosen cycle is
       captured NOW, so a later reprice of that package leaves this customer
       alone. Limits are copied too, unless the operator is overriding them in
       the same request. */
    if (req.body.plan_id !== undefined && Number(req.body.plan_id) !== before.sub_id) {
      planId = Number(req.body.plan_id);
      const plan = (await client.query(
        'SELECT * FROM subscription_plans WHERE sub_id = $1', [planId])).rows[0];
      if (!plan) return res.status(400).json({ success: false, message: 'No such package' });

      const period = req.body.billing_period || before.billing_period || 'monthly';
      const price = (await client.query(`
        SELECT price FROM plan_prices
        WHERE plan_id = $1 AND billing_period = $2 AND is_active ORDER BY plan_price_id LIMIT 1
      `, [planId, period])).rows[0];

      listPrice = price ? Number(price.price) : Number(plan.price || 0);
      push('sub_id', planId);
      push('list_price', listPrice);
      if (req.body.max_pcs === undefined) push('max_pcs', plan.max_pcs);
      if (req.body.max_branches === undefined) push('max_branches', plan.max_branches);
      if (req.body.max_users === undefined) push('max_users', plan.max_users);
      if (req.body.max_installations === undefined) push('max_installations', plan.max_installations);
      /* Moving off a trial onto a real package makes it a paid subscription;
         leaving type = TRIAL would keep the trial banner up forever. */
      if (!plan.is_freetrial && before.type === 'TRIAL') push('type', 'PAID');
    }

    if (req.body.billing_period !== undefined) push('billing_period', req.body.billing_period);
    if (req.body.list_price !== undefined) {
      listPrice = Number(req.body.list_price);
      push('list_price', listPrice);
    }

    const discountType = req.body.discount_type ?? before.discount_type ?? 'NO_DISCOUNT';
    const discountValue = req.body.discount_value ?? before.discount_value ?? 0;
    if (req.body.discount_type !== undefined) push('discount_type', discountType);
    if (req.body.discount_value !== undefined) push('discount_value', discountValue);

    /* net_price is always derived, never accepted from the request. Letting a
       client send it invites a discount and a total that disagree. */
    if (sets.some((s) => /list_price|discount_type|discount_value|sub_id/.test(s))) {
      push('net_price', computeNet(listPrice, discountType, discountValue));
    }

    for (const [field, column] of [
      ['max_pcs', 'max_pcs'], ['max_branches', 'max_branches'],
      ['max_users', 'max_users'], ['max_installations', 'max_installations'],
      ['start_date', 'start_date'], ['end_date', 'end_date'],
      ['promo_ends_at', 'promo_ends_at'], ['price_after_promo', 'price_after_promo']
    ]) {
      if (req.body[field] !== undefined) push(column, req.body[field] === '' ? null : req.body[field]);
    }

    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const updated = (await client.query(`
      UPDATE subscriptions SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE subscription_id = $1 RETURNING *
    `, params)).rows[0];

    await recordAdminAudit(req, {
      action: 'subscription.updated', resource_type: 'subscription', resource_id: id,
      organization_id: before.organization_id,
      old_value: {
        plan_id: before.sub_id, list_price: before.list_price, net_price: before.net_price,
        discount_type: before.discount_type, discount_value: before.discount_value,
        max_pcs: before.max_pcs, end_date: before.end_date
      },
      new_value: {
        plan_id: updated.sub_id, list_price: updated.list_price, net_price: updated.net_price,
        discount_type: updated.discount_type, discount_value: updated.discount_value,
        max_pcs: updated.max_pcs, end_date: updated.end_date
      }
    });

    res.json({ success: true, message: 'Subscription saved', data: updated });
  } catch (error) {
    console.error('Admin subscription update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that subscription' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/subscriptions/:id/extend  { days }
 *
 * Extends from whichever is later: today, or the current end date. Extending
 * an already-lapsed subscription by seven days should give seven days from
 * now, not seven days from a date in the past — which is what adding to the
 * stored value would do, and it would land the customer straight back in
 * expiry.
 */
export const extendSubscription = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const days = Number(req.body?.days);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return res.status(400).json({ success: false, message: 'Enter a number of days between 1 and 3650' });
    }

    const before = (await pool.query('SELECT * FROM subscriptions WHERE subscription_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const isTrial = before.type === 'TRIAL';
    const updated = (await pool.query(`
      UPDATE subscriptions
      SET end_date = GREATEST(COALESCE(end_date, NOW()), NOW()) + ($2::int || ' days')::interval,
          trial_ends_at = CASE WHEN $3::boolean
            THEN GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + ($2::int || ' days')::interval
            ELSE trial_ends_at END,
          status = CASE WHEN status IN ('EXPIRED','PAST_DUE','GRACE_PERIOD')
            THEN CASE WHEN $3::boolean THEN 'TRIAL' ELSE 'ACTIVE' END ELSE status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE subscription_id = $1 RETURNING *
    `, [id, days, isTrial])).rows[0];

    await recordAdminAudit(req, {
      action: isTrial ? 'trial.extended' : 'subscription.extended',
      resource_type: 'subscription', resource_id: id,
      organization_id: before.organization_id,
      old_value: { end_date: before.end_date, status: before.status },
      new_value: { end_date: updated.end_date, status: updated.status, days }
    });

    res.json({
      success: true,
      message: `${isTrial ? 'Trial' : 'Subscription'} extended by ${days} day${days === 1 ? '' : 's'}`,
      data: updated
    });
  } catch (error) {
    console.error('Admin subscription extend failed:', error);
    res.status(500).json({ success: false, message: 'Could not extend that subscription' });
  }
};

/** POST /api/admin/subscriptions/:id/status  { status, reason } */
export const setSubscriptionStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    const allowed = ['ACTIVE', 'TRIAL', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'EXPIRED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of ${allowed.join(', ')}` });
    }

    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
    /* Anything that stops a café trading demands a reason. Six months later
       "why is this customer suspended" needs an answer that is not a guess. */
    if (['SUSPENDED', 'CANCELLED'].includes(status) && !reason) {
      return res.status(400).json({
        success: false,
        message: `A reason is required to ${status === 'CANCELLED' ? 'cancel' : 'suspend'} a subscription`
      });
    }

    const before = (await pool.query('SELECT * FROM subscriptions WHERE subscription_id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    /* Every use of $2 is cast to text. Without the casts Postgres sees it
       assigned to a varchar column, compared to a string literal, and tested
       against an IN list, deduces conflicting types and refuses the whole
       statement — which turned every suspend into a 500. */
    const updated = (await pool.query(`
      UPDATE subscriptions
      SET status = $2::text,
          cancelled_at = CASE WHEN $2::text = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
          cancel_reason = COALESCE($3::text, cancel_reason),
          is_active = $2::text IN ('TRIAL','ACTIVE','PAST_DUE','GRACE_PERIOD'),
          updated_at = CURRENT_TIMESTAMP
      WHERE subscription_id = $1 RETURNING *
    `, [id, status, reason])).rows[0];

    await recordAdminAudit(req, {
      action: `subscription.${status.toLowerCase()}`,
      resource_type: 'subscription', resource_id: id,
      organization_id: before.organization_id,
      old_value: { status: before.status }, new_value: { status, reason }
    });

    res.json({ success: true, message: `Subscription is now ${status.toLowerCase()}`, data: updated });
  } catch (error) {
    console.error('Admin subscription status change failed:', error);
    res.status(500).json({ success: false, message: 'Could not change that subscription' });
  }
};

/** POST /api/admin/subscriptions/:id/addons  { addon_id, quantity } */
export const addSubscriptionAddon = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const addonId = Number(req.body?.addon_id);
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);

    const sub = (await pool.query('SELECT * FROM subscriptions WHERE subscription_id = $1', [id])).rows[0];
    if (!sub) return res.status(404).json({ success: false, message: 'Not found' });
    const addon = (await pool.query('SELECT * FROM addons WHERE addon_id = $1 AND is_active', [addonId])).rows[0];
    if (!addon) return res.status(400).json({ success: false, message: 'No such add-on' });

    /* The price is snapshotted, like everything else commercial. The add-on's
       list price may move; what this customer agreed to pay may not. */
    const row = (await pool.query(`
      INSERT INTO subscription_addons
        (subscription_id, addon_id, quantity, price_snapshot, currency, status)
      VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING *
    `, [id, addonId, quantity, Number(addon.price) * quantity, addon.currency])).rows[0];

    await recordAdminAudit(req, {
      action: 'subscription.addon_added', resource_type: 'subscription', resource_id: id,
      organization_id: sub.organization_id,
      new_value: { addon: addon.code, quantity, price: row.price_snapshot }
    });

    res.status(201).json({
      success: true,
      message: `${addon.name}${quantity > 1 ? ` ×${quantity}` : ''} added`,
      data: row
    });
  } catch (error) {
    console.error('Admin add-on attach failed:', error);
    res.status(500).json({ success: false, message: 'Could not add that add-on' });
  }
};

/** DELETE /api/admin/subscriptions/:id/addons/:rowId */
export const removeSubscriptionAddon = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rowId = Number(req.params.rowId);

    /* Cancelled, not deleted. What a customer was billed for is a commercial
       record; erasing it would leave an invoice nobody can explain. */
    const row = (await pool.query(`
      UPDATE subscription_addons SET status = 'CANCELLED'
      WHERE subscription_addon_id = $1 AND subscription_id = $2
      RETURNING *
    `, [rowId, id])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });

    const sub = (await pool.query(
      'SELECT organization_id FROM subscriptions WHERE subscription_id = $1', [id])).rows[0];
    await recordAdminAudit(req, {
      action: 'subscription.addon_removed', resource_type: 'subscription', resource_id: id,
      organization_id: sub?.organization_id, old_value: { subscription_addon_id: rowId }
    });

    res.json({ success: true, message: 'Add-on removed', data: row });
  } catch (error) {
    console.error('Admin add-on remove failed:', error);
    res.status(500).json({ success: false, message: 'Could not remove that add-on' });
  }
};
