import pool from '../config/database.js';
import { getSetting } from '../config/settings.js';

/*
 * Station telemetry.
 *
 * The client agent samples its own hardware counters and pushes them to the
 * admin console over the WebSocket that already exists; the console relays
 * them here. Nothing in this file invents a number: a counter the station
 * could not read arrives as null and is stored as null, because storing zero
 * would make an unreadable sensor look like a healthy idle machine.
 *
 * Samples are a time series. The most recent row per station is the live
 * view; older rows are the history, pruned on a schedule set in app_settings.
 */

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Clamp a percentage into 0..100, or null if it was never measured. */
const pct = (v) => {
  const n = num(v);
  if (n === null || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Number(n.toFixed(2))));
};

const int = (v) => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? null : Math.round(n);
};

const str = (v, max) =>
  v === null || v === undefined || v === '' ? null : String(v).slice(0, max);

const shape = (row) => ({
  telemetry_id: row.telemetry_id === undefined ? undefined : Number(row.telemetry_id),
  pc_id: row.pc_id,
  pc_name: row.pc_name,
  cpu_percent: num(row.cpu_percent),
  cpu_model: row.cpu_model,
  cpu_cores: row.cpu_cores,
  mem_total_bytes: num(row.mem_total_bytes),
  mem_used_bytes: num(row.mem_used_bytes),
  mem_percent: num(row.mem_percent),
  disk_total_bytes: num(row.disk_total_bytes),
  disk_free_bytes: num(row.disk_free_bytes),
  disk_percent: num(row.disk_percent),
  gpu_name: row.gpu_name,
  gpu_vram_bytes: num(row.gpu_vram_bytes),
  temperature_c: num(row.temperature_c),
  uptime_seconds: num(row.uptime_seconds),
  latency_ms: row.latency_ms,
  platform: row.platform,
  os_release: row.os_release,
  running_app: row.running_app,
  sampled_at: row.sampled_at,
  received_at: row.received_at
});

/** The thresholds a sample is judged against. One read, cached upstream. */
const thresholds = async () => ({
  cpu: await getSetting('telemetry.cpu_warn', 85),
  mem: await getSetting('telemetry.mem_warn', 90),
  disk: await getSetting('telemetry.disk_warn', 90),
  temp: await getSetting('telemetry.temp_warn', 85),
  stale: await getSetting('telemetry.stale_seconds', 90),
  sample: await getSetting('telemetry.sample_seconds', 15)
});

/**
 * What is wrong with this station right now, in words a café owner can act on.
 * A counter that was never measured raises nothing — silence is not a fault.
 */
const evaluate = (sample, limits, now) => {
  const alerts = [];
  if (!sample) return alerts;

  const ageSeconds = (now - new Date(sample.sampled_at)) / 1000;
  if (ageSeconds > Number(limits.stale)) {
    alerts.push({
      level: 'warning',
      metric: 'reporting',
      message: `No telemetry for ${Math.round(ageSeconds)}s`
    });
  }

  const check = (value, limit, metric, label, unit) => {
    if (value === null || value === undefined) return;
    if (Number(value) >= Number(limit)) {
      alerts.push({
        level: Number(value) >= Number(limit) + 8 ? 'critical' : 'warning',
        metric,
        message: `${label} at ${Number(value).toFixed(0)}${unit} (limit ${limit}${unit})`
      });
    }
  };

  check(sample.cpu_percent, limits.cpu, 'cpu', 'CPU', '%');
  check(sample.mem_percent, limits.mem, 'mem', 'Memory', '%');
  check(sample.disk_percent, limits.disk, 'disk', 'Disk', '%');
  check(sample.temperature_c, limits.temp, 'temp', 'Temperature', '°C');

  return alerts;
};

/* ==========================================================================
   INGEST
   ========================================================================== */
/*
 * POST /api/telemetry   { samples: [ {...}, ... ] }  or a single sample body.
 *
 * The console batches whatever it has collected since the last flush, so a
 * brief backend outage costs a gap rather than a lost station.
 */
