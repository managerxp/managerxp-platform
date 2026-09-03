import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import {
  loadRules, pickRule, applyRule, describeRule, nextRuleChange
} from '../config/pricingRules.js';
import { categoryJoin, categoryExpr } from '../config/softwareCategory.js';

/*
 * Peak, off-peak, weekend and happy-hour windows.
 *
 * Every read and write is scoped to req.actor.cafe_id — a café's trading
 * pattern is its own business, and one café must never see or edit another's
 * windows. A rule belonging to a different café reads as absent, not
 * forbidden, so probing this endpoint cannot confirm that a rule exists.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* How each scope reads on screen. Kept beside the shape rather than in the
   UI so the list, the audit trail and the API all say the same words. */
const SCOPE_LABELS = {
  GAMING: 'All gaming',
  FNB: 'Food & drink',
  SHOP: 'Shop items',
  ALL: 'Everything on the bill'
};

const shapeRule = (row) => ({
  rule_id: row.rule_id,
  name: row.name,
  rule_kind: row.rule_kind,
  days: (row.days || []).map(Number),
  day_labels: (row.days || []).map((d) => DAY_NAMES[Number(d)]).filter(Boolean),
  start_time: String(row.start_time).slice(0, 5),
  end_time: String(row.end_time).slice(0, 5),
  // A window that closes no later than it opens ran past midnight; saying so
  // explicitly saves every reader from re-deriving it.
  crosses_midnight: String(row.end_time).slice(0, 5) <= String(row.start_time).slice(0, 5),
  software_id: row.software_id || null,
  software_name: row.software_name || null,
  category: row.category || null,
  applies_to: row.applies_to || 'GAMING',
  /* What an owner reads in the list. A narrowed gaming rule names the thing
     it narrowed to; everything else names the kind of line it covers. */
  scope_label: row.software_name
    || row.category
    || SCOPE_LABELS[row.applies_to || 'GAMING']
    || 'All gaming',
  adjust_type: row.adjust_type,
  adjust_value: Number(row.adjust_value),
  effect_label: row.adjust_type === 'FIXED'
    ? `Set to ${Number(row.adjust_value)}`
    : `${Number(row.adjust_value) > 0 ? '+' : ''}${Number(row.adjust_value)}%`,
  priority: row.priority,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const SELECT_RULE = `
  SELECT r.*, sm.software_name
    FROM pricing_rules r
    LEFT JOIN software_master sm ON sm.software_id = r.software_id
`;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validate and normalise a rule body. Returns { error } or { value }. */
const readBody = (body) => {
  const name = body?.name ? String(body.name).trim().slice(0, 120) : '';
  if (!name) return { error: 'Give the window a name' };

  const kinds = ['PEAK', 'OFFPEAK', 'HAPPY', 'WEEKEND', 'CUSTOM'];
  const ruleKind = kinds.includes(body?.rule_kind) ? body.rule_kind : 'CUSTOM';

  const days = Array.isArray(body?.days)
    ? [...new Set(body.days.map((d) => parseInt(d, 10)))]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
    : [];
  if (!days.length) return { error: 'Pick at least one day' };

  const startTime = String(body?.start_time || '').slice(0, 5);
  const endTime = String(body?.end_time || '').slice(0, 5);
  if (!HHMM.test(startTime)) return { error: 'Start time must look like 18:00' };
  if (!HHMM.test(endTime)) return { error: 'End time must look like 23:00' };

  const adjustType = body?.adjust_type === 'FIXED' ? 'FIXED' : 'PERCENT';
  const adjustValue = Number(body?.adjust_value);
  if (!Number.isFinite(adjustValue)) return { error: 'Enter an amount for this window' };
  if (adjustType === 'PERCENT' && (adjustValue < -100 || adjustValue > 1000)) {
    return { error: 'A percentage must be between -100 and 1000' };
  }
  if (adjustType === 'FIXED' && adjustValue < 0) {
    return { error: 'A fixed price cannot be negative' };
  }
  if (adjustType === 'PERCENT' && adjustValue === 0) {
    return { error: 'A 0% window would change nothing' };
  }

  /* Which kind of bill line this touches. Defaults to gaming, which is what
     every window created before this field existed meant. */
  const scopes = ['GAMING', 'FNB', 'SHOP', 'ALL'];
  const appliesTo = scopes.includes(String(body?.applies_to || '').toUpperCase())
    ? String(body.applies_to).toUpperCase()
    : 'GAMING';

  /* One or the other, never both — a rule that named a game *and* a category
     would silently match only when the two agreed, which reads as the rule
     simply not working. */
  const softwareId = body?.software_id ? parseInt(body.software_id, 10) : null;
  const category = body?.category ? String(body.category).trim().slice(0, 64) : null;
  if (softwareId && category) {
    return { error: 'Narrow the window by game or by category, not both' };
  }
  /* Naming a game or a station category only means something for gaming.
     Silently ignoring it would leave an owner staring at a food rule that
     claims to be about the pool table. */
  if (appliesTo !== 'GAMING' && (softwareId || category)) {
    return { error: 'A game or station category can only narrow a gaming window' };
  }

  const priority = Number.isFinite(Number(body?.priority)) ? parseInt(body.priority, 10) : 100;
  const status = body?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

  return {
    value: {
      name, ruleKind, days, startTime, endTime, appliesTo,
      softwareId: Number.isInteger(softwareId) ? softwareId : null,
      category, adjustType, adjustValue, priority, status
    }
  };
};

// GET /api/pricing-rules
export const listRules = async (req, res) => {
  try {
    const result = await pool.query(
      `${SELECT_RULE} WHERE r.cafe_id = $1 ORDER BY r.priority ASC, r.rule_id ASC`,
      [req.actor?.cafe_id ?? null]
    );
    res.status(200).json({
      success: true,
      data: result.rows.map(shapeRule),
      count: result.rowCount
    });
  } catch (error) {
    console.error('Error listing pricing rules:', error);
    res.status(500).json({ success: false, message: 'Failed to load pricing windows' });
  }
};

// POST /api/pricing-rules
export const createRule = async (req, res) => {
  try {
    const parsed = readBody(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const v = parsed.value;

    const inserted = await pool.query(
      `INSERT INTO pricing_rules
         (cafe_id, name, rule_kind, days, start_time, end_time,
          software_id, category, applies_to, adjust_type, adjust_value,
          priority, status, created_by)
       VALUES ($1,$2,$3,$4::smallint[],$5::time,$6::time,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING rule_id`,
      [
        req.actor?.cafe_id ?? null, v.name, v.ruleKind, v.days, v.startTime, v.endTime,
        v.softwareId, v.category, v.appliesTo, v.adjustType, v.adjustValue,
        v.priority, v.status, req.actor?.label || null
      ]
    );

    const fresh = await pool.query(`${SELECT_RULE} WHERE r.rule_id = $1`, [inserted.rows[0].rule_id]);
    const rule = shapeRule(fresh.rows[0]);

    await recordAudit(req, {
      action: 'pricing_rule.create',
      category: 'pricing',
      entity: 'pricing_rule',
      entity_id: rule.rule_id,
      summary: `Added pricing window "${rule.name}" — ${rule.day_labels.join(', ')} ` +
        `${rule.start_time}–${rule.end_time}, ${rule.effect_label} on ${rule.scope_label}`
    });

    res.status(201).json({ success: true, message: 'Pricing window added', data: rule });
  } catch (error) {
    console.error('Error creating pricing rule:', error);
    res.status(500).json({ success: false, message: 'Failed to add the pricing window' });
  }
};

// PUT /api/pricing-rules/:id
export const updateRule = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Pricing window not found' });
    }

    const parsed = readBody(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const v = parsed.value;

    // Scoped in the UPDATE itself: another café's rule matches no row and comes
    // back as "not found", which is the same answer as one that never existed.
    const updated = await pool.query(
      `UPDATE pricing_rules
          SET name = $1, rule_kind = $2, days = $3::smallint[],
              start_time = $4::time, end_time = $5::time,
              software_id = $6, category = $7, applies_to = $8,
              adjust_type = $9, adjust_value = $10,
              priority = $11, status = $12,
              updated_at = CURRENT_TIMESTAMP
        WHERE rule_id = $13 AND cafe_id = $14
        RETURNING rule_id`,
      [
        v.name, v.ruleKind, v.days, v.startTime, v.endTime,
        v.softwareId, v.category, v.appliesTo, v.adjustType, v.adjustValue,
        v.priority, v.status, id, req.actor?.cafe_id ?? null
      ]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ success: false, message: 'Pricing window not found' });
    }

    const fresh = await pool.query(`${SELECT_RULE} WHERE r.rule_id = $1`, [id]);
    const rule = shapeRule(fresh.rows[0]);

    await recordAudit(req, {
      action: 'pricing_rule.update',
      category: 'pricing',
      entity: 'pricing_rule',
      entity_id: id,
      summary: `Changed pricing window "${rule.name}" — ${rule.day_labels.join(', ')} ` +
        `${rule.start_time}–${rule.end_time}, ${rule.effect_label} on ${rule.scope_label}`
    });

    res.status(200).json({ success: true, message: 'Pricing window updated', data: rule });
  } catch (error) {
    console.error('Error updating pricing rule:', error);
    res.status(500).json({ success: false, message: 'Failed to update the pricing window' });
  }
};

