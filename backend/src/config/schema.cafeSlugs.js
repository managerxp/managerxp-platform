/* ==========================================================================
   Café slugs — a stable, URL-safe id for a café's public booking page
   (managerxp.com/book/:slug), independent of its display name so a rename
   never breaks a link already handed out.

   Cafés are created from four different places (a plain signup, the fuller
   organization-provisioning signup, an owner adding a second branch, and a
   platform-admin-created one) — rather than touching all four INSERT
   statements, every café missing a slug is backfilled here, which runs on
   every boot. A café created between one restart and the next has no public
   link for that window; self-heals at the next restart, which in practice
   is often.
   ========================================================================== */

const slugify = (name) => String(name).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cafe';

export const initializeCafeSlugs = async (client) => {
  await client.query(`ALTER TABLE cafes ADD COLUMN IF NOT EXISTS slug VARCHAR(80)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cafes_slug ON cafes (slug) WHERE slug IS NOT NULL`);

  const missing = await client.query(`SELECT cafe_id, name FROM cafes WHERE slug IS NULL ORDER BY cafe_id`);
  for (const row of missing.rows) {
    const base = slugify(row.name);
    let slug = base, n = 1;
    // eslint-disable-next-line no-await-in-loop
    while ((await client.query('SELECT 1 FROM cafes WHERE slug = $1', [slug])).rows.length) {
      slug = `${base}-${++n}`;
    }
    // eslint-disable-next-line no-await-in-loop
    await client.query('UPDATE cafes SET slug = $1 WHERE cafe_id = $2', [slug, row.cafe_id]);
  }

  console.log('✅ Café slugs created/verified');
};
