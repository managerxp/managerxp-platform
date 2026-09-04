import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { getSetting } from '../config/settings.js';
import { checkLimit, checkStationLimit } from '../modules/entitlements/entitlements.service.js';

/**
 * POST /api/pcs/:id/client-version
 *
 * The console relays what a station reports about its own CafeXP Client build
 * the moment it connects. Advisory, like updates.Controller's reportUpdateState
 * — it feeds the version inventory an operator sees in Settings, never an
 * entitlement decision, so a station that misreports only confuses its own row.
 */
export const reportClientVersion = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const version = String(req.body?.version || '').trim().slice(0, 32);
    if (!version) return res.status(400).json({ success: false, message: 'A version is required' });

    const { rows } = await pool.query(`
      UPDATE pcs SET client_version = $2, client_version_seen_at = CURRENT_TIMESTAMP
      WHERE pc_id = $1 AND cafe_id = $3
      RETURNING pc_id, client_version, client_version_seen_at
    `, [id, version, req.actor.cafe_id]);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Station not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error recording client version:', error);
    res.status(500).json({ success: false, message: 'Could not record version' });
  }
};

// Get all PCs with optional filtering
/*
 * Which café's stations the caller may read.
 *
 * A station row is not just a name: it carries the IP address, the MAC address
 * and the port the console connects on. That is a map of a café's internal
 * network, and it was readable by anyone who could reach the port. "Machine
 * names are not a secret" was the reasoning; the rest of the row is.
 *
 * The vendor sees everything — supporting an install means seeing it. Everyone
 * else sees the café their token names.
 */
const cafeOf = (req) => {
  const actor = req.actor || {};
  if (actor.isPlatformAdmin) return null;          // no restriction
  return actor.cafe_id || 0;                       // 0 matches nothing
};

/** Someone else's café is answered as absent, never as forbidden. */
const deniesCafe = (req, cafeId) => {
  const scope = cafeOf(req);
  if (scope === null) return false;
  return String(scope) !== String(cafeId);
};

export const getAllPCs = async (req, res) => {
  try {
    const { cafe_id, branch_id, is_active } = req.query;
    let query = `
      SELECT p.*, 
             c.name as cafe_name,
             b.city as branch_name
      FROM pcs p
      LEFT JOIN cafes c ON p.cafe_id = c.cafe_id
      LEFT JOIN branches b ON p.branch_id = b.branch_id
      WHERE 1=1
    `;
    const queryParams = [];
    let paramCounter = 1;

    /* Applied before anything the caller asked for, and not removable by
       omitting the filter — the query string narrows this scope, it never
       widens it. */
    const scope = cafeOf(req);
    if (scope !== null) {
      query += ` AND p.cafe_id = $${paramCounter++}`;
      queryParams.push(scope);
    }

    if (cafe_id) {
      query += ` AND p.cafe_id = $${paramCounter++}`;
      queryParams.push(cafe_id);
    }
    if (branch_id) {
      query += ` AND p.branch_id = $${paramCounter++}`;
      queryParams.push(branch_id);
    }
    if (is_active !== undefined) {
      query += ` AND p.is_active = $${paramCounter++}`;
      queryParams.push(is_active === 'true');
    }

    query += ` ORDER BY p.created_at DESC`;

    const result = await pool.query(query, queryParams);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching PCs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching PCs',
      error: error.message
    });
  }
};

