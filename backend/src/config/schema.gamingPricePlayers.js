/* ==========================================================================
   Gaming price player count — one price per game + session + player count.

   A pool table seats up to four; a PS5 pairs a second pad in before a third
   or fourth ever joins. The Gaming Price Master priced a game once regardless
   of how many were playing, so a café selling a table to four people for the
   same price as two was either undercharging the table or asking staff to do
   the multiplication by hand at the counter every time — exactly the manual
   step this column removes.

   1 stays the default and the only value most games ever need: a solo PC
   session pays no cost for a dimension it never uses. A café adds a second
   row (2 Players, 3 Players, …) only for the tables that actually carry more
   than one person — nothing forces every game onto a ladder it doesn't have.
   ========================================================================== */
export const initializeGamingPricePlayers = async (client) => {
  await client.query(`
    ALTER TABLE gaming_prices
      ADD COLUMN IF NOT EXISTS player_count SMALLINT NOT NULL DEFAULT 1
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gaming_prices_player_count_range'
      ) THEN
        ALTER TABLE gaming_prices
          ADD CONSTRAINT gaming_prices_player_count_range
          CHECK (player_count BETWEEN 1 AND 8);
      END IF;
    END $$;
  `);

  /* Widens the tenancy migration's own uniqueness rule rather than adding a
     competing index: a café can now price the same game + block once per
     player count instead of once total. */
  await client.query(`DROP INDEX IF EXISTS idx_gaming_prices_unique_pair`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gaming_prices_unique_pair
      ON gaming_prices (cafe_id, software_id, session_master_id, player_count)
  `);

  /* Snapshotted onto the session for the same reason the rate and the
     pricing-rule label already are: a table sold at the 3-player price stays
     billed for 3 even if that row on the price master is later edited or
     removed. */
  await client.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS player_count SMALLINT NOT NULL DEFAULT 1
  `);

  console.log('✅ Gaming price player-count column created/verified');
};

export default { initializeGamingPricePlayers };
