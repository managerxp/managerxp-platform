/*
 * Update authority.
 *
 * The one rule this file exists to enforce: ManagerXP decides what a station
 * may run. Not the station, and not the café's console.
 *
 * A café's PCs are machines ManagerXP does not control, sitting on a network
 * ManagerXP does not control. So nothing a client says is treated as a fact
 * worth acting on — it reports its version, and that report is used for one
 * thing only: showing an inventory to the operator. Whether an update is
 * offered, and which one, is derived here from the licence and the
 * subscription, both of which live in this database.
 *
 * The practical consequence: a station that lies about its version gets the
 * same answer as one that tells the truth, because the answer never depended
 * on the claim.
 */
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { resolveOrganizationForCafe, getSubscription } from '../modules/entitlements/entitlements.service.js';

const LIVE_STATUSES = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD']);

/* ==========================================================================
   VERSIONS
   ========================================================================== */

/**
 * Turn a semver into something sortable.
 *
 * Text comparison gets this wrong in the way that matters most: '1.10.0' sorts
 * before '1.9.0', so the newest release stops being offered the moment a minor
 * version reaches double digits. Packing each part into a fixed field makes
 * the comparison arithmetic instead.
 */
export const versionSort = (version) => {
  const parts = String(version || '0.0.0').replace(/^v/i, '').split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  // A prerelease suffix ('1.2.3-beta.1') is stripped; the channel already
  // carries that distinction and mixing the two double-counts it.
  const patch = parseInt(String(parts[2] || '0').split('-')[0], 10) || 0;
  return major * 1_000_000 + minor * 1_000 + patch;
};

const isNewer = (candidate, current) => versionSort(candidate) > versionSort(current);

const shapeRelease = (row) => ({
  release_id: row.release_id,
  product: row.product,
  component: row.component,
  version: row.version,
  channel: row.channel,
  release_notes: row.release_notes,
  file_name: row.file_name,
  file_size: row.file_size != null ? Number(row.file_size) : null,
  sha512: row.sha512,
  is_published: row.is_published,
  is_mandatory: row.is_mandatory,
  min_supported_version: row.min_supported_version,
  published_at: row.published_at,
  created_at: row.created_at
});

/* ==========================================================================
   THE AUTHORITATIVE CHECK

   Called by a café's console on behalf of its stations. Public in the sense
   that it takes no session — the licence key is the credential, exactly as it
   is for activation.
   ========================================================================== */

