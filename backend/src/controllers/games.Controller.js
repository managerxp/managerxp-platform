/*
 * A café's Game Library.
 *
 * Everything technical — a title's platforms, App IDs, executables, process
 * names — belongs to ManagerXP's master catalog (gameCatalog.Controller.js).
 * This file is deliberately unable to write any of that: a café can only
 * browse the catalog, add or remove a title, choose how customers get into
 * it (account_mode) and an optional rate, and say which platform of a game
 * is installed on which of its PCs. There is no endpoint here that accepts
 * an App ID, because there must never be one.
 */
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/*
 * The launch fields ride along here because the café console has to hand
 * them to the station that will actually run the game. They are read-only
 * on this side — no café endpoint writes any of them — which is the
 * distinction the architecture draws: a café may not AUTHOR a launch
 * configuration, but its own console plainly has to be able to relay one.
 */
const shapePlatform = (r) => ({
  id: r.platform_id ?? r.id,
  platform: r.platform,
  platform_game_id: r.platform_game_id || null,
  launch_method: r.launch_method || null,
  launch_target: r.launch_target || null,
  process_name: r.process_name || null,
  launch_arguments: r.launch_arguments || null,
  status: r.platform_status || r.status
});

/* One row per café selection, with every platform the game has (a café may
   offer more than one — Steam AND EA both installed across different PCs). */
const shapeCafeGame = (r) => ({
  cafe_game_id: r.cafe_game_id,
  /* `g.*` supplies the game's own key as `id`; only cafe_games calls it
     `game_id`. Reading just one of the two silently produced an undefined
     game_id everywhere the query joined from the games side. */
  game_id: r.game_id ?? r.id,
  name: r.name,
  category: r.category || null,
  icon_url: r.icon_url || null,
  banner_url: r.banner_url || null,
  enabled: !!r.enabled,
  account_mode: r.account_mode,
  price_per_hour: r.price_per_hour === null || r.price_per_hour === undefined ? null : Number(r.price_per_hour),
  platforms: r.platforms || [],
  pc_count: r.pc_count !== undefined ? Number(r.pc_count) : undefined
});

const ACCOUNT_MODES = ['CUSTOMER_ACCOUNT', 'VENUE_ACCOUNT', 'CUSTOMER_OR_VENUE'];

const platformsByGame = async (gameIds) => {
  if (!gameIds.length) return new Map();
  const { rows } = await pool.query(`
    SELECT id AS platform_id, game_id, platform, platform_game_id, status AS platform_status,
           launch_method, launch_target, process_name, launch_arguments
      FROM game_platforms WHERE game_id = ANY($1) AND status = 'ACTIVE'
     ORDER BY platform
  `, [gameIds]);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.game_id)) map.set(row.game_id, []);
    map.get(row.game_id).push(shapePlatform(row));
  }
  return map;
};

/* ==========================================================================
   BROWSE THE CATALOG
   ========================================================================== */

/** GET /api/games/catalog?search= — every active title, so a café can pick one. */
export const browseCatalog = async (req, res) => {
  try {
    const filters = [`status = 'ACTIVE'`];
    const params = [];
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`name ILIKE $${params.length}`);
    }
    const { rows } = await pool.query(`
      SELECT id, name, category, icon_url, banner_url
        FROM games
       WHERE ${filters.join(' AND ')}
       ORDER BY name
    `, params);
    const byGame = await platformsByGame(rows.map((r) => r.id));
    res.json({ success: true, data: rows.map((r) => ({ ...r, platforms: byGame.get(r.id) || [] })) });
  } catch (error) {
    console.error('Catalog browse failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the game catalog' });
  }
};

/* ==========================================================================
   THE CAFÉ'S OWN LIBRARY
   ========================================================================== */

/** GET /api/games?search=&enabled= */
export const listGames = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const filters = ['cg.cafe_id IS NOT DISTINCT FROM $1'];
    const params = [cafeId];

    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`g.name ILIKE $${params.length}`);
    }
    if (req.query.enabled === 'true' || req.query.enabled === 'false') {
      params.push(req.query.enabled === 'true'); filters.push(`cg.enabled = $${params.length}`);
    }

    const { rows } = await pool.query(`
      SELECT cg.cafe_game_id, cg.enabled, cg.account_mode, cg.price_per_hour, g.*,
             (SELECT COUNT(*) FROM station_game_platforms sgp WHERE sgp.cafe_game_id = cg.cafe_game_id AND sgp.installed) AS pc_count
        FROM cafe_games cg
        JOIN games g ON g.id = cg.game_id
       WHERE ${filters.join(' AND ')}
       ORDER BY g.name
    `, params);

    const byGame = await platformsByGame(rows.map((r) => r.id));
    res.json({ success: true, data: rows.map((r) => shapeCafeGame({ ...r, platforms: byGame.get(r.id) || [] })) });
  } catch (error) {
    console.error('Game list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the game library' });
  }
};