// Get PC by ID
export const getPCById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT p.*, 
             c.name as cafe_name,
             b.city as branch_name
      FROM pcs p
      LEFT JOIN cafes c ON p.cafe_id = c.cafe_id
      LEFT JOIN branches b ON p.branch_id = b.branch_id
      WHERE p.pc_id = $1
    `;
    
    const result = await pool.query(query, [id]);

    /* A station belonging to another café is reported missing, so the two
       cases are indistinguishable from outside. */
    if (result.rows.length === 0 || deniesCafe(req, result.rows[0].cafe_id)) {
      return res.status(404).json({
        success: false,
        message: 'PC not found'
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching PC',
      error: error.message
    });
  }
};

// Create new PC
export const createPC = async (req, res) => {
  try {
    const {
      cafe_id, branch_id, name, ip_address, mac_address, port, is_active,
      category, description
    } = req.body;

    if (!cafe_id || !branch_id || !name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: cafe_id, branch_id, name'
      });
    }

    /*
     * A station is networked or it is not.
     *
     * A gaming PC runs the CafeXP client and is reached over the network, so
     * it needs an address. A pool table, a dartboard or a console without the
     * client is still a thing the café sells time on, and has no address at
     * all — registering one used to mean inventing an IP for it.
     *
     * Half an address is the case worth refusing: it would look networked to
     * every screen that checks, and be unreachable.
     */
    const networked = !!(ip_address || mac_address);
    if (networked && !(ip_address && mac_address)) {
      return res.status(400).json({
        success: false,
        message: 'A networked station needs both an IP address and a MAC address'
      });
    }

    // Check if cafe exists
    const cafeCheck = await pool.query('SELECT cafe_id, organization_id FROM cafes WHERE cafe_id = $1', [cafe_id]);
    if (cafeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cafe not found'
      });
    }
    const orgId = cafeCheck.rows[0].organization_id;

    /* Entitlement, checked before the row exists rather than after: creating
       then deleting an over-limit station would still have let the plan be
       exceeded for the moment in between, and any code racing the count in
       that window would see it. A category of PC (or none set) draws down the
       overall Gaming PCs total; anything else only has its own per-type cap,
       if the plan sets one — see getUsage's category filter for why these two
       checks are mutually exclusive, not additive. */
    const normalizedCategory = category ? String(category).trim().slice(0, 60) || null : null;
    if (orgId) {
      const room = (!normalizedCategory || normalizedCategory === 'PC')
        ? await checkLimit(orgId, 'pc')
        : await checkStationLimit(orgId, normalizedCategory);
      if (!room.ok) {
        return res.status(409).json({ success: false, message: room.message, data: room });
      }
    }
    
    // Check if branch exists
    const branchCheck = await pool.query(
      'SELECT branch_id, name, max_pcs FROM branches WHERE branch_id = $1', [branch_id]
    );
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    const branch = branchCheck.rows[0];

    /* A branch's own max_pcs is a slice of the org's overall Gaming PCs total
       (see adminBranches.Controller.js's PC pool), so it only ever gates a
       PC — the same condition the org-wide check above uses. Unset means the
       branch draws from the shared pool with no allocation of its own. */
    if (branch.max_pcs != null && (!normalizedCategory || normalizedCategory === 'PC')) {
      const used = (await pool.query(`
        SELECT COUNT(*)::int AS n FROM pcs
        WHERE branch_id = $1 AND is_active AND device_type = 'GAMING_PC'
          AND (category = 'PC' OR category IS NULL)
      `, [branch_id])).rows[0].n;
      if (used >= branch.max_pcs) {
        return res.status(409).json({
          success: false,
          message: `${branch.name} has used all ${branch.max_pcs} of its allocated PCs. ` +
            'Raise its allocation or free one up.',
          data: { reason: 'branch_allocation_reached', used, max: branch.max_pcs }
        });
      }
    }

    /* Only meaningful for a networked station. Two pool tables both having no
       address is not a clash — it is the normal case. */
    if (networked) {
      const existingCheck = await pool.query(
        'SELECT pc_id FROM pcs WHERE ip_address = $1 OR mac_address = $2',
        [ip_address, mac_address]
      );
      if (existingCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'A station with this IP address or MAC address already exists'
        });
      }
    }

    const query = `
      INSERT INTO pcs (cafe_id, branch_id, organization_id, name, ip_address, mac_address, port,
                       is_active, category, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await pool.query(query, [
      cafe_id,
      branch_id,
      // Without this, a boot-time backfill (schema.tenancy.js) is the only
      // thing that ever sets it — which means every entitlement check above
      // (and every usage count anywhere else) is blind to this row until the
      // next restart. That is the gap that let the limit check above pass
      // once already: the row it should have been counting had no
      // organization_id yet to be counted by.
      orgId || null,
      name,
      ip_address || null,
      mac_address || null,
      // A station with no address has nothing to connect to, so no port either.
      networked ? (port || await getSetting('station.default_port', 9090)) : null,
      is_active !== undefined ? is_active : true,
      // What kind of play it hosts — decides its prices, its floor grouping,
      // and (above) which entitlement it just drew down.
      normalizedCategory,
      description ? String(description).trim().slice(0, 160) || null : null
    ]);
    
    res.status(201).json({
      success: true,
      message: 'PC created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating PC',
      error: error.message
    });
  }
};

