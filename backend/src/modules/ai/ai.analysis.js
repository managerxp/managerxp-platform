import { pctChange } from './ai.tools.js';

/*
 * Analysis.
 *
 * This is where a set of query results becomes an explanation. Everything in
 * this file is arithmetic over figures that already came from the database —
 * no number is created here, and none is passed to a model to be "worked out".
 *
 * The rule the whole feature rests on: if the data does not support a claim,
 * this file says so rather than reaching for a plausible one. A café owner
 * acting on an invented cause is worse off than one told "I can see the drop
 * but not the reason".
 */

/** A change worth mentioning at all. Below this it is noise, not a finding. */
const MATERIAL_PCT = 5;
const MATERIAL_ABS = 1;

const fmt = (n) => {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: Math.round(v * 100) % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(v);
  } catch { return v.toFixed(2); }
};

const direction = (pct) => (pct > 0 ? 'up' : 'down');
const absPct = (pct) => Math.abs(Number(pct)).toFixed(1);

/**
 * Confidence in an explanation.
 *
 * Deliberately conservative: a café with three bills in the window can produce
 * a large percentage swing that means nothing. Volume gates confidence.
 */
export const assessConfidence = ({ bills, sessions, hasCause, sampleWindows }) => {
  if (!sampleWindows) return 'low';
  if (bills < 3 && sessions < 3) return 'low';
  if (!hasCause) return 'medium';
  if (bills >= 20 || sessions >= 20) return 'high';
  return 'medium';
};

/**
 * Attribute a revenue change to its largest contributor.
 *
 * Works down the split — gaming, F&B, shop, other — and picks the line that
 * moved the most in absolute terms, because that is what actually shifted the
 * total. A category that halved but was only 40 XP is not the story.
 */
export const attributeRevenueChange = (comparison) => {
  const parts = ['gaming', 'fnb', 'shop', 'other']
    .map((k) => ({
      key: k,
      label: k === 'fnb' ? 'F&B' : k.charAt(0).toUpperCase() + k.slice(1),
      ...comparison.change[k]
    }))
    .filter((p) => Math.abs(p.delta) >= MATERIAL_ABS);

  if (!parts.length) return null;

  parts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const leader = parts[0];
  const total = comparison.change.revenue;

  // How much of the whole move this one line accounts for.
  const share = total.delta !== 0
    ? Math.abs(leader.delta / total.delta)
    : null;

  return {
    leader,
    others: parts.slice(1),
    // "Primarily" only when one line genuinely dominates.
    dominant: share !== null && share >= 0.6,
    share: share === null ? null : Number((share * 100).toFixed(0))
  };
};

/**
 * Narrow a change to the hours it happened in.
 *
 * Returns the contiguous block with the largest shortfall, so an answer can
 * say "concentrated between 6 and 9pm" instead of "spread across the day"
 * only when that is true.
 */
export const findHourConcentration = (currentHours, previousHours) => {
  if (!currentHours?.length || !previousHours?.length) return null;

  const prev = {};
  previousHours.forEach((h) => { prev[h.hour] = h.revenue; });

  const deltas = currentHours.map((h) => ({
    hour: h.hour,
    delta: Number((h.revenue - (prev[h.hour] || 0)).toFixed(2))
  }));

  const totalDelta = deltas.reduce((s, d) => s + d.delta, 0);
  if (Math.abs(totalDelta) < MATERIAL_ABS) return null;

  // Best contiguous run in the same direction as the overall move.
  const sign = totalDelta < 0 ? -1 : 1;
  let best = null;
  for (let i = 0; i < deltas.length; i += 1) {
    let sum = 0;
    for (let j = i; j < deltas.length; j += 1) {
      sum += deltas[j].delta;
      const magnitude = sum * sign;
      if (!best || magnitude > best.magnitude) {
        best = { startHour: deltas[i].hour, endHour: deltas[j].hour + 1, magnitude, sum };
      }
    }
  }

  if (!best || best.magnitude <= 0) return null;

  const share = Math.abs(best.sum / totalDelta);
  // Only a real concentration if a short window carries most of the move.
  const width = best.endHour - best.startHour;
  if (share < 0.55 || width > 8) return null;

  return {
    startHour: best.startHour,
    endHour: best.endHour,
    amount: Number(best.sum.toFixed(2)),
    share: Number((share * 100).toFixed(0)),
    label: `${formatHour(best.startHour)}–${formatHour(best.endHour)}`
  };
};

export const formatHour = (h) => {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
};

/**
 * Build the structured evidence list.
 *
 * Only figures that were actually queried appear here. The frontend renders
 * this rather than parsing the prose, so the numbers on screen are the numbers
 * from the database.
 */
