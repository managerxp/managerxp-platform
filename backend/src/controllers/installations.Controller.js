/*
 * Installation and device registration — the desktop side.
 *
 * Section 30 is explicit that there are no customer-facing licence keys. An
 * installation earns its identity by signing in: the café owner authenticates
 * in the CafeXP server app, the app registers itself, and it receives an
 * installation_id and a credential of its own. From then on the *machine*
 * authenticates, not the person, which is what lets a café be revoked without
 * touching anyone's password.
 *
 * Three properties this file is built around:
 *
 *   The credential is shown once. It is hashed on arrival and never returned
 *   again — it is a secret, not a reference number, which is exactly the
 *   difference between it and the licence key it replaces.
 *
 *   Revoking means revoked. A revoked installation cannot quietly re-register
 *   itself under the same device identifier; if it could, revoking would be a
 *   suggestion. Coming back requires an administrator.
 *
 *   Limits are enforced here, not in the app. The desktop client asks to
 *   register; the server decides whether it may.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';
import { checkLimit, getEntitlements, getSubscription } from '../modules/entitlements/entitlements.service.js';

/** Which organization and branch does this café principal belong to? */
const resolveScope = async (actor, requestedBranchId) => {
  const cafeId = Number(actor?.cafe_id);
  if (!Number.isFinite(cafeId) || cafeId <= 0) return null;

  const cafe = (await pool.query(
    'SELECT cafe_id, organization_id FROM cafes WHERE cafe_id = $1', [cafeId]
  )).rows[0];
  if (!cafe?.organization_id) return null;

  /* A branch id in the request is a claim. It is only honoured if that branch
     genuinely belongs to this café's organization — otherwise an installation
     could be filed under someone else's location. */
  let branchId = null;
  if (requestedBranchId) {
    const owned = (await pool.query(
      'SELECT branch_id FROM branches WHERE branch_id = $1 AND organization_id = $2',
      [Number(requestedBranchId), cafe.organization_id]
    )).rows[0];
    if (!owned) return { ...cafe, branchId: null, badBranch: true };
    branchId = owned.branch_id;
  } else {
    const first = (await pool.query(`
      SELECT branch_id FROM branches
      WHERE organization_id = $1 AND status <> 'CLOSED'
      ORDER BY branch_id LIMIT 1
    `, [cafe.organization_id])).rows[0];
    branchId = first?.branch_id || null;
  }

  return { cafeId: cafe.cafe_id, organizationId: cafe.organization_id, branchId };
};

