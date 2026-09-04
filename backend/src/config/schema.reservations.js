/* ==========================================================================
   Reservations — booking a station ahead of time.

   A reservation names either a specific station (`pc_id`) or a category
   ("any PC", "any PS5") — the same `category` values `pcs.category` already
   uses everywhere else pricing and grouping are scoped, rather than
   inventing a second "zone" concept. Booking a category checks capacity
   (how many stations of that type exist vs. how many are already promised
   for the overlapping window) instead of pinning a specific machine, so
   "any PS5 between 6 and 7" does not require picking one in advance.

   Check-in is deliberately a status flip only, not an auto-created session:
   starting a session needs a game/price/pricing decision this table has no
   business making. Staff check a booking in, then start the session the
   same way any walk-in session starts, from the customer or station it
   named.
   ========================================================================== */

export const initializeReservations = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      reservation_id SERIAL PRIMARY KEY,
      cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE,
      -- A specific station, or NULL to mean "any station of the category below".
      pc_id INTEGER REFERENCES pcs(pc_id) ON DELETE SET NULL,
      category VARCHAR(60),
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      guest_name VARCHAR(160),
      guest_phone VARCHAR(20),
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'CONFIRMED',
      party_size INTEGER,
      notes VARCHAR(300),
      cancelled_reason VARCHAR(160),
      checked_in_at TIMESTAMPTZ,
      created_by VARCHAR(160),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check`);
  await client.query(`
    ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
      CHECK (status IN ('CONFIRMED','CHECKED_IN','CANCELLED','NO_SHOW','COMPLETED'))
  `);
  await client.query(`ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_time_check`);
  await client.query(`
    ALTER TABLE reservations ADD CONSTRAINT reservations_time_check CHECK (end_time > start_time)
  `);
  // What is being booked: a named station, or at least a category to book one of.
  await client.query(`ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_target_check`);
  await client.query(`
    ALTER TABLE reservations ADD CONSTRAINT reservations_target_check
      CHECK (pc_id IS NOT NULL OR category IS NOT NULL)
  `);
  // Who it is for: a registered customer, or at least a name to hold it under.
  await client.query(`ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_who_check`);
  await client.query(`
    ALTER TABLE reservations ADD CONSTRAINT reservations_who_check
      CHECK (customer_id IS NOT NULL OR guest_name IS NOT NULL)
  `);

  // The overlap check filters on exactly these; a table scan per booking
  // attempt would not survive a café with any real reservation volume.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reservations_pc_time ON reservations (pc_id, start_time, end_time)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reservations_cafe_category_time ON reservations (cafe_id, category, start_time, end_time)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations (customer_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reservations_cafe_start ON reservations (cafe_id, start_time)`);

  /*
   * Store hours, on the branch rather than the café — the physical location
   * a customer books a seat at is a branch, and a business with more than
   * one location may keep different hours at each. Nullable: a branch that
   * has never set hours is treated as open around the clock, the same
   * "unset means unrestricted" default the rest of this file uses.
   */
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS opening_time TIME`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS closing_time TIME`);

  console.log('✅ Reservations table created/verified');
};
