/*
 * The Game Library.
 *
 * Distinct from `software_master`, which catalogues station *types* (a PS5, a
 * pool table, a VR rig). This is the list of actual game titles a café offers
 * on its gaming PCs, each carrying the one thing a station type never needs:
 * how to launch it. A title knows its launcher (Steam, Riot, EA, …) and the
 * handful of facts an agent needs to start it — an app id, an executable, the
 * process to watch for, the arguments to pass.
 *
 * A game belongs to a café. `pc_games` then records which of those titles is
 * actually installed on which PC, so the client can show a customer only the
 * games the machine in front of them can run.
 *
 * The launcher never learns a customer's password here. CafeXP starts the
 * launcher; the customer signs into Steam or Riot themselves. This schema
 * stores what to launch, never a credential to launch it with.
 */

/* Publisher → the launcher a café most often runs each on. Not a law of
   nature — many titles sell on several stores — but the sensible default the
   operator can override per game. Anything not matched falls back to Steam,
   which is where most PC café libraries live. */
const LAUNCHER_BY_PUBLISHER = {
  'Riot Games': 'Riot',
  'Electronic Arts (EA)': 'EA',
  'Epic Games': 'Epic',
  'Ubisoft': 'Ubisoft',
  'Activision': 'Battle.net',
  'Blizzard Entertainment': 'Battle.net',
  'Rockstar Games': 'Rockstar'
};

/* The client/agent word for how a launcher starts a title. */
const LAUNCH_TYPE = {
  Steam: 'Steam App',
  Riot: 'Riot Client',
  EA: 'EA App',
  Epic: 'Epic Games',
  Ubisoft: 'Ubisoft Connect',
  'Battle.net': 'Battle.net',
  Rockstar: 'Rockstar',
  Custom: 'Executable'
};

/* [name, publisher, category]. The launcher is derived from the publisher
   above; app id / executable / process are left for the operator to fill in
   against how each title is actually installed, rather than shipping guesses. */
const SEED = [
  ['GTA V', 'Rockstar Games', 'Action'],
  ['Red Dead Redemption 2', 'Rockstar Games', 'Action'],
  ['F1 25', 'Electronic Arts (EA)', 'Racing'],
  ['EA Sports FC 26', 'Electronic Arts (EA)', 'Sports'],
  ['Valorant', 'Riot Games', 'FPS'],
  ['League of Legends', 'Riot Games', 'MOBA'],
  ['Counter-Strike 2', 'Valve', 'FPS'],
  ['Dota 2', 'Valve', 'MOBA'],
  ['PUBG: Battlegrounds', 'Krafton', 'Battle Royale'],
  ['BGMI', 'Krafton', 'Battle Royale'],
  ['Call of Duty: Warzone', 'Activision', 'Battle Royale'],
  ['Call of Duty: Black Ops 6', 'Activision', 'FPS'],
  ['Fortnite', 'Epic Games', 'Battle Royale'],
  ['Rocket League', 'Epic Games', 'Sports'],
  ['Apex Legends', 'Electronic Arts (EA)', 'Battle Royale'],
  ['The Sims 4', 'Electronic Arts (EA)', 'Simulation'],
  ['Need for Speed Unbound', 'Electronic Arts (EA)', 'Racing'],
  ['Need for Speed Heat', 'Electronic Arts (EA)', 'Racing'],
  ['Forza Horizon 5', 'Xbox Game Studios / Microsoft', 'Racing'],
  ['Forza Motorsport', 'Xbox Game Studios / Microsoft', 'Racing'],
  ['Minecraft', 'Microsoft / Xbox Game Studios', 'Sandbox'],
  ['Overwatch 2', 'Blizzard Entertainment', 'FPS'],
  ['Rainbow Six Siege', 'Ubisoft', 'FPS'],
  ['Far Cry 6', 'Ubisoft', 'FPS'],
  ["Assassin's Creed Shadows", 'Ubisoft', 'Action'],
  ['The Crew Motorfest', 'Ubisoft', 'Racing'],
  ['Trackmania', 'Ubisoft', 'Racing'],
  ['Tekken 8', 'Bandai Namco', 'Fighting'],
  ['Elden Ring', 'Bandai Namco', 'RPG'],
  ['Dark Souls III', 'Bandai Namco', 'RPG'],
  ['Cyberpunk 2077', 'CD Projekt', 'RPG'],
  ['The Witcher 3', 'CD Projekt', 'RPG'],
  ['Hogwarts Legacy', 'Warner Bros. Games', 'RPG'],
  ['Mortal Kombat 1', 'Warner Bros. Games', 'Fighting'],
  ['Forza Horizon 4', 'Xbox Game Studios / Microsoft', 'Racing'],
  ['God of War', 'Sony Interactive Entertainment', 'Action'],
  ['God of War Ragnarök', 'Sony Interactive Entertainment', 'Action'],
  ["Marvel's Spider-Man Remastered", 'Sony Interactive Entertainment', 'Action'],
  ['Spider-Man: Miles Morales', 'Sony Interactive Entertainment', 'Action'],
  ['Horizon Forbidden West', 'Sony Interactive Entertainment', 'Action'],
  ['The Last of Us Part I', 'Sony Interactive Entertainment', 'Action'],
  ['Resident Evil 4', 'Capcom', 'Survival Horror'],
  ['Monster Hunter Wilds', 'Capcom', 'Action RPG'],
  ['Street Fighter 6', 'Capcom', 'Fighting'],
  ['Euro Truck Simulator 2', 'SCS Software', 'Simulation'],
  ['Assetto Corsa', '505 Games / Kunos Simulazioni', 'Racing'],
  ['Terraria', 'Re-Logic', 'Sandbox'],
  ['Rust', 'Facepunch Studios', 'Survival'],
  ['ARK: Survival Evolved', 'Studio Wildcard', 'Survival'],
  ['Palworld', 'Pocketpair', 'Survival'],
  ['Dead by Daylight', 'Behaviour Interactive', 'Horror'],
  ['The Finals', 'Embark Studios', 'FPS']
];

