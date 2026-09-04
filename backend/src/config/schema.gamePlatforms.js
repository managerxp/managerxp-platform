/* ==========================================================================
   The Game / Platform / Account architecture.

   Supersedes schema.gameCatalog.js's `manager_games` (one game = one
   launcher). That shape broke the moment a game existed on more than one
   store — F1 25 on Steam, Epic AND EA is one title, not three — and it had
   no idea of a "venue account": a café-owned login/license that a customer
   can just play on without an account of their own. Session 2026-08-28's
   corrected architecture, in full:

     games            — the title itself. No launcher, no App ID, nothing
                         technical — just what a player recognises.
     game_platforms   — one row per (game, store) pair. Steam's App ID and
                         Epic's launch config live on DIFFERENT rows for the
                         SAME game, because they genuinely are different
                         configurations, not two copies of one fact.
     cafe_games       — a café's own selection, now carrying account_mode
                         (does a customer bring their own login, use the
                         café's, or either) and an optional per-game rate.
     game_accounts    — the café's pool of venue-owned logins/licenses per
                         platform config, reserved one-per-session so two
                         stations can never be handed the same account.
     station_game_platforms — which PLATFORM of a game is actually installed
                         on a given PC. A café offering F1 25 on both Steam
                         and EA still only has one or the other installed on
                         any one machine — this is that fact, not "the game
                         is on this PC" (which platform is not a detail, it
                         is what the launcher has to know to start anything).

   sessions gains three nullable columns (game_id, game_platform_id,
   game_account_id) rather than becoming a new `gaming_sessions` table —
   the existing `sessions` table already carries this session's entire
   billing snapshot (pricing_unit, membership discount, block extension...),
   built and tested earlier the same day this file was written, and a
   session that never launches a specific game (open-ended counter play,
   F&B-only) is the common case, not the exception, so these three columns
   are the addition, not the whole row.

   `pcs` already IS the "station" entity the new architecture describes
   (pc_id, cafe_id, name, mac_address, status) — renaming a table 50+ files
   already depend on for a naming preference alone would be pure churn with
   no functional gain, so this file does not attempt it.
   ========================================================================== */
import crypto from 'crypto';

export const PLATFORMS = ['Steam', 'Epic', 'EA', 'Riot', 'Ubisoft', 'Battle.net', 'Rockstar', 'Custom'];

/* What the client-app's launcher adapter for each platform actually needs to
   act — a URI built from an id, or a bare executable. Kept here (not just in
   client-app) so a freshly-migrated game_platforms row gets a sane default
   without every caller having to know this mapping too. */
export const LAUNCH_METHOD_BY_PLATFORM = {
  Steam: 'STEAM_URI', Epic: 'EPIC_URI', EA: 'EA_APP', Ubisoft: 'UBISOFT_URI',
  'Battle.net': 'BATTLENET_URI', Riot: 'EXECUTABLE', Rockstar: 'EXECUTABLE', Custom: 'EXECUTABLE'
};

