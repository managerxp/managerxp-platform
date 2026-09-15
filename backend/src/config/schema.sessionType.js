/* ==========================================================================
   Session type — which billing model produced this session.

   Two genuinely different things create a row in `sessions` today: a
   customer logging into a kiosk (billed by occupancy — grace period, then
   metered until logout) and staff manually starting play for a walk-in from
   the console (billed by a game+duration price chosen up front, unchanged).
   Both share the same table and the same pause/resume/extend/end machinery,
   which is correct — they are the same kind of record. What they are not is
   the same kind of *session*, and a report or a support conversation asking
   "why was this one billed like that" needs the answer on the row itself,
   not inferred from which fields happen to be null.

   Defaults to STAFF_MANUAL — every session created before this column
   existed, and every call site that doesn't yet pass session_type, was and
   remains that kind.

   grace_seconds is the same rate-lock idea already applied to rate_per_hour:
   the café's "buffer time" setting can change after a session has started,
   and a session already mid-grace must keep the boundary it started with,
   not the one an admin sets five minutes later. NULL on a row created before
   this column means "fall back to the live setting" — see gracedSeconds in
   session.Controller.js.
   ========================================================================== */
export const initializeSessionType = async (client) => {
  await client.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS session_type VARCHAR(20) NOT NULL DEFAULT 'STAFF_MANUAL'
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sessions_session_type_check'
      ) THEN
        ALTER TABLE sessions
          ADD CONSTRAINT sessions_session_type_check
          CHECK (session_type IN ('STAFF_MANUAL','KIOSK_OCCUPANCY'));
      END IF;
    END $$;
  `);

  await client.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS grace_seconds INTEGER
  `);

  /* setSetting() only creates a café's own row by copying value_type off the
     platform default row — so these defaults must exist before any café can
     override them. occupancy.rates_by_category is a per-station-category
     hourly rate for kiosk occupancy billing (a PS5 occupies differently than
     a bare PC); "_default" covers any category with no entry of its own. */
  await client.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, category, description) VALUES
      ('occupancy.rates_by_category',      '{}',  'json',   'session',
       'Hourly rate for kiosk occupancy billing, per station category — {"PS5":100,"Pool":80,"_default":60}. A category with no entry falls back to "_default", then to session.default_rate_per_hour.'),
      ('session.heartbeat_timeout_seconds','300', 'number', 'session',
       'How long a kiosk occupancy session can go without a heartbeat before the server closes it and bills using the last known timestamps')
    ON CONFLICT (setting_key) WHERE cafe_id IS NULL DO NOTHING
  `);

  console.log('✅ Session type column created/verified');
};

export default { initializeSessionType };