// POST /api/updates/check
export const checkForUpdate = async (req, res) => {
  const client = await pool.connect();
  try {
    const rawKey = String(req.body?.license_key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (rawKey.length < 10) {
      return res.status(400).json({ success: false, message: 'A licence key is required' });
    }
    const key = `${rawKey.slice(0, 3)}-${rawKey.slice(3).match(/.{1,4}/g).join('-')}`;

    const license = (await client.query(`
      SELECT l.*, c.is_active AS cafe_active, c.suspended_reason, c.name AS cafe_name
      FROM license_keys l
      LEFT JOIN cafes c ON c.cafe_id = l.cafe_id
      WHERE l.license_key = $1
    `, [key])).rows[0];

    /*
     * Every refusal below returns 200 with `entitled: false` rather than an
     * error status. The caller is a console asking "may I update?", and the
     * answer "no, and here is why" is a successful answer to that question —
     * treating it as a failure makes consoles retry a settled decision.
     */
    const refuse = (reason, detail) => res.json({
      success: true,
      data: { entitled: false, reason, detail, update_available: false }
    });

    if (!license) return refuse('invalid_licence', 'That licence key is not recognised.');
    if (license.status === 'revoked') {
      return refuse('licence_revoked', license.revoked_reason || 'This licence has been revoked.');
    }
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return refuse('licence_expired', 'This licence has expired. Renew to receive updates.');
    }
    if (license.cafe_id && license.cafe_active === false) {
      return refuse('account_suspended', license.suspended_reason || 'This account is suspended.');
    }

    // Subscription, checked separately: a licence can be live while the
    // subscription behind it has lapsed, and updates follow the subscription.
    if (license.cafe_id) {
      const sub = (await client.query(`
        SELECT end_date FROM subscriptions
        WHERE cafe_id = $1 AND is_active AND end_date > NOW()
        ORDER BY end_date DESC LIMIT 1
      `, [license.cafe_id])).rows[0];

      if (!sub) {
        return refuse('subscription_lapsed',
          'The subscription has lapsed. Renew to receive updates.');
      }
    }

    /* The channel is the café's setting, not the caller's request — a station
       cannot talk its way onto beta by asking for it. */
    const channelRow = (await client.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'updates.channel'`)).rows[0];
    const channel = channelRow?.setting_value === 'beta' ? 'beta' : 'stable';

    /* Which component is asking. The console checks for both itself and its
       stations, so this is a parameter rather than a constant — but it is only
       ever a component name, never a version or a URL, so it cannot be used to
       ask for something the café is not entitled to. */
    const component = req.body?.component === 'server' ? 'server' : 'client';

    const latest = (await client.query(`
      SELECT * FROM client_releases
      WHERE product = $1 AND component = $3 AND is_published
        AND (channel = $2 OR channel = 'stable')
      ORDER BY version_sort DESC LIMIT 1
    `, [license.product || 'cafexp', channel, component])).rows[0];

    if (!latest) {
      return res.json({
        success: true,
        data: {
          entitled: true, update_available: false,
          reason: 'no_release',
          detail: `No ${component} release has been published yet.`
        }
      });
    }

    /* The reported version is used only to answer "is this newer than what
       they have". It is a claim, and a wrong claim changes nothing except
       whether the console shows an update badge. */
    const reported = String(req.body?.current_version || '0.0.0');
    const available = isNewer(latest.version, reported);

    res.json({
      success: true,
      data: {
        entitled: true,
        component,
        update_available: available,
        current_version: reported,
        latest_version: latest.version,
        channel: latest.channel,
        release_notes: latest.release_notes,
        is_mandatory: latest.is_mandatory,
        // Below the floor the café must update before it may keep running.
        below_minimum: latest.min_supported_version
          ? versionSort(reported) < versionSort(latest.min_supported_version)
          : false,
        download: available
          ? {
            url: latest.download_url,
            file_name: latest.file_name,
            file_size: latest.file_size != null ? Number(latest.file_size) : null,
            // The console verifies this before anything is applied. It is a
            // digest, not a secret — the signing key never leaves the build.
            sha512: latest.sha512
          }
          : null,
        licence: {
          cafe_name: license.cafe_name,
          expires_at: license.expires_at,
          max_pcs: license.max_pcs
        }
      }
    });
  } catch (error) {
    console.error('Error checking for updates:', error);
    res.status(500).json({ success: false, message: 'Could not check for updates' });
  } finally {
    client.release();
  }
};

/**
 * GET /api/updates/mine
 *
 * The same question as /check, asked by a café's own console over its
 * ordinary staff login instead of a licence key. No installation has gone
 * through licence activation yet, so this is what actually gets called today;
 * /check stays in place for whenever that flow exists. Entitlement follows
 * the subscription directly rather than license_keys.cafe_id, which is empty
 * for almost every café right now.
 *
 * No download block here on purpose — this endpoint answers "is one
 * available", not "here is the file". Fetching the artifact is the next
 * phase, once real releases exist to fetch.
 */
export const checkForUpdateMine = async (req, res) => {
  const client = await pool.connect();
  try {
    const refuse = (reason, detail) => res.json({
      success: true,
      data: { entitled: false, reason, detail, update_available: false }
    });

    const scope = await resolveOrganizationForCafe(req.actor?.cafe_id);
    if (!scope) return refuse('no_organization', 'This installation is not linked to a business yet.');

    const subscription = await getSubscription(scope.organizationId);
    if (!subscription || !LIVE_STATUSES.has(subscription.status)) {
      return refuse('subscription_lapsed', 'The subscription has lapsed. Renew to receive updates.');
    }

    const channelRow = (await client.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'updates.channel'`)).rows[0];
    const channel = channelRow?.setting_value === 'beta' ? 'beta' : 'stable';
    const component = req.query?.component === 'client' ? 'client' : 'server';

    const latest = (await client.query(`
      SELECT * FROM client_releases
      WHERE product = 'cafexp' AND component = $2 AND is_published
        AND (channel = $1 OR channel = 'stable')
      ORDER BY version_sort DESC LIMIT 1
    `, [channel, component])).rows[0];

    if (!latest) {
      return res.json({
        success: true,
        data: {
          entitled: true, component, update_available: false,
          reason: 'no_release', detail: `No ${component} release has been published yet.`
        }
      });
    }

    const reported = String(req.query?.current_version || '0.0.0');
    const available = isNewer(latest.version, reported);
    res.json({
      success: true,
      data: {
        entitled: true,
        component,
        update_available: available,
        current_version: reported,
        latest_version: latest.version,
        channel: latest.channel,
        release_notes: latest.release_notes,
        is_mandatory: latest.is_mandatory,
        below_minimum: latest.min_supported_version
          ? versionSort(reported) < versionSort(latest.min_supported_version)
          : false,
        // Was deliberately absent while no release existed to fetch — see
        // checkForUpdate's identical block, now that client_releases is
        // populated by the release pipeline this answers "here is the file"
        // too, not just "one exists".
        download: available
          ? {
            url: latest.download_url,
            file_name: latest.file_name,
            file_size: latest.file_size != null ? Number(latest.file_size) : null,
            sha512: latest.sha512
          }
          : null
      }
    });
  } catch (error) {
    console.error('Error checking for updates (mine):', error);
    res.status(500).json({ success: false, message: 'Could not check for updates' });
  } finally {
    client.release();
  }
};

