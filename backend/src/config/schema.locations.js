/*
 * The location master — countries, states, cities.
 *
 * Global data, deliberately not tenant-scoped. There is one `countries` table
 * for the whole platform, not one per customer; a café in Hyderabad and a café
 * in Dubai pick from the same list, and correcting a misspelt city corrects it
 * for everyone at once. That is the entire reason this is master data rather
 * than three text columns.
 *
 * The importer below is separated from the dataset it reads. Replacing
 * `locations.dataset.js` with a fuller export needs no change here, and the
 * upsert is keyed on natural identifiers so re-running it corrects rows rather
 * than duplicating them.
 */
import { COUNTRIES, STATES, CITIES, CAPITALS } from '../data/locations.dataset.js';

export const initializeLocations = async (client) => {
  /* ======================================================================
     COUNTRIES
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS countries (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      iso2_code CHAR(2) NOT NULL UNIQUE,
      iso3_code CHAR(3) NOT NULL UNIQUE,
      phone_code VARCHAR(8),
      currency_code VARCHAR(8),
      currency_name VARCHAR(80),
      timezone VARCHAR(64),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_countries_name ON countries (LOWER(name))`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_countries_active ON countries (is_active)`);

  /* ======================================================================
     STATES
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS states (
      id SERIAL PRIMARY KEY,
      country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
      name VARCHAR(140) NOT NULL,
      code VARCHAR(12),
      type VARCHAR(40) NOT NULL DEFAULT 'State',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_states_country ON states (country_id, is_active)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_states_name ON states (LOWER(name))`);
  /* Natural key for the upsert: a country never has two divisions of the same
     name, and this is what lets the importer be re-run safely. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_states_country_name ON states (country_id, LOWER(name))
  `);

  /* ======================================================================
     CITIES

     `country_id` is carried here as well as on the state. It is redundant by
     normalisation and worth it twice over: filtering and validating a city
     against a country becomes one index lookup instead of a join, and the
     constraint below turns "city belongs to a state in another country" from
     a bug into something the database refuses to store.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS cities (
      id SERIAL PRIMARY KEY,
      state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
      country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
      name VARCHAR(140) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cities_state ON cities (state_id, is_active)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cities_country ON cities (country_id, is_active)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cities_name ON cities (LOWER(name))`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_state_name ON cities (state_id, LOWER(name))
  `);

  /* The pair (id, country_id) on states gives cities something to point at, so
     a city's country cannot disagree with its state's country. Without this
     the redundancy above would be a second place for the truth to drift. */
  /* Order matters, and getting it wrong only shows up on the second boot.
     The foreign key below depends on the unique constraint above it, so the
     dependant is dropped first and added back last. Dropping the unique
     constraint while the FK still references it is refused by Postgres —
     which passes silently on a fresh database, where neither exists yet, and
     then stops the server booting on every run after that. */
  await client.query(`
    ALTER TABLE cities DROP CONSTRAINT IF EXISTS fk_cities_state_country
  `);
  await client.query(`
    ALTER TABLE states DROP CONSTRAINT IF EXISTS uq_states_id_country
  `);
  await client.query(`
    ALTER TABLE states ADD CONSTRAINT uq_states_id_country UNIQUE (id, country_id)
  `);
  await client.query(`
    ALTER TABLE cities ADD CONSTRAINT fk_cities_state_country
      FOREIGN KEY (state_id, country_id) REFERENCES states (id, country_id) ON DELETE CASCADE
  `);

  /* ======================================================================
     TENANT LOCATION COLUMNS

     Added alongside the existing text columns, not instead of them. The text
     is left in place until the backfill below has been seen to work — losing
     a customer's address to a migration would be a far worse outcome than
     carrying two representations for a while.
     ====================================================================== */
  for (const [table, key] of [['organizations', 'organization_id'], ['branches', 'branch_id']]) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS country_id INTEGER REFERENCES countries(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS state_id INTEGER REFERENCES states(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS address_line_1 VARCHAR(255)`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS address_line_2 VARCHAR(255)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_country ON ${table} (country_id)`);
  }

  await importLocations(client);
  await backfillTenantLocations(client);
};

/**
 * Upsert the dataset.
 *
 * Idempotent on natural keys, so a restart corrects a renamed city rather than
 * adding a second one. Existing rows are never deactivated by an import — an
 * operator may have switched a country off deliberately, and a redeploy must
 * not quietly switch it back on.
 */
