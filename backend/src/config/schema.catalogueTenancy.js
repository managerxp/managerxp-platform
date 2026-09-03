/* ==========================================================================
   Catalogue tenancy — whose games, whose session lengths, whose prices.

   These three tables predate multi-tenancy and carried no cafe_id at all, so
   every café on the platform shared one catalogue. In practice that meant a
   café could see — and price against — another café's pool table, and the
   rates one owner set were the rates everybody got. For gaming_prices in
   particular that is not a cosmetic leak: it is one café's commercial terms
   published to its competitors.

   The fix is not "scope everything to a café", because part of this really is
   shared on purpose:

   software_master   NULL cafe_id = the platform catalogue ManagerXP publishes,
                     where artwork is uploaded centrally and every café draws
                     from the same source. A row with a cafe_id is a *house
                     activity* — the pool table or dartboard an owner added
                     themselves, which was never ours to publish and is nobody
                     else's business.

   session_master    NULL cafe_id = the stock lengths (30 Minutes, 1 Hour) that
                     every café starts with. A café adding "Night Pass" owns it.

   gaming_prices     always belongs to a café. There is no such thing as a
                     shared price: this is the money.

   ── Backfill ──────────────────────────────────────────────────────────────
   Existing rows are assigned to the café that demonstrably authored them —
   traced through the sessions that were actually sold at each price, falling
   back to the only café with stations on the floor. Platform catalogue rows
   and the stock session lengths stay shared, so no café loses anything it was
   legitimately using.
   ========================================================================== */

export const initializeCatalogueTenancy = async (client) => {
  await client.query(`
    ALTER TABLE software_master
      ADD COLUMN IF NOT EXISTS cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE
  `);
  await client.query(`
    ALTER TABLE session_master
      ADD COLUMN IF NOT EXISTS cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE
  `);
  await client.query(`
    ALTER TABLE gaming_prices
      ADD COLUMN IF NOT EXISTS cafe_id INTEGER REFERENCES cafes(cafe_id) ON DELETE CASCADE
  `);

  /*
   * Who owned the orphans.
   *
   * Only run while rows still have no café, so this is a one-time migration
   * and never touches anything created afterwards. The candidate is the café
   * that ran sessions against these prices; if nothing was ever sold, the café
   * that has stations registered; failing both, the oldest café.
   */
  const owner = await client.query(`
    SELECT COALESCE(
      (SELECT s.cafe_id FROM sessions s
        WHERE s.gaming_price_id IS NOT NULL AND s.cafe_id IS NOT NULL
        GROUP BY s.cafe_id ORDER BY COUNT(*) DESC, s.cafe_id ASC LIMIT 1),
      (SELECT p.cafe_id FROM pcs p
        WHERE p.cafe_id IS NOT NULL
        GROUP BY p.cafe_id ORDER BY COUNT(*) DESC, p.cafe_id ASC LIMIT 1),
      (SELECT c.cafe_id FROM cafes c ORDER BY c.cafe_id ASC LIMIT 1)
    ) AS cafe_id
  `);
  const ownerCafeId = owner.rows[0]?.cafe_id ?? null;

  if (ownerCafeId) {
    // Every unowned price becomes that café's. Prices are never shared.
    const prices = await client.query(
      `UPDATE gaming_prices SET cafe_id = $1 WHERE cafe_id IS NULL RETURNING id`,
      [ownerCafeId]
    );

    /* House activities only. A platform row (is_house = false) stays shared —
       that is the catalogue whose artwork the admin side maintains. */
    const house = await client.query(
      `UPDATE software_master SET cafe_id = $1
        WHERE cafe_id IS NULL AND is_house = true RETURNING software_id`,
      [ownerCafeId]
    );

    if (prices.rowCount || house.rowCount) {
      console.log(
        `   ↳ catalogue backfill: ${prices.rowCount} price(s), ` +
        `${house.rowCount} house activity(ies) → café ${ownerCafeId}`
      );
    }
  }

  /*
   * The old uniqueness rules assumed a single tenant and would now stop a
   * second café from pricing PlayStation 5 · 1 Hour at all — its neighbour got
   * there first. Both are re-scoped so they constrain within a café, which is
   * where they were always meant to apply.
   */
  await client.query(`ALTER TABLE gaming_prices DROP CONSTRAINT IF EXISTS gaming_prices_unique_pair`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gaming_prices_unique_pair
      ON gaming_prices (cafe_id, software_id, session_master_id)
  `);

  await client.query(`DROP INDEX IF EXISTS idx_session_master_name`);
  /* Two partial indexes rather than one: NULL never equals NULL in a unique
     index, so a single index over (cafe_id, name) would happily allow five
     copies of "1 Hour" among the shared rows. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_master_name_cafe
      ON session_master (cafe_id, lower(session_name)) WHERE cafe_id IS NOT NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_master_name_shared
      ON session_master (lower(session_name)) WHERE cafe_id IS NULL
  `);

  // Every catalogue read is "this café's rows plus the shared ones".
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_gaming_prices_cafe ON gaming_prices (cafe_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_software_master_cafe ON software_master (cafe_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_session_master_cafe ON session_master (cafe_id)
  `);

  console.log('✅ Catalogue tenancy created/verified');
};

export default { initializeCatalogueTenancy };