// DELETE /api/pricing-rules/:id
export const deleteRule = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Pricing window not found' });
    }

    /* Safe to delete outright, unlike a bill or a session: a rule is
       configuration, and every session it ever priced already carries its own
       snapshot of the rate and the window's name. Removing one cannot change
       what anybody was charged. */
    const removed = await pool.query(
      `DELETE FROM pricing_rules WHERE rule_id = $1 AND cafe_id = $2 RETURNING name`,
      [id, req.actor?.cafe_id ?? null]
    );

    if (!removed.rows.length) {
      return res.status(404).json({ success: false, message: 'Pricing window not found' });
    }

    await recordAudit(req, {
      action: 'pricing_rule.delete',
      category: 'pricing',
      entity: 'pricing_rule',
      entity_id: id,
      sensitive: true,
      summary: `Removed pricing window "${removed.rows[0].name}"`
    });

    res.status(200).json({ success: true, message: 'Pricing window removed' });
  } catch (error) {
    console.error('Error deleting pricing rule:', error);
    res.status(500).json({ success: false, message: 'Failed to remove the pricing window' });
  }
};

/*
 * GET /api/pricing-rules/preview
 *
 * What every catalogue price costs right now, and when that next changes.
 *
 * Exists so the till and the session dialog can show the live rate without
 * reimplementing the matching logic — it calls the very same pickRule and
 * applyRule that session start uses, so a preview that disagrees with the
 * charge is not possible by construction.
 */