/**
 * GET /api/portal/downloads
 *
 * The website's own Downloads page, not a station or a console — a portal
 * user asking "what can I install" before anything has been set up yet, so
 * this takes no licence, no subscription check and no reported version. It
 * is the one place `client_releases` is read by someone who isn't already
 * running CafeXP.
 */
export const getLatestDownloads = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT DISTINCT ON (component) component, version, release_notes,
             download_url, file_name, file_size, published_at
      FROM client_releases
      WHERE product = 'cafexp' AND is_published AND channel = 'stable'
      ORDER BY component, version_sort DESC
    `);

    const byComponent = {};
    rows.forEach((r) => {
      byComponent[r.component] = {
        version: r.version,
        release_notes: r.release_notes,
        download_url: r.download_url,
        file_name: r.file_name,
        file_size: r.file_size != null ? Number(r.file_size) : null,
        published_at: r.published_at
      };
    });

    res.json({
      success: true,
      data: { server: byComponent.server || null, client: byComponent.client || null }
    });
  } catch (error) {
    console.error('Error loading downloads:', error);
    res.status(500).json({ success: false, message: 'Could not load downloads' });
  } finally {
    client.release();
  }
};

/**
 * POST /api/updates/report
 *
 * A console telling ManagerXP how a rollout went. Advisory: it feeds the
 * platform view of which cafés are on which version, and is never used to
 * decide entitlement.
 */
export const reportUpdateState = async (req, res) => {
  const client = await pool.connect();
  try {
    const rawKey = String(req.body?.license_key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (rawKey.length < 10) return res.status(400).json({ success: false, message: 'Licence required' });
    const key = `${rawKey.slice(0, 3)}-${rawKey.slice(3).match(/.{1,4}/g).join('-')}`;

    const license = (await client.query(
      'SELECT cafe_id FROM license_keys WHERE license_key = $1', [key])).rows[0];
    if (!license) return res.status(403).json({ success: false, message: 'Not recognised' });

    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
    for (const ev of events) {
      await client.query(`
        INSERT INTO update_events (cafe_id, pc_name, from_version, to_version, state, detail)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        license.cafe_id,
        ev.pc_name ? String(ev.pc_name).slice(0, 160) : null,
        ev.from_version ? String(ev.from_version).slice(0, 32) : null,
        ev.to_version ? String(ev.to_version).slice(0, 32) : null,
        String(ev.state || 'unknown').slice(0, 24),
        ev.detail ? String(ev.detail).slice(0, 255) : null
      ]).catch(() => { /* one malformed event must not lose the batch */ });
    }

    res.json({ success: true, data: { recorded: events.length } });
  } catch (error) {
    console.error('Error recording update state:', error);
    res.status(500).json({ success: false, message: 'Could not record' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PLATFORM ADMIN — publishing releases
   ========================================================================== */

// GET /api/platform/releases
export const listReleases = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT r.*, u.name AS published_by_name,
             (SELECT COUNT(*)::int FROM pcs WHERE client_version = r.version) AS stations_on_version
      FROM client_releases r
      LEFT JOIN users u ON u.id = r.published_by
      ORDER BY r.version_sort DESC, r.created_at DESC
    `);
    res.json({
      success: true,
      data: rows.map((r) => ({ ...shapeRelease(r), published_by_name: r.published_by_name,
                               stations_on_version: r.stations_on_version }))
    });
  } catch (error) {
    console.error('Error listing releases:', error);
    res.status(500).json({ success: false, message: 'Error loading releases' });
  } finally {
    client.release();
  }
};

// POST /api/platform/releases
export const createRelease = async (req, res) => {
  const client = await pool.connect();
  try {
    const version = String(req.body?.version || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      return res.status(400).json({
        success: false,
        message: 'Version must look like 1.2.3'
      });
    }

    const product = ['cafexp', 'racexp'].includes(req.body?.product) ? req.body.product : 'cafexp';
    const channel = req.body?.channel === 'beta' ? 'beta' : 'stable';
    // The console is a separate Windows app on its own release line; a café
    // can be on client 1.4.0 and console 1.2.0 quite legitimately.
    const component = req.body?.component === 'server' ? 'server' : 'client';
    const publish = req.body?.is_published === true || req.body?.is_published === 'true';

    /* Publishing without a checksum would mean stations installing a package
       nobody verified. The column allows null so a draft can be created
       first, but it cannot be published in that state. */
    if (publish && (!req.body?.download_url || !req.body?.sha512)) {
      return res.status(400).json({
        success: false,
        message: 'A published release needs both a download URL and a sha512 checksum'
      });
    }

    const { rows } = await client.query(`
      INSERT INTO client_releases
        (product, component, version, channel, version_sort, release_notes,
         download_url, file_name, file_size, sha512, is_published, is_mandatory,
         min_supported_version, published_by, published_at)
      VALUES ($1,$14,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
              CASE WHEN $10 THEN CURRENT_TIMESTAMP ELSE NULL END)
      ON CONFLICT (product, component, version, channel) DO UPDATE SET
        release_notes = EXCLUDED.release_notes,
        download_url = EXCLUDED.download_url,
        file_name = EXCLUDED.file_name,
        file_size = EXCLUDED.file_size,
        sha512 = EXCLUDED.sha512,
        is_published = EXCLUDED.is_published,
        is_mandatory = EXCLUDED.is_mandatory,
        min_supported_version = EXCLUDED.min_supported_version,
        published_at = CASE WHEN EXCLUDED.is_published AND client_releases.published_at IS NULL
                            THEN CURRENT_TIMESTAMP ELSE client_releases.published_at END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      product, version, channel, versionSort(version),
      req.body?.release_notes || null,
      req.body?.download_url || null,
      req.body?.file_name || null,
      req.body?.file_size || null,
      req.body?.sha512 || null,
      publish,
      req.body?.is_mandatory === true || req.body?.is_mandatory === 'true',
      req.body?.min_supported_version || null,
      req.actor?.id || null,
      component
    ]);

    await recordAudit(req, {
      action: 'platform.release.publish',
      category: 'system',
      entity: 'client_release',
      entity_id: rows[0].release_id,
      sensitive: true,
      summary: `${publish ? 'Published' : 'Drafted'} ${product} ${component} ${version} (${channel})`,
      meta: { product, component, version, channel, mandatory: rows[0].is_mandatory }
    });

    res.status(201).json({
      success: true,
      message: publish ? `Version ${version} published` : `Version ${version} saved as a draft`,
      data: shapeRelease(rows[0])
    });
  } catch (error) {
    console.error('Error creating release:', error);
    res.status(500).json({ success: false, message: 'Error saving the release' });
  } finally {
    client.release();
  }
};