// Update PC
export const updatePC = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      cafe_id, branch_id, name, ip_address, mac_address, is_active,
      category, status, description
    } = req.body;

    // Check if PC exists, and that it is this café's to change
    const pcCheck = await pool.query(
      'SELECT pc_id, cafe_id, organization_id, category FROM pcs WHERE pc_id = $1', [id]);
    if (pcCheck.rows.length === 0 || deniesCafe(req, pcCheck.rows[0].cafe_id)) {
      return res.status(404).json({
        success: false,
        message: 'PC not found'
      });
    }
    const existingPc = pcCheck.rows[0];

    // Build dynamic update query
    const updates = [];
    const queryParams = [];
    let paramCounter = 1;
    
    if (cafe_id !== undefined) {
      // Check if cafe exists
      const cafeCheck = await pool.query('SELECT cafe_id FROM cafes WHERE cafe_id = $1', [cafe_id]);
      if (cafeCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Cafe not found'
        });
      }
      updates.push(`cafe_id = $${paramCounter++}`);
      queryParams.push(cafe_id);
    }
    
    if (branch_id !== undefined) {
      // Check if branch exists
      const branchCheck = await pool.query('SELECT branch_id FROM branches WHERE branch_id = $1', [branch_id]);
      if (branchCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Branch not found'
        });
      }
      updates.push(`branch_id = $${paramCounter++}`);
      queryParams.push(branch_id);
    }
    
    if (name !== undefined) {
      updates.push(`name = $${paramCounter++}`);
      queryParams.push(name);
    }
    
    if (ip_address !== undefined) {
      // Check if IP address already exists for another PC
      const ipCheck = await pool.query(
        'SELECT pc_id FROM pcs WHERE ip_address = $1 AND pc_id != $2',
        [ip_address, id]
      );
      if (ipCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'PC with this IP address already exists'
        });
      }
      updates.push(`ip_address = $${paramCounter++}`);
      queryParams.push(ip_address);
    }
    
    if (mac_address !== undefined) {
      // Check if MAC address already exists for another PC
      const macCheck = await pool.query(
        'SELECT pc_id FROM pcs WHERE mac_address = $1 AND pc_id != $2',
        [mac_address, id]
      );
      if (macCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'PC with this MAC address already exists'
        });
      }
      updates.push(`mac_address = $${paramCounter++}`);
      queryParams.push(mac_address);
    }
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCounter++}`);
      queryParams.push(is_active);
    }

    /* What kind of play this station hosts — "PS5", "VR", "Pool". Empty
       clears it, which makes the station general purpose rather than
       restricted to one type. */
    if (category !== undefined) {
      const clean = category === null ? null : String(category).trim().slice(0, 60);

      /* A per-type cap on the plan is enforced here, where a station is given
         its type. Only when actually moving *to* a type — clearing it, or
         leaving it unchanged, is never blocked — and the station itself is
         excluded from the count so re-saving the same type is a no-op. The
         overall max_pcs cap is enforced separately at registration. */
      if (clean && clean !== existingPc.category && existingPc.organization_id) {
        const room = await checkStationLimit(existingPc.organization_id, clean, Number(id));
        if (!room.ok) {
          return res.status(409).json({ success: false, message: room.message, data: room });
        }
      }

      updates.push(`category = $${paramCounter++}`);
      queryParams.push(clean || null);
    }

    /* AVAILABLE / MAINTENANCE / INACTIVE. OCCUPIED is not settable: it is
       whether a session is open, and is derived rather than stored. */
    if (description !== undefined) {
      const clean = description === null ? null : String(description).trim().slice(0, 160);
      updates.push(`description = $${paramCounter++}`);
      queryParams.push(clean || null);
    }

    if (status !== undefined) {
      const allowed = ['AVAILABLE', 'MAINTENANCE', 'INACTIVE'];
      const next = String(status).toUpperCase();
      if (!allowed.includes(next)) {
        return res.status(400).json({
          success: false,
          message: `Status must be one of ${allowed.join(', ')}`
        });
      }
      updates.push(`status = $${paramCounter++}`);
      queryParams.push(next);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    
    const query = `
      UPDATE pcs 
      SET ${updates.join(', ')}
      WHERE pc_id = $${paramCounter}
      RETURNING *
    `;
    
    queryParams.push(id);
    
    const result = await pool.query(query, queryParams);
    
    res.status(200).json({
      success: true,
      message: 'PC updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating PC',
      error: error.message
    });
  }
};

// Delete PC (Soft delete by setting is_active to false)
export const deletePC = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;
    
    // Check if PC exists
    const pcCheck = await pool.query('SELECT pc_id, name, cafe_id FROM pcs WHERE pc_id = $1', [id]);
    if (pcCheck.rows.length === 0 || deniesCafe(req, pcCheck.rows[0].cafe_id)) {
      return res.status(404).json({
        success: false,
        message: 'PC not found'
      });
    }

    if (permanent === 'true') {
      // Permanent delete. Sessions, bills and telemetry reference this row, so
      // refuse rather than cascade away a station's trading history.
      const history = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM sessions WHERE pc_id = $1) AS sessions,
           (SELECT COUNT(*)::int FROM station_telemetry WHERE pc_id = $1) AS telemetry`,
        [id]
      );
      const counts = history.rows[0];

      if (counts.sessions > 0) {
        return res.status(409).json({
          success: false,
          message: `This station has ${counts.sessions} session(s) against it. ` +
            'Deactivate it instead — deleting would take its trading history with it.',
          data: counts
        });
      }

      // Telemetry is disposable, so clear it rather than block on it.
      await pool.query('DELETE FROM station_telemetry WHERE pc_id = $1', [id]);
      await pool.query('DELETE FROM pcs WHERE pc_id = $1', [id]);

      await recordAudit(req, {
        action: 'station.delete',
        category: 'station',
        entity: 'station',
        entity_id: id,
        sensitive: true,
        summary: `Permanently deleted station ${pcCheck.rows[0].name}`,
        meta: { telemetry_removed: counts.telemetry }
      });

      res.status(200).json({
        success: true,
        message: 'PC permanently deleted successfully'
      });
    } else {
      // Soft delete - just deactivate
      const result = await pool.query(
        `UPDATE pcs
         SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE pc_id = $1
         RETURNING *`,
        [id]
      );

      await recordAudit(req, {
        action: 'station.deactivate',
        category: 'station',
        entity: 'station',
        entity_id: id,
        sensitive: true,
        summary: `Deactivated station ${result.rows[0].name}`,
        meta: { ip_address: result.rows[0].ip_address }
      });

      res.status(200).json({
        success: true,
        message: 'PC deactivated successfully',
        data: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error deleting PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting PC',
      error: error.message
    });
  }
};