export const previewRates = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const when = req.query.at ? new Date(req.query.at) : new Date();
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ success: false, message: 'That is not a valid time' });
    }

    const rules = await loadRules(pool, cafeId);

    // This café's own rate card only — the windows are private, and so are the
    // prices they adjust.
    const prices = await pool.query(
      `SELECT gp.id, gp.price, gp.currency,
              sm.software_id, sm.software_name,
              ${categoryExpr()} AS category,
              s.session_name, s.duration_minutes, s.duration_type
         FROM gaming_prices gp
         JOIN software_master sm ON sm.software_id = gp.software_id
         JOIN session_master  s  ON s.id = gp.session_master_id
         ${categoryJoin(1)}
        WHERE gp.status = 'ACTIVE' AND sm.is_active AND s.status = 'ACTIVE'
          AND gp.cafe_id IS NOT DISTINCT FROM $1
        ORDER BY sm.software_name, s.duration_minutes NULLS LAST`,
      [cafeId]
    );

    /* This panel lists the gaming rate card, so it asks only about gaming
       lines — a food window must not appear to change the price of a PS5
       hour just because it is running at the same time. */
    const data = prices.rows.map((row) => {
      const scope = { when, softwareId: row.software_id, category: row.category, itemType: 'GAMING' };
      const rule = pickRule(rules, scope);
      const base = Number(row.price);
      const now = applyRule(base, rule);
      const change = nextRuleChange(rules, scope);

      return {
        gaming_price_id: row.id,
        software_id: row.software_id,
        software_name: row.software_name,
        category: row.category,
        session_name: row.session_name,
        duration_minutes: row.duration_minutes,
        is_unlimited: row.duration_type === 'UNLIMITED',
        currency: row.currency,
        base_price: base,
        current_price: now,
        changed: now !== base,
        rule_id: rule ? rule.rule_id : null,
        rule_label: describeRule(rule),
        rule_kind: rule ? rule.rule_kind : null,
        // "…until 18:00, then ₹350" — the bit a customer actually asks about.
        next_change_at: change ? change.at : null,
        next_change_time: change ? change.label : null,
        next_price: change ? applyRule(base, change.rule) : null
      };
    });

    res.status(200).json({ success: true, data, count: data.length, at: when });
  } catch (error) {
    console.error('Error previewing rates:', error);
    res.status(500).json({ success: false, message: 'Failed to work out current rates' });
  }
};

export default { listRules, createRule, updateRule, deleteRule, previewRates };