export const ingest = async (req, res) => {
  const client = await pool.connect();
  try {
    const batch = Array.isArray(req.body?.samples) ? req.body.samples : [req.body];
    if (!batch.length) {
      return res.status(400).json({ success: false, message: 'No samples supplied' });
    }
    if (batch.length > 200) {
      return res.status(400).json({ success: false, message: 'Too many samples in one batch' });
    }

    // Resolve names to station rows once, not per sample.
    const names = [...new Set(batch.map((s) => String(s?.pc_name || '').trim()).filter(Boolean))];
    if (!names.length) {
      return res.status(400).json({ success: false, message: 'Every sample needs a pc_name' });
    }

    const known = await client.query(
      'SELECT pc_id, name FROM pcs WHERE name = ANY($1)', [names]
    );
    const idByName = new Map(known.rows.map((r) => [r.name, r.pc_id]));

    await client.query('BEGIN');

    let stored = 0;
    for (const s of batch) {
      const name = String(s?.pc_name || '').trim();
      if (!name) continue;

      await client.query(
        `INSERT INTO station_telemetry
           (pc_id, pc_name, cpu_percent, cpu_model, cpu_cores,
            mem_total_bytes, mem_used_bytes, mem_percent,
            disk_total_bytes, disk_free_bytes, disk_percent,
            gpu_name, gpu_vram_bytes, temperature_c, uptime_seconds,
            latency_ms, platform, os_release, running_app, sampled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 COALESCE($20::timestamptz, CURRENT_TIMESTAMP))`,
        [
          idByName.get(name) ?? null,
          name.slice(0, 120),
          pct(s?.cpu_percent),
          str(s?.cpu_model, 160),
          int(s?.cpu_cores),
          int(s?.mem_total_bytes),
          int(s?.mem_used_bytes),
          pct(s?.mem_percent),
          int(s?.disk_total_bytes),
          int(s?.disk_free_bytes),
          pct(s?.disk_percent),
          str(s?.gpu_name, 160),
          int(s?.gpu_vram_bytes),
          num(s?.temperature_c),
          int(s?.uptime_seconds),
          int(s?.latency_ms),
          str(s?.platform, 40),
          str(s?.os_release, 80),
          str(s?.running_app, 200),
          s?.sampled_at ? new Date(s.sampled_at).toISOString() : null
        ]
      );
      stored += 1;
    }

    await client.query('COMMIT');

    // Prune outside the transaction: losing a prune is harmless, losing the
    // sample that triggered it is not.
    pruneOldSamples().catch((e) => console.error('Telemetry prune failed:', e.message));

    const unknown = names.filter((n) => !idByName.has(n));
    res.status(201).json({
      success: true,
      message: `${stored} sample(s) stored`,
      // Named so the console can say which station is not registered rather
      // than silently dropping its metrics.
      unregistered_stations: unknown
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error storing telemetry:', error);
    res.status(500).json({ success: false, message: 'Error storing telemetry' });
  } finally {
    client.release();
  }
};

/** Drop samples past the retention window. Cheap; runs after each ingest. */
let lastPrune = 0;
const pruneOldSamples = async () => {
  // Once an hour is plenty — a sweep on every sample would be pure overhead.
  if (Date.now() - lastPrune < 3600_000) return;
  lastPrune = Date.now();

  const days = Number(await getSetting('telemetry.retention_days', 7));
  if (!Number.isFinite(days) || days <= 0) return;

  const result = await pool.query(
    `DELETE FROM station_telemetry
     WHERE sampled_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval`,
    [String(days)]
  );
  if (result.rowCount) {
    console.log(`Telemetry: pruned ${result.rowCount} sample(s) older than ${days} day(s)`);
  }
};

/* ==========================================================================
   READ
   ========================================================================== */
// GET /api/telemetry/latest — one row per station, with its verdict
export const latest = async (req, res) => {
  try {
    const limits = await thresholds();
    const now = new Date();

    // Every registered station appears, including ones that have never
    // reported — "no data" is the most important thing this page can say.
    const result = await pool.query(
      `SELECT p.pc_id, p.name AS pc_name, p.ip_address, p.is_active, p.zone_id,
              z.zone_name, t.*
       FROM pcs p
       LEFT JOIN floor_zones z ON z.zone_id = p.zone_id
       LEFT JOIN LATERAL (
         SELECT * FROM station_telemetry s
         WHERE s.pc_name = p.name
         ORDER BY s.sampled_at DESC
         LIMIT 1
       ) t ON TRUE
       ORDER BY p.name`
    );

    const stations = result.rows.map((row) => {
      const sample = row.sampled_at ? shape(row) : null;
      return {
        pc_id: row.pc_id,
        pc_name: row.pc_name,
        ip_address: row.ip_address,
        is_active: row.is_active,
        zone_name: row.zone_name || null,
        reporting: !!sample &&
          (now - new Date(sample.sampled_at)) / 1000 <= Number(limits.stale),
        sample,
        alerts: evaluate(sample, limits, now)
      };
    });

    res.status(200).json({
      success: true,
      data: stations,
      thresholds: limits,
      summary: {
        stations: stations.length,
        reporting: stations.filter((s) => s.reporting).length,
        never_reported: stations.filter((s) => !s.sample).length,
        alerting: stations.filter((s) => s.alerts.length).length
      }
    });
  } catch (error) {
    console.error('Error reading telemetry:', error);
    res.status(500).json({ success: false, message: 'Error reading telemetry' });
  }
};

/*
 * GET /api/telemetry/history/:pcName?minutes=60&points=120
 *
 * Buckets the window into a fixed number of points so a chart costs the same
 * whether it covers an hour or a week.
 */
export const history = async (req, res) => {
  try {
    const name = String(req.params.pcName || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'A station name is required' });
    }

    const minutes = Math.min(Math.max(parseInt(req.query.minutes, 10) || 60, 5), 60 * 24 * 7);
    const points = Math.min(Math.max(parseInt(req.query.points, 10) || 120, 10), 500);
    const bucketSeconds = Math.max(Math.round((minutes * 60) / points), 1);

    const result = await pool.query(
      `SELECT
         to_timestamp(floor(extract(epoch FROM sampled_at) / $1) * $1) AS bucket,
         ROUND(AVG(cpu_percent), 2)  AS cpu_percent,
         ROUND(AVG(mem_percent), 2)  AS mem_percent,
         ROUND(AVG(disk_percent), 2) AS disk_percent,
         ROUND(AVG(temperature_c), 2) AS temperature_c,
         ROUND(AVG(latency_ms))      AS latency_ms,
         COUNT(*)::int               AS samples
       FROM station_telemetry
       WHERE pc_name = $2
         AND sampled_at >= CURRENT_TIMESTAMP - ($3 || ' minutes')::interval
       GROUP BY bucket
       ORDER BY bucket`,
      [bucketSeconds, name, String(minutes)]
    );

    res.status(200).json({
      success: true,
      data: result.rows.map((r) => ({
        at: r.bucket,
        cpu_percent: num(r.cpu_percent),
        mem_percent: num(r.mem_percent),
        disk_percent: num(r.disk_percent),
        temperature_c: num(r.temperature_c),
        latency_ms: num(r.latency_ms),
        samples: r.samples
      })),
      window: { minutes, bucket_seconds: bucketSeconds, station: name }
    });
  } catch (error) {
    console.error('Error reading telemetry history:', error);
    res.status(500).json({ success: false, message: 'Error reading telemetry history' });
  }
};

