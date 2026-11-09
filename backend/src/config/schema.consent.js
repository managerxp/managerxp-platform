/*
 * Website visitor consent records (DPDP Act 2023, s.6).
 *
 * Append-only: every time a visitor accepts, limits, customises or withdraws
 * consent, a new row is written and nothing is ever updated. The history is
 * the proof that consent was asked for, what was chosen, under which policy
 * version, and when.
 *
 * Data minimisation: no IP address and no account link. `consent_id` is a
 * random UUID the visitor's own browser generates; it ties one browser's
 * changes together without identifying the person.
 */

export const CONSENT_ACTIONS = ['accept_all', 'necessary_only', 'custom', 'withdraw'];

export const initializeConsent = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS consent_records (
      record_id      SERIAL PRIMARY KEY,
      consent_id     UUID NOT NULL,
      policy_version VARCHAR(32) NOT NULL,
      necessary      BOOLEAN NOT NULL DEFAULT TRUE,
      preferences    BOOLEAN NOT NULL,
      analytics      BOOLEAN NOT NULL,
      marketing      BOOLEAN NOT NULL,
      action         VARCHAR(16) NOT NULL
        CHECK (action IN ('accept_all', 'necessary_only', 'custom', 'withdraw')),
      page           VARCHAR(200),
      user_agent     VARCHAR(255),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS consent_records_consent_id_idx
      ON consent_records (consent_id, created_at DESC)
  `);
};
