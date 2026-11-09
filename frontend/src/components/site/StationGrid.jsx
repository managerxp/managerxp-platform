import React, { useEffect, useMemo, useState } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

/*
 * A CafeXP floor, live. On mount the PCs power on one by one (the "boot"),
 * then sessions start, tick and end the way a real Saturday night does.
 * Flat colours only: red is a running session, amber is paused, grey is free.
 * Sample data; under reduced motion it shows the settled floor, no ticking.
 */

const SEED = ['active', 'idle', 'active', 'active', 'paused', 'idle', 'active', 'idle', 'active', 'active', 'idle', 'active',
  'idle', 'active', 'paused', 'active', 'idle', 'active', 'active', 'idle', 'active', 'idle', 'active', 'active'];
const START_SECS = [2531, 0, 418, 3307, 911, 0, 1764, 0, 125, 2210, 0, 3902, 0, 640, 1200, 2875, 0, 77, 1530, 0, 2402, 0, 980, 3333];

const initial = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `PC-${String(i + 1).padStart(2, '0')}`,
    state: SEED[i % SEED.length],
    secs: START_SECS[i % START_SECS.length],
  }));

const clock = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const tone = {
  off: 'border-white/[0.06] text-white/15',
  idle: 'border-white/15 text-white/45',
  active: 'border-[#e5322d] bg-[#e5322d]/[0.12] text-white',
  paused: 'border-amber-400/50 bg-amber-400/[0.06] text-amber-100/80',
};

const StationGrid = ({ count = 24, className = '' }) => {
  const reduce = useMemo(() => prefersReducedMotion(), []);
  const [stations, setStations] = useState(() => initial(count));
  const [booted, setBooted] = useState(reduce ? count : 0);

  // Boot: one PC every 55ms.
  useEffect(() => {
    if (reduce || booted >= count) return undefined;
    const t = setTimeout(() => setBooted((b) => b + 1), 55);
    return () => clearTimeout(t);
  }, [booted, count, reduce]);

  // Live floor: sessions tick every second; one station changes every few seconds.
  useEffect(() => {
    if (reduce || booted < count) return undefined;
    const tick = setInterval(() => {
      setStations((prev) => prev.map((s) => (s.state === 'active' ? { ...s, secs: s.secs + 1 } : s)));
    }, 1000);
    const flip = setInterval(() => {
      setStations((prev) => {
        const next = [...prev];
        const i = Math.floor(Math.random() * next.length);
        const s = next[i];
        next[i] = s.state === 'active' ? { ...s, state: 'idle', secs: 0 } : { ...s, state: 'active', secs: s.state === 'paused' ? s.secs : 0 };
        return next;
      });
    }, 2600);
    return () => {
      clearInterval(tick);
      clearInterval(flip);
    };
  }, [booted, count, reduce]);

  const playing = stations.filter((s) => s.state === 'active').length;
  const paused = stations.filter((s) => s.state === 'paused').length;
  const free = stations.length - playing - paused;

  return (
    <figure className={className}>
      <div aria-hidden="true" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {stations.map((s, i) => {
          const state = i < booted ? s.state : 'off';
          return (
            <div key={s.id} className={`flex aspect-[5/4] flex-col justify-between border p-2 font-mono text-[11px] transition-colors duration-300 ${tone[state]}`}>
              <span>{s.id}</span>
              <span className="text-right tabular-nums">
                {state === 'active' ? clock(s.secs) : state === 'paused' ? 'paused' : state === 'idle' ? 'free' : ''}
              </span>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] text-white/60">
        <span><span className="tabular-nums text-white">{playing}</span> playing</span>
        <span><span className="tabular-nums text-white">{free}</span> free</span>
        <span><span className="tabular-nums text-white">{paused}</span> paused</span>
        <span className="text-white/35">Sample floor</span>
      </figcaption>
    </figure>
  );
};

export default StationGrid;
