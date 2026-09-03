import pool from '../../config/database.js';
import { runTool } from './ai.tools.js';
import { resolvePeriod, resolveHourWindow, comparisonFor, defaultPeriod } from './ai.dates.js';
import { detectIntent, isFollowUp } from './ai.intent.js';
import { narrate } from './ai.providers.js';
import {
  attributeRevenueChange, findHourConcentration, buildEvidence,
  composeRevenueAnalysis, suggestNextStep, assessConfidence, formatMoney, formatHour
} from './ai.analysis.js';

/*
 * The pipeline.
 *
 *   question → intent → period → tools → validation → analysis → narration
 *
 * Every step before narration is deterministic and reads only from the
 * database. The provider is called last, with prose that is already true.
 */

const MAX_QUESTION_LENGTH = 500;

/** A short in-memory conversation context, so follow-ups keep their period. */
const conversations = new Map();
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const MAX_CONVERSATIONS = 500;

const rememberContext = (key, context) => {
  if (conversations.size > MAX_CONVERSATIONS) {
    // Drop the oldest rather than grow without bound.
    const oldest = conversations.keys().next().value;
    conversations.delete(oldest);
  }
  conversations.set(key, { ...context, at: Date.now() });
};

const recallContext = (key) => {
  const found = conversations.get(key);
  if (!found) return null;
  if (Date.now() - found.at > CONVERSATION_TTL_MS) {
    conversations.delete(key);
    return null;
  }
  return found;
};

/** Everything the answer needs when there is simply nothing to report on. */
const noData = (question, period, reason) => ({
  question,
  answer: reason,
  summary: null,
  suggested_next_step: null,
  confidence: 'low',
  period: { start: period.from, end: period.to, label: period.label },
  comparison: null,
  evidence: [],
  tools_used: [],
  provider: 'deterministic'
});

/**
 * Answer a question about the café.
 *
 * `scope` comes from the authenticated token — see ai.scope.js. It is never
 * taken from the request body.
 */
