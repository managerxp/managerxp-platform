/* ==========================================================================
   Time-based pricing — peak, off-peak, weekend and happy hours.

   The Gaming Price Master answers "what does an hour of PS5 cost". It has no
   concept of *when*, so a café that is packed on Saturday night and empty on
   Tuesday afternoon had one price for both. This table is the "when" layer:
   a set of windows that adjust the base price, evaluated the moment a session
   starts.

   Deliberately a separate table rather than more columns on gaming_prices.
   A café typically has a handful of windows ("Weekends", "Happy Hour",
   "Weekday mornings") that apply across many priced items — folding them into
   gaming_prices would mean re-entering the same weekend surcharge against
   every game and session length combination, and keeping them in sync by hand
   forever after.

   ── How a rule matches ────────────────────────────────────────────────────
   days         which weekdays it covers (0 = Sunday … 6 = Saturday, matching
                JavaScript's getDay() so the two ends agree without a mapping)
   start_time   when the window opens
   end_time     when it closes; if it is not after start_time the window is
                understood to run past midnight into the following day

   ── What it applies to ────────────────────────────────────────────────────
   software_id  narrows the rule to one game, or
   category     narrows it to a station category (Pool, PS5, VR)
   Both NULL means the rule covers all gaming, which is the common case.

   ── What it does to the price ─────────────────────────────────────────────
   PERCENT  a signed adjustment: +25 for a peak surcharge, -30 for happy hour
   FIXED    an absolute price for the block, replacing the master's price

   ── Which rule wins ───────────────────────────────────────────────────────
   priority, lowest number first, then the most specific rule, then the
   oldest. Exactly one rule ever applies — overlapping windows do not compound,
   because stacked percentages are close to impossible for an owner to predict
   and the failure mode is charging a customer something nobody intended.
   ========================================================================== */
export const initializePricingRules = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS pricing_rules (
      rule_id SERIAL PRIMARY KEY,
      cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,

      /* Presentation only — what the owner calls this window. The engine does
         not branch on it; a "Happy Hour" is just a rule with a negative
         percentage, which is why adding a new kind of window never needs
         code. */
      rule_kind VARCHAR(16) NOT NULL DEFAULT 'CUSTOM'
        CHECK (rule_kind IN ('PEAK','OFFPEAK','HAPPY','WEEKEND','CUSTOM')),

      /* 0 = Sunday … 6 = Saturday. An empty set would match nothing and is
         almost certainly a half-finished rule rather than an intent. */
      days SMALLINT[] NOT NULL CHECK (
        array_length(days, 1) BETWEEN 1 AND 7
        AND days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
      ),

      start_time TIME NOT NULL,
      end_time   TIME NOT NULL,

      -- NULL/NULL = all gaming. At most one of the two may narrow the rule.
      software_id INTEGER REFERENCES software_master(software_id) ON DELETE CASCADE,
      category VARCHAR(64),
      CONSTRAINT pricing_rules_one_scope CHECK (
        software_id IS NULL OR category IS NULL
      ),

      adjust_type VARCHAR(16) NOT NULL
        CHECK (adjust_type IN ('PERCENT','FIXED')),
      adjust_value NUMERIC(10,2) NOT NULL,

      /* A percentage may not take more than the whole price away, and a fixed
         price may not be negative. Without this a typo turns into a café
         paying its customers to play. */
      CONSTRAINT pricing_rules_value_shape CHECK (
        (adjust_type = 'PERCENT' AND adjust_value >= -100 AND adjust_value <= 1000)
        OR (adjust_type = 'FIXED' AND adjust_value >= 0)
      ),

      priority INTEGER NOT NULL DEFAULT 100,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','INACTIVE')),

      /*
       * Which kind of line on the bill this window touches.
       *
       * The original table could only describe gaming, because software_id
       * and category are both gaming concepts — so "10% off food between 3
       * and 5" was not expressible at all. This is the missing dimension:
       * GAMING is table time, FNB is the kitchen and the fridge, SHOP is
       * merchandise, ALL is the whole bill.
       *
       * Gaming's two narrowing columns only mean anything under GAMING. A
       * rule scoped to food that also named a pool table would be silently
       * unmatchable, which reads to an owner as the rule simply not working.
       */
      applies_to VARCHAR(16) NOT NULL DEFAULT 'GAMING'
        CHECK (applies_to IN ('GAMING','FNB','SHOP','ALL')),
      CONSTRAINT pricing_rules_scope_is_gaming CHECK (
        applies_to = 'GAMING' OR (software_id IS NULL AND category IS NULL)
      ),

      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
   * Migration for tables that predate applies_to.
   *
   * The column defaults to GAMING, which is exactly what every rule created
   * before this existed actually meant — the engine had no other kind of line
   * to match against — so existing windows keep behaving identically.
   */
  await client.query(`
    ALTER TABLE pricing_rules
      ADD COLUMN IF NOT EXISTS applies_to VARCHAR(16) NOT NULL DEFAULT 'GAMING'
  `);

  /* Constraints have no IF NOT EXISTS, so they are added only when absent —
     re-running this on an already-migrated database must not error. */
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pricing_rules_applies_to_check'
      ) THEN
        ALTER TABLE pricing_rules
          ADD CONSTRAINT pricing_rules_applies_to_check
          CHECK (applies_to IN ('GAMING','FNB','SHOP','ALL'));
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pricing_rules_scope_is_gaming'
      ) THEN
        ALTER TABLE pricing_rules
          ADD CONSTRAINT pricing_rules_scope_is_gaming
          CHECK (applies_to = 'GAMING' OR (software_id IS NULL AND category IS NULL));
      END IF;
    END $$;
  `);

  /* Every lookup is "the active rules for this café, best first" — the engine
     reads the whole small set and matches in JavaScript, because a day/time
     window that wraps past midnight is not something SQL expresses cleanly
     enough to be worth the index. */
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pricing_rules_cafe
      ON pricing_rules (cafe_id, status, priority)
  `);

  /* The rule that applied is snapshotted onto the session, exactly as the
     rate and the membership discount already are. A session that started
     during happy hour stays priced at happy hour even after the window
     closes, the rule is edited, or the rule is deleted outright. */
  await client.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS pricing_rule_id INTEGER,
      ADD COLUMN IF NOT EXISTS pricing_rule_label VARCHAR(160),
      ADD COLUMN IF NOT EXISTS base_rate_per_hour NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS base_flat_amount NUMERIC(10,2)
  `);

  console.log('✅ Time-based pricing rules created/verified');
};

export default { initializePricingRules };
