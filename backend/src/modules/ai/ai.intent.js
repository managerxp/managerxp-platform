/*
 * Intent detection.
 *
 * Deliberately deterministic. Sending the question to a model to decide which
 * tools to run adds a network round trip, a cost, and a failure mode — before
 * any data has been touched. The vocabulary of a café is small and closed:
 * revenue, sessions, stations, F&B, products, hours, customers. Matching it
 * here is faster, free, and cannot drift.
 *
 * The model's job comes later, and is narrower: phrasing an answer whose
 * numbers were already computed.
 */

/**
 * Each intent names the tools it needs and whether it is a "why" question —
 * a why question triggers root-cause attribution rather than a plain lookup.
 */
const INTENTS = [
  {
    id: 'revenue_explain',
    // "why was revenue lower", "what happened to revenue", "revenue drop"
    match: (q) =>
      /(revenue|takings|sales|income|money)/.test(q) &&
      /(why|explain|drop|lower|down|fell|decline|less|worse|higher|up|better|different|change)/.test(q),
    tools: ['compare_revenue', 'get_session_summary', 'get_station_utilization',
            'get_fnb_summary', 'get_hourly_revenue', 'get_discount_summary', 'get_refund_summary'],
    causal: true
  },
  {
    id: 'revenue_lookup',
    match: (q) => /(revenue|takings|sales|income|turnover|how much did we (make|take))/.test(q),
    tools: ['get_revenue_summary', 'compare_revenue'],
    causal: false
  },
  {
    id: 'fnb',
    match: (q) => /(f&b|fnb|food|drink|kitchen|snack|beverage)/.test(q),
    tools: ['get_fnb_summary', 'get_product_sales', 'compare_revenue'],
    causal: (q) => /(why|drop|lower|down|fell|decline|change)/.test(q)
  },
  {
    id: 'products',
    match: (q) => /(product|item|sell|selling|sold|stock|restock|best.?sell)/.test(q),
    tools: ['get_product_sales', 'get_fnb_summary'],
    causal: false
  },
  {
    id: 'stations',
    match: (q) =>
      /(station|pc|machine|rig|seat|terminal)/.test(q) ||
      /(utili[sz]ation|occupancy|underperform|idle)/.test(q),
    tools: ['get_station_utilization', 'get_session_summary', 'get_station_reporting'],
    causal: false
  },
  {
    id: 'peak_hours',
    match: (q) =>
      /(busiest|peak|quiet|when are we|what (time|hours)|staff|rush)/.test(q) ||
      /(best.?performing hours|which hours)/.test(q),
    tools: ['get_peak_hours', 'get_hourly_revenue'],
    causal: false
  },
  {
    id: 'sessions',
    match: (q) => /(session|play time|playtime|how long|duration|how many people)/.test(q),
    tools: ['get_session_summary', 'get_peak_hours'],
    causal: false
  },
  {
    id: 'customers',
    match: (q) => /(customer|player|member|regular|returning|loyal|visitor)/.test(q),
    tools: ['get_customer_summary', 'get_session_summary'],
    causal: false
  },
  {
    id: 'payments',
    match: (q) => /(payment|cash|card|upi|wallet|tender|refund|discount)/.test(q),
    tools: ['get_payment_summary', 'get_refund_summary', 'get_discount_summary'],
    causal: false
  }
];

/**
 * Classify a question.
 *
 * Falls back to a revenue overview rather than refusing, because "how are we
 * doing" is the most common thing an owner types and it has a good answer.
 */
export const detectIntent = (question) => {
  const q = String(question || '').toLowerCase();

  for (const intent of INTENTS) {
    if (intent.match(q)) {
      return {
        id: intent.id,
        tools: intent.tools,
        causal: typeof intent.causal === 'function' ? intent.causal(q) : intent.causal,
        fallback: false
      };
    }
  }

  // Nothing matched. Flagged so a follow-up can inherit the previous intent
  // rather than silently switching the subject to revenue.
  return {
    id: 'overview',
    tools: ['get_revenue_summary', 'compare_revenue', 'get_session_summary'],
    causal: false,
    fallback: true
  };
};

/**
 * Whether the question refers back to an earlier one.
 *
 * A follow-up like "what about between 6 and 9pm" carries no period of its
 * own; the service reuses the previous period rather than silently defaulting
 * to the last 7 days and answering about the wrong window.
 */
export const isFollowUp = (question) => {
  const q = String(question || '').toLowerCase().trim();
  if (/^(and|what about|how about|why|and why|then)\b/.test(q)) return true;
  // Short questions with a pronoun and no subject of their own.
  if (q.split(/\s+/).length <= 8 && /\b(that|it|this|those|them|there)\b/.test(q)) return true;
  return false;
};
