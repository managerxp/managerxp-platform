# CafeXP AI

An operational intelligence layer over the CafeXP database. Not a chatbot: it
turns a question into a set of controlled analytical queries, works out what
changed and why, and returns a structured answer with the evidence attached.

---

## The decision everything else follows from

**The model never sources a number.**

Every figure is computed by the tool layer from SQL, and the explanation is
composed from those figures, *before* any AI provider is called. A provider's
only job is to rewrite finished prose more naturally.

```
question → intent → period → tools → validation → analysis → narration
                    └─────── deterministic ───────┘   └─ optional ─┘
```

This makes "must not hallucinate business data" a property of the architecture
rather than an instruction in a prompt. A prompt saying *"don't invent figures"*
is a request. A pipeline where the model is handed completed sentences and asked
only to improve their wording **cannot** invent a figure, because it is never
asked to produce one.

It also means the feature works with **no provider configured at all**. The
`deterministic` provider returns the composed analysis unchanged — less fluent,
exactly as correct. A café without an API key still gets working intelligence.

---

## Module layout

```
src/modules/ai/
├── ai.routes.js       POST /ask · GET /health · GET /suggestions
├── ai.controller.js   HTTP, rate limiting, error shaping
├── ai.service.js      the pipeline, conversation context, usage logging
├── ai.intent.js       deterministic intent detection
├── ai.dates.js        natural-language dates from the server clock
├── ai.tools.js        read-only, tenant-scoped analytical queries
├── ai.analysis.js     comparison, attribution, evidence, next step
├── ai.scope.js        tenant resolution and SQL scope fragments
└── ai.providers.js    provider abstraction
```

---

## API

### `POST /api/ai/ask`

```json
{ "question": "Why was revenue lower yesterday?", "conversation_id": "optional" }
```

A `cafe_id` in the body is **ignored**. The café comes from the authenticated
token and nowhere else.

```json
{
  "success": true,
  "data": {
    "question": "Why was revenue lower yesterday?",
    "answer": "Revenue for yesterday came in 8.4% down on the previous Tuesday…",
    "summary": "The largest movement is in Gaming.",
    "suggested_next_step": "Look at station availability between 6pm–9pm…",
    "confidence": "high",
    "period":     { "start": "…", "end": "…", "label": "yesterday" },
    "comparison": { "type": "previous_same_weekday", "basis": "the previous Tuesday" },
    "evidence": [
      { "label": "Revenue", "metric": "revenue", "value": "4,192.33 XP",
        "raw": 4192.33, "previous": 4576.10, "change": -8.4, "change_label": "-8.4%" }
    ],
    "tools_used": ["compare_revenue", "get_session_summary"],
    "provider": "deterministic",
    "confidence": "high",
    "duration_ms": 92
  }
}
```

### `GET /api/ai/health`
Reports the active provider and whether one is configured. Never reports whether
a key looks valid.

### `GET /api/ai/suggestions`
Starter questions the data can actually answer.

---

## Tenant isolation

Mandatory, and enforced in the backend — never left to the model.

The café is read from `req.actor.cafe_id`, populated by the auth guards from the
JWT. `ai.scope.js` refuses a request whose café cannot be identified rather than
widening it, which would be exactly the cross-tenant read it exists to prevent.

### What the schema can and cannot scope

Only some tables carry `cafe_id`:

> `bills` · `sessions` · `pcs` · `staff` · `floor_zones` · `discount_codes` ·
> `branches` · `subscriptions`

The rest are reached by joining:

| Table | Scoped through |
|---|---|
| `payments`, `bill_items` | `bills.cafe_id` |
| `orders`, `order_items` | `bills.cafe_id`, falling back to `pcs` by id **or name** |
| `station_telemetry` | `pcs.cafe_id` |

Two things genuinely **cannot** be scoped, because the platform models them as
global:

- **`products`** — one catalogue shared across cafés
- **`customers`** — one directory shared across cafés

Their *activity* is scopable (product sales come through orders; customer visits
come through sessions), so no trading figure leaks. Only the catalogue rows are
shared, and no tool reports a product or customer with no activity in the
caller's café.

This is stated plainly rather than implying an isolation the data model does not
provide.

---

## Permissions

CafeXP AI sits behind its own key, **`ai.ask`**, granted to Owner and Manager.

It deliberately does not ride on `reports.view` or `requireStaff`: a single
question crosses revenue, sessions, stations, F&B, customers and payments. A
cashier who may operate the till should not gain the café's whole trading
picture because an AI endpoint exists.

---

## Tools

Thirteen read-only tools. The model does not write SQL and never sees the tool
file; it selects a named tool and the SQL is fixed here. That is what stops a
question becoming a query.

```
get_revenue_summary      compare_revenue        get_hourly_revenue
get_session_summary      get_station_utilization  get_peak_hours
get_fnb_summary          get_product_sales      get_payment_summary
get_refund_summary       get_discount_summary   get_customer_summary
get_station_reporting
```

Every tool is:

