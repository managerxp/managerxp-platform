import React, { useEffect, useMemo, useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { Monitor, Power, RotateCcw, Lock, LogOut, Cpu, MemoryStick, Wifi } from 'lucide-react';
import DemoBadge from './DemoBadge';
import { EASE_MOTION, SPRING, prefersReducedMotion } from '../lib/motion';

/**
 * Floor map + station control, as one connected experience: pick a machine on
 * the left, drive it from the panel on the right. Sample data.
 */

const STATE = {
  gaming: { label: 'Gaming', dot: 'bg-red-500', text: 'text-red-400', ring: 'border-red-500/45', glow: 'shadow-[0_0_18px_-5px_rgba(220,38,38,0.8)]' },
  available: { label: 'Available', dot: 'bg-emerald-400', text: 'text-emerald-400/90', ring: 'border-emerald-400/25', glow: '' },
  maintenance: { label: 'Maintenance', dot: 'bg-amber-400', text: 'text-amber-400/90', ring: 'border-amber-400/25', glow: '' },
  offline: { label: 'Offline', dot: 'bg-neutral-600', text: 'text-neutral-500', ring: 'border-white/10', glow: '' }
};

const seed = [
  { id: 'PC-01', zone: 'Main', state: 'available', secs: 0, cpu: 4, mem: 21 },
  { id: 'PC-02', zone: 'Main', state: 'gaming', secs: 5072, cpu: 61, mem: 68 },
  { id: 'PC-03', zone: 'Main', state: 'gaming', secs: 2538, cpu: 48, mem: 63 },
  { id: 'PC-04', zone: 'Main', state: 'offline', secs: 0, cpu: 0, mem: 0 },
  { id: 'PC-05', zone: 'VIP', state: 'maintenance', secs: 0, cpu: 0, mem: 0 },
  { id: 'PC-06', zone: 'VIP', state: 'gaming', secs: 7411, cpu: 72, mem: 74 },
  { id: 'PC-07', zone: 'VIP', state: 'available', secs: 0, cpu: 3, mem: 18 },
  { id: 'PC-08', zone: 'Main', state: 'gaming', secs: 1264, cpu: 55, mem: 59 }
];

const clock = (s) => {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
};

const StationOps = () => {
  const [stations, setStations] = useState(seed);
  const [selectedId, setSelectedId] = useState('PC-02');
  const [zone, setZone] = useState('All');

  const zones = useMemo(() => ['All', ...new Set(seed.map((s) => s.zone))], []);
  const visible = zone === 'All' ? stations : stations.filter((s) => s.zone === zone);
  const selected = stations.find((s) => s.id === selectedId) || stations[0];

  // Session clocks advance; load figures drift slightly so the panel feels live.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => {
      setStations((prev) =>
        prev.map((s) =>
          s.state === 'gaming'
            ? {
                ...s,
                secs: s.secs + 1,
                cpu: Math.min(92, Math.max(35, s.cpu + (Math.random() > 0.5 ? 1 : -1))),
                mem: Math.min(90, Math.max(40, s.mem + (Math.random() > 0.5 ? 1 : -1)))
              }
            : s
        )
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const runAction = (action) => {
    setStations((prev) =>
      prev.map((s) => {
        if (s.id !== selected.id) return s;
        if (action === 'end') return { ...s, state: 'available', secs: 0, cpu: 4, mem: 20 };
        if (action === 'shutdown') return { ...s, state: 'offline', secs: 0, cpu: 0, mem: 0 };
        if (action === 'restart') return { ...s, state: 'available', secs: 0, cpu: 8, mem: 24 };
        return s;
      })
    );
  };

  const st = STATE[selected.state];
  const busy = stations.filter((s) => s.state === 'gaming').length;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl shadow-[0_0_60px_-30px_rgba(220,38,38,0.5)]">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2" role="tablist" aria-label="Zone">
          {zones.map((z) => (
            <button
              key={z}
              type="button"
              role="tab"
              aria-selected={zone === z}
              onClick={() => setZone(z)}
              className={`relative rounded-full px-3 py-1.5 text-xs font-mono transition-colors ${
                zone === z ? 'text-white' : 'text-neutral-500 hover:text-white'
              }`}
            >
              {zone === z && (
                <Motion.span layoutId="zone-pill" transition={SPRING} className="absolute inset-0 -z-10 rounded-full bg-red-600/20 border border-red-500/40" />
              )}
              {z}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          {busy} of {stations.length} in play
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5">

        {/* Floor map */}
        <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-white/5 p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <AnimatePresence mode="popLayout">
              {visible.map((s) => {
                const cfg = STATE[s.state];
                const isSel = s.id === selected.id;
                return (
                  <Motion.button
                    key={s.id}
                    layout
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    aria-pressed={isSel}
                    whileHover={{ y: -4 }}
                    transition={SPRING}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    className={`rounded-xl border bg-white/[0.03] p-3 text-left transition-colors duration-500 ${cfg.ring} ${cfg.glow} ${
                      isSel ? 'ring-1 ring-red-500/60' : ''
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-white">{s.id}</span>
                      <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${cfg.dot}`} />
                    </div>
                    <Monitor className={`mb-1.5 h-4 w-4 transition-colors duration-500 ${cfg.text}`} />
                    <p className={`font-mono text-[10px] tabular-nums transition-colors duration-500 ${cfg.text}`}>
                      {s.state === 'gaming' ? clock(s.secs) : cfg.label}
                    </p>
                  </Motion.button>
                );
              })}
            </AnimatePresence>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/5 pt-3">
            {Object.entries(STATE).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
                {v.label}
              </span>
            ))}
          </div>
        </div>

        {/* Control panel */}
        <div className="lg:col-span-2 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-sm text-white">{selected.id}</span>
            <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${st.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
              {st.label}
            </span>
          </div>

          <div className="space-y-2.5">
            {[
              { icon: <Cpu className="h-3.5 w-3.5" />, label: 'CPU', value: selected.cpu },
              { icon: <MemoryStick className="h-3.5 w-3.5" />, label: 'Memory', value: selected.mem }
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                    <span className="text-red-500">{m.icon}</span>
                    {m.label}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-white">{m.value}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/10">
                  <Motion.div
                    className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400"
                    animate={{ width: `${m.value}%` }}
                    transition={{ duration: 0.6, ease: EASE_MOTION }}
                  />
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                  <Wifi className="h-3.5 w-3.5 text-red-500" />
                  Session
                </span>
                <span className="font-mono text-sm tabular-nums text-red-400">
                  {selected.state === 'gaming' ? clock(selected.secs) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { id: 'lock', label: 'Lock', icon: <Lock className="h-3.5 w-3.5" /> },
              { id: 'restart', label: 'Restart', icon: <RotateCcw className="h-3.5 w-3.5" /> },
              { id: 'shutdown', label: 'Shutdown', icon: <Power className="h-3.5 w-3.5" /> },
              { id: 'end', label: 'End session', icon: <LogOut className="h-3.5 w-3.5" /> }
            ].map((a) => (
              <Motion.button
                key={a.id}
                type="button"
                onClick={() => runAction(a.id)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                transition={SPRING}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-2.5 font-mono text-[11px] text-neutral-300 hover:border-red-500/40 hover:text-white"
              >
                <span className="text-red-500">{a.icon}</span>
                {a.label}
              </Motion.button>
            ))}
          </div>

          <div className="mt-4 flex justify-center">
            <DemoBadge />
          </div>
        </div>
      </div>
    </div>
  );
};

export default StationOps;