export const importLocations = async (client) => {
  let countries = 0, states = 0, cities = 0;

  for (const [name, iso2, iso3, phone, currency, currencyName, timezone] of COUNTRIES) {
    await client.query(`
      INSERT INTO countries (name, iso2_code, iso3_code, phone_code, currency_code, currency_name, timezone)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (iso2_code) DO UPDATE SET
        name = EXCLUDED.name, iso3_code = EXCLUDED.iso3_code,
        phone_code = EXCLUDED.phone_code, currency_code = EXCLUDED.currency_code,
        currency_name = EXCLUDED.currency_name, timezone = EXCLUDED.timezone,
        updated_at = CURRENT_TIMESTAMP
    `, [name, iso2, iso3, phone, currency, currencyName, timezone]);
    countries++;
  }

  const idOf = new Map(
    (await client.query('SELECT id, iso2_code FROM countries')).rows.map((r) => [r.iso2_code, r.id])
  );

  for (const [iso2, rows] of Object.entries(STATES)) {
    const countryId = idOf.get(iso2);
    if (!countryId) continue;
    for (const [name, code, type] of rows) {
      await client.query(`
        INSERT INTO states (country_id, name, code, type) VALUES ($1,$2,$3,$4)
        ON CONFLICT (country_id, LOWER(name)) DO UPDATE SET
          code = EXCLUDED.code, type = EXCLUDED.type, updated_at = CURRENT_TIMESTAMP
      `, [countryId, name, code, type]);
      states++;
    }
  }

  /* A country with no divisions listed gets one standing in for itself, so the
     cascade always has a next step. */
  for (const [iso2, capital] of Object.entries(CAPITALS)) {
    const countryId = idOf.get(iso2);
    if (!countryId || STATES[iso2]) continue;
    const country = (await client.query('SELECT name FROM countries WHERE id = $1', [countryId])).rows[0];
    await client.query(`
      INSERT INTO states (country_id, name, code, type) VALUES ($1,$2,$3,'Country')
      ON CONFLICT (country_id, LOWER(name)) DO NOTHING
    `, [countryId, country.name, iso2]);
    states++;

    const stateId = (await client.query(
      'SELECT id FROM states WHERE country_id = $1 AND LOWER(name) = LOWER($2)',
      [countryId, country.name])).rows[0]?.id;
    if (stateId) {
      await client.query(`
        INSERT INTO cities (state_id, country_id, name) VALUES ($1,$2,$3)
        ON CONFLICT (state_id, LOWER(name)) DO NOTHING
      `, [stateId, countryId, capital]);
      cities++;
    }
  }

  const stateKey = new Map();
  for (const row of (await client.query(`
    SELECT s.id, s.code, c.iso2_code FROM states s JOIN countries c ON c.id = s.country_id
    WHERE s.code IS NOT NULL
  `)).rows) {
    stateKey.set(`${row.iso2_code}:${row.code}`, row.id);
  }

  for (const [key, names] of Object.entries(CITIES)) {
    const stateId = stateKey.get(key);
    if (!stateId) continue;
    const countryId = idOf.get(key.split(':')[0]);
    for (const name of names) {
      await client.query(`
        INSERT INTO cities (state_id, country_id, name) VALUES ($1,$2,$3)
        ON CONFLICT (state_id, LOWER(name)) DO NOTHING
      `, [stateId, countryId, name]);
      cities++;
    }
  }

  console.log(`✅ Location master: ${countries} countries, ${states} states, ${cities} cities`);
  return { countries, states, cities };
};

/**
 * Match existing free-text addresses onto the master, without destroying them.
 *
 * Only exact, case-insensitive matches are taken. A fuzzy match here would
 * quietly file a café in the wrong city and nobody would find out until an
 * invoice or a tax return was wrong; leaving the id null and the text intact
 * is the recoverable failure.
 */
export const backfillTenantLocations = async (client) => {
  const filled = await client.query(`
    UPDATE organizations o SET country_id = c.id, updated_at = CURRENT_TIMESTAMP
    FROM countries c
    WHERE o.country_id IS NULL AND o.country IS NOT NULL
      AND LOWER(TRIM(o.country)) = LOWER(c.name)
  `);

  await client.query(`
    UPDATE organizations o SET state_id = s.id
    FROM states s
    WHERE o.state_id IS NULL AND o.country_id = s.country_id
      AND o.state IS NOT NULL AND LOWER(TRIM(o.state)) = LOWER(s.name)
  `);

  await client.query(`
    UPDATE organizations o SET city_id = ci.id
    FROM cities ci
    WHERE o.city_id IS NULL AND o.state_id = ci.state_id
      AND o.city IS NOT NULL AND LOWER(TRIM(o.city)) = LOWER(ci.name)
  `);

  /* Address text moves into line 1 only when line 1 is empty, so re-running
     cannot overwrite an address somebody has since corrected. */
  await client.query(`
    UPDATE organizations SET address_line_1 = address
    WHERE address_line_1 IS NULL AND address IS NOT NULL AND address <> ''
  `);

  if (filled.rowCount > 0) {
    console.log(`✅ Location backfill: ${filled.rowCount} organization(s) matched to a country`);
  }
};