export const initializeGames = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS games (
      game_id      SERIAL PRIMARY KEY,
      cafe_id      INTEGER,
      name         VARCHAR(160) NOT NULL,
      category     VARCHAR(48),
      publisher    VARCHAR(120),
      launcher     VARCHAR(24) NOT NULL DEFAULT 'Steam'
        CHECK (launcher IN ('Steam','Riot','EA','Epic','Ubisoft','Battle.net','Rockstar','Custom')),
      launch_type  VARCHAR(48),
      app_id       VARCHAR(64),
      executable   VARCHAR(255),
      process_name VARCHAR(120),
      launch_args  TEXT,
      icon_url     TEXT,
      -- Start the game the moment the launcher is ready, rather than leaving the
      -- customer at the launcher's own menu.
      auto_launch  BOOLEAN NOT NULL DEFAULT TRUE,
      -- A title switched off never reaches a customer's game list, without
      -- being deleted and losing its launch config.
      enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order   INTEGER NOT NULL DEFAULT 100,
      created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  /* One title per name per café. A plain unique index; the seed targets a
     concrete cafe_id, so no NULL-collision subtlety arises here. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_games_cafe_name ON games (cafe_id, name)
  `);

  /* Which titles are installed on which PC. The customer at PC-07 is shown only
     what PC-07 can actually run. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS pc_games (
      pc_id     INTEGER NOT NULL REFERENCES pcs(pc_id) ON DELETE CASCADE,
      game_id   INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
      installed BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (pc_id, game_id)
    )
  `);

  /*
   * A starter library for the first café, once. Idempotent: seeded only when
   * that café has no games yet, so a restart never doubles the list and never
   * fights an operator who has since curated it.
   *
   * Scoped to the oldest café rather than every café — a game library is a
   * café's own inventory, not a platform-wide fact, and a fresh café starts
   * empty and adds what it stocks.
   */
  const firstCafe = (await client.query(
    'SELECT cafe_id FROM cafes ORDER BY cafe_id ASC LIMIT 1')).rows[0];
  if (firstCafe) {
    const cafeId = firstCafe.cafe_id;
    const has = (await client.query(
      'SELECT 1 FROM games WHERE cafe_id = $1 LIMIT 1', [cafeId])).rows[0];
    if (!has) {
      let order = 10;
      for (const [name, publisher, category] of SEED) {
        const launcher = LAUNCHER_BY_PUBLISHER[publisher] || 'Steam';
        await client.query(`
          INSERT INTO games (cafe_id, name, category, publisher, launcher, launch_type, sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (cafe_id, name) DO NOTHING
        `, [cafeId, name, category, publisher, launcher, LAUNCH_TYPE[launcher], order]);
        order += 10;
      }
      console.log(`✅ Game library seeded: ${SEED.length} titles for café ${cafeId}`);
    }
  }
};