/** POST /api/games   { game_id }  — add a catalog title to this café. */
export const addGame = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const gameId = parseInt(req.body?.game_id, 10);
    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ success: false, message: 'Choose a game from the catalog' });
    }

    const game = (await pool.query(
      `SELECT * FROM games WHERE id = $1 AND status = 'ACTIVE'`, [gameId])).rows[0];
    if (!game) return res.status(404).json({ success: false, message: 'That game is not available' });

    const cg = await pool.query(`
      INSERT INTO cafe_games (cafe_id, game_id, enabled)
      VALUES ($1,$2,TRUE)
      ON CONFLICT (cafe_id, game_id) DO UPDATE SET enabled = TRUE
      RETURNING *
    `, [cafeId, gameId]);

    await recordAudit(req, {
      action: 'game.add', category: 'games', entity: 'cafe_game', entity_id: cg.rows[0].cafe_game_id,
      summary: `Added ${game.name} to the café's game library`
    });
    const byGame = await platformsByGame([gameId]);
    res.status(201).json({
      success: true, message: `${game.name} added`,
      data: shapeCafeGame({ ...game, ...cg.rows[0], platforms: byGame.get(gameId) || [] })
    });
  } catch (error) {
    console.error('Game add failed:', error);
    res.status(500).json({ success: false, message: 'Could not add that game' });
  }
};

/**
 * PATCH /api/games/:cafeGameId   { enabled?, account_mode?, price_per_hour? }
 *
 * The account policy decides what a customer is offered when they pick this
 * game at a station — their own login, a venue account, or either — and the
 * rate is an optional per-game override; leaving it null defers to the
 * station's own hourly pricing.
 */
export const updateCafeGame = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const id = parseInt(req.params.id, 10);
    const sets = []; const params = [id, cafeId];

    if (req.body?.enabled !== undefined) {
      params.push(!!req.body.enabled); sets.push(`enabled = $${params.length}`);
    }
    if (req.body?.account_mode !== undefined) {
      if (!ACCOUNT_MODES.includes(req.body.account_mode)) {
        return res.status(400).json({ success: false, message: `account_mode must be one of ${ACCOUNT_MODES.join(', ')}` });
      }
      params.push(req.body.account_mode); sets.push(`account_mode = $${params.length}`);
    }
    if (req.body?.price_per_hour !== undefined) {
      const rate = req.body.price_per_hour === null ? null : Number(req.body.price_per_hour);
      if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
        return res.status(400).json({ success: false, message: 'Rate must be zero or more, or left blank' });
      }
      params.push(rate); sets.push(`price_per_hour = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const updated = (await pool.query(`
      UPDATE cafe_games SET ${sets.join(', ')}
       WHERE cafe_game_id = $1 AND cafe_id IS NOT DISTINCT FROM $2
      RETURNING *
    `, params)).rows[0];
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });

    const game = (await pool.query('SELECT * FROM games WHERE id = $1', [updated.game_id])).rows[0];
    await recordAudit(req, {
      action: 'game.update', category: 'games', entity: 'cafe_game', entity_id: id,
      summary: `Saved ${game?.name || 'a game'}'s café settings`
    });
    const byGame = await platformsByGame([updated.game_id]);
    res.json({ success: true, message: 'Saved', data: shapeCafeGame({ ...game, ...updated, platforms: byGame.get(updated.game_id) || [] }) });
  } catch (error) {
    console.error('Game update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that change' });
  }
};

/** DELETE /api/games/:cafeGameId — remove from this café's library. */
export const removeGame = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const id = parseInt(req.params.id, 10);
    const row = (await pool.query(`
      DELETE FROM cafe_games WHERE cafe_game_id = $1 AND cafe_id IS NOT DISTINCT FROM $2
      RETURNING game_id
    `, [id, cafeId])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });

    const game = (await pool.query('SELECT name FROM games WHERE id = $1', [row.game_id])).rows[0];
    await recordAudit(req, {
      action: 'game.remove', category: 'games', entity: 'cafe_game', entity_id: id,
      summary: `Removed ${game?.name || 'a game'} from the café's game library`
    });
    res.json({ success: true, message: `${game?.name || 'Game'} removed` });
  } catch (error) {
    console.error('Game remove failed:', error);
    res.status(500).json({ success: false, message: 'Could not remove that game' });
  }
};

/* ==========================================================================
   PC ↔ PLATFORM AVAILABILITY
   ========================================================================== */