const slugify = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const initializeGamePlatforms = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      slug VARCHAR(180) UNIQUE NOT NULL,
      description TEXT,
      category VARCHAR(48),
      icon_url VARCHAR(255),
      banner_url VARCHAR(255),
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  /* CREATE TABLE IF NOT EXISTS is a no-op on a `games` table that already
     existed before these two columns were added here — it never widens an
     existing table. On such a database, uploadCatalogLogo/uploadCatalogCover
     (gameCatalog.Controller.js's saveAsset) would fail with "column
     icon_url/banner_url does not exist" on every attempt, surfacing to the
     admin as a generic "Could not save that logo/cover image". */
  await client.query(`
    ALTER TABLE games
      ADD COLUMN IF NOT EXISTS icon_url VARCHAR(255),
      ADD COLUMN IF NOT EXISTS banner_url VARCHAR(255)
  `);

  /* One row per (game, store). A game with no platform configured yet still
     exists in the catalog — ManagerXP can register "Hollow Knight" and add
     its Steam config later — so game_id is the only NOT NULL foreign fact. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_platforms (
      id SERIAL PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      platform VARCHAR(24) NOT NULL CHECK (platform IN ('Steam','Epic','EA','Riot','Ubisoft','Battle.net','Rockstar','Custom')),
      platform_game_id VARCHAR(64),
      launch_method VARCHAR(32),
      launch_target VARCHAR(500),
      process_name VARCHAR(120),
      launch_arguments TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (game_id, platform)
    )
  `);

  /*
   * The venue account pool. `status` is the reservation state a session-start
   * locks against (see session.Controller.js's startSession) — AVAILABLE is
   * the only state a session may claim, and claiming it is a single
   * UPDATE ... WHERE status = 'AVAILABLE' inside the session's own
   * transaction, so two stations racing for the last account cannot both win.
   *
   * `profile_identifier` is what keeps a story-mode game's save data with one
   * customer's play session rather than another's — "Venue Account 2" always
   * resumes "GTA Profile 2", never whichever profile happened to be loaded
   * last. `credentials_encrypted` reuses the same AES-256-GCM helper the
   * payment-gateway secrets already use; despite that module's name, the
   * primitive is generic — there is no reason for a second implementation of
   * "encrypt a secret at rest" in this codebase.
   */
  await client.query(`
    CREATE TABLE IF NOT EXISTS game_accounts (
      id SERIAL PRIMARY KEY,
      cafe_id INTEGER NOT NULL REFERENCES cafes(cafe_id) ON DELETE CASCADE,
      game_platform_id INTEGER NOT NULL REFERENCES game_platforms(id) ON DELETE CASCADE,
      account_name VARCHAR(160) NOT NULL,
      account_type VARCHAR(24) NOT NULL DEFAULT 'LOGIN',
      credentials_encrypted TEXT,
      profile_identifier VARCHAR(160),
      status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','IN_USE','DISABLED')),
      current_session_id INTEGER REFERENCES sessions(session_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  /* Added after the table's first release — CREATE TABLE IF NOT EXISTS only
     matters the very first time, so a column added later needs its own
     ALTER or it silently never appears on an already-initialized database. */
  await client.query(`ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(160)`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_game_accounts_available
      ON game_accounts (game_platform_id, status)
  `);

  /* Which platform of a game is actually installed on a given PC. Kept
     separate from cafe_games (the café's *offer*) because the offer can span
     several platforms while any one machine only ever runs one of them. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS station_game_platforms (
      pc_id INTEGER NOT NULL REFERENCES pcs(pc_id) ON DELETE CASCADE,
      cafe_game_id INTEGER NOT NULL,
      game_platform_id INTEGER NOT NULL REFERENCES game_platforms(id) ON DELETE CASCADE,
      installed BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (pc_id, game_platform_id)
    )
  `);

  /*
   * cafe_games gains the account policy and an optional per-game rate. This
   * is additive to the table the previous game-catalog migration created —
   * its rows, and their cafe_id/game_id pairing, are kept; only game_id's
   * target and these two new columns change.
   */
  await client.query(`
    ALTER TABLE cafe_games
      ADD COLUMN IF NOT EXISTS account_mode VARCHAR(24) NOT NULL DEFAULT 'CUSTOMER_ACCOUNT',
      ADD COLUMN IF NOT EXISTS price_per_hour NUMERIC(10,2)
  `);
  await client.query(`ALTER TABLE cafe_games DROP CONSTRAINT IF EXISTS cafe_games_account_mode_check`);
  await client.query(`
    ALTER TABLE cafe_games ADD CONSTRAINT cafe_games_account_mode_check
      CHECK (account_mode IN ('CUSTOMER_ACCOUNT','VENUE_ACCOUNT','CUSTOMER_OR_VENUE'))
  `);

  /* A session may (not must) be tied to a specific game — most sessions are
     open-ended counter play or a customer who launched nothing in particular. */
  await client.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS game_platform_id INTEGER REFERENCES game_platforms(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS game_account_id INTEGER REFERENCES game_accounts(id) ON DELETE SET NULL
  `);

  /* ------------------------------------------------------------------------
     ONE-TIME MIGRATION off manager_games/cafe_games(old game_id)/pc_games.
     Runs only once — guarded on `games` being empty and the old catalog
     still existing — and never drops anything old, the same discipline the
     first game-catalog migration used a few hours earlier the same day.
     ------------------------------------------------------------------------ */
  const gamesEmpty = (await client.query('SELECT 1 FROM games LIMIT 1')).rows.length === 0;
  const managerGamesExists = (await client.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'manager_games'
  `)).rows.length > 0;

  if (gamesEmpty && managerGamesExists) {
    const oldGames = (await client.query('SELECT * FROM manager_games')).rows;
    const oldToNewGameId = new Map();       // manager_games.game_id -> games.id
    const gameIdToPlatformId = new Map();   // games.id -> its one game_platforms.id

    for (const old of oldGames) {
      let slug = slugify(old.name) || 'game', n = 1;
      for (;;) {
        const clash = await client.query('SELECT 1 FROM games WHERE slug = $1', [slug]);
        if (!clash.rows[0]) break;
        slug = `${slugify(old.name) || 'game'}-${++n}`;
      }

      const inserted = await client.query(`
        INSERT INTO games (name, slug, category, icon_url, banner_url, status)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id
      `, [old.name, slug, old.category, old.logo_url, old.cover_url, old.status]);
      const newGameId = inserted.rows[0].id;
      oldToNewGameId.set(old.game_id, newGameId);

      const platform = PLATFORMS.includes(old.launcher) ? old.launcher : 'Custom';
      const platformRow = await client.query(`
        INSERT INTO game_platforms
          (game_id, platform, platform_game_id, launch_method, launch_target, process_name, launch_arguments, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
      `, [
        newGameId, platform, old.app_id,
        LAUNCH_METHOD_BY_PLATFORM[platform] || 'EXECUTABLE',
        old.launcher_config, old.process_name, old.launch_arguments, old.status
      ]);
      gameIdToPlatformId.set(newGameId, platformRow.rows[0].id);
    }

    /*
     * The UNIQUE(cafe_id, game_id) constraint has to come off before this
     * loop, not just the FK: rewriting one row at a time can transiently
     * collide with a sibling row that has not been remapped yet (row A's new
     * id lands on whatever row B's still-old id currently is), even though
     * the final set of values is perfectly unique. Dropped and recreated
     * around the loop rather than deferred, since a plain DROP/ADD needs no
     * assumptions about this constraint's original name or deferrability.
     */
    await client.query(`ALTER TABLE cafe_games DROP CONSTRAINT IF EXISTS cafe_games_cafe_id_game_id_key`);
    await client.query(`ALTER TABLE cafe_games DROP CONSTRAINT IF EXISTS cafe_games_game_id_fkey`);

    const cafeGameRows = (await client.query('SELECT cafe_game_id, game_id FROM cafe_games')).rows;
    const cafeGameToPlatformId = new Map(); // cafe_game_id -> game_platform_id, for the pc_games pass below
    for (const row of cafeGameRows) {
      const newGameId = oldToNewGameId.get(row.game_id);
      if (newGameId == null) continue; // orphaned row, nothing to remap it to
      await client.query('UPDATE cafe_games SET game_id = $1 WHERE cafe_game_id = $2', [newGameId, row.cafe_game_id]);
      cafeGameToPlatformId.set(row.cafe_game_id, gameIdToPlatformId.get(newGameId));
    }

    // Repoint cafe_games.game_id at the new table now that every row has been remapped.
    await client.query(`
      ALTER TABLE cafe_games ADD CONSTRAINT cafe_games_cafe_id_game_id_key UNIQUE (cafe_id, game_id)
    `);
    await client.query(`
      ALTER TABLE cafe_games ADD CONSTRAINT cafe_games_game_id_fkey
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    `);

    const pcGamesExists = (await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'pc_games'
    `)).rows.length > 0;
    let migratedStationRows = 0;
    if (pcGamesExists) {
      const pcGames = (await client.query('SELECT pc_id, cafe_game_id, installed FROM pc_games')).rows;
      for (const row of pcGames) {
        const platformId = cafeGameToPlatformId.get(row.cafe_game_id);
        if (platformId == null) continue;
        await client.query(`
          INSERT INTO station_game_platforms (pc_id, cafe_game_id, game_platform_id, installed)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (pc_id, game_platform_id) DO NOTHING
        `, [row.pc_id, row.cafe_game_id, platformId, row.installed]);
        migratedStationRows += 1;
      }
      await client.query(`ALTER TABLE pc_games RENAME TO pc_games_deprecated_v2`);
    }

    await client.query(`ALTER TABLE manager_games RENAME TO manager_games_deprecated`);

    console.log(`✅ Game/platform architecture migrated: ${oldGames.length} games, ` +
      `${cafeGameRows.length} café selection(s), ${migratedStationRows} station mapping(s)`);
  }

  console.log('✅ Game/platform/account architecture created/verified');
};

export default { initializeGamePlatforms, PLATFORMS, LAUNCH_METHOD_BY_PLATFORM };
