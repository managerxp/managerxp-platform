import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion as Motion } from 'framer-motion';
import { createDraggable, createScope, createTimeline, onScroll, stagger, svg } from 'animejs';
import { TrendingUp, Users, Monitor, IndianRupee } from 'lucide-react';
import DemoBadge from './DemoBadge';
import { SPRING, prefersReducedMotion } from '../lib/motion';

/**
 * Occupancy / revenue across the trading day, with a draggable read-out cursor.
 *
 * This is the one product section where Anime.js is the right tool: the SVG
 * trace drawing and the physical drag-and-snap cursor are exactly its
 * primitives. The surrounding UI stays on Motion.
 */

const HOURS = ['10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p'];

const SERIES = {
  occupancy: {
    label: 'Occupancy',
    unit: '%',
    icon: <Monitor className="h-3.5 w-3.5" />,
    values: [22, 28, 32, 38, 44, 48, 55, 61, 72, 84, 96, 92, 78, 54]
  },
  revenue: {
    label: 'Revenue',
    unit: '₹',
    icon: <IndianRupee className="h-3.5 w-3.5" />,
    values: [180, 260, 340, 420, 510, 560, 680, 760, 980, 1240, 1480, 1390, 1120, 720]
  },
  customers: {
    label: 'Customers',
    unit: '',
    icon: <Users className="h-3.5 w-3.5" />,
    values: [3, 5, 6, 7, 9, 10, 12, 14, 17, 20, 23, 22, 18, 12]
  }
};

const W = 640;
const H = 160;

const AnalyticsPeak = () => {
  const rootRef = useRef(null);
  const railRef = useRef(null);
  const handleRef = useRef(null);
  const draggableRef = useRef(null);
  const indexRef = useRef(9);

  const [metric, setMetric] = useState('occupancy');
  const [index, setIndex] = useState(9);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const series = SERIES[metric];
  const max = Math.max(...series.values);
  const peakIndex = series.values.indexOf(max);

  const points = useMemo(
    () =>
      series.values
        .map((v, i) => `${((i / (series.values.length - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 16) - 8).toFixed(1)}`)
        .join(' '),
    [series, max]
  );

  // Trace draws itself when the section arrives.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const scope = createScope({ root: rootRef }).add(() => {
      createTimeline({
        autoplay: onScroll({ target: rootRef.current, enter: 'bottom-=80 top', repeat: false })
      })
        .add(svg.createDrawable('.an-trace'), { draw: ['0 0', '0 1'], duration: 1400, ease: 'inOutQuad' }, 0)
        .add('.an-bar', { scaleY: [0, 1], duration: 620, delay: stagger(34), ease: 'out(3)' }, 300);
    });
    return () => scope.revert();
  }, [metric]);

  // Physical drag along the hour axis, snapping to each reading.
  useEffect(() => {
    const handle = handleRef.current;
    const rail = railRef.current;
    if (!handle || !rail || prefersReducedMotion()) return;

    const step = () => rail.getBoundingClientRect().width / (HOURS.length - 1);

    const draggable = createDraggable(handle, {
      container: rail,
      y: false,
      x: { snap: HOURS.map((_, i) => i * step()) },
      releaseStiffness: 140,
      releaseDamping: 20,
      onUpdate: (self) => {
        const i = Math.round(self.x / step());
        setIndex(Math.min(HOURS.length - 1, Math.max(0, i)));
      }
    });

    draggableRef.current = draggable;
    draggable.setX(indexRef.current * step(), true);

    return () => {
      draggable.revert();
      draggableRef.current = null;
    };
  }, []);

  const moveTo = (i) => {
    const clamped = Math.min(HOURS.length - 1, Math.max(0, i));
    setIndex(clamped);
    const rail = railRef.current;
    const d = draggableRef.current;
    if (d && rail) d.setX((clamped * rail.getBoundingClientRect().width) / (HOURS.length - 1), true);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); moveTo(indexRef.current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveTo(indexRef.current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); moveTo(0); }
    else if (e.key === 'End') { e.preventDefault(); moveTo(HOURS.length - 1); }
  };

  const value = series.values[index];
  const fmt = (v) => (metric === 'revenue' ? `₹${v.toLocaleString('en-IN')}` : `${v}${series.unit}`);

  return (
    <div ref={rootRef} className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl shadow-[0_0_60px_-30px_rgba(220,38,38,0.5)]">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3">
        <div className="flex gap-1.5" role="tablist" aria-label="Metric">
          {Object.entries(SERIES).map(([id, s]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={metric === id}
              onClick={() => setMetric(id)}
              className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                metric === id ? 'text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {metric === id && (
                <Motion.span layoutId="metric-pill" transition={SPRING} className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-red-700 to-red-900" />
              )}
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
        <DemoBadge />
      </div>

      <div className="p-4 sm:p-6">
        {/* Read-out */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              {HOURS[index]} · {series.label}
            </p>
            <p className="font-mono text-3xl font-semibold tabular-nums text-white">{fmt(value)}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-red-400" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-red-300">
              Peak {HOURS[peakIndex]}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${series.label} across the day (sample data)`}>
            {series.values.map((v, i) => (
              <rect
                key={i}
                className="an-bar origin-bottom"
                x={(i / series.values.length) * W + 3}
                y={H - (v / max) * (H - 16) - 8}
                width={W / series.values.length - 6}
                height={(v / max) * (H - 16)}
                rx="3"
                fill={i === index ? 'rgba(239,68,68,0.55)' : 'rgba(239,68,68,0.14)'}
                style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
              />
            ))}
            <polyline className="an-trace" points={points} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" />
            <line
              x1={(index / (series.values.length - 1)) * W}
              y1="0"
              x2={(index / (series.values.length - 1)) * W}
              y2={H}
              stroke="rgba(239,68,68,0.8)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          </svg>
        </div>

        {/* Draggable cursor */}
        <div className="mt-4">
          <div ref={railRef} className="relative h-8 rounded-full border border-white/10 bg-white/[0.03]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-900/40 to-red-600/30"
              style={{ width: `${(index / (HOURS.length - 1)) * 100}%` }}
              aria-hidden="true"
            />
            <div
              ref={handleRef}
              role="slider"
              tabIndex={0}
              aria-label="Hour of day"
              aria-valuemin={0}
              aria-valuemax={HOURS.length - 1}
              aria-valuenow={index}
              aria-valuetext={`${HOURS[index]}, ${fmt(value)}`}
              onKeyDown={onKey}
              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border border-red-400/60 bg-black shadow-[0_0_16px_-2px_rgba(239,68,68,0.9)] active:cursor-grabbing"
              style={prefersReducedMotion() ? { left: `${(index / (HOURS.length - 1)) * 100}%` } : { left: 0 }}
            >
              <span aria-hidden="true" className="absolute inset-[5px] rounded-full bg-red-500" />
            </div>
          </div>
          <div className="mt-2 flex justify-between font-mono text-[9px] text-neutral-600">
            <span>{HOURS[0]}</span>
            <span className="hidden sm:inline">Drag or use arrow keys</span>
            <span>{HOURS[HOURS.length - 1]}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPeak;
