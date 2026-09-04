/* ==========================================================================
   Seed a testing super administrator, and unlock every feature for one café.

   For working on ManagerXP, not for running it. It mints a credential and
   switches a café to the top plan so every screen can be reached, which is
   exactly what you want on a laptop and exactly what you do not want on a
   machine serving real cafés.

   Run:  node scripts/seed-test-superadmin.mjs
         node scripts/seed-test-superadmin.mjs --org 7      (a different café)

   Nothing here is destructive to existing admin accounts: the ManagerXP login
   is a new row. The café owner's password IS reset, because the console cannot
   be signed into without one — that is called out in the output.
   ========================================================================== */
import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../src/config/database.js';

const ADMIN_EMAIL = 'superadmin@managerxp.test';
const args = process.argv.slice(2);
const orgArg = args.indexOf('--org');
const ORG_ID = orgArg !== -1 ? parseInt(args[orgArg + 1], 10) : 1;

/*
 * Refuse to run anywhere that looks live.
 *
 * A seeding script that mints a super administrator is the single worst thing
 * to run against production by accident, and "I was in the wrong terminal" is
 * how it happens. The check is deliberately noisy rather than clever.
 */
const guardEnvironment = () => {
  const url = String(process.env.DATABASE_URL || '');
  const host = String(process.env.DB_HOST || '').toLowerCase();
  const env = String(process.env.NODE_ENV || '').toLowerCase();

  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || !host || ['localhost', '127.0.0.1'].includes(host);
  const looksProd = env === 'production' || /amazonaws|azure|render|railway|supabase|neon\.tech/i.test(url + host);

  if (looksProd || !looksLocal) {
    console.error('\nREFUSING TO RUN.');
    console.error('  This creates a super administrator and unlocks every paid feature.');
    console.error(`  NODE_ENV=${env || '(unset)'}  DB_HOST=${host || '(unset)'}`);
    console.error('  It only runs against a local database. Nothing has been changed.\n');
    process.exit(1);
  }
};

/** Readable but not guessable: 4 groups of 5 from an unambiguous alphabet. */
const makePassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  const pick = () => alphabet[crypto.randomInt(alphabet.length)];
  return Array.from({ length: 4 }, () => Array.from({ length: 5 }, pick).join('')).join('-');
};

const main = async () => {
  guardEnvironment();

  const password = makePassword();
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  const done = [];

  try {
    await client.query('BEGIN');

    /* ---- 1. the ManagerXP super administrator ------------------------- */
    const role = await client.query(
      `SELECT admin_role_id FROM admin_roles WHERE role_key = 'SUPER_ADMIN'`);
    if (!role.rows.length) throw new Error('No SUPER_ADMIN role — start the server once to seed the schema.');
    const roleId = role.rows[0].admin_role_id;

    const admin = await client.query(
      `INSERT INTO admin_users (email, name, password_hash, admin_role_id, status)
       VALUES ($1, 'Test Super Admin', $2, $3, 'ACTIVE')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             admin_role_id = EXCLUDED.admin_role_id,
             status = 'ACTIVE',
             failed_attempts = 0,
             locked_until = NULL
       RETURNING admin_user_id, email`,
      [ADMIN_EMAIL, hash, roleId]
    );
    done.push(`ManagerXP super admin: ${admin.rows[0].email}`);

    /* ---- 2. the café, and who owns it --------------------------------- */
    const org = await client.query(
      `SELECT organization_id, name FROM organizations WHERE organization_id = $1`, [ORG_ID]);
    if (!org.rows.length) throw new Error(`No organization ${ORG_ID}`);

    const sub = await client.query(
      `SELECT subscription_id, cafe_id FROM subscriptions WHERE organization_id = $1
        ORDER BY subscription_id LIMIT 1`, [ORG_ID]);
    if (!sub.rows.length) throw new Error(`Organization ${ORG_ID} has no subscription`);
    const cafeId = sub.rows[0].cafe_id;

    const owner = await client.query(
      `SELECT u.id, u.email FROM cafes c JOIN users u ON u.id = c.user_id WHERE c.cafe_id = $1`,
      [cafeId]);
    if (owner.rows.length) {
      await client.query(
        `UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [hash, owner.rows[0].id]);
      done.push(`Café owner (CafeXP console): ${owner.rows[0].email}`);
    }

    /* ---- 3. the top plan, so no limit gets in the way ------------------ */
    const elite = await client.query(
      `SELECT sub_id, name, max_pcs, max_branches, max_users, max_managers, max_installations
         FROM subscription_plans WHERE code = 'ELITE' AND is_active LIMIT 1`);
    if (!elite.rows.length) throw new Error('No ELITE plan found');
    const p = elite.rows[0];

    await client.query(
      `UPDATE subscriptions
          SET sub_id = $1, type = 'PAID', status = 'ACTIVE', is_active = TRUE,
              start_date = CURRENT_TIMESTAMP,
              end_date = CURRENT_TIMESTAMP + INTERVAL '10 years',
              trial_ends_at = NULL,
              max_pcs = $2, max_branches = $3, max_users = $4,
              max_managers = $5, max_installations = $6,
              cancelled_at = NULL, cancel_reason = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE subscription_id = $7`,
      [p.sub_id, p.max_pcs, p.max_branches, p.max_users, p.max_managers,
       p.max_installations, sub.rows[0].subscription_id]
    );
    done.push(`${org.rows[0].name} → ${p.name}, active for 10 years (${p.max_pcs} PCs, ${p.max_branches} branches)`);

    /* ---- 4. every feature on, explicitly ------------------------------- */
    /* An override sits above the plan in the resolution order, so this holds
       even if the plan is later changed underneath it. It also clears the
       FNB = false override that was switched off from the admin console and
       would otherwise keep F&B locked no matter which plan is chosen. */
    const features = await client.query(`SELECT feature_key FROM features WHERE is_active`);
    for (const { feature_key } of features.rows) {
      await client.query(
        `INSERT INTO entitlement_overrides
           (organization_id, branch_id, feature_key, enabled, note)
         VALUES ($1, NULL, $2, TRUE, 'Testing — unlocked by seed-test-superadmin')
         /* The unique index is plain, not partial, and declares NULLS NOT
            DISTINCT — so a NULL branch_id collides properly and the conflict
            target needs no predicate. */
         ON CONFLICT (organization_id, branch_id, feature_key)
         DO UPDATE SET enabled = TRUE, expires_at = NULL,
                       note = 'Testing — unlocked by seed-test-superadmin'`,
        [ORG_ID, feature_key]
      );
    }
    done.push(`${features.rows.length} features force-enabled for organization ${ORG_ID}`);

    await client.query('COMMIT');

    console.log('\n' + '='.repeat(66));
    console.log('  TEST SUPER ADMIN READY');
    console.log('='.repeat(66));
    done.forEach((d) => console.log('  ✓ ' + d));
    console.log('\n  Password for BOTH accounts (shown once, not stored anywhere):\n');
    console.log('      ' + password + '\n');
    console.log('  ManagerXP console : http://localhost:5173/login');
    console.log('                      ' + ADMIN_EMAIL);
    if (owner.rows.length) {
      console.log('  CafeXP console    : ' + owner.rows[0].email);
    }
    console.log('\n  Development only. Delete before this database is ever served');
    console.log('  from anywhere but your machine.');
    console.log('='.repeat(66) + '\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed, nothing changed:', error.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

main();