/**
 * GET /api/games/pc/:pcId
 *
 * Every game in this café's library and, for each of its platforms, whether
 * THIS station has it installed. A game with two platforms enabled café-wide
 * can show one installed here and the other not — installation is a fact
 * about the PC, not the café's offer.
 */
export const listPcGames = async (req, res) => {
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const pcId = parseInt(req.params.pcId, 10);

    const pc = (await pool.query(
      'SELECT pc_id, name FROM pcs WHERE pc_id = $1 AND cafe_id IS NOT DISTINCT FROM $2', [pcId, cafeId])).rows[0];
    if (!pc) return res.status(404).json({ success: false, message: 'Station not found' });

    const cafeGames = (await pool.query(`
      SELECT cg.cafe_game_id, cg.enabled, cg.account_mode, cg.price_per_hour, g.*
        FROM cafe_games cg JOIN games g ON g.id = cg.game_id
       WHERE cg.cafe_id IS NOT DISTINCT FROM $1
       ORDER BY g.name
    `, [cafeId])).rows;

    const platformRows = (await pool.query(`
      SELECT gp.id AS platform_id, gp.game_id, gp.platform, gp.platform_game_id, gp.status AS platform_status,
             gp.process_name, gp.launch_method, gp.launch_target, gp.launch_arguments,
             (sgp.pc_id IS NOT NULL AND sgp.installed) AS installed
        FROM game_platforms gp
        LEFT JOIN station_game_platforms sgp ON sgp.game_platform_id = gp.id AND sgp.pc_id = $1
       WHERE gp.status = 'ACTIVE'
       ORDER BY gp.platform
    `, [pcId])).rows;

    const platformsByGameId = new Map();
    for (const row of platformRows) {
      if (!platformsByGameId.has(row.game_id)) platformsByGameId.set(row.game_id, []);
      platformsByGameId.get(row.game_id).push({ ...shapePlatform(row), installed: !!row.installed });
    }

    const games = cafeGames.map((r) => shapeCafeGame({ ...r, platforms: platformsByGameId.get(r.id) || [] }));
    res.json({ success: true, data: { pc, games } });
  } catch (error) {
    console.error('PC games list failed:', error);
    res.status(500).json({ success: false, message: "Could not load this station's games" });
  }
};

/** PUT /api/games/pc/:pcId  { game_platform_ids: [...] } — the exact set installed here. */
export const setPcGames = async (req, res) => {
  const client = await pool.connect();
  try {
    const cafeId = req.actor?.cafe_id ?? null;
    const pcId = parseInt(req.params.pcId, 10);
    const wanted = Array.isArray(req.body?.game_platform_ids)
      ? [...new Set(req.body.game_platform_ids.map((n) => parseInt(n, 10)).filter(Number.isInteger))]
      : null;
    if (!wanted) return res.status(400).json({ success: false, message: 'Send a game_platform_ids array' });

    const pc = (await client.query(
      'SELECT pc_id, name FROM pcs WHERE pc_id = $1 AND cafe_id IS NOT DISTINCT FROM $2', [pcId, cafeId])).rows[0];
    if (!pc) return res.status(404).json({ success: false, message: 'Station not found' });

    /* Only platforms belonging to games this café actually offers can be
       mapped — a platform id from another café's catalogue selection, or one
       this café never enabled, is silently dropped rather than trusted. */
    const valid = wanted.length
      ? (await client.query(`
          SELECT gp.id AS game_platform_id, cg.cafe_game_id
            FROM game_platforms gp
            JOIN cafe_games cg ON cg.game_id = gp.game_id AND cg.cafe_id IS NOT DISTINCT FROM $1
           WHERE gp.id = ANY($2)
        `, [cafeId, wanted])).rows
      : [];

    await client.query('BEGIN');
    await client.query('DELETE FROM station_game_platforms WHERE pc_id = $1', [pcId]);
    for (const row of valid) {
      await client.query(
        `INSERT INTO station_game_platforms (pc_id, cafe_game_id, game_platform_id, installed)
         VALUES ($1,$2,$3,TRUE)`,
        [pcId, row.cafe_game_id, row.game_platform_id]);
    }
    await client.query('COMMIT');

    await recordAudit(req, {
      action: 'game.pc_map', category: 'games', entity: 'pc', entity_id: pcId,
      summary: `Set ${valid.length} platform${valid.length === 1 ? '' : 's'} available on ${pc.name}`
    });
    res.json({
      success: true, message: `${valid.length} platform${valid.length === 1 ? '' : 's'} available on ${pc.name}`,
      data: { game_platform_ids: valid.map((r) => r.game_platform_id) }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PC games set failed:', error);
    res.status(500).json({ success: false, message: "Could not save this station's games" });
  } finally {
    client.release();
  }
};