export const ask = async ({ question, scope, conversationKey, now }) => {
  const started = Date.now();
  const trimmed = String(question || '').trim();

  if (!trimmed) {
    throw Object.assign(new Error('Ask a question about the café'), { status: 400 });
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw Object.assign(
      new Error(`Keep the question under ${MAX_QUESTION_LENGTH} characters`),
      { status: 400 }
    );
  }

  const cafeId = scope.cafeId;
  const prior = conversationKey ? recallContext(conversationKey) : null;

  /* ---- period: server clock only, never the model ---- */
  let period = resolvePeriod(trimmed, { now });
  if (!period && prior && isFollowUp(trimmed)) {
    // A follow-up inherits the window rather than silently defaulting.
    period = prior.period;
  }
  if (!period) period = defaultPeriod({ now });

  const hourWindow = resolveHourWindow(trimmed) || (isFollowUp(trimmed) ? prior?.hourWindow : null);
  const comparison = comparisonFor(period);
  let intent = detectIntent(trimmed);

  /*
   * A follow-up that names no subject of its own keeps the previous one.
   * "And what about between 9 and 11pm?" after a question about busy hours is
   * still about busy hours — falling back to a revenue overview would quietly
   * answer a different question than the one asked.
   */
  if (intent.fallback && prior && prior.intentDetail && isFollowUp(trimmed)) {
    intent = prior.intentDetail;
  }

  /* ---- run the tools this intent needs ---- */
  const args = {
    cafeId,
    from: period.from,
    to: period.to,
    prevFrom: comparison.from,
    prevTo: comparison.to,
    startHour: hourWindow?.startHour,
    endHour: hourWindow?.endHour
  };

  const results = {};
  const toolsUsed = [];
  for (const name of intent.tools) {
    try {
      results[name] = await runTool(name, args);
      toolsUsed.push(name);
    } catch (error) {
      // One tool failing must not lose the whole answer; the analysis simply
      // has less to work with and says so through lower confidence.
      console.error(`[ai] tool ${name} failed: ${error.message}`);
    }
  }

  /* ---- validation: refuse rather than narrate nothing ---- */
  const rev = results.compare_revenue || null;
  const revenueSummary = results.get_revenue_summary || rev?.current || null;

  /*
   * Whether anything was found at all.
   *
   * This has to consider whichever tools the intent actually ran, not a fixed
   * list: a peak-hours question never touches revenue, so checking only
   * revenue and sessions declared "no trade" on a café that was plainly
   * trading. Each tool reports its own emptiness.
   */
  const anyActivity =
    (revenueSummary && (revenueSummary.bills > 0 || revenueSummary.revenue > 0)) ||
    (results.get_session_summary && results.get_session_summary.sessions > 0) ||
    (results.get_fnb_summary && results.get_fnb_summary.orders > 0) ||
    (results.get_product_sales || []).length > 0 ||
    (results.get_customer_summary || []).length > 0 ||
    (results.get_payment_summary || []).length > 0 ||
    (results.get_peak_hours || []).some((h) => h.sessions > 0) ||
    (results.get_hourly_revenue || []).some((h) => h.revenue > 0) ||
    (results.get_station_utilization || []).some((s) => s.sessions > 0);

  if (!anyActivity) {
    return {
      ...noData(
        trimmed, period,
        `There is no recorded trade for ${period.label} — no bills, sessions or orders. ` +
        `I can't explain a figure that isn't there.`
      ),
      duration_ms: Date.now() - started
    };
  }

  /* ---- analysis ---- */
  let analysisText = '';
  let evidence = [];
  let nextStep = null;
  let attribution = null;
  let concentration = null;

  if (rev) {
    attribution = attributeRevenueChange(rev);

    if (intent.causal && results.get_hourly_revenue) {
      const prevHours = await runTool('get_hourly_revenue', {
        cafeId, from: comparison.from, to: comparison.to
      }).catch(() => null);
      if (prevHours) {
        concentration = findHourConcentration(results.get_hourly_revenue, prevHours);
      }
    }

    analysisText = composeRevenueAnalysis({
      comparison: rev,
      attribution,
      concentration,
      sessions: results.get_session_summary,
      basis: comparison.basis,
      periodLabel: period.label,
      refunds: results.get_refund_summary,
      discounts: results.get_discount_summary
    });

    evidence = buildEvidence(rev, {
      sessions: results.get_session_summary,
      concentration,
      refunds: results.get_refund_summary
    });

    nextStep = suggestNextStep({
      attribution,
      concentration,
      stations: results.get_station_utilization,
      sessions: results.get_session_summary
    });
  } else {
    analysisText = describeNonRevenue(intent, results, period, hourWindow);
    evidence = nonRevenueEvidence(intent, results);
    nextStep = nonRevenueNextStep(intent, results);
  }

  if (!analysisText) {
    return {
      ...noData(
        trimmed, period,
        `I can see activity for ${period.label}, but not enough detail to answer that ` +
        `confidently. Try asking about revenue, sessions, stations or F&B.`
      ),
      duration_ms: Date.now() - started
    };
  }

  /* ---- narration: prose only, numbers already fixed ---- */
  const narrated = await narrate({ analysis: analysisText, question: trimmed });

  const confidence = assessConfidence({
    bills: revenueSummary?.bills || 0,
    sessions: results.get_session_summary?.sessions || 0,
    hasCause: !!(attribution || concentration),
    sampleWindows: !!rev
  });

  if (conversationKey) {
    rememberContext(conversationKey, {
      period, hourWindow, intent: intent.id, intentDetail: intent
    });
  }

  return {
    question: trimmed,
    answer: narrated.text,
    summary: attribution
      ? `The largest movement is in ${attribution.leader.label}.`
      : null,
    suggested_next_step: nextStep,
    confidence,
    period: { start: period.from, end: period.to, label: period.label },
    comparison: rev
      ? { type: comparison.type, basis: comparison.basis, start: comparison.from, end: comparison.to }
      : null,
    evidence,
    tools_used: toolsUsed,
    provider: narrated.provider,
    model: narrated.model,
    degraded: narrated.degraded,
    tokens: narrated.tokens,
    duration_ms: Date.now() - started
  };
};

