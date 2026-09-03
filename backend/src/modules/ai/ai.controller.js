import { ask, logUsage } from './ai.service.js';
import { resolveScope } from './ai.scope.js';
import { providerHealth } from './ai.providers.js';
import { recordAudit } from '../../config/audit.js';

/*
 * HTTP layer for CafeXP AI.
 *
 * Nothing internal reaches the caller: no SQL, no stack trace, no provider
 * error, no key. A café owner sees a sentence they can act on; the detail goes
 * to the server log.
 */

/* ---- rate limiting ------------------------------------------------------ */
/*
 * Per café, in memory. One user holding the Enter key must not be able to run
 * unbounded analytical queries — or, once a provider is configured, unbounded
 * spend. A process restart resets it, which is acceptable for a limit whose
 * job is stopping runaway loops rather than adversaries.
 */
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20);
const buckets = new Map();

const rateLimited = (cafeId) => {
  const now = Date.now();
  const bucket = buckets.get(cafeId) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  buckets.set(cafeId, bucket);
  return bucket.count > MAX_PER_WINDOW;
};

// POST /api/ai/ask   { question, conversation_id? }
export const askController = async (req, res) => {
  const scope = resolveScope(req);

  /*
   * A request that cannot be tied to a café is refused rather than widened.
   * Widening it to "all cafés" is precisely the cross-tenant read the whole
   * module is built to prevent.
   */
  if (!scope.usable) {
    return res.status(403).json({
      success: false,
      message: 'This account is not linked to a café, so there is no data to analyse.'
    });
  }

  if (rateLimited(scope.cafeId)) {
    return res.status(429).json({
      success: false,
      message: 'Too many questions at once. Give it a moment and try again.'
    });
  }

  const question = req.body?.question;

  // The conversation key is scoped to the café and actor, so one café's
  // follow-up can never inherit another's period.
  const conversationKey = req.body?.conversation_id
    ? `${scope.cafeId}:${scope.actorLabel}:${String(req.body.conversation_id).slice(0, 64)}`
    : null;

  try {
    const result = await ask({ question, scope, conversationKey });

    await logUsage({ scope, question, result, ok: true });

    // Asking is a read, so it is recorded but not flagged sensitive.
    await recordAudit(req, {
      action: 'ai.ask',
      category: 'system',
      entity: 'ai',
      summary: `Asked CafeXP AI: ${String(question).slice(0, 160)}`,
      meta: { tools: result.tools_used, confidence: result.confidence, provider: result.provider }
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;

    if (status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }

    // Everything else is logged in full and reported plainly.
    console.error('[ai] ask failed:', error);
    await logUsage({ scope, question, ok: false, errorMessage: error.message });

    res.status(500).json({
      success: false,
      message: "I couldn't retrieve the café data required to answer that. Please try again."
    });
  }
};

// GET /api/ai/health
export const healthController = async (req, res) => {
  const scope = resolveScope(req);
  res.status(200).json({
    success: true,
    data: {
      ...providerHealth(),
      cafe_scoped: scope.usable,
      // Stated so an operator knows answers still work without a key.
      note: providerHealth().configured
        ? 'A model is configured; it rewrites the analysis but never sources figures.'
        : 'No model configured. Answers are generated deterministically from the database.'
    }
  });
};

// GET /api/ai/suggestions — starter questions the data can actually answer
export const suggestionsController = async (req, res) => {
  res.status(200).json({
    success: true,
    data: [
      { text: 'Why was revenue lower yesterday?', area: 'revenue' },
      { text: 'Compare this week with last week', area: 'revenue' },
      { text: 'When is the café busiest?', area: 'operations' },
      { text: 'Which stations underperform?', area: 'stations' },
      { text: 'Which products sell the most?', area: 'fnb' },
      { text: 'How many sessions did we have yesterday?', area: 'sessions' },
      { text: 'What is our average session duration?', area: 'sessions' },
      { text: 'Which customers are returning most frequently?', area: 'customers' },
      { text: 'Are we over-discounting?', area: 'billing' },
      { text: 'Why did F&B revenue change?', area: 'fnb' }
    ]
  });
};