// Restore PC (reactivate soft-deleted PC)
export const restorePC = async (req, res) => {
  try {
    const { id } = req.params;

    /* Scoped in the UPDATE itself rather than checked first: a separate read
       then write leaves a window, and the whole point is that this row is not
       the caller's to touch. */
    const scope = cafeOf(req);
    const result = await pool.query(
      `UPDATE pcs
       SET is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE pc_id = $1 AND is_active = false
         ${scope === null ? '' : 'AND cafe_id = $2'}
       RETURNING *`,
      scope === null ? [id] : [id, scope]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'PC not found or already active'
      });
    }
    
    await recordAudit(req, {
      action: 'station.restore',
      category: 'station',
      entity: 'station',
      entity_id: id,
      summary: `Reactivated station ${result.rows[0].name}`,
      meta: { ip_address: result.rows[0].ip_address }
    });

    res.status(200).json({
      success: true,
      message: 'PC restored successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error restoring PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error restoring PC',
      error: error.message
    });
  }
};

// Get PCs by branch
export const getPCsByBranch = async (req, res) => {
  try {
    const { branchId } = req.params;
    
    /* A branch id belongs to exactly one café, so scoping by café here also
       stops a branch of somebody else's being read by guessing its number. */
    const scope = cafeOf(req);
    const query = `
      SELECT p.*, c.name as cafe_name
      FROM pcs p
      LEFT JOIN cafes c ON p.cafe_id = c.cafe_id
      WHERE p.branch_id = $1
        ${scope === null ? '' : 'AND p.cafe_id = $2'}
      ORDER BY p.name ASC
    `;

    const result = await pool.query(query, scope === null ? [branchId] : [branchId, scope]);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching PCs by branch:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching PCs by branch',
      error: error.message
    });
  }
};