const newPublicId = () => `CXI-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

/* ==========================================================================
   REGISTRATION
   ========================================================================== */

/**
 * POST /api/installations/register
 *
 * Called by the CafeXP server app once, after the owner signs in. Idempotent
 * on device_identifier: running the app again on the same machine returns the
 * same installation rather than consuming another seat.
 */
export const registerInstallation = async (req, res) => {
  try {
    const scope = await resolveScope(req.actor, req.body?.branch_id);
    if (!scope) {
      return res.status(400).json({
        success: false,
        message: 'This account is not linked to a business yet. Finish setting up in the portal first.'
      });
    }
    if (scope.badBranch) {
      // Same answer as "no such branch" — confirming it exists but belongs to
      // someone else tells an attacker which ids are worth trying.
      return res.status(404).json({ success: false, message: 'No such branch' });
    }

    const deviceIdentifier = String(req.body?.device_identifier || '').trim().slice(0, 128);
    if (!deviceIdentifier) {
      return res.status(400).json({ success: false, message: 'A device identifier is required' });
    }

    const existing = (await pool.query(`
      SELECT * FROM installations
      WHERE organization_id = $1 AND device_identifier = $2
    `, [scope.organizationId, deviceIdentifier])).rows[0];

    /* Revoked stays revoked. Letting the same machine re-register would make
       revocation a formality, and revocation is how a stolen server or a
       closed branch is actually stopped. */
    if (existing?.status === 'REVOKED') {
      return res.status(403).json({
        success: false,
        message: 'This installation has been revoked. Contact ManagerXP support to restore it.',
        data: { installation_id: existing.public_id, status: 'REVOKED' }
      });
    }
    if (existing?.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        message: 'This installation is suspended.',
        data: { installation_id: existing.public_id, status: 'SUSPENDED' }
      });
    }

    const name = String(req.body?.name || '').trim().slice(0, 160) || null;
    const version = String(req.body?.version || '').trim().slice(0, 32) || null;

    /* A fresh credential every registration. The app stores it; nobody else
       ever sees it again, including us. */
    const credential = crypto.randomBytes(32).toString('base64url');
    const credentialHash = await bcrypt.hash(credential, 10);

    let installation;
    if (existing) {
      installation = (await pool.query(`
        UPDATE installations
        SET name = COALESCE($2, name), version = COALESCE($3, version),
            branch_id = COALESCE($4, branch_id), cafe_id = $5,
            credential_hash = $6, credential_issued_at = CURRENT_TIMESTAMP,
            status = 'ACTIVE',
            last_authorized_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE installation_id = $1 RETURNING *
      `, [existing.installation_id, name, version, scope.branchId, scope.cafeId, credentialHash])).rows[0];
    } else {
      /* Only a new installation consumes a seat. Re-running the app on a
         machine that is already registered must not be able to exhaust the
         customer's allowance. */
      const allowed = await checkLimit(scope.organizationId, 'installation');
      if (!allowed.ok) {
        return res.status(409).json({ success: false, message: allowed.message, data: allowed });
      }

      installation = (await pool.query(`
        INSERT INTO installations
          (public_id, organization_id, branch_id, cafe_id, name, device_identifier,
           credential_hash, credential_issued_at, status, version,
           last_authorized_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,'ACTIVE',$8,
                CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        RETURNING *
      `, [newPublicId(), scope.organizationId, scope.branchId, scope.cafeId,
          name, deviceIdentifier, credentialHash, version])).rows[0];
    }

    const [entitlements, graceHours] = await Promise.all([
      getEntitlements(scope.organizationId, scope.branchId),
      getSetting('entitlements.offline_grace_hours', 72)
    ]);

    res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? 'Installation re-registered' : 'Installation registered',
      data: {
        installation_id: installation.installation_id,
        public_id: installation.public_id,
        organization_id: installation.organization_id,
        branch_id: installation.branch_id,
        status: installation.status,
        /* Returned exactly once. There is no endpoint that hands it back. */
        credential,
        offline_grace_hours: Number(graceHours),
        subscription: entitlements.subscription,
        modules: entitlements.modules,
        features: entitlements.features
      }
    });
  } catch (error) {
    console.error('Installation registration failed:', error);
    res.status(500).json({ success: false, message: 'Could not register this installation' });
  }
};

/**
 * POST /api/installations/authorize   { public_id, credential, version? }
 *
 * The machine authenticating as itself, with no user involved. This is what
 * the app calls at start-up and periodically after: it is both the "am I still
 * allowed to run" check and the entitlement refresh.
 */
export const authorizeInstallation = async (req, res) => {
  try {
    const publicId = String(req.body?.public_id || '').trim();
    const credential = String(req.body?.credential || '');
    if (!publicId || !credential) {
      return res.status(400).json({ success: false, message: 'Installation credentials are required' });
    }

    const installation = (await pool.query(
      'SELECT * FROM installations WHERE public_id = $1', [publicId]
    )).rows[0];

    /* One answer for "no such installation" and "wrong credential", for the
       same reason the login page has one. */
    const ok = installation?.credential_hash
      && await bcrypt.compare(credential, installation.credential_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'This installation could not be authorised' });
    }

    if (installation.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: installation.status === 'REVOKED'
          ? 'This installation has been revoked.'
          : 'This installation is not active.',
        data: { status: installation.status, reason: installation.revoked_reason }
      });
    }

    const version = String(req.body?.version || '').trim().slice(0, 32) || null;
    await pool.query(`
      UPDATE installations
      SET last_authorized_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP,
          version = COALESCE($2, version), updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1
    `, [installation.installation_id, version]);

    const [entitlements, graceHours] = await Promise.all([
      getEntitlements(installation.organization_id, installation.branch_id),
      getSetting('entitlements.offline_grace_hours', 72)
    ]);

    res.json({
      success: true,
      data: {
        installation_id: installation.installation_id,
        public_id: installation.public_id,
        organization_id: installation.organization_id,
        branch_id: installation.branch_id,
        status: 'ACTIVE',
        offline_grace_hours: Number(graceHours),
        subscription: entitlements.subscription,
        modules: entitlements.modules,
        features: entitlements.features,
        authorized_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Installation authorisation failed:', error);
    res.status(500).json({ success: false, message: 'Could not authorise this installation' });
  }
};

/**
 * POST /api/installations/devices   { device_identifier, name, device_type }
 *
 * A station registering under an installation. The PC limit is enforced here,
 * against the organization's whole pool — and separately against the branch's
 * allocation, because a café that has divided its pool means those divisions
 * to hold.
 */
export const registerDevice = async (req, res) => {
  try {
    const scope = await resolveScope(req.actor, req.body?.branch_id);
    if (!scope || scope.badBranch) {
      return res.status(400).json({ success: false, message: 'This account is not linked to a business' });
    }

    const identifier = String(req.body?.device_identifier || '').trim().slice(0, 128);
    const name = String(req.body?.name || '').trim().slice(0, 160);
    const type = String(req.body?.device_type || 'GAMING_PC').toUpperCase();
    const allowedTypes = ['GAMING_PC', 'SERVER', 'FRONT_DESK', 'ADMIN', 'MANAGER'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: `device_type must be one of ${allowedTypes.join(', ')}` });
    }
    if (!identifier || !name) {
      return res.status(400).json({ success: false, message: 'A device identifier and name are required' });
    }

    const installation = req.body?.installation_id
      ? (await pool.query(
          'SELECT * FROM installations WHERE installation_id = $1 AND organization_id = $2',
          [Number(req.body.installation_id), scope.organizationId])).rows[0]
      : null;

    const existing = (await pool.query(`
      SELECT * FROM pcs WHERE organization_id = $1 AND mac_address = $2
    `, [scope.organizationId, identifier])).rows[0];

    if (!existing) {
      /* Only gaming PCs count against the allowance. Charging a café for its
         own till would be charging them to take money. */
      if (type === 'GAMING_PC') {
        const allowed = await checkLimit(scope.organizationId, 'pc');
        if (!allowed.ok) {
          return res.status(409).json({ success: false, message: allowed.message, data: allowed });
        }

        if (scope.branchId) {
          const branch = (await pool.query(
            'SELECT name, max_pcs FROM branches WHERE branch_id = $1', [scope.branchId])).rows[0];
          if (branch?.max_pcs != null) {
            const used = (await pool.query(`
              SELECT COUNT(*)::int AS n FROM pcs
              WHERE branch_id = $1 AND is_active AND device_type = 'GAMING_PC'
                AND (category = 'PC' OR category IS NULL)
            `, [scope.branchId])).rows[0].n;
            if (used >= branch.max_pcs) {
              return res.status(409).json({
                success: false,
                message: `${branch.name} has used all ${branch.max_pcs} of its allocated PCs. ` +
                  'Raise its allocation or free one up.',
                data: { reason: 'branch_allocation_reached', used, max: branch.max_pcs }
              });
            }
          }
        }
      }

      const created = (await pool.query(`
        INSERT INTO pcs (cafe_id, branch_id, organization_id, installation_id, name,
                         ip_address, mac_address, device_type, is_active,
                         registered_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        RETURNING *
      `, [scope.cafeId, scope.branchId, scope.organizationId,
          installation?.installation_id || null, name,
          String(req.body?.ip_address || '0.0.0.0').slice(0, 255), identifier, type])).rows[0];

      return res.status(201).json({ success: true, message: `${name} registered`, data: created });
    }

    const updated = (await pool.query(`
      UPDATE pcs SET name = $2, branch_id = COALESCE($3, branch_id),
                     installation_id = COALESCE($4, installation_id),
                     is_active = TRUE, last_seen_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
      WHERE pc_id = $1 RETURNING *
    `, [existing.pc_id, name, scope.branchId, installation?.installation_id || null])).rows[0];

    res.json({ success: true, message: `${name} re-registered`, data: updated });
  } catch (error) {
    console.error('Device registration failed:', error);
    res.status(500).json({ success: false, message: 'Could not register this device' });
  }
};

/** GET /api/installations/mine — what this café has registered. */
export const listMine = async (req, res) => {
  try {
    const scope = await resolveScope(req.actor);
    if (!scope) return res.json({ success: true, data: [] });

    const { rows } = await pool.query(`
      SELECT i.installation_id, i.public_id, i.name, i.status, i.version,
             i.last_seen_at, i.last_authorized_at, i.registered_at,
             b.name AS branch_name,
             (SELECT COUNT(*)::int FROM pcs p WHERE p.installation_id = i.installation_id
                AND p.is_active) AS device_count
      FROM installations i
      LEFT JOIN branches b ON b.branch_id = i.branch_id
      WHERE i.organization_id = $1
      ORDER BY i.registered_at DESC
    `, [scope.organizationId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Installation list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load installations' });
  }
};

export { resolveScope };
