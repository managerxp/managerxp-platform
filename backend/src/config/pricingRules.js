import pool from './database.js';

/*
 * The time-of-day pricing engine.
 *
 * Answers one question: at this moment, for this game, does a window apply —
 * and if so, what does the base price become?
 *
 * Called from resolveGamingPrice at session start, so the adjusted rate is
 * snapshotted onto the session like every other pricing input. Nothing here
 * runs again for a session already under way: a happy hour that ends at 6pm
 * does not raise the price on someone who started at 5:45.
 */

const round2 = (n) => Number(Number(n).toFixed(2));

/** "18:30:00" or "18:30" → minutes since midnight. */
const toMinutes = (t) => {
  if (t === null || t === undefined) return null;
  const parts = String(t).split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
};

const pad = (n) => String(n).padStart(2, '0');
const fromMinutes = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

/**
 * Does this rule cover the given moment?
 *
 * A window whose end is not after its start runs past midnight — "Happy Hour,
 * Friday 22:00–02:00" is one window, not two. Such a window is anchored to the
 * day it *opened*, so 01:00 on Saturday belongs to Friday's rule. Getting this
 * wrong is how a late-night rate silently stops applying at midnight, which is
 * exactly when a café is busiest.
 */
export const ruleCoversMoment = (rule, when) => {
  const start = toMinutes(rule.start_time);
  const end = toMinutes(rule.end_time);
  if (start === null || end === null) return false;

  const days = (rule.days || []).map(Number);
  const day = when.getDay();
  const minute = when.getHours() * 60 + when.getMinutes();

  if (end > start) {
    return days.includes(day) && minute >= start && minute < end;
  }

  /* Wraps midnight. Either we are in the evening portion on a covered day, or
     in the small-hours portion belonging to the previous covered day. A window
     with start === end is read as "all day", not "no time at all". */
  if (start === end) return days.includes(day);

  const previousDay = (day + 6) % 7;
  return (days.includes(day) && minute >= start)
      || (days.includes(previousDay) && minute < end);
};

/*
 * How specific a rule is, for tie-breaking.
 *
 * A rule naming a single game beats one naming a category, which beats one
 * covering all gaming. Without this, a café-wide weekend surcharge sharing a
 * priority with "Pool is half price on Sunday" would win or lose by row order
 * — and row order in Postgres is physical, so the answer could change between
 * two identical sessions.
 */
const specificity = (rule) => {
  if (rule.software_id) return 3;
  if (rule.category) return 2;
  // A rule naming one kind of line beats one covering the whole bill.
  if (rule.applies_to && rule.applies_to !== 'ALL') return 1;
  return 0;
};

/*
 * Which bill lines a rule is allowed to touch.
 *
 * `applies_to` is the item-type dimension: GAMING is table time, FNB the
 * kitchen and fridge, SHOP merchandise, ALL the whole bill. A rule with no
 * value at all is read as GAMING, which is what every rule written before
 * this column existed actually meant.
 */
const matchesItemType = (rule, itemType) => {
  const scope = rule.applies_to || 'GAMING';
  if (scope === 'ALL') return true;
  // No item type supplied means the caller is pricing gaming — the session
  // engine, which predates this and only ever asks about table time.
  return scope === (itemType || 'GAMING');
};

/**
 * Pick the one rule that applies, or null.
 *
 * Rules are already ordered by the caller; this walks them and returns the
 * first match, where "first" means lowest priority number, then most specific,
 * then oldest.
 */
export const pickRule = (rules, { when, softwareId, category, itemType }) => {
  const candidates = (rules || []).filter((rule) => {
    if (rule.status && rule.status !== 'ACTIVE') return false;
    if (!matchesItemType(rule, itemType)) return false;
    if (rule.software_id && Number(rule.software_id) !== Number(softwareId)) return false;
    if (rule.category && rule.category !== category) return false;
    return ruleCoversMoment(rule, when);
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const byPriority = (a.priority ?? 100) - (b.priority ?? 100);
    if (byPriority !== 0) return byPriority;
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity !== 0) return bySpecificity;
    return Number(a.rule_id) - Number(b.rule_id);
  });

  return candidates[0];
};

/** Apply a rule to a base price. Returns the adjusted price, never negative. */
export const applyRule = (basePrice, rule) => {
  const base = Number(basePrice) || 0;
  if (!rule) return round2(base);

  const value = Number(rule.adjust_value) || 0;
  if (rule.adjust_type === 'FIXED') return round2(Math.max(0, value));
  return round2(Math.max(0, base * (1 + value / 100)));
};

/** How the applied rule reads on a session, a receipt and a report. */
export const describeRule = (rule) => {
  if (!rule) return null;
  if (rule.adjust_type === 'FIXED') return `${rule.name}`;
  const value = Number(rule.adjust_value) || 0;
  const sign = value > 0 ? '+' : '';
  return `${rule.name} (${sign}${value}%)`;
};

/** A café's active rules, best-first. Small set, read whole and matched in JS. */
export const loadRules = async (client, cafeId) => {
  const db = client || pool;
  const result = await db.query(
    `SELECT rule_id, cafe_id, name, rule_kind, days, start_time, end_time,
            software_id, category, applies_to,
            adjust_type, adjust_value, priority, status
       FROM pricing_rules
      WHERE status = 'ACTIVE'
        AND ($1::int IS NULL OR cafe_id = $1::int OR cafe_id IS NULL)
      ORDER BY priority ASC, rule_id ASC`,
    [cafeId ?? null]
  );
  return result.rows;
};

/**
 * The rule in force right now for a game, if any.
 *
 * The single entry point used by both session start and the rate preview, so
 * what staff are shown and what the customer is charged cannot drift apart.
 */
export const activeRuleFor = async (client, { cafeId, softwareId, category, itemType, when } = {}) => {
  const rules = await loadRules(client, cafeId);
  return pickRule(rules, { when: when || new Date(), softwareId, category, itemType });
};

/**
 * When does the rule in force stop applying, or the next one start?
 *
 * Used to tell staff "Happy Hour until 18:00, then ₹350/hr" — the part of a
 * rate that matters to a customer deciding whether to start now or wait.
 * Walks forward in ten-minute steps for a day; a coarse scan is enough for a
 * label, and it sidesteps reasoning about wrapped windows analytically.
 */
export const nextRuleChange = (rules, { when, softwareId, category, itemType }) => {
  const current = pickRule(rules, { when, softwareId, category, itemType });
  const currentId = current ? current.rule_id : null;

  const cursor = new Date(when.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + (10 - (cursor.getMinutes() % 10)));

  for (let step = 0; step < 24 * 6; step += 1) {
    const at = pickRule(rules, { when: cursor, softwareId, category, itemType });
    const atId = at ? at.rule_id : null;
    if (atId !== currentId) {
      return { at: new Date(cursor.getTime()), rule: at, label: fromMinutes(cursor.getHours() * 60 + cursor.getMinutes()) };
    }
    cursor.setMinutes(cursor.getMinutes() + 10);
  }
  return null;
};

export default {
  ruleCoversMoment, pickRule, applyRule, describeRule,
  loadRules, activeRuleFor, nextRuleChange
};
