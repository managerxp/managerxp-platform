/*
 * The master Game Catalog — ManagerXP's own.
 *
 * A game and its platform configurations are deliberately two different
 * things now, not one flat row. `games` is what a player recognises — a
 * name, artwork, a genre — and knows nothing about how to launch anything.
 * `game_platforms` is where Steam's App ID, Epic's launch config and EA's
 * launch config for THE SAME game each get their own row, because F1 25 on
 * three stores is three different technical facts, not three copies of one.
 *
 * A café never edits any of this; it only ever selects a game and, per
 * station, which of its platform configs is actually installed there (see
 * games.Controller.js / station_game_platforms).
 */
import path from 'path';
import fs from 'fs/promises';
import pool from '../config/database.js';
import { recordAdminAudit } from '../middleware/adminAuth.js';
import { optimizeLogo, optimizeCover } from '../middleware/catalogAssetUpload.js';
import { PLATFORMS, LAUNCH_METHOD_BY_PLATFORM } from '../config/schema.gamePlatforms.js';

const slugify = (name) => String(name).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const clean = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const shapeGame = (r) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description || null,
  category: r.category || null,
  icon_url: r.icon_url || null,
  banner_url: r.banner_url || null,
  status: r.status,
  created_at: r.created_at,
  updated_at: r.updated_at,
  cafe_count: r.cafe_count !== undefined ? Number(r.cafe_count) : undefined,
  platforms: r.platforms || undefined
});

const shapePlatform = (r) => ({
  id: r.id,
  game_id: r.game_id,
  platform: r.platform,
  platform_game_id: r.platform_game_id || null,
  launch_method: r.launch_method || null,
  launch_target: r.launch_target || null,
  process_name: r.process_name || null,
  launch_arguments: r.launch_arguments || null,
  status: r.status,
  created_at: r.created_at,
  updated_at: r.updated_at
});

const GAME_FIELD = {
  name:        (v) => { const s = clean(v, 160); return s ? { value: s } : { error: 'A game name is required' }; },
  description: (v) => ({ value: clean(v, 4000) }),
  category:    (v) => ({ value: clean(v, 48) }),
  status:      (v) => ['ACTIVE', 'INACTIVE'].includes(String(v)) ? { value: String(v) } : { error: 'Status must be ACTIVE or INACTIVE' }
};

const PLATFORM_FIELD = {
  platform:         (v) => PLATFORMS.includes(String(v)) ? { value: String(v) } : { error: `Platform must be one of ${PLATFORMS.join(', ')}` },
  platform_game_id: (v) => ({ value: clean(v, 64) }),
  launch_method:    (v) => ({ value: clean(v, 32) }),
  launch_target:    (v) => ({ value: clean(v, 500) }),
  process_name:     (v) => ({ value: clean(v, 120) }),
  launch_arguments: (v) => ({ value: clean(v, 2000) }),
  status:           (v) => ['ACTIVE', 'INACTIVE'].includes(String(v)) ? { value: String(v) } : { error: 'Status must be ACTIVE or INACTIVE' }
};

const uniqueSlug = async (name, excludeId) => {
  const base = slugify(name) || 'game';
  let slug = base, n = 1;
  for (;;) {
    const clash = await pool.query(
      'SELECT 1 FROM games WHERE slug = $1 AND id IS DISTINCT FROM $2', [slug, excludeId ?? null]);
    if (!clash.rows[0]) return slug;
    slug = `${base}-${++n}`;
  }
};

const loadPlatforms = async (gameIds) => {
  if (!gameIds.length) return new Map();
  const { rows } = await pool.query(
    'SELECT * FROM game_platforms WHERE game_id = ANY($1) ORDER BY platform', [gameIds]);
  const byGame = new Map();
  for (const row of rows) {
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, []);
    byGame.get(row.game_id).push(shapePlatform(row));
  }
  return byGame;
};

/* ==========================================================================
   GAMES
   ========================================================================== */