// Get active PCs only
export const getActivePCs = async (req, res) => {
  try {
    const { cafe_id, branch_id } = req.query;
    let query = `
      SELECT p.*, 
             c.name as cafe_name,
             b.city as branch_name
      FROM pcs p
      LEFT JOIN cafes c ON p.cafe_id = c.cafe_id
      LEFT JOIN branches b ON p.branch_id = b.branch_id
      WHERE p.is_active = true
    `;
    const queryParams = [];
    let paramCounter = 1;

    const activeScope = cafeOf(req);
    if (activeScope !== null) {
      query += ` AND p.cafe_id = $${paramCounter++}`;
      queryParams.push(activeScope);
    }

    if (cafe_id) {
      query += ` AND p.cafe_id = $${paramCounter++}`;
      queryParams.push(cafe_id);
    }
    if (branch_id) {
      query += ` AND p.branch_id = $${paramCounter++}`;
      queryParams.push(branch_id);
    }
    
    query += ` ORDER BY p.name ASC`;
    
    const result = await pool.query(query, queryParams);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching active PCs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active PCs',
      error: error.message
    });
  }
};

//get pc by cafe id
export const getPCsByCafe = async (req, res) => {
  try {
    const { cafeId } = req.params;

    /* Reading another café's stations answers as though it has none, rather
       than refusing — a 403 would confirm the café exists and that its id is
       worth walking. */
    if (deniesCafe(req, cafeId)) {
      return res.status(200).json({ success: true, data: [], count: 0 });
    }

    const query = `
      SELECT p.*, b.city as branch_name
      FROM pcs p
      LEFT JOIN branches b ON p.branch_id = b.branch_id
      WHERE p.cafe_id = $1
      ORDER BY p.name ASC
    `;
    const result = await pool.query
    (query, [cafeId]);
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  }
    catch (error) {
    console.error('Error fetching PCs by cafe:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching PCs by cafe',
      error: error.message
    });
  }
};

