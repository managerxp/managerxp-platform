/*
 * Provider abstraction.
 *
 * ── The important design decision in CafeXP AI ──────────────────────────────
 *
 * The model never sources a number. Every figure in an answer is computed by
 * ai.tools.js from SQL and composed into prose by ai.analysis.js *before* any
 * provider is called. A provider's only job is to rewrite that prose more
 * naturally.
 *
 * That is what makes "must not hallucinate business data" a property of the
 * architecture rather than an instruction in a prompt. A prompt that says
 * "don't invent figures" is a request; a pipeline where the model is handed
 * finished sentences and asked only to improve their wording cannot invent a
 * figure, because it is never asked to produce one.
 *
 * It also means the feature works with no provider configured at all. The
 * `deterministic` provider returns the composed analysis unchanged — the
 * answer is less fluent and exactly as correct. A café that has not bought an
 * API key still gets working operational intelligence.
 */

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 400);

/**
 * The instruction every provider is given. Kept here so the constraint is
 * stated once and cannot drift between providers.
 */
const SYSTEM_PROMPT = [
  'You rewrite short operational summaries for a gaming café owner.',
  '',
  'You will be given an analysis that has ALREADY been computed from the café database.',
  'Rewrite it so it reads naturally and concisely.',
  '',
  'Absolute rules:',
  '- Never introduce a number, percentage, date, station, product or customer that is not in the input.',
  '- Never soften or strengthen a claim the input makes.',
  '- If the input says data is missing, say so plainly. Do not offer a guess.',
  '- No preamble, no sign-off, no motivational advice, no generic business tips.',
  '- Two or three short paragraphs at most. Plain sentences.',
  '- Write in British English.'
].join('\n');

/* ==========================================================================
   PROVIDERS
   ========================================================================== */

/** No external call. Returns the composed analysis untouched. */
const deterministicProvider = {
  name: 'deterministic',
  configured: true,
  async narrate({ analysis }) {
    return { text: analysis, tokens: null, model: 'deterministic' };
  }
};

/** Anthropic Messages API. */
const anthropicProvider = {
  name: 'anthropic',
  get configured() { return !!process.env.ANTHROPIC_API_KEY; },
  async narrate({ analysis, question }) {
    const model = process.env.AI_MODEL || 'claude-sonnet-5';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: `Question asked: ${question}\n\nComputed analysis:\n${analysis}`
          }]
        })
      });

      if (!res.ok) throw new Error(`provider returned ${res.status}`);
      const body = await res.json();
      const text = (body.content || []).map((c) => c.text).filter(Boolean).join('\n').trim();
      if (!text) throw new Error('provider returned no text');

      return {
        text,
        model,
        tokens: body.usage
          ? { input: body.usage.input_tokens, output: body.usage.output_tokens }
          : null
      };
    } finally {
      clearTimeout(timer);
    }
  }
};

/** OpenAI Chat Completions API. */
const openaiProvider = {
  name: 'openai',
  get configured() { return !!process.env.OPENAI_API_KEY; },
  async narrate({ analysis, question }) {
    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Question asked: ${question}\n\nComputed analysis:\n${analysis}` }
          ]
        })
      });

      if (!res.ok) throw new Error(`provider returned ${res.status}`);
      const body = await res.json();
      const text = body.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('provider returned no text');

      return {
        text,
        model,
        tokens: body.usage
          ? { input: body.usage.prompt_tokens, output: body.usage.completion_tokens }
          : null
      };
    } finally {
      clearTimeout(timer);
    }
  }
};

/** Google Gemini — generateContent API. */
const geminiProvider = {
  name: 'gemini',
  get configured() { return !!process.env.GEMINI_API_KEY; },
  async narrate({ analysis, question }) {
    const model = process.env.AI_MODEL || 'gemini-2.0-flash';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
              role: 'user',
              parts: [{ text: `Question asked: ${question}\n\nComputed analysis:\n${analysis}` }]
            }],
            generationConfig: { maxOutputTokens: MAX_TOKENS }
          })
        }
      );

      if (!res.ok) throw new Error(`provider returned ${res.status}`);
      const body = await res.json();
      const text = ((body.candidates || [])[0]?.content?.parts || [])
        .map((p) => p.text).filter(Boolean).join('\n').trim();
      if (!text) throw new Error('provider returned no text');

      return {
        text,
        model,
        tokens: body.usageMetadata
          ? { input: body.usageMetadata.promptTokenCount, output: body.usageMetadata.candidatesTokenCount }
          : null
      };
    } finally {
      clearTimeout(timer);
    }
  }
};

const PROVIDERS = {
  deterministic: deterministicProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider
};

/** The provider named by AI_PROVIDER, or deterministic when unset/unusable. */
export const activeProvider = () => {
  const requested = String(process.env.AI_PROVIDER || 'deterministic').toLowerCase();
  const provider = PROVIDERS[requested];
  if (!provider) return deterministicProvider;
  if (!provider.configured) return deterministicProvider;
  return provider;
};

/**
 * Narrate an analysis, falling back rather than failing.
 *
 * If the provider errors or times out, the deterministic text is returned. A
 * café asking why revenue moved should still get its answer when an external
 * API is having a bad day — the analysis was never the model's work.
 */
export const narrate = async ({ analysis, question }) => {
  const provider = activeProvider();

  if (provider.name === 'deterministic') {
    return { text: analysis, provider: 'deterministic', model: 'deterministic', tokens: null, degraded: false };
  }

  try {
    const result = await provider.narrate({ analysis, question });
    return { ...result, provider: provider.name, degraded: false };
  } catch (error) {
    // Logged for operators; never surfaced to the caller.
    console.error(`[ai] provider ${provider.name} failed: ${error.message}`);
    return {
      text: analysis,
      provider: provider.name,
      model: 'deterministic-fallback',
      tokens: null,
      degraded: true
    };
  }
};

export const providerHealth = () => {
  const provider = activeProvider();
  return {
    provider: provider.name,
    model: provider.name === 'deterministic'
      ? 'deterministic'
      : (process.env.AI_MODEL || 'provider default'),
    // Never report whether a key looks valid, only that one is present.
    configured: provider.name !== 'deterministic',
    available: Object.keys(PROVIDERS)
  };
};
