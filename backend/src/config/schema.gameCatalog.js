/*
 * The Game Catalog — master / tenant / device.
 *
 *   manager_games   ManagerXP's own catalogue. Every technical fact needed to
 *                   launch a title — its launcher, its App ID, its executable,
 *                   its process name, its arguments — lives here and only
 *                   here. Global, not scoped to any café.
 *
 *   cafe_games      A café's selection from that catalogue. Nothing more than
 *                   "we offer this one" and "it's switched on" — no technical
 *                   field is ever duplicated onto this row, so a café can
 *                   never drift from the master configuration by editing a
 *                   copy of it, because there is no copy.
 *
 *   pc_games        Which of a café's selected titles is actually installed
 *                   on which PC.
 *
 * This replaces the first version of the Game Library, which let a café type
 * in its own App ID and executable path per title — exactly what a café admin
 * should never have to know, and exactly how one café's typo could never be
 * fixed except by that café. A café now only ever chooses from the catalogue;
 * ManagerXP is the one place a launch configuration can be wrong or right.
 */

export const LAUNCHERS = ['Steam', 'Riot', 'EA', 'Epic', 'Ubisoft', 'Battle.net', 'Rockstar', 'Custom'];

/* The client/agent word for how a launcher starts a title — a label, not
   behaviour; what the client actually does is decided by `launcher` alone. */
export const LAUNCH_TYPE_BY_LAUNCHER = {
  Steam: 'Steam App', Riot: 'Riot Client', EA: 'EA App', Epic: 'Epic Games',
  Ubisoft: 'Ubisoft Connect', 'Battle.net': 'Battle.net', Rockstar: 'Rockstar', Custom: 'Executable'
};

const LAUNCHER_BY_PUBLISHER = {
  'Riot Games': 'Riot',
  'Electronic Arts (EA)': 'EA',
  'Epic Games': 'Epic',
  'Ubisoft': 'Ubisoft',
  'Activision': 'Battle.net',
  'Blizzard Entertainment': 'Battle.net',
  'Rockstar Games': 'Rockstar'
};

/* [name, publisher, category]. App id / executable / process are left for
   ManagerXP to fill in against how each title is actually installed, rather
   than shipping guesses that would be wrong for most cafés. */
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

