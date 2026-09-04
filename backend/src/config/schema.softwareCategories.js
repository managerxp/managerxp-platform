/* ==========================================================================
   Per-branch category filing.

   software_master.category is one column on a row every café shares, so when
   a café filed PlayStation 5 under "PS5" it re-filed it for every other café
   on the platform — and the last one to touch it won. Cosmetic compared to
   the price leak, but it is still one business writing into another's screen.

   A category is not part of a title's identity. It is how *this branch*
   arranges *its own* till: the same PS5 might sit under "Console" at the
   flagship and "PS5" at the second site, and neither is wrong. So the fix is
   an override per branch rather than a fight over one shared column.

   Scoped to cafe_id — the branch — not organization_id. Two branches of the
   same business run different floors with different station mixes, and the
   till layout follows the floor, not the letterhead. A chain that wants both
   branches filed identically sets the same category twice, which is a great
   deal cheaper than a chain that cannot tell them apart at all.

   A row here means "this branch has an opinion". No row means it takes the
   published default, so the table stays small and a café that never touches
   categories never appears in it.
   ========================================================================== */
export const initializeSoftwareCategories = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS software_category_overrides (
      cafe_id INTEGER NOT NULL REFERENCES cafes(cafe_id) ON DELETE CASCADE,
      software_id INTEGER NOT NULL REFERENCES software_master(software_id) ON DELETE CASCADE,
      category VARCHAR(64),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (cafe_id, software_id)
    )
  `);

  /* Every read is "this branch's overrides, joined onto the catalogue", which
     the primary key already serves. This index covers the reverse question —
     "who has re-filed this title" — used when a title is retired. */
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_software_category_overrides_software
      ON software_category_overrides (software_id)
  `);

  console.log('✅ Per-branch software categories created/verified');
};

export default { initializeSoftwareCategories };
