import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { createDraggable, svg, animate as animeAnimate } from 'animejs';
import { Play, Pause, RotateCcw, Gauge, Flag } from 'lucide-react';
import { createTelemetry, formatLap, formatSector, formatDelta } from '../lib/telemetry';
import { prefersReducedMotion } from '../lib/motion';

/**
 * RaceXP live telemetry panel.
 *
 * The lap runs on its own from a deterministic simulation (see lib/telemetry):
 * one clock drives position, and position drives the track marker, the graph
 * cursor and every readout, so nothing animates independently.
 *
 * Rendering cost is kept down by splitting the loop: the marker and cursor are
 * moved imperatively every frame, while React state updates at ~12Hz for the
 * numeric panels.
 */

const GRAPH_W = 640;
const GRAPH_H = 120;
const PEDAL_H = 46;
const READOUT_HZ = 12;
const MOTION_PATH_DURATION = 1000;

const TelemetryPanel = () => {
  const engine = useMemo(() => createTelemetry(), []);
  const { track, car, driver } = engine;

  const rootRef = useRef(null);
  const pathRef = useRef(null);
  const markerRef = useRef(null);
  const markerAnimRef = useRef(null);
  const cursorRef = useRef(null);
  const pedalCursorRefs = useRef([]);
  const railRef = useRef(null);
  const handleRef = useRef(null);
  const draggableRef = useRef(null);

  const elapsedRef = useRef(0);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const lastPushRef = useRef(0);
  const scrubbingRef = useRef(false);

  const [running, setRunning] = useState(true);
  const [lapNumber, setLapNumber] = useState(12);
  const [bestLap, setBestLap] = useState(engine.referenceLapTime);
  const [newBest, setNewBest] = useState(false);
  const [reading, setReading] = useState(() => engine.sample(0));

  const sectorTimes = useMemo(() => engine.sectorTimes(), [engine]);

  // Static traces — the shape of the lap does not change, so they are built once.
  const traces = useMemo(() => {
    const cur = engine.trace(200);
    const ref = engine.referenceTrace(200);
    const top = engine.topSpeed;
    const pts = (arr, key, max, h) =>
      arr.map((d, i) => `${((i / (arr.length - 1)) * GRAPH_W).toFixed(1)},${(h - (d[key] / max) * (h - 6) - 3).toFixed(1)}`).join(' ');
    return {
      speed: pts(cur, 'speed', top, GRAPH_H),
      speedRef: pts(ref, 'speed', top, GRAPH_H),
      throttle: pts(cur, 'throttle', 100, PEDAL_H),
      brake: pts(cur, 'brake', 100, PEDAL_H)
    };
  }, [engine]);

  /** Move everything that can be positioned without a React render. */
  const paint = useCallback((position) => {
    const x = position * GRAPH_W;
    if (cursorRef.current) cursorRef.current.setAttribute('transform', `translate(${x} 0)`);
    pedalCursorRefs.current.forEach((el) => el && el.setAttribute('transform', `translate(${x} 0)`));
    markerAnimRef.current?.seek(position * MOTION_PATH_DURATION);
    if (handleRef.current && !scrubbingRef.current && draggableRef.current && railRef.current) {
      draggableRef.current.setX(position * railRef.current.getBoundingClientRect().width, true);
    }
  }, []);

  // Marker follows the circuit path, including orientation.
  useEffect(() => {
    const path = pathRef.current;
    const marker = markerRef.current;
    if (!path || !marker) return;

    const mp = svg.createMotionPath(path);
    const seekable = animeAnimate(marker, {
      translateX: mp.translateX,
      translateY: mp.translateY,
      rotate: mp.rotate,
      duration: MOTION_PATH_DURATION,
      ease: 'linear',
      autoplay: false
    });
    markerAnimRef.current = seekable;
    paint(engine.positionAtTime(elapsedRef.current));

    return () => {
      seekable.revert();
      markerAnimRef.current = null;
    };
  }, [engine, paint]);

  // The lap clock.
  useEffect(() => {
    if (!running || prefersReducedMotion()) return;

    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.25, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (!scrubbingRef.current) {
        elapsedRef.current += dt;

        if (elapsedRef.current >= engine.lapTime) {
          const completed = engine.lapTime;
          elapsedRef.current = 0;
          setLapNumber((n) => n + 1);
          setBestLap((prev) => {
            if (completed < prev) {
              setNewBest(true);
              setTimeout(() => setNewBest(false), 2600);
              return completed;
            }
            return prev;
          });
        }
      }

      const position = engine.positionAtTime(elapsedRef.current);
      paint(position);

      if (ts - lastPushRef.current > 1000 / READOUT_HZ) {
        lastPushRef.current = ts;
        setReading(engine.sample(position));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTsRef.current = 0;
    };
  }, [running, engine, paint]);

  // Scrub handle.
  useEffect(() => {
    const handle = handleRef.current;
    const rail = railRef.current;
    if (!handle || !rail || prefersReducedMotion()) return;

    const width = () => rail.getBoundingClientRect().width;
    const draggable = createDraggable(handle, {
      container: rail,
      y: false,
      releaseStiffness: 140,
      releaseDamping: 20,
      onGrab: () => { scrubbingRef.current = true; },
      onRelease: () => { scrubbingRef.current = false; lastTsRef.current = 0; },
      onUpdate: (self) => {
        if (!scrubbingRef.current) return;
        const w = width();
        if (!w) return;
        const position = Math.min(1, Math.max(0, self.x / w));
        elapsedRef.current = engine.timeAtPosition(position);
        paint(position);
        setReading(engine.sample(position));
      }
    });

    draggableRef.current = draggable;
    return () => {
      draggable.revert();
      draggableRef.current = null;
    };
  }, [engine, paint]);

  const scrubTo = (position) => {
    const p = Math.min(1, Math.max(0, position));
    elapsedRef.current = engine.timeAtPosition(p);
    paint(p);
    setReading(engine.sample(p));
  };

  const onKey = (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    // Read the live position from the clock ref, not from React state: held or
    // repeated keys fire faster than re-renders, and reading state would make
    // every press compute the same target.
    const current = engine.positionAtTime(elapsedRef.current);

    if (e.key === 'ArrowRight') { e.preventDefault(); scrubTo(current + step); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scrubTo(current - step); }
    else if (e.key === 'Home') { e.preventDefault(); scrubTo(0); }
    else if (e.key === 'End') { e.preventDefault(); scrubTo(0.999); }
  };

  const restart = () => { scrubTo(0); setRunning(true); };

  const activeSector = reading.sector.id;

  return (
    <div ref={rootRef} className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 backdrop-blur-xl shadow-[0_0_70px_-30px_rgba(220,38,38,0.65)]">

      {/* Context header */}
      <div className="border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold tracking-wide text-white">
              <Flag className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
              {track.name}
            </p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              {track.lengthKm} km · {track.corners} corners · {track.elevationM} m elevation · “{track.nickname}”
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-600">Car</p>
              <p className="text-xs font-medium text-neutral-200">{car.label}</p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-600">Driver</p>
              <p className="text-xs font-medium text-neutral-200">
                <span className="text-red-400">#{driver.number}</span> {driver.name}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-red-300">
                <span className={`h-1.5 w-1.5 rounded-full bg-red-500 ${running ? 'animate-pulse' : ''}`} />
                Lap {lapNumber}
              </span>
            </div>
          </div>
        </div>

        {/* Honest provenance: this is a simulation, not a live feed. */}
        <p className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-600">
          Simulated live telemetry · {car.class} · time attack · not a live timing feed
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5">

        {/* Circuit */}
        <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-white/5 p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">Circuit</span>
            <span className="font-mono text-[10px] tabular-nums text-neutral-500">
              {reading.distanceKm.toFixed(2)} / {track.lengthKm} km
            </span>
          </div>

          <svg viewBox={track.viewBox} className="w-full h-auto" role="img" aria-label={`${track.name} circuit map with simulated car position`}>
            <path d={track.path} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="26" strokeLinejoin="round" strokeLinecap="round" />
            <path ref={pathRef} d={track.path} fill="none" stroke="rgba(239,68,68,0.85)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
            <g ref={markerRef}>
              <circle r="16" fill="rgba(239,68,68,0.22)" />
              <circle r="8" fill="#ef4444" />
            </g>
          </svg>

          {/* Current corner */}
          <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">Current section</p>
            <AnimatePresence mode="popLayout">
              <Motion.p
                key={reading.corner.name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="text-sm font-semibold text-white"
              >
                {reading.corner.name}
              </Motion.p>
            </AnimatePresence>
          </div>

          {/* Lap + sectors */}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">Lap time</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-white">{formatLap(reading.elapsed)}</p>
            </div>
            <div className={`rounded-lg border p-2.5 transition-colors ${newBest ? 'border-red-500/60 bg-red-500/15' : 'border-white/10 bg-white/[0.03]'}`}>
              <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">
                {newBest ? 'New best' : 'Best lap'}
              </p>
              <p className="font-mono text-sm font-semibold tabular-nums text-red-400">{formatLap(bestLap)}</p>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {sectorTimes.map((s) => (
              <div
                key={s.id}
                className={`rounded-lg border px-2 py-1.5 text-center transition-colors duration-300 ${
                  activeSector === s.id ? 'border-red-500/50 bg-red-500/10' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <p className={`font-mono text-[9px] uppercase tracking-wider ${activeSector === s.id ? 'text-red-400' : 'text-neutral-600'}`}>
                  {s.id}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-neutral-200">{formatSector(s.time)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Traces + readouts */}
        <div className="lg:col-span-3 p-4 sm:p-5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">Speed · lap vs reference</span>
            <span className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider">
              <span className="flex items-center gap-1 text-red-400"><span className="h-[2px] w-3 bg-red-500" /> Lap</span>
              <span className="flex items-center gap-1 text-neutral-500"><span className="h-[2px] w-3 bg-neutral-500" /> Reference</span>
            </span>
          </div>

          <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} className="w-full h-24" role="img" aria-label="Simulated speed trace against reference lap">
            {track.sectors.slice(1).map((s) => (
              <line key={s.id} x1={s.from * GRAPH_W} y1="0" x2={s.from * GRAPH_W} y2={GRAPH_H} stroke="rgba(255,255,255,0.10)" strokeDasharray="3 4" />
            ))}
            <polyline points={traces.speedRef} fill="none" stroke="rgba(163,163,163,0.6)" strokeWidth="1.5" />
            <polyline points={traces.speed} fill="none" stroke="#ef4444" strokeWidth="2" />
            <g ref={cursorRef}>
              <line x1="0" y1="0" x2="0" y2={GRAPH_H} stroke="rgba(239,68,68,0.9)" strokeWidth="1.5" />
            </g>
          </svg>

          <div className="mt-2 grid grid-cols-2 gap-3">
            {[
              { label: 'Throttle', points: traces.throttle, stroke: 'rgba(52,211,153,0.75)' },
              { label: 'Brake', points: traces.brake, stroke: 'rgba(248,113,113,0.85)' }
            ].map((p, i) => (
              <div key={p.label}>
                <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">{p.label}</span>
                <svg viewBox={`0 0 ${GRAPH_W} ${PEDAL_H}`} className="w-full h-9" aria-hidden="true">
                  <polyline points={p.points} fill="none" stroke={p.stroke} strokeWidth="1.5" />
                  <g ref={(el) => { pedalCursorRefs.current[i] = el; }}>
                    <line x1="0" y1="0" x2="0" y2={PEDAL_H} stroke="rgba(239,68,68,0.65)" strokeWidth="1" />
                  </g>
                </svg>
              </div>
            ))}
          </div>

          {/* Transport */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => { lastTsRef.current = 0; setRunning((r) => !r); }}
              aria-label={running ? 'Pause lap' : 'Play lap'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20 hover:text-white"
            >
              {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={restart}
              aria-label="Restart lap"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-400 transition-colors hover:border-white/25 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            <div ref={railRef} className="relative h-9 flex-1 rounded-full border border-white/10 bg-white/[0.03]">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-900/45 to-red-600/35"
                style={{ width: `${reading.position * 100}%` }}
                aria-hidden="true"
              />
              {[
                { label: 'S1', at: 0 },
                { label: 'S2', at: track.sectors[1].from },
                { label: 'S3', at: track.sectors[2].from }
              ].map((s) => (
                <span key={s.label} aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 font-mono text-[8px] uppercase text-neutral-500" style={{ left: `${s.at * 100}%` }}>
                  <span className="mx-auto mb-0.5 block h-2 w-px bg-white/20" />
                  {s.label}
                </span>
              ))}
              <div
                ref={handleRef}
                role="slider"
                tabIndex={0}
                aria-label="Lap position"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(reading.position * 100)}
                aria-valuetext={`${reading.corner.name}, ${formatLap(reading.elapsed)}`}
                onKeyDown={onKey}
                className="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border border-red-400/60 bg-black shadow-[0_0_18px_-2px_rgba(239,68,68,0.9)] active:cursor-grabbing"
                style={prefersReducedMotion() ? { left: `${reading.position * 100}%` } : { left: 0 }}
              >
                <span aria-hidden="true" className="absolute inset-[6px] rounded-full bg-red-500" />
              </div>
            </div>
          </div>

          {/* Channels */}
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {[
              { label: 'Speed', value: `${reading.speed}`, unit: 'km/h' },
              { label: 'Throttle', value: `${reading.throttle}`, unit: '%' },
              { label: 'Brake', value: `${reading.brake}`, unit: '%' },
              { label: 'RPM', value: reading.rpm.toLocaleString('en-US'), unit: '' },
              { label: 'Gear', value: `${reading.gear}`, unit: '' }
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <dt className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">{c.label}</dt>
                <dd className="font-mono text-base font-semibold tabular-nums text-white">
                  {c.value}
                  {c.unit && <span className="ml-0.5 text-[10px] font-normal text-neutral-500">{c.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-2.5 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-neutral-500">
              <Gauge className="h-3.5 w-3.5 text-red-500" />
              Delta to reference
            </span>
            <span className={`font-mono text-lg font-semibold tabular-nums ${reading.delta <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatDelta(reading.delta)}s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TelemetryPanel;
