/* ==========================================================================
   Expenses — what the café spends, not just what it takes in.

   Revenue has always had a home (bills). Outgoings never did, so the only
   answer to "are we actually profitable" was to keep a separate spreadsheet
   and hope it stayed in sync. This is one table, one café, one ledger.

   Category is free text with suggestions, not a lookup table — the same
   choice made for software/gaming categories elsewhere in this schema. The
   categories a café spends against (Salary, Rent, Stock, Maintenance…) are
   its own list and differ café to café; making an owner administer a
   category master before they can log a purchase is a gate, not a feature.

   Void, never deleted — the same rule bills and sessions already follow.
   A café's accounts should never have a hole where a spend used to be with
   no trace of it having existed.
   ========================================================================== */
export const initializeExpenses = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      expense_id SERIAL PRIMARY KEY,
      cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
      category VARCHAR(60) NOT NULL,
      description VARCHAR(255),
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      currency VARCHAR(8) NOT NULL DEFAULT 'XP',
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','VOID')),
      void_reason VARCHAR(255),
      created_by VARCHAR(255),
      voided_by VARCHAR(255),
      voided_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // The two shapes every read needs: a café's spend in a date range, and its
  // spend by category. One index serves both — category rollups still scan
  // a single café's slice, never the whole table.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_expenses_cafe_date
      ON expenses (cafe_id, expense_date DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_expenses_cafe_category
      ON expenses (cafe_id, category)
  `);

  console.log('✅ Expense tables created/verified');
};

export default { initializeExpenses };
