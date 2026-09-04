/* ==========================================================================
   Per-café settings.

   app_settings was one row per key for the whole platform, so a café that
   turned GST on turned it on for every café, and the receipt footer one owner
   wrote was printed by all of them. The `scope` column separated café
   settings from platform ones but never separated one café from another.

   ── The model ─────────────────────────────────────────────────────────────
   cafe_id IS NULL   the default — what the setting is until somebody changes
                     it, and the only row a platform-scoped setting ever has
   cafe_id = N       café N's own answer, which wins for café N alone

   A café that has never touched a setting has no row of its own and simply
   reads the default, so this costs nothing until it is used and a new café
   starts life with sensible values rather than an empty table.

   ── Why not just add cafe_id to the primary key ───────────────────────────
   NULL is never equal to NULL in a unique index, so a single index over
   (setting_key, cafe_id) would happily allow ten copies of the default row.
   Two partial indexes say what is actually meant: one default per key, and
   one override per key per café.
   ========================================================================== */
export const initializeSettingsScoping = async (client) => {
  /*
   * The column, the dropped primary key and the two partial indexes are all
   * applied much earlier — immediately after app_settings is created — because
   * every seed in this codebase writes a default through
   * `ON CONFLICT (setting_key) WHERE cafe_id IS NULL`, and a conflict target
   * cannot reference an index that does not exist yet.
   *
   * What is left for here is the foreign key, which needs `cafes` to exist and
   * so genuinely cannot run before the tenancy tables.
   */
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_cafe_fk'
      ) THEN
        ALTER TABLE app_settings
          ADD CONSTRAINT app_settings_cafe_fk
          FOREIGN KEY (cafe_id) REFERENCES cafes(cafe_id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_app_settings_lookup
      ON app_settings (cafe_id, setting_key)
  `);

  /*
   * Existing rows become the defaults.
   *
   * They already are, in effect — every café reads them today — so leaving
   * them at cafe_id NULL preserves exactly the current behaviour. Nothing
   * changes for anybody until a café saves a value of its own.
   */
  console.log('✅ Per-café settings created/verified');
};

export default { initializeSettingsScoping };
