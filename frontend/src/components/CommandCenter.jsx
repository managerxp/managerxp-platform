import React, { useEffect, useRef, useState } from 'react';
import { motion as Motion, animate, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Activity, Monitor, IndianRupee, Signal, Bell } from 'lucide-react';
import DemoBadge from './DemoBadge';
import { prefersReducedMotion, supportsPointerParallax, EASE_MOTION, VIEWPORT } from '../lib/motion';

/**
 * The CafeXP command center: a layered, pseudo-3D product visual.
 *
 * This is product UI, so it is animated with Motion (Anime.js is reserved for
 * the RaceXP engineering visuals). Depth is real CSS 3D — perspective +
 * preserve-3d + a z offset per layer — which gives the floating-panel look for
 * a fraction of a WebGL scene, and degrades cleanly on mobile where the pointer
 * parallax is switched off entirely.
 *
 * Every figure shown is sample data (see DemoBadge).
 */

const stageVariants = {
  hidden: { opacity: 0, y: 70, rotateX: 14 },
  visible: { opacity: 1, y: 0, rotateX: 0, transition: { duration: 1.05, ease: EASE_MOTION, staggerChildren: 0.09, delayChildren: 0.25 } }
};

/** Each floating layer settles to its own depth. */
const layerVariants = (depth = 0) => ({
  hidden: { opacity: 0, z: 0, y: 24 },
  visible: { opacity: 1, z: depth, y: 0, transition: { duration: 0.85, ease: EASE_MOTION } }
});

const STATION_STATES = {
  active: { label: 'Active', dot: 'bg-red-500', text: 'text-red-400', ring: 'border-red-500/45', glow: 'shadow-[0_0_16px_-4px_rgba(220,38,38,0.7)]' },
  available: { label: 'Available', dot: 'bg-emerald-400', text: 'text-emerald-400/90', ring: 'border-emerald-400/25', glow: '' },
  paused: { label: 'Paused', dot: 'bg-amber-400', text: 'text-amber-400/90', ring: 'border-amber-400/25', glow: '' }
};

const initialStations = [
  { id: 'PC-01', state: 'active', mins: 42 },
  { id: 'PC-02', state: 'available', mins: 0 },
  { id: 'PC-03', state: 'active', mins: 17 },
  { id: 'PC-04', state: 'paused', mins: 8 },
  { id: 'PC-05', state: 'active', mins: 63 },
  { id: 'PC-06', state: 'available', mins: 0 }
];

const chartBars = [32, 44, 38, 56, 64, 72, 86, 96, 81, 68, 52, 40];
const chartHours = ['10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p'];