const slugify = (name) => String(name).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const initializeGameCatalog = async (client) => {
  /*
   * The old `pc_games` (pc_id, game_id) has to be out of the way before
   * `CREATE TABLE IF NOT EXISTS pc_games` below can create the new shape
   * (pc_id, cafe_game_id) — otherwise the old table simply stays, silently,
   * and every query against the new column fails. Detected by the column
   * that changed name, not by existence alone, so this runs exactly once.
   */
  const pcGamesIsOldShape = (await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pc_games' AND column_name = 'game_id'
  `)).rows.length > 0;
  if (pcGamesIsOldShape) {
    await client.query(`ALTER TABLE pc_games RENAME TO pc_games_old`);
  }

  /* ========================================================================
     MASTER CATALOGUE — ManagerXP's own
     ======================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS manager_games (
      game_id         SERIAL PRIMARY KEY,
      name            VARCHAR(160) NOT NULL,
      slug            VARCHAR(180) UNIQUE NOT NULL,
      publisher       VARCHAR(120),
      category        VARCHAR(48),
      logo_url        TEXT,
      cover_url       TEXT,
      launcher        VARCHAR(24) NOT NULL DEFAULT 'Steam'
        CHECK (launcher IN ('Steam','Riot','EA','Epic','Ubisoft','Battle.net','Rockstar','Custom')),
      launch_type     VARCHAR(48),
      app_id          VARCHAR(64),
      process_name    VARCHAR(120),
      -- Renamed from a bare "executable": this is the launcher's own command
      -- as much as it is the game's — a Custom title's .exe, or the path a
      -- protocol launch has no App ID for.
      launcher_config VARCHAR(255),
      launch_arguments TEXT,
      status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* ========================================================================
     CAFÉ SELECTION — "we offer this one", nothing else
     ======================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS cafe_games (
      cafe_game_id SERIAL PRIMARY KEY,
      cafe_id      INTEGER NOT NULL,
      game_id      INTEGER NOT NULL REFERENCES manager_games(game_id) ON DELETE CASCADE,
      -- A café can carry a title it has since paused, without losing which PCs
      -- had it and without ManagerXP's catalogue toggle being the only switch.
      enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (cafe_id, game_id)
    )
  `);

  /* ========================================================================
     PC MAPPING — which of a café's selected titles is on which machine
     ======================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS pc_games (
      pc_id        INTEGER NOT NULL REFERENCES pcs(pc_id) ON DELETE CASCADE,
      cafe_game_id INTEGER NOT NULL REFERENCES cafe_games(cafe_game_id) ON DELETE CASCADE,
      installed    BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (pc_id, cafe_game_id)
    )
  `);

  /* ========================================================================
     MIGRATION — from the first, café-authored version of this feature.
     Runs once: if the old `games` table still exists and manager_games is
     still empty, its rows become the master catalogue (deduplicated by name,
     since the master is now global rather than per-café), every café that
     had one becomes a cafe_games row, and pc_games is rebuilt to point at
     those instead of directly at a game. The old tables are renamed rather
     than dropped — this is data an operator spent time curating.
     ======================================================================== */
  /*
   * Shape-checked, not just name-checked: the newer games/game_platforms
   * architecture (schema.gamePlatforms.js) later claimed the name `games`
   * for an unrelated, `id`-keyed table. A bare table-name match would treat
   * that one as this migration's old café-authored table and crash trying
   * to read a `game_id` column it does not have. The original table this
   * migration targets is `game_id`-keyed; that is the actual fact worth
   * checking, not the name it happened to have.
   */
  const oldGamesExists = (await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'game_id'
  `)).rows.length > 0;
  const catalogueEmpty = (await client.query(`SELECT 1 FROM manager_games LIMIT 1`)).rows.length === 0;

  if (oldGamesExists && catalogueEmpty) {
    const oldGames = (await client.query(`SELECT * FROM games ORDER BY game_id ASC`)).rows;
    if (oldGames.length) {
      const masterIdByName = new Map();   // name -> new manager_games.game_id
      const cafeGameId = new Map();       // "cafeId:masterId" -> cafe_games.cafe_game_id

      // Checked once: true exactly when the rename above actually ran.
      const hasOldPcGames = pcGamesIsOldShape;

      for (const g of oldGames) {
        let masterId = masterIdByName.get(g.name);
        if (masterId === undefined) {
          const slugBase = slugify(g.name) || `game-${g.game_id}`;
          let slug = slugBase, n = 1;
          // eslint-disable-next-line no-await-in-loop
          while ((await client.query('SELECT 1 FROM manager_games WHERE slug = $1', [slug])).rows.length) {
            slug = `${slugBase}-${++n}`;
          }
          const inserted = await client.query(`
            INSERT INTO manager_games
              (name, slug, publisher, category, logo_url, launcher, launch_type,
               app_id, process_name, launcher_config, launch_arguments, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING game_id
          `, [
            g.name, slug, g.publisher, g.category, g.icon_url, g.launcher, g.launch_type,
            g.app_id, g.process_name, g.executable, g.launch_args,
            g.enabled === false ? 'INACTIVE' : 'ACTIVE'
          ]);
          masterId = inserted.rows[0].game_id;
          masterIdByName.set(g.name, masterId);
        }

        const cafeId = g.cafe_id;
        if (cafeId != null) {
          const key = `${cafeId}:${masterId}`;
          if (!cafeGameId.has(key)) {
            const cg = await client.query(`
              INSERT INTO cafe_games (cafe_id, game_id, enabled)
              VALUES ($1,$2,$3)
              ON CONFLICT (cafe_id, game_id) DO UPDATE SET enabled = EXCLUDED.enabled
              RETURNING cafe_game_id
            `, [cafeId, masterId, g.enabled !== false]);
            cafeGameId.set(key, cg.rows[0].cafe_game_id);
          }
        }

        // Old pc_games rows, carried over onto the café selection they now map to.
        if (hasOldPcGames && cafeId != null) {
          const key = `${cafeId}:${masterId}`;
          const cgId = cafeGameId.get(key);
          if (cgId != null) {
            const links = await client.query(
              'SELECT pc_id, installed FROM pc_games_old WHERE game_id = $1', [g.game_id]);
            for (const l of links.rows) {
              // eslint-disable-next-line no-await-in-loop
              await client.query(`
                INSERT INTO pc_games (pc_id, cafe_game_id, installed)
                VALUES ($1,$2,$3) ON CONFLICT (pc_id, cafe_game_id) DO NOTHING
              `, [l.pc_id, cgId, l.installed]);
            }
          }
        }
      }

      console.log(`✅ Game catalog migrated: ${masterIdByName.size} master titles, ${cafeGameId.size} café selection(s)`);
    }

    // Renamed, not dropped — this is the record of how the migration ran.
    await client.query(`ALTER TABLE games RENAME TO games_deprecated`).catch(() => {});
  }

  /*
   * Seed a starter catalogue once, only when the whole catalogue is empty —
   * covers a fresh install that never had the old `games` table at all.
   *
   * Also skipped once the newer games/game_platforms architecture
   * (schema.gamePlatforms.js) has taken over: `manager_games` gets renamed
   * away the moment that migration succeeds, which means the very next boot
   * finds an innocently empty, freshly-`CREATE TABLE IF NOT EXISTS`-recreated
   * `manager_games` and would otherwise seed 52 titles into a table nothing
   * reads from anymore, forever, on every future boot.
   */
  const newArchitectureLive = (await client.query(`
    SELECT 1 FROM information_schema.tables t
     WHERE t.table_name = 'games'
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns c
          WHERE c.table_name = 'games' AND c.column_name = 'game_id'
       )
  `)).rows.length > 0;
  const stillEmpty = !newArchitectureLive
    && (await client.query(`SELECT 1 FROM manager_games LIMIT 1`)).rows.length === 0;
  if (stillEmpty) {
    for (const [name, publisher, category] of SEED) {
      const launcher = LAUNCHER_BY_PUBLISHER[publisher] || 'Steam';
      let slug = slugify(name), n = 1;
      // eslint-disable-next-line no-await-in-loop
      while ((await client.query('SELECT 1 FROM manager_games WHERE slug = $1', [slug])).rows.length) {
        slug = `${slugify(name)}-${++n}`;
      }
      await client.query(`
        INSERT INTO manager_games (name, slug, publisher, category, launcher, launch_type, status)
        VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
        ON CONFLICT (slug) DO NOTHING
      `, [name, slug, publisher, category, launcher, LAUNCH_TYPE_BY_LAUNCHER[launcher]]);
    }
    console.log(`✅ Game catalog seeded: ${SEED.length} titles`);
  }
};
