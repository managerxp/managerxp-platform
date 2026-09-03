/**
 * RaceXP telemetry engine — deterministic lap simulation.
 *
 * There is no live timing feed in this project, so this generates telemetry
 * from a track model rather than inventing numbers. Every channel is a pure
 * function of position around the lap: the corner list drives a target-speed
 * profile, speed drives gear/RPM/throttle/brake, and integrating 1/speed over
 * distance produces the lap and sector times. The same position therefore
 * always yields the same readings, and the car genuinely slows for corners and
 * accelerates down the straights.
 *
 * The UI labels this as simulated. Nothing here is presented as a live feed.
 *
 * Track metadata (length, corner count, elevation) is the circuit's real
 * published data. The driver is fictional. Car performance figures are
 * simulation parameters chosen to produce a plausible GT3 lap, not a
 * manufacturer specification sheet.
 */

/* -------------------------------------------------------------- track model */

/**
 * The circuit traced as ordered waypoints, following the real Nordschleife
 * layout: north out of the start/finish straight, anti-clockwise up the
 * western side through Flugplatz and Aremberg, across the north through
 * Bergwerk, down the eastern side through Karussell, Brünnchen and
 * Pflanzgarten, then the long Döttinger Höhe straight back to Tiergarten.
 *
 * Named entries are the corners that shape the speed profile; `v` is the apex
 * speed in km/h. Unnamed entries only steer the drawn line.
 *
 * Both the track map and each corner's position around the lap are derived
 * from this one list, so the moving car and the corner read-out cannot drift
 * apart. Coordinates are traced from the circuit's published layout — a
 * schematic, not a surveyed GPS trace.
 */
const NORDSCHLEIFE_OUTLINE = [
  { x: 398, y: 612 },                                        // start/finish
  { x: 408, y: 560, name: 'Nordkehre', v: 130 },
  { x: 366, y: 552, name: 'Hatzenbach', v: 110 },
  { x: 300, y: 566 },
  { x: 262, y: 552, name: 'Hocheichen', v: 145 },
  { x: 292, y: 508, name: 'Quiddelbacher Höhe', v: 210 },
  { x: 214, y: 486, name: 'Flugplatz', v: 215 },
  { x: 246, y: 424, name: 'Kottenborn', v: 190 },
  { x: 224, y: 374, name: 'Schwedenkreuz', v: 205 },
  { x: 170, y: 340, name: 'Aremberg', v: 105 },
  { x: 178, y: 312, name: 'Poststraße', v: 150 },
  { x: 246, y: 302, name: 'Fuchsröhre', v: 185 },
  { x: 214, y: 252, name: 'Adenauer Forst', v: 80 },
  { x: 268, y: 186, name: 'Metzgesfeld', v: 140 },
  { x: 260, y: 130, name: 'Kallenhard', v: 110 },
  { x: 316, y: 122, name: 'Wehrseifen', v: 65 },
  { x: 372, y: 96, name: 'Ex-Mühle', v: 95 },
  { x: 422, y: 116, name: 'Breidscheid', v: 120 },
  { x: 480, y: 58, name: 'Bergwerk', v: 85 },
  { x: 562, y: 120, name: 'Kesselchen', v: 200 },
  { x: 640, y: 130, name: 'Klostertal', v: 115 },
  { x: 624, y: 170, name: 'Mutkurve', v: 100 },
  { x: 684, y: 180, name: 'Karussell', v: 55 },
  { x: 744, y: 100, name: 'Hohe Acht', v: 120 },
  { x: 802, y: 104, name: 'Hedwigshöhe', v: 145 },
  { x: 840, y: 132, name: 'Wippermann', v: 110 },
  { x: 808, y: 164, name: 'Eschbach', v: 125 },
  { x: 848, y: 192, name: 'Brünnchen', v: 105 },
  { x: 796, y: 212, name: 'Eiskurve', v: 115 },
  { x: 780, y: 248, name: 'Pflanzgarten I', v: 150 },
  { x: 746, y: 290, name: 'Sprunghügel', v: 165 },
  { x: 796, y: 334, name: 'Pflanzgarten II', v: 140 },
  { x: 662, y: 322, name: 'Schwalbenschwanz', v: 95 },
  { x: 622, y: 344, name: 'Kleines Karussell', v: 75 },
  { x: 694, y: 384, name: 'Galgenkopf', v: 170 },
  { x: 600, y: 456, name: 'Döttinger Höhe', v: 285 },
  { x: 520, y: 514 },
  { x: 496, y: 530, name: 'Antoniusbuche', v: 245 },
  { x: 460, y: 556, name: 'Tiergarten', v: 190 }
];