// PATCH /api/platform/releases/:id
export const updateRelease = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const publish = req.body?.is_published;

    if (publish === true || publish === 'true') {
      const existing = (await client.query(
        'SELECT download_url, sha512 FROM client_releases WHERE release_id = $1', [id])).rows[0];
      if (!existing) return res.status(404).json({ success: false, message: 'Release not found' });
      if (!existing.download_url || !existing.sha512) {
        return res.status(400).json({
          success: false,
          message: 'Add a download URL and checksum before publishing'
        });
      }
    }

    const { rows } = await client.query(`
      UPDATE client_releases
      SET is_published = COALESCE($2, is_published),
          is_mandatory = COALESCE($3, is_mandatory),
          release_notes = COALESCE($4, release_notes),
          published_at = CASE WHEN $2 = TRUE AND published_at IS NULL
                              THEN CURRENT_TIMESTAMP ELSE published_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE release_id = $1
      RETURNING *
    `, [
      id,
      publish === undefined ? null : (publish === true || publish === 'true'),
      req.body?.is_mandatory === undefined ? null
        : (req.body.is_mandatory === true || req.body.is_mandatory === 'true'),
      req.body?.release_notes ?? null
    ]);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Release not found' });

    await recordAudit(req, {
      action: 'platform.release.update',
      category: 'system',
      entity: 'client_release',
      entity_id: id,
      sensitive: true,
      summary: `Updated release ${rows[0].version}` +
        (publish !== undefined ? (rows[0].is_published ? ' — published' : ' — unpublished') : '')
    });

    res.json({ success: true, message: 'Release updated', data: shapeRelease(rows[0]) });
  } catch (error) {
    console.error('Error updating release:', error);
    res.status(500).json({ success: false, message: 'Error updating the release' });
  } finally {
    client.release();
  }
};

// GET /api/platform/releases/rollout
export const getRollout = async (req, res) => {
  const client = await pool.connect();
  try {
    /* Who is on what, across every café. The question a vendor actually asks
       after publishing is "has it landed", and this answers it. */
    const { rows } = await client.query(`
      SELECT COALESCE(p.client_version, 'unknown') AS version,
             COUNT(*)::int AS stations,
             COUNT(DISTINCT p.cafe_id)::int AS cafes,
             MAX(p.client_version_seen_at) AS last_seen
      FROM pcs p
      GROUP BY COALESCE(p.client_version, 'unknown')
      ORDER BY stations DESC
    `);

    const recent = await client.query(`
      SELECT e.*, c.name AS cafe_name
      FROM update_events e
      LEFT JOIN cafes c ON c.cafe_id = e.cafe_id
      ORDER BY e.created_at DESC LIMIT 50
    `);

    res.json({
      success: true,
      data: {
        by_version: rows,
        recent_events: recent.rows
      }
    });
  } catch (error) {
    console.error('Error building rollout view:', error);
    res.status(500).json({ success: false, message: 'Error loading rollout' });
  } finally {
    client.release();
  }
};