/** GET /api/admin/game-catalog?search=&status= */
export const listCatalog = async (req, res) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      filters.push(`name ILIKE $${params.length}`);
    }
    if (req.query.status) { params.push(String(req.query.status).toUpperCase()); filters.push(`status = $${params.length}`); }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(`
      SELECT g.*, (SELECT COUNT(*) FROM cafe_games cg WHERE cg.game_id = g.id) AS cafe_count
      FROM games g ${where}
      ORDER BY g.name
    `, params);

    const platformsByGame = await loadPlatforms(rows.map((r) => r.id));
    res.json({
      success: true,
      data: rows.map((r) => shapeGame({ ...r, platforms: platformsByGame.get(r.id) || [] }))
    });
  } catch (error) {
    console.error('Catalog list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the game catalog' });
  }
};

/** GET /api/admin/game-catalog/:id */
export const getCatalogGame = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const g = (await pool.query('SELECT * FROM games WHERE id = $1', [id])).rows[0];
    if (!g) return res.status(404).json({ success: false, message: 'Not found' });
    const platformsByGame = await loadPlatforms([id]);
    res.json({ success: true, data: shapeGame({ ...g, platforms: platformsByGame.get(id) || [] }) });
  } catch (error) {
    console.error('Catalog read failed:', error);
    res.status(500).json({ success: false, message: 'Could not load that game' });
  }
};