/* ==========================================================================
   NON-REVENUE NARRATION
   ========================================================================== */
const describeNonRevenue = (intent, results, period, hourWindow) => {
  const lines = [];

  if (intent.id === 'stations' && results.get_station_utilization) {
    const stations = results.get_station_utilization;
    if (!stations.length) return 'No stations are registered for this café yet.';

    const active = stations.filter((s) => s.is_active);
    const used = active.filter((s) => s.sessions > 0);
    const idle = active.filter((s) => s.sessions === 0);
    const best = used[0];

    lines.push(
      `Across ${period.label}, ${used.length} of ${active.length} active station(s) took sessions.`
    );
    if (best) {
      lines.push(
        `${best.station} led on ${best.play_hours} play hours across ${best.sessions} session(s), ` +
        `${best.utilisation_pct}% of the window.`
      );
    }
    if (idle.length) {
      lines.push(
        `${idle.length} took none at all: ${idle.slice(0, 5).map((s) => s.station).join(', ')}.`
      );
    }
    return lines.join(' ');
  }

  if (intent.id === 'peak_hours' && results.get_peak_hours) {
    const hours = results.get_peak_hours.filter((h) => h.sessions > 0);
    if (!hours.length) return `No sessions were started during ${period.label}, so there is no peak to report.`;

    const sorted = [...hours].sort((a, b) => b.sessions - a.sessions);
    const top = sorted.slice(0, 3);
    lines.push(
      `Over ${period.label} the busiest hours by sessions started were ` +
      top.map((h) => `${formatHour(h.hour)} (${h.sessions})`).join(', ') + '.'
    );

    const revHours = results.get_hourly_revenue || [];
    const topRev = [...revHours].sort((a, b) => b.revenue - a.revenue)[0];
    if (topRev && topRev.revenue > 0) {
      lines.push(
        `The strongest hour for revenue was ${formatHour(topRev.hour)} at ` +
        `${formatMoney(topRev.revenue)} XP.`
      );
    }
    return lines.join(' ');
  }

  if (intent.id === 'products' && results.get_product_sales) {
    const products = results.get_product_sales;
    if (!products.length) return `Nothing was sold through F&B during ${period.label}.`;
    const top = products.slice(0, 5);
    lines.push(
      `Over ${period.label} the strongest sellers were ` +
      top.map((p) => `${p.product} (${p.quantity} sold, ${formatMoney(p.revenue)} XP)`).join(', ') + '.'
    );
    const tail = products.filter((p) => p.quantity <= 1);
    if (tail.length) {
      lines.push(`${tail.length} product(s) moved one unit or fewer.`);
    }
    return lines.join(' ');
  }

  if (intent.id === 'sessions' && results.get_session_summary) {
    const s = results.get_session_summary;
    if (!s.sessions) return `No sessions were recorded during ${period.label}.`;
    lines.push(
      `${s.sessions} session(s) ran during ${period.label}` +
      (hourWindow ? ` within ${hourWindow.label}` : '') +
      `, totalling ${s.play_hours} play hours across ${s.stations_used} station(s).`
    );
    lines.push(
      `The average session ran ${s.average_minutes} minutes. ` +
      `${s.guest_sessions} were guests and ${s.registered_sessions} registered customers.`
    );
    return lines.join(' ');
  }

  if (intent.id === 'customers' && results.get_customer_summary) {
    const customers = results.get_customer_summary;
    if (!customers.length) return `No registered customers played during ${period.label} — any sessions were guests.`;
    const top = customers.slice(0, 5);
    lines.push(
      `The most frequent visitors over ${period.label} were ` +
      top.map((c) => `${c.customer} (${c.visits} visit${c.visits === 1 ? '' : 's'})`).join(', ') + '.'
    );
    return lines.join(' ');
  }

  if (intent.id === 'payments') {
    const methods = results.get_payment_summary || [];
    if (!methods.length) return `No payments were taken during ${period.label}.`;
    lines.push(
      `Payments over ${period.label}: ` +
      methods.map((m) => `${m.method} ${formatMoney(m.taken)} XP`).join(', ') + '.'
    );
    const refunds = results.get_refund_summary;
    if (refunds && refunds.refunds > 0) {
      lines.push(`${formatMoney(refunds.amount)} XP was refunded across ${refunds.refunds} bill(s).`);
    }
    const discounts = results.get_discount_summary;
    if (discounts && discounts.amount > 0) {
      lines.push(
        `${formatMoney(discounts.amount)} XP was discounted on ${discounts.discounted_bills} bill(s).`
      );
    }
    return lines.join(' ');
  }

  if (intent.id === 'fnb' && results.get_fnb_summary) {
    const f = results.get_fnb_summary;
    if (!f.orders) return `No F&B orders were placed during ${period.label}.`;
    lines.push(
      `${f.orders} F&B order(s) over ${period.label} totalling ${formatMoney(f.revenue)} XP, ` +
      `averaging ${formatMoney(f.average_order)} XP per order.`
    );
    if (f.cancelled) lines.push(`${f.cancelled} were cancelled.`);
    const products = results.get_product_sales || [];
    if (products.length) {
      lines.push(`The strongest seller was ${products[0].product}.`);
    }
    return lines.join(' ');
  }

  return '';
};