// GET /api/telemetry/alerts — only the stations that need attention
export const alerts = async (req, res) => {
  try {
    const limits = await thresholds();
    const now = new Date();

    const result = await pool.query(
      `SELECT p.name AS pc_name, t.*
       FROM pcs p
       LEFT JOIN LATERAL (
         SELECT * FROM station_telemetry s
         WHERE s.pc_name = p.name ORDER BY s.sampled_at DESC LIMIT 1
       ) t ON TRUE
       WHERE p.is_active = TRUE
       ORDER BY p.name`
    );

    const flagged = [];
    result.rows.forEach((row) => {
      const sample = row.sampled_at ? shape(row) : null;
      // A station that has never reported is a setup gap, not an alert — the
      // latest view says so plainly instead of crying wolf here.
      if (!sample) return;
      const found = evaluate(sample, limits, now);
      if (found.length) flagged.push({ pc_name: row.pc_name, sample, alerts: found });
    });

    res.status(200).json({ success: true, data: flagged, thresholds: limits });
  } catch (error) {
    console.error('Error reading telemetry alerts:', error);
    res.status(500).json({ success: false, message: 'Error reading alerts' });
  }
};

// DELETE /api/telemetry/:pcName — clear one station's history
export const clearStation = async (req, res) => {
  try {
    const name = String(req.params.pcName || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'A station name is required' });
    }
    const result = await pool.query(
      'DELETE FROM station_telemetry WHERE pc_name = $1', [name]
    );
    res.status(200).json({
      success: true,
      message: `${result.rowCount} sample(s) removed for ${name}`
    });
  } catch (error) {
    console.error('Error clearing telemetry:', error);
    res.status(500).json({ success: false, message: 'Error clearing telemetry' });
  }
};