const CommandCenter = () => {
  const rootRef = useRef(null);

  const [stations, setStations] = useState(initialStations);
  const [revenue, setRevenue] = useState(12480);
  const [hoveredBar, setHoveredBar] = useState(null);
  const [notice, setNotice] = useState(null);

  // Pointer parallax: raw pointer position -> damped springs -> layer transforms.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 120, damping: 20, mass: 0.6 });
  const springY = useSpring(pointerY, { stiffness: 120, damping: 20, mass: 0.6 });

  const rotateY = useTransform(springX, [-0.5, 0.5], [-11, 11]);
  const rotateX = useTransform(springY, [-0.5, 0.5], [8, -8]);
  // Nearer layers travel further, which is what sells the depth.
  const nearX = useTransform(springX, [-0.5, 0.5], [-42, 42]);
  const nearY = useTransform(springY, [-0.5, 0.5], [-30, 30]);
  const midX = useTransform(springX, [-0.5, 0.5], [-26, 26]);
  const midY = useTransform(springY, [-0.5, 0.5], [-18, 18]);
  const farX = useTransform(springX, [-0.5, 0.5], [-9, 9]);
  const farY = useTransform(springY, [-0.5, 0.5], [-6, 6]);

  useEffect(() => {
    if (!supportsPointerParallax()) return;

    const root = rootRef.current;
    if (!root) return;

    const onMove = (event) => {
      const rect = root.getBoundingClientRect();
      pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
      pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
    };

    const onLeave = () => {
      pointerX.set(0);
      pointerY.set(0);
    };

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [pointerX, pointerY]);

  // --- Live sample data ---------------------------------------------------
  useEffect(() => {
    if (prefersReducedMotion()) return;

    // Session timers tick slowly; only active stations advance.
    const tick = setInterval(() => {
      setStations((prev) =>
        prev.map((s) => (s.state === 'active' ? { ...s, mins: s.mins + 1 } : s))
      );
    }, 6000);

    // One station changes state at a time, so the grid never flickers.
    const flip = setInterval(() => {
      setStations((prev) => {
        const next = [...prev];
        const i = Math.floor(Math.random() * next.length);
        const s = next[i];
        if (s.state === 'active') next[i] = { ...s, state: 'available', mins: 0 };
        else if (s.state === 'available') next[i] = { ...s, state: 'active', mins: 1 };
        else next[i] = { ...s, state: 'active' };
        return next;
      });
    }, 4200);

    return () => {
      clearInterval(tick);
      clearInterval(flip);
    };
  }, []);

  // Revenue counts up smoothly rather than jumping. Motion's imperative animate
  // tweens the number; the interval does not depend on the current value, so it
  // is installed once instead of re-subscribing on every tick.
  useEffect(() => {
    if (prefersReducedMotion()) return;

    let controls;
    const id = setInterval(() => {
      setRevenue((current) => {
        const next = current + 40 + Math.floor(Math.random() * 260);
        controls = animate(current, next, {
          duration: 1.2,
          ease: 'easeOut',
          onUpdate: (v) => setRevenue(Math.round(v))
        });
        return current;
      });
    }, 7000);

    return () => {
      clearInterval(id);
      controls?.stop();
    };
  }, []);

  // Occasional notification chip.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const messages = ['PC-04 resumed', 'Session closed · PC-02', 'New customer added', 'PC-06 started'];
    let i = 0;
    const id = setInterval(() => {
      setNotice(messages[i % messages.length]);
      i += 1;
      setTimeout(() => setNotice(null), 3200);
    }, 9000);
    return () => clearInterval(id);
  }, []);

  const activeCount = stations.filter((s) => s.state === 'active').length;
  const availableCount = stations.filter((s) => s.state === 'available').length;
  const utilisation = Math.round((activeCount / stations.length) * 100);

  return (
    <div ref={rootRef} className="relative w-full">
      {/* Perspective viewport */}
      <div className="relative mx-auto w-full max-w-4xl" style={{ perspective: '1500px', perspectiveOrigin: '50% 40%' }}>

        {/* Layer 1-2: environment grid + ambient red glow, sitting behind the panel */}
        <Motion.div
          aria-hidden="true"
          style={{ x: farX, y: farY }}
          className="pointer-events-none absolute -inset-x-10 -inset-y-14"
        >
          <div className="absolute inset-0 opacity-[0.09] bg-[length:44px_44px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.5)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black,transparent)]" />
          <div className="absolute inset-0 [background:radial-gradient(ellipse_50%_45%_at_50%_55%,rgba(220,38,38,0.28),transparent_70%)] blur-2xl" />
        </Motion.div>

        {/* The 3D stage */}
        <Motion.div
          variants={stageVariants}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
          style={{ rotateX, rotateY, transformStyle: 'preserve-3d', willChange: 'transform' }}
          className="relative"
        >
          {/* Layer 3: main dashboard panel */}
          <Motion.div
            variants={layerVariants(0)}
            className="relative rounded-2xl border border-white/10 bg-neutral-950/80 backdrop-blur-xl overflow-hidden shadow-[0_40px_90px_-40px_rgba(220,38,38,0.55),0_0_0_1px_rgba(255,255,255,0.03)]"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-2 min-w-0">
                <Signal className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-xs sm:text-sm font-semibold tracking-wide text-white truncate">
                  Live Cafe Control
                </span>
              </div>
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-red-400 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Live
              </span>
            </div>

            <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-5 gap-4 sm:gap-5">

              {/* Station grid */}
              <div className="md:col-span-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-2.5">
                  Stations
                </p>
                <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
                  {stations.map((station) => {
                    const s = STATION_STATES[station.state];
                    return (
                      <div
                        key={station.id}
                        className={`rounded-lg border bg-white/[0.03] p-2.5 transition-all duration-500 ${s.ring} ${s.glow}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono text-[10px] text-neutral-300">{station.id}</span>
                          <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${s.dot}`} />
                        </div>
                        <Monitor className={`w-4 h-4 mb-1.5 transition-colors duration-500 ${s.text}`} />
                        <p className={`font-mono text-[9px] transition-colors duration-500 ${s.text}`}>
                          {station.state === 'available' ? s.label : `${station.mins}m`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* KPI rail */}
              <div className="md:col-span-2 space-y-2.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                  Today
                </p>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-red-500 mb-1.5">
                    <IndianRupee className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Takings</span>
                  </div>
                  <p className="text-lg font-semibold text-white tabular-nums leading-none">
                    {revenue.toLocaleString('en-IN')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <Activity className="w-3.5 h-3.5 text-red-500 mb-1.5" />
                    <p className="text-base font-semibold text-white tabular-nums leading-none">{activeCount}</p>
                    <p className="text-[9px] font-mono uppercase tracking-wider text-neutral-500 mt-1">Active</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <Monitor className="w-3.5 h-3.5 text-emerald-400/80 mb-1.5" />
                    <p className="text-base font-semibold text-white tabular-nums leading-none">{availableCount}</p>
                    <p className="text-[9px] font-mono uppercase tracking-wider text-neutral-500 mt-1">Free</p>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Utilisation</span>
                    <span className="text-[10px] font-mono text-white tabular-nums">{utilisation}%</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="cc-fill h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 transition-[width] duration-700 ease-out"
                      data-fill={`${utilisation}%`}
                      style={{ width: `${utilisation}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Motion.div>

          {/* Layer 4: floating analytics card */}
          <Motion.div
            variants={layerVariants(110)}
            style={{ x: midX, y: midY }}
            className="absolute -bottom-10 w-[260px] hidden lg:block
                       lg:-left-6 xl:-left-16
                       rounded-xl border border-white/10 bg-neutral-950/90 backdrop-blur-xl p-4
                       shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                Sessions by hour
              </span>
              <span className="text-[10px] font-mono text-red-400 tabular-nums">
                {hoveredBar !== null ? chartBars[hoveredBar] : '—'}
              </span>
            </div>

            <div className="relative flex items-end gap-1 h-20">
              {chartBars.map((h, i) => (
                <button
                  key={chartHours[i]}
                  type="button"
                  onMouseEnter={() => setHoveredBar(i)}
                  onMouseLeave={() => setHoveredBar(null)}
                  onFocus={() => setHoveredBar(i)}
                  onBlur={() => setHoveredBar(null)}
                  aria-label={`${chartHours[i]}: ${h} sessions (sample)`}
                  className="group relative flex-1 h-full flex items-end"
                >
                  <Motion.span
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={VIEWPORT}
                    transition={{ duration: 0.7, delay: 0.5 + i * 0.04, ease: EASE_MOTION }}
                    className={`w-full rounded-t origin-bottom transition-colors duration-300 ${
                      hoveredBar === i
                        ? 'bg-gradient-to-t from-red-500 to-red-300 shadow-[0_0_14px_rgba(239,68,68,0.75)]'
                        : 'bg-gradient-to-t from-red-800/70 to-red-500/70'
                    }`}
                    style={{ height: `${h}%` }}
                  />
                </button>
              ))}

              {hoveredBar !== null && (
                <span
                  className="pointer-events-none absolute -top-1 z-10 rounded-md border border-white/15 bg-black/90 px-1.5 py-0.5 text-[9px] font-mono text-white whitespace-nowrap"
                  style={{ left: `${(hoveredBar / chartBars.length) * 100}%` }}
                >
                  {chartHours[hoveredBar]} · {chartBars[hoveredBar]}
                </span>
              )}
            </div>
          </Motion.div>

          {/* Layer 5: floating status card */}
          <Motion.div
            variants={layerVariants(150)}
            style={{ x: nearX, y: nearY }}
            className="absolute -top-8 w-[190px] hidden lg:block
                       lg:-right-5 xl:-right-14
                       rounded-xl border border-white/10 bg-neutral-950/90 backdrop-blur-xl p-3.5
                       shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Systems
              </span>
            </div>
            {[
              { label: 'Agents online', value: `${stations.length}/6` },
              { label: 'Billing', value: 'Auto' },
              { label: 'Telemetry', value: 'On' }
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-1 text-[10px] font-mono">
                <span className="text-neutral-500">{row.label}</span>
                <span className="text-neutral-200">{row.value}</span>
              </div>
            ))}
          </Motion.div>

          {/* Layer 6: notification chip */}
          <Motion.div
            style={{ x: nearX, y: nearY, z: 180 }}
            className="absolute -bottom-4 right-2 sm:right-6 hidden lg:block"
          >
            {notice && (
              <div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-black/90 px-3 py-1.5 shadow-[0_0_24px_-6px_rgba(220,38,38,0.8)]">
                <Bell className="w-3 h-3 text-red-400" />
                <span className="text-[10px] font-mono text-neutral-200 whitespace-nowrap">{notice}</span>
              </div>
            )}
          </Motion.div>
        </Motion.div>
      </div>

      <div className="mt-14 sm:mt-16 flex justify-center">
        <DemoBadge />
      </div>
    </div>
  );
};

export default CommandCenter;