/**
 * Smooth closed curve through the waypoints: each point acts as a control
 * handle between the midpoints of its neighbouring segments, which gives a
 * flowing racing line rather than a polygon.
 */
const buildOutlinePath = (pts) => {
  const mid = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const n = pts.length;
  const first = mid(pts[n - 1], pts[0]);
  let d = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % n]);
    d += ` Q ${cur.x} ${cur.y} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return `${d} Z`;
};

/**
 * Corner positions as a fraction of the lap, measured along the traced
 * outline. Deriving them from the geometry keeps the corner read-out aligned
 * with wherever the car actually is on the map.
 */
const buildCornerList = (pts) => {
  const n = pts.length;
  const seg = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const total = seg.reduce((a, b) => a + b, 0);

  const corners = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    if (pts[i].name) corners.push({ at: run / total, v: pts[i].v, name: pts[i].name });
    run += seg[i];
  }
  return corners.sort((a, b) => a.at - b.at);
};

const NORDSCHLEIFE_PATH = buildOutlinePath(NORDSCHLEIFE_OUTLINE);
const NORDSCHLEIFE_CORNERS = buildCornerList(NORDSCHLEIFE_OUTLINE);

export const tracks = {
  nurburgringNordschleife: {
    id: 'nurburgringNordschleife',
    name: 'Nürburgring Nordschleife',
    shortName: 'Nordschleife',
    nickname: 'Green Hell',
    country: 'Germany',
    location: 'Nürburg, Germany',
    lengthKm: 20.832,
    corners: 73,
    elevationM: 300,
    path: NORDSCHLEIFE_PATH,
    viewBox: '0 0 960 700',
    cornerList: NORDSCHLEIFE_CORNERS,
    // Sector splits as a fraction of the lap.
    sectors: [
      { id: 'S1', from: 0, to: 0.34 },
      { id: 'S2', from: 0.34, to: 0.68 },
      { id: 'S3', from: 0.68, to: 1 }
    ]
  }
};

/* ---------------------------------------------------------------- car model */

export const cars = {
  porsche911GT3R: {
    id: 'porsche911GT3R',
    manufacturer: 'Porsche',
    model: '911 GT3 R',
    label: 'Porsche 911 GT3 R',
    class: 'GT3',
    drivetrain: 'Rear-wheel drive',
    gearbox: '6-speed sequential',
    // Simulation parameters, not a manufacturer specification sheet.
    sim: {
      topSpeed: 295,
      gearShiftPoints: [0, 85, 120, 160, 200, 240],
      redline: 9000,
      idleRpm: 3200,
      fuelCapacity: 100,
      fuelPerLap: 11.4
    }
  }
};

export const drivers = {
  alexMorgan: {
    // Fictional driver created for this simulation.
    name: 'Alex Morgan',
    number: 27,
    nationality: 'United Kingdom',
    category: 'GT3 Pro'
  }
};

/* ------------------------------------------------------- speed profile calc */

const SAMPLES = 720;
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Shortest distance between two positions on a closed lap.
 */
const wrapDist = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
};

/**
 * Target speed at a position: the lowest corner-limited speed that applies,
 * where each corner's influence widens with how much it slows the car.
 * Approaching a corner costs more distance than leaving it, which is what
 * gives braking zones their asymmetric shape.
 */
const targetSpeed = (pos, corners, topSpeed) => {
  let v = topSpeed;

  for (const c of corners) {
    // Signed distance: negative before the apex, positive after.
    let delta = pos - c.at;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;

    // The modelled corner list is a subset of the circuit's 73 turns, so the
    // influence zones are widened to stand in for the linking corners between
    // them. Without this the car spends unrealistically long at top speed and
    // the lap comes out far quicker than a GT3 actually laps here.
    const severity = (topSpeed - c.v) / topSpeed;
    const brakeZone = 0.013 + severity * 0.036;
    const accelZone = 0.017 + severity * 0.055;

    let limit;
    if (delta < 0) {
      const t = Math.min(1, -delta / brakeZone);
      limit = lerp(c.v, topSpeed, t * t);
    } else {
      const t = Math.min(1, delta / accelZone);
      limit = lerp(c.v, topSpeed, Math.sqrt(t));
    }
    if (limit < v) v = limit;
  }

  return v;
};

/**
 * Build a full lap table: speed at each sample plus cumulative elapsed time,
 * derived by integrating segment distance over speed.
 */
const buildLap = (track, car, pace = () => 1) => {
  const segmentKm = track.lengthKm / SAMPLES;

  const speed = new Float32Array(SAMPLES);
  const time = new Float32Array(SAMPLES + 1);

  for (let i = 0; i < SAMPLES; i++) {
    const p = i / SAMPLES;
    // Pace varies around the lap so the reference lap is quicker in some
    // places and slower in others, which makes the delta swing either side of
    // zero the way a real comparison does.
    speed[i] = targetSpeed(p, track.cornerList, car.sim.topSpeed) * pace(p);
  }

  for (let i = 0; i < SAMPLES; i++) {
    // hours = km / (km/h) -> seconds
    time[i + 1] = time[i] + (segmentKm / speed[i]) * 3600;
  }

  return { speed, time, lapTime: time[SAMPLES] };
};

/* ------------------------------------------------------------ public engine */

export const createTelemetry = ({
  track = tracks.nurburgringNordschleife,
  car = cars.porsche911GT3R,
  driver = drivers.alexMorgan
} = {}) => {
  const current = buildLap(track, car);
  // Reference lap: fractionally quicker overall, but with the gain distributed
  // unevenly around the circuit, so the delta moves both ways through the lap
  // and finishes slightly negative.
  const reference = buildLap(track, car, (p) => 1.005 - 0.030 * Math.cos(p * Math.PI * 4));

  const lapTime = current.lapTime;
  const referenceLapTime = reference.lapTime;

  /** Position (0-1) for a given elapsed time within the lap. */
  const positionAtTime = (elapsed) => {
    const t = Math.max(0, Math.min(lapTime, elapsed));
    // Binary search the cumulative time table.
    let lo = 0;
    let hi = SAMPLES;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (current.time[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = current.time[lo + 1] - current.time[lo] || 1;
    return (lo + (t - current.time[lo]) / span) / SAMPLES;
  };

  /** Elapsed lap time at a given position. */
  const timeAtPosition = (pos, table = current) => {
    const p = ((pos % 1) + 1) % 1;
    const idx = p * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(idx));
    return lerp(table.time[i], table.time[i + 1], idx - i);
  };

  const speedAt = (pos) => {
    const p = ((pos % 1) + 1) % 1;
    const idx = p * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(idx));
    const j = (i + 1) % SAMPLES;
    return lerp(current.speed[i], current.speed[j], idx - i);
  };

  const sectorFor = (pos) =>
    track.sectors.find((s) => pos >= s.from && pos < s.to) || track.sectors[track.sectors.length - 1];

  const cornerFor = (pos) => {
    let best = track.cornerList[0];
    let bestD = 1;
    for (const c of track.cornerList) {
      const d = wrapDist(pos, c.at);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  const gearFor = (speed) => {
    const pts = car.sim.gearShiftPoints;
    let gear = 1;
    for (let i = 0; i < pts.length; i++) if (speed >= pts[i]) gear = i + 1;
    return Math.min(6, gear);
  };

  const rpmFor = (speed, gear) => {
    const pts = car.sim.gearShiftPoints;
    const low = pts[gear - 1] ?? 0;
    const high = pts[gear] ?? car.sim.topSpeed;
    const band = Math.max(1, high - low);
    const frac = Math.min(1, Math.max(0, (speed - low) / band));
    return Math.round(lerp(car.sim.idleRpm, car.sim.redline, 0.25 + frac * 0.75));
  };

  /**
   * Full reading at a lap position. Throttle and brake come from whether the
   * speed profile is rising or falling, so they line up with the corners
   * instead of being independent noise.
   */
  const sample = (pos) => {
    const p = ((pos % 1) + 1) % 1;
    const speed = speedAt(p);
    const ahead = speedAt(p + 0.0025);
    const behind = speedAt(p - 0.0025);
    const slope = (ahead - behind) / 2;

    // Normalise the gradient so pedal values scale with how hard the car is
    // actually accelerating or slowing, not with raw km/h per sample.
    const norm = Math.max(1, car.sim.topSpeed * 0.035);
    const accel = Math.max(0, slope) / norm;
    const decel = Math.max(0, -slope) / norm;
    const speedFrac = speed / car.sim.topSpeed;

    // Deadband: a gentle lift between corners is not braking. Only a genuine
    // deceleration counts, which keeps braking to real braking zones rather
    // than most of the lap.
    // Deadband: a gentle lift between corners is not braking. The threshold sits
    // at the point where braking covers roughly a fifth of the lap around the lap, which keeps the
    // brake trace to actual braking zones (~18% of the lap) rather than most of
    // it, and the scale reaches 100% at the heaviest stop.
    const brake = Math.round(Math.min(100, Math.max(0, decel - 0.85) * 118));
    // Off the brakes the driver is either feeding it in out of a corner or
    // holding it flat down a straight.
    const throttle =
      brake > 6
        ? 0
        : Math.round(Math.min(100, 100 * Math.min(1, 0.28 + accel * 1.6 + speedFrac * 0.55)));

    const gear = gearFor(speed);

    const elapsed = timeAtPosition(p, current);
    const refElapsed = timeAtPosition(p, reference);

    return {
      position: p,
      distanceKm: p * track.lengthKm,
      speed: Math.round(speed),
      throttle: brake > 8 ? 0 : throttle,
      brake,
      gear,
      rpm: rpmFor(speed, gear),
      delta: elapsed - refElapsed,
      corner: cornerFor(p),
      sector: sectorFor(p),
      elapsed
    };
  };

  /** Trace for the graphs, sampled evenly around the lap. */
  const trace = (points = 160) =>
    Array.from({ length: points }, (_, i) => {
      const p = i / (points - 1);
      const s = sample(p);
      return { p, speed: s.speed, throttle: s.throttle, brake: s.brake };
    });

  const referenceTrace = (points = 160) =>
    Array.from({ length: points }, (_, i) => {
      const idx = (i / (points - 1)) * SAMPLES;
      const j = Math.min(SAMPLES - 1, Math.floor(idx));
      return { p: i / (points - 1), speed: Math.round(reference.speed[j]) };
    });

  const sectorTimes = (table = current) =>
    track.sectors.map((s) => ({
      id: s.id,
      time: timeAtPosition(s.to === 1 ? 0.99999 : s.to, table) - timeAtPosition(s.from, table)
    }));

  return {
    track,
    car,
    driver,
    lapTime,
    referenceLapTime,
    topSpeed: car.sim.topSpeed,
    positionAtTime,
    timeAtPosition,
    sample,
    trace,
    referenceTrace,
    sectorTimes
  };
};

/* -------------------------------------------------------------- formatting */

export const formatLap = (seconds) => {
  if (!Number.isFinite(seconds)) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

export const formatSector = (seconds) => {
  if (!Number.isFinite(seconds)) return '--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
};

export const formatDelta = (seconds) => {
  if (!Number.isFinite(seconds)) return '+0.000';
  const sign = seconds >= 0 ? '+' : '-';
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
};