- **read-only** — `SELECT` only; there is no write path in the module
- **parameterised** — no value is ever interpolated; the café id and dates bind
- **tenant-scoped** — each carries a scope clause; a tool that cannot be scoped is not written
- **bounded** — every result set has a `LIMIT`

`runTool()` looks the name up in a fixed registry and refuses anything absent,
and refuses any call without a café scope.

---

## Dates

Resolved from the **server clock**, never the model — a model has no reliable
notion of "today" and a wrong date silently poisons every number downstream.

Supported: `today` · `yesterday` · `last <weekday>` · `last N days` ·
`this/last week` · `this/last month`, plus hour windows (`6pm to 9pm`,
`evening`, `morning`).

A café's trading day is not a calendar day; `dayStartHour` shifts the boundary
so a session running past midnight belongs to the night it started.

---

## Comparison

A single day compares against **the same weekday a week earlier**, not the day
before — a café's Tuesday looks nothing like its Saturday, so "down on
yesterday" is usually noise. Longer windows compare against the preceding window
of equal length.

The basis is always stated in the answer: *"8.4% down on the previous Tuesday"*,
never a bare *"8.4% down"*.

---

## Root-cause analysis

For a "why" question the pipeline works down:

```
revenue → split by kind (gaming · F&B · shop · other)
        → largest absolute mover
        → the hour block carrying most of the move
        → sessions, station utilisation, refunds, discounts
```

Attribution picks the line that moved most **in absolute terms** — a category
that halved but was only 40 XP is not the story. It says "primarily" only when
one line carries ≥60% of the move; otherwise it says the change is spread.

Hour concentration is only reported when a window of ≤8 hours carries ≥55% of
the move, so "concentrated between 6 and 9pm" is never said about a change that
was spread evenly.

---

## Refusing to answer

The feature refuses rather than reaching for a plausible cause:

| Situation | Response |
|---|---|
| No trade in the window | *"There is no recorded trade for yesterday — no bills, sessions or orders. I can't explain a figure that isn't there."* |
| Activity but no answerable detail | *"I can see activity for … but not enough detail to answer that confidently."* |
| No prior period | *"There is no figure for the preceding period, so there is nothing to compare it against yet."* |

Confidence is gated on **volume**: a café with three bills can produce a large
percentage swing that means nothing, so low volume caps confidence at `low`.

`suggestNextStep()` returns `null` rather than generic advice. *"Consider
improving marketing"* is worse than silence — it is what a report says when it
has found nothing.

---

## Providers

```
AI_PROVIDER = deterministic | anthropic | openai | gemini
AI_MODEL    = claude-sonnet-5 | gpt-4o-mini | gemini-2.0-flash | …
ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
AI_TIMEOUT_MS  (default 20000)
AI_MAX_TOKENS  (default 400)
AI_RATE_LIMIT_PER_MINUTE (default 20)
```

Keys live in environment variables, are never committed, and never reach the
frontend. An unconfigured or failing provider **falls back to deterministic
narration** — a café asking why revenue moved still gets its answer when an
external API is having a bad day, because the analysis was never the model's
work.

---

## Cost control

- Per-café rate limit, default 20 questions/minute
- Question capped at 500 characters
- `AI_MAX_TOKENS` caps narration length
- Provider timeout, default 20s
- Every tool result is `LIMIT`ed
- Narration is a single call — there is no tool-calling loop to run away

---

## Logging

`ai_usage` records café, actor, question, tools, provider, model, confidence,
duration, tokens and success. It does **not** store the answer, the analysis,
any raw café data, or any secret — the question and its cost are enough to bill,
rate-limit and debug.

Asking is also written to the audit trail as `ai.ask`, categorised `system` and
not flagged sensitive, because it is a read.

---

## Errors

Nothing internal reaches the caller — no SQL, stack trace, provider error or
key. Provider failures degrade to deterministic narration; database failures
return *"I couldn't retrieve the café data required to answer that."*

---

## Bugs this work surfaced

Building tenant-scoped tools exposed three real defects, all fixed:

1. **Bills had no café.** `createBill` stored `cafe_id: cafe_id || null`, so
   every bill raised from the counter or a closing session belonged to no café —
   8 of 10 rows. Invisible on a single-café install, data loss on a second one.
   Now derived from the session, station or token, and existing rows backfilled.

2. **The owner JWT carried no café.** Login looked `cafe_id` up and attached it
   to the response body for the frontend, but never put it in the token — so the
   backend could never trust which café a request belonged to. Now a claim.

3. **`orders.pc_id` is unreliable**, NULL while `pc_name` is set. Scoping orders
   through the station alone lost nearly all of them; the bill is now the
   primary link.

---

## Not built, deliberately

Forecasting, anomaly detection, churn prediction, dynamic pricing, automated
daily summaries. The tool + analysis split is designed so these become new tools
and new analysis functions rather than a rewrite.

**No write capability.** The module contains no statement that is not a `SELECT`
and no route that mutates. Action-taking would be a separate, explicitly
designed capability.