// Check if PC exists by IP or MAC address
// Auto-updates IP if MAC address matches but IP is different (handles unknown PC scenario)
export const checkPCExists = async (req, res) => {
  try {
    const { ip_address, mac_address } = req.body;
    
    if (!ip_address && !mac_address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide ip_address or mac_address'
      });
    }
    
    // First check if PC exists by MAC address (since MAC is more reliable)
    if (mac_address) {
      const macQuery = 'SELECT pc_id, name, ip_address, mac_address, cafe_id, branch_id FROM pcs WHERE mac_address = $1';
      const macResult = await pool.query(macQuery, [mac_address]);
      
      if (macResult.rows.length > 0) {
        const existingPC = macResult.rows[0];
        
        // If IP address is provided and different from database IP, auto-update it
        if (ip_address && existingPC.ip_address !== ip_address) {
          console.log(`🔄 IP Auto-Update: MAC ${mac_address} found. Updating IP from ${existingPC.ip_address} to ${ip_address}`);
          
          const updateQuery = `
            UPDATE pcs 
            SET ip_address = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE mac_address = $2 
            RETURNING *
          `;
          
          const updateResult = await pool.query(updateQuery, [ip_address, mac_address]);
          
          return res.status(200).json({
            success: true,
            exists: true,
            ip_updated: true,
            message: `PC found. IP auto-updated from ${existingPC.ip_address} to ${ip_address}`,
            data: updateResult.rows[0]
          });
        }
        
        // If IP is same or not provided, just return the existing PC
        return res.status(200).json({
          success: true,
          exists: true,
          ip_updated: false,
          data: existingPC
        });
      }
    }
    
    // If MAC not found, check by IP address
    if (ip_address) {
      const ipQuery = 'SELECT pc_id, name, ip_address, mac_address FROM pcs WHERE ip_address = $1';
      const ipResult = await pool.query(ipQuery, [ip_address]);
      
      if (ipResult.rows.length > 0) {
        return res.status(200).json({
          success: true,
          exists: true,
          ip_updated: false,
          data: ipResult.rows[0]
        });
      }
    }
    
    // PC not found in database
    res.status(200).json({
      success: true,
      exists: false,
      message: 'PC not found in database'
    });
  } catch (error) {
    console.error('Error checking PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking PC',
      error: error.message
    });
  }
};

// Register a new discovered PC
// Auto-updates IP if MAC already exists (handles unknown PC with changed IP)
export const registerDiscoveredPC = async (req, res) => {
  try {
    const { cafe_id, branch_id, name, ip_address, mac_address, port, hostname } = req.body;
    
    // Validate required fields
    if (!ip_address || !mac_address) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: ip_address, mac_address'
      });
    }
    
    // Use provided name or hostname as fallback
    const pc_name = name || hostname || `PC-${mac_address.substring(0, 8)}`;
    
    // Auto-discovered stations often arrive without a cafe or branch. The
    // fallbacks come from app_settings rather than being pinned to 1 in code.
    const final_cafe_id = cafe_id || await getSetting('station.default_cafe_id', 1);
    const final_branch_id = branch_id || await getSetting('station.default_branch_id', 1);
    
    // Check if MAC address already exists (case where PC moved/changed IP)
    const macExistsCheck = await pool.query(
      'SELECT pc_id, ip_address FROM pcs WHERE mac_address = $1',
      [mac_address]
    );
    
    if (macExistsCheck.rows.length > 0) {
      const existingPC = macExistsCheck.rows[0];
      
      // If IP is different, update it
      if (existingPC.ip_address !== ip_address) {
        console.log(`🔄 IP Auto-Update on Register: MAC ${mac_address} found. Updating IP from ${existingPC.ip_address} to ${ip_address}`);
        
        const updateQuery = `
          UPDATE pcs 
          SET ip_address = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE mac_address = $2 
          RETURNING *
        `;
        
        const updateResult = await pool.query(updateQuery, [ip_address, mac_address]);
        
        return res.status(200).json({
          success: true,
          registered: false,
          ip_updated: true,
          message: `PC already exists. IP auto-updated from ${existingPC.ip_address} to ${ip_address}`,
          data: updateResult.rows[0]
        });
      }
      
      // MAC exists with same IP, just return the existing PC
      return res.status(200).json({
        success: true,
        registered: false,
        ip_updated: false,
        message: 'PC already registered with same configuration',
        data: macExistsCheck.rows[0]
      });
    }
    
    // Check if IP address already exists for another PC
    const ipExistsCheck = await pool.query(
      'SELECT pc_id FROM pcs WHERE ip_address = $1',
      [ip_address]
    );
    
    if (ipExistsCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'PC with this IP address already exists',
        conflict: 'ip_address'
      });
    }
    
    // Create new PC since MAC doesn't exist
    const query = `
      INSERT INTO pcs (cafe_id, branch_id, name, ip_address, mac_address, port, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      final_cafe_id,
      final_branch_id,
      pc_name,
      ip_address,
      mac_address,
      port || await getSetting('station.default_port', 9090),
      true
    ]);
    
    res.status(201).json({
      success: true,
      registered: true,
      message: 'PC registered successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error registering PC:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering PC',
      error: error.message
    });
  }
};