const nonRevenueEvidence = (intent, results) => {
  const evidence = [];
  const add = (label, metric, value, raw, note) =>
    evidence.push({ label, metric, value, raw, change: null, change_label: note || null });

  if (results.get_session_summary) {
    const s = results.get_session_summary;
    add('Sessions', 'session_count', String(s.sessions), s.sessions);
    add('Play time', 'play_hours', `${s.play_hours} h`, s.play_hours);
    if (s.average_minutes) add('Average session', 'avg_minutes', `${s.average_minutes} min`, s.average_minutes);
  }
  if (results.get_fnb_summary && results.get_fnb_summary.orders) {
    const f = results.get_fnb_summary;
    add('F&B orders', 'fnb_orders', String(f.orders), f.orders);
    add('F&B revenue', 'fnb_revenue', `${formatMoney(f.revenue)} XP`, f.revenue);
  }
  if (results.get_station_utilization) {
    const active = results.get_station_utilization.filter((s) => s.is_active);
    const idle = active.filter((s) => s.sessions === 0);
    add('Active stations', 'stations_active', String(active.length), active.length);
    if (idle.length) add('Took no sessions', 'stations_idle', String(idle.length), idle.length);
  }
  return evidence;
};

const nonRevenueNextStep = (intent, results) => {
  if (intent.id === 'stations' && results.get_station_utilization) {
    const idle = results.get_station_utilization.filter((s) => s.is_active && s.sessions === 0);
    if (idle.length) {
      return `Check whether ${idle.slice(0, 3).map((s) => s.station).join(', ')} ` +
        `were reachable — they are active but took no sessions.`;
    }
  }
  if (intent.id === 'products' && results.get_product_sales) {
    const slow = results.get_product_sales.filter((p) => p.quantity <= 1);
    if (slow.length >= 3) {
      return `${slow.length} products barely moved. Worth reviewing whether they earn their shelf space.`;
    }
  }
  return null;
};

/* ==========================================================================
   USAGE LOG
   ========================================================================== */
/**
 * Record what was asked and what it cost, never the answer's raw data or any
 * secret. Failures here never break the answer.
 */
export const logUsage = async ({ scope, question, result, ok, errorMessage }) => {
  try {
    await pool.query(
      `INSERT INTO ai_usage
         (cafe_id, actor_label, actor_kind, staff_id, question, intent_tools,
          provider, model, confidence, duration_ms, input_tokens, output_tokens,
          success, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        scope.cafeId,
        scope.actorLabel,
        scope.actorKind,
        scope.staffId,
        String(question).slice(0, 500),
        result?.tools_used ? result.tools_used.join(',') : null,
        result?.provider || null,
        result?.model || null,
        result?.confidence || null,
        result?.duration_ms || null,
        result?.tokens?.input || null,
        result?.tokens?.output || null,
        ok !== false,
        errorMessage ? String(errorMessage).slice(0, 300) : null
      ]
    );
  } catch (error) {
    console.error('[ai] usage log failed:', error.message);
  }
};