export const buildEvidence = (comparison, extras = {}) => {
  const evidence = [];

  const push = (label, metric, change, unit = 'XP') => {
    if (!change) return;
    evidence.push({
      label,
      metric,
      value: unit === 'XP' ? fmt(change.current) + ' XP' : String(change.current),
      raw: change.current,
      previous: change.previous,
      change: change.pct === null ? null : Number(change.pct),
      change_label: change.pct === null
        ? 'no prior figure'
        : `${change.pct > 0 ? '+' : ''}${change.pct}%`
    });
  };

  push('Revenue', 'revenue', comparison.change.revenue);
  if (comparison.current.gaming || comparison.previous.gaming) {
    push('Gaming', 'gaming_revenue', comparison.change.gaming);
  }
  if (comparison.current.fnb || comparison.previous.fnb) {
    push('F&B', 'fnb_revenue', comparison.change.fnb);
  }
  push('Bills', 'bill_count', comparison.change.bills, 'count');

  if (extras.sessions) {
    evidence.push({
      label: 'Sessions',
      metric: 'session_count',
      value: String(extras.sessions.sessions),
      raw: extras.sessions.sessions,
      change: null,
      change_label: null
    });
    if (extras.sessions.average_minutes) {
      evidence.push({
        label: 'Average session',
        metric: 'avg_session_minutes',
        value: `${extras.sessions.average_minutes} min`,
        raw: extras.sessions.average_minutes,
        change: null,
        change_label: null
      });
    }
  }

  if (extras.concentration) {
    evidence.push({
      label: 'Concentrated in',
      metric: 'hour_window',
      value: extras.concentration.label,
      raw: extras.concentration.amount,
      change: null,
      change_label: `${extras.concentration.share}% of the move`
    });
  }

  if (extras.refunds && extras.refunds.amount > 0) {
    evidence.push({
      label: 'Refunded',
      metric: 'refunds',
      value: fmt(extras.refunds.amount) + ' XP',
      raw: extras.refunds.amount,
      change: null,
      change_label: `${extras.refunds.refunds} refund(s)`
    });
  }

  return evidence;
};

/**
 * Compose the analysis prose from figures that are already known.
 *
 * This is the fallback narration and the source of truth for what the answer
 * may claim. When a model is configured it rewrites this text — it is never
 * given the freedom to introduce a fact that is not already here.
 */
export const composeRevenueAnalysis = ({ comparison, attribution, concentration, sessions, basis, periodLabel, refunds, discounts }) => {
  const rev = comparison.change.revenue;
  const lines = [];

  if (rev.pct === null) {
    lines.push(
      `Revenue for ${periodLabel} was ${fmt(rev.current)} XP. There is no figure for ` +
      `${basis}, so there is nothing to compare it against yet.`
    );
  } else if (Math.abs(rev.pct) < MATERIAL_PCT) {
    lines.push(
      `Revenue for ${periodLabel} was ${fmt(rev.current)} XP, effectively level with ` +
      `${basis} (${rev.pct > 0 ? '+' : ''}${rev.pct}%).`
    );
  } else {
    lines.push(
      `Revenue for ${periodLabel} came in ${absPct(rev.pct)}% ${direction(rev.pct)} on ${basis} — ` +
      `${fmt(rev.current)} XP against ${fmt(rev.previous)} XP.`
    );
  }

  if (attribution) {
    const l = attribution.leader;
    if (attribution.dominant) {
      lines.push(
        `${l.label} accounts for most of the difference: ${fmt(Math.abs(l.delta))} XP ` +
        `${direction(l.delta)}, about ${attribution.share}% of the total move.`
      );
    } else {
      lines.push(
        `The largest single movement is ${l.label}, ${fmt(Math.abs(l.delta))} XP ` +
        `${direction(l.delta)}, but it is not the whole story — the change is spread ` +
        `across ${attribution.others.length + 1} categories.`
      );
    }

    // Name a category that held, because that narrows where to look.
    const steady = attribution.others.find((o) => Math.abs(o.pct || 0) < MATERIAL_PCT);
    if (steady) lines.push(`${steady.label} held steady over the same window.`);
  }

  if (concentration) {
    lines.push(
      `The shortfall is concentrated between ${concentration.label}, which carries ` +
      `${concentration.share}% of it rather than it being spread through the day.`
    );
  }

  if (refunds && refunds.amount > 0 && Math.abs(refunds.amount) >= Math.abs(rev.delta) * 0.25) {
    lines.push(
      `${fmt(refunds.amount)} XP was refunded across ${refunds.refunds} bill(s) in this ` +
      `window, which is a meaningful part of the gap.`
    );
  }

  if (discounts && discounts.amount > 0 && discounts.discounted_bills > 0) {
    lines.push(
      `${fmt(discounts.amount)} XP was given away in discounts on ` +
      `${discounts.discounted_bills} bill(s).`
    );
  }

  return lines.join(' ');
};

/**
 * A next step the data actually points at.
 *
 * Returns null rather than generic advice. "Consider improving marketing" is
 * worse than silence — it is what a report says when it has found nothing.
 */
export const suggestNextStep = ({ attribution, concentration, stations, sessions }) => {
  if (concentration && attribution?.leader?.key === 'gaming') {
    return `Look at station availability between ${concentration.label} — the gap sits in that ` +
      `block rather than across the day.`;
  }

  if (attribution?.leader?.key === 'gaming' && sessions) {
    if (sessions.sessions === 0) return 'No sessions were recorded in this window at all — check that stations were online and staff were starting sessions.';
    return `Gaming time drove the change. Check how many stations were available and whether ` +
      `sessions were being started — ${sessions.sessions} ran, averaging ${sessions.average_minutes} minutes.`;
  }

  if (attribution?.leader?.key === 'fnb') {
    return 'The movement is in F&B rather than station time. Compare which products sold and ' +
      'whether anything was out of stock.';
  }

  if (stations && stations.length) {
    const idle = stations.filter((s) => s.sessions === 0 && s.is_active);
    if (idle.length) {
      return `${idle.length} active station(s) took no sessions in this window — ` +
        `${idle.slice(0, 3).map((s) => s.station).join(', ')}. Worth checking they were reachable.`;
    }
  }

  return null;
};

export const formatMoney = fmt;
export const MATERIAL_THRESHOLD_PCT = MATERIAL_PCT;