/** POST /api/admin/game-catalog — the game only; add platforms afterward. */
export const createCatalogGame = async (req, res) => {
  try {
    const cols = []; const vals = []; const ph = [];
    for (const [key, check] of Object.entries(GAME_FIELD)) {
      if (req.body?.[key] === undefined && key !== 'name') continue;
      const r = check(req.body?.[key]);
      if (r.error) return res.status(400).json({ success: false, message: r.error });
      cols.push(key); vals.push(r.value); ph.push(`$${vals.length}`);
    }
    const name = req.body?.name;
    if (!name) return res.status(400).json({ success: false, message: 'A game name is required' });

    const slug = await uniqueSlug(name);
    cols.push('slug'); vals.push(slug); ph.push(`$${vals.length}`);

    const g = (await pool.query(
      `INSERT INTO games (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, vals)).rows[0];

    await recordAdminAudit(req, {
      action: 'catalog.game_created', resource_type: 'game', resource_id: g.id,
      new_value: { name: g.name }
    });
    res.status(201).json({ success: true, message: `${g.name} added to the catalog`, data: shapeGame({ ...g, platforms: [] }) });
  } catch (error) {
    console.error('Catalog create failed:', error);
    res.status(500).json({ success: false, message: 'Could not add that game' });
  }
};

/** PATCH /api/admin/game-catalog/:id */
export const updateCatalogGame = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const before = (await pool.query('SELECT * FROM games WHERE id = $1', [id])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const sets = []; const params = [id];
    for (const [key, check] of Object.entries(GAME_FIELD)) {
      if (req.body?.[key] === undefined) continue;
      const r = check(req.body[key]);
      if (r.error) return res.status(400).json({ success: false, message: r.error });
      params.push(r.value); sets.push(`${key} = $${params.length}`);
    }
    if (req.body?.name !== undefined && req.body.name !== before.name) {
      const slug = await uniqueSlug(req.body.name, id);
      params.push(slug); sets.push(`slug = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const g = (await pool.query(
      `UPDATE games SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      params)).rows[0];

    await recordAdminAudit(req, {
      action: 'catalog.game_updated', resource_type: 'game', resource_id: id,
      old_value: { name: before.name, status: before.status },
      new_value: { name: g.name, status: g.status }
    });
    const platformsByGame = await loadPlatforms([id]);
    res.json({ success: true, message: `${g.name} saved`, data: shapeGame({ ...g, platforms: platformsByGame.get(id) || [] }) });
  } catch (error) {
    console.error('Catalog update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that game' });
  }
};

/**
 * DELETE /api/admin/game-catalog/:id
 *
 * Refused while any café has selected it — retiring a title every café can
 * still see it offering would be a silent surprise. Set it INACTIVE instead;
 * that removes it from every café's "add a game" list without deleting the
 * record of who already offers it. Its platform rows go with it (ON DELETE
 * CASCADE) since they have no meaning without the game they belong to.
 */
export const deleteCatalogGame = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const inUse = (await pool.query('SELECT COUNT(*)::int AS n FROM cafe_games WHERE game_id = $1', [id])).rows[0].n;
    if (inUse > 0) {
      return res.status(409).json({
        success: false,
        message: `${inUse} café${inUse === 1 ? ' has' : 's have'} this game selected. Set it to Inactive instead of deleting it.`
      });
    }
    const g = (await pool.query('DELETE FROM games WHERE id = $1 RETURNING name', [id])).rows[0];
    if (!g) return res.status(404).json({ success: false, message: 'Not found' });

    await recordAdminAudit(req, {
      action: 'catalog.game_deleted', resource_type: 'game', resource_id: id,
      sensitive: true, summary: `Removed ${g.name} from the catalog`
    });
    res.json({ success: true, message: `${g.name} removed` });
  } catch (error) {
    console.error('Catalog delete failed:', error);
    res.status(500).json({ success: false, message: 'Could not remove that game' });
  }
};

/* ==========================================================================
   PLATFORM CONFIGURATIONS — nested under a game
   ========================================================================== */

/** POST /api/admin/game-catalog/:id/platforms */
export const createPlatform = async (req, res) => {
  try {
    const gameId = parseInt(req.params.id, 10);
    const game = (await pool.query('SELECT id, name FROM games WHERE id = $1', [gameId])).rows[0];
    if (!game) return res.status(404).json({ success: false, message: 'Not found' });

    const cols = ['game_id']; const vals = [gameId]; const ph = ['$1'];
    for (const [key, check] of Object.entries(PLATFORM_FIELD)) {
      if (req.body?.[key] === undefined && key !== 'platform') continue;
      const r = check(req.body?.[key] ?? (key === 'platform' ? 'Steam' : undefined));
      if (r.error) return res.status(400).json({ success: false, message: r.error });
      cols.push(key); vals.push(r.value); ph.push(`$${vals.length}`);
    }

    // A sensible launch method by default — the operator only has to
    // override it for the rare title that needs something unusual.
    if (!req.body?.launch_method) {
      const platform = vals[cols.indexOf('platform')];
      cols.push('launch_method');
      vals.push(LAUNCH_METHOD_BY_PLATFORM[platform] || 'EXECUTABLE');
      ph.push(`$${vals.length}`);
    }

    const p = (await pool.query(
      `INSERT INTO game_platforms (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, vals)).rows[0];

    await recordAdminAudit(req, {
      action: 'catalog.platform_created', resource_type: 'game_platform', resource_id: p.id,
      new_value: { game: game.name, platform: p.platform }
    });
    res.status(201).json({ success: true, message: `${p.platform} added to ${game.name}`, data: shapePlatform(p) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That game already has a configuration for this platform.' });
    }
    console.error('Platform create failed:', error);
    res.status(500).json({ success: false, message: 'Could not add that platform' });
  }
};

/** PATCH /api/admin/game-catalog/:id/platforms/:platformId */
export const updatePlatform = async (req, res) => {
  try {
    const gameId = parseInt(req.params.id, 10);
    const platformId = parseInt(req.params.platformId, 10);
    const before = (await pool.query(
      'SELECT * FROM game_platforms WHERE id = $1 AND game_id = $2', [platformId, gameId])).rows[0];
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    const sets = []; const params = [platformId];
    for (const [key, check] of Object.entries(PLATFORM_FIELD)) {
      if (req.body?.[key] === undefined) continue;
      const r = check(req.body[key]);
      if (r.error) return res.status(400).json({ success: false, message: r.error });
      params.push(r.value); sets.push(`${key} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change' });

    const p = (await pool.query(
      `UPDATE game_platforms SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      params)).rows[0];

    await recordAdminAudit(req, {
      action: 'catalog.platform_updated', resource_type: 'game_platform', resource_id: platformId,
      old_value: { platform: before.platform, status: before.status },
      new_value: { platform: p.platform, status: p.status }
    });
    res.json({ success: true, message: `${p.platform} configuration saved`, data: shapePlatform(p) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That game already has a configuration for this platform.' });
    }
    console.error('Platform update failed:', error);
    res.status(500).json({ success: false, message: 'Could not save that platform' });
  }
};

/**
 * DELETE /api/admin/game-catalog/:id/platforms/:platformId
 *
 * Refused while a station has this platform installed or a venue account is
 * configured against it — both would otherwise point at a launch
 * configuration that no longer exists.
 */
export const deletePlatform = async (req, res) => {
  try {
    const gameId = parseInt(req.params.id, 10);
    const platformId = parseInt(req.params.platformId, 10);

    const stationCount = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM station_game_platforms WHERE game_platform_id = $1', [platformId])).rows[0].n;
    const accountCount = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM game_accounts WHERE game_platform_id = $1', [platformId])).rows[0].n;
    if (stationCount > 0 || accountCount > 0) {
      return res.status(409).json({
        success: false,
        message: `This platform is in use by ${stationCount} station(s) and ${accountCount} venue account(s). ` +
          `Set it to Inactive instead of removing it, or remove those first.`
      });
    }

    const p = (await pool.query(
      'DELETE FROM game_platforms WHERE id = $1 AND game_id = $2 RETURNING platform', [platformId, gameId])).rows[0];
    if (!p) return res.status(404).json({ success: false, message: 'Not found' });

    await recordAdminAudit(req, {
      action: 'catalog.platform_deleted', resource_type: 'game_platform', resource_id: platformId,
      summary: `Removed ${p.platform} configuration`
    });
    res.json({ success: true, message: `${p.platform} configuration removed` });
  } catch (error) {
    console.error('Platform delete failed:', error);
    res.status(500).json({ success: false, message: 'Could not remove that platform' });
  }
};

/* ==========================================================================
   ARTWORK
   ========================================================================== */
const saveAsset = async (req, res, { optimize, column, label }) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image was uploaded' });
    const id = parseInt(req.params.id, 10);
    const game = (await pool.query('SELECT id, name FROM games WHERE id = $1', [id])).rows[0];
    if (!game) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const ext = column === 'banner_url' ? '.jpg' : '.png';
    const optimizedName = `optimized-${path.basename(req.file.filename, path.extname(req.file.filename))}${ext}`;
    const optimizedPath = path.join(path.dirname(req.file.path), optimizedName);
    await optimize(req.file.path, optimizedPath);
    const url = `/uploads/${optimizedName}`;

    const updated = (await pool.query(
      `UPDATE games SET ${column} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [url, id])).rows[0];

    await recordAdminAudit(req, {
      action: 'catalog.game_updated', resource_type: 'game', resource_id: id,
      summary: `Set the ${label} for ${game.name}`
    });
    const platformsByGame = await loadPlatforms([id]);
    res.json({ success: true, message: `${label} saved`, data: shapeGame({ ...updated, platforms: platformsByGame.get(id) || [] }) });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    console.error(`Catalog ${label} upload failed:`, error);
    res.status(500).json({ success: false, message: `Could not save that ${label}` });
  }
};

/** PATCH /api/admin/game-catalog/:id/logo — multipart, field name "image". */
export const uploadCatalogLogo = (req, res) =>
  saveAsset(req, res, { optimize: optimizeLogo, column: 'icon_url', label: 'logo' });

/** PATCH /api/admin/game-catalog/:id/cover — multipart, field name "image". */
export const uploadCatalogCover = (req, res) =>
  saveAsset(req, res, { optimize: optimizeCover, column: 'banner_url', label: 'cover image' });
