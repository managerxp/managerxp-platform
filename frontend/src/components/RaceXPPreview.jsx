import React, { useEffect, useState } from 'react';
import { Flag, Trophy, Layers, Plus } from 'lucide-react';
import Reveal from './Reveal';
import DemoBadge from './DemoBadge';
import TelemetryPanel from './TelemetryPanel';
import { prefersReducedMotion } from '../lib/motion';

/**
 * RaceXP — the Phase 2 expansion of the ManagerXP platform.
 *
 * The capability lists below are planned direction, not shipped features. The
 * telemetry panel runs a deterministic simulation and says so on its face.
 */

const leaderboardSeed = [
  { id: 'D1', driver: 'A. Morgan', best: '8:19.150', gap: '—' },
  { id: 'D2', driver: 'J. Vermeer', best: '8:21.402', gap: '+2.252' },
  { id: 'D3', driver: 'K. Sato', best: '8:24.917', gap: '+5.767' },
  { id: 'D4', driver: 'R. Delgado', best: '8:27.554', gap: '+8.404' },
  { id: 'D5', driver: 'M. Fischer', best: '8:31.088', gap: '+11.938' }
];

const plannedAddOn = [
  'Simulator management',
  'Race session control',
  'Driver profiles',
  'Lap timing',
  'Leaderboards'
];

const plannedStandalone = [
  'Venue management',
  'Race scheduling',
  'Championships & events',
  'Race results',
  'Telemetry capture',
  'Remote operations'
];

const RaceXPPreview = () => {
  const [board, setBoard] = useState(leaderboardSeed);

  // Occasional position swap so the board reads as a running session.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => {
      setBoard((prev) => {
        const next = [...prev];
        const i = 1 + Math.floor(Math.random() * (next.length - 1));
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        return next;
      });
    }, 5200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-10">

      {/* Phase 2 header */}
      <Reveal>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-6 sm:p-8 backdrop-blur-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-red-400">
              <Flag className="h-3 w-3" aria-hidden="true" />
              Phase 2 · In development
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              Not yet available
            </span>
          </div>

          <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white text-balance">
            RaceXP — the next generation of{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-red-700">
              racing centre management.
            </span>
          </h3>
          <p className="mt-4 max-w-2xl text-sm sm:text-base leading-relaxed text-neutral-400 text-pretty">
            RaceXP extends the ManagerXP platform into sim racing centres, racing lounges and simulator
            venues. Everything below describes the planned direction for this product, not features you
            can buy today.
          </p>
        </div>
      </Reveal>

      {/* Live telemetry */}
      <Reveal>
        <TelemetryPanel />
      </Reveal>

      {/* Two future forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Reveal className="h-full">
          <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-sm transition-colors duration-300 hover:border-red-500/30">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-lg border border-white/10 bg-white/5 p-2 text-red-500">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </span>
              <h4 className="text-lg font-semibold text-white">CafeXP + RaceXP add-on</h4>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-neutral-400">
              For a gaming cafe that wants to add racing simulators alongside its existing floor —
              one operation, gaming and racing together.
            </p>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-neutral-600">Planned areas</p>
            <ul className="space-y-2">
              {plannedAddOn.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-neutral-300">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={110} className="h-full">
          <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-sm transition-colors duration-300 hover:border-red-500/30">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-lg border border-white/10 bg-white/5 p-2 text-red-500">
                <Layers className="h-4 w-4" aria-hidden="true" />
              </span>
              <h4 className="text-lg font-semibold text-white">RaceXP standalone</h4>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-neutral-400">
              For dedicated sim-racing centres and simulator venues that do not run a gaming cafe at all,
              eventually running as its own product.
            </p>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-neutral-600">Planned areas</p>
            <ul className="space-y-2">
              {plannedStandalone.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-neutral-300">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      {/* Leaderboard */}
      <Reveal>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-white">
              <Trophy className="h-4 w-4 text-red-500" aria-hidden="true" />
              Session leaderboard · concept
            </span>
            <DemoBadge />
          </div>

          <ul className="divide-y divide-white/5">
            {board.map((row, index) => (
              <li key={row.id} className="flex items-center gap-4 px-4 sm:px-5 py-3 transition-colors duration-500">
                <span className={`w-7 text-center font-mono text-xs tabular-nums ${index === 0 ? 'text-red-400' : 'text-neutral-500'}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 text-sm text-neutral-200">{row.driver}</span>
                <span className="font-mono text-xs tabular-nums text-neutral-300">{row.best}</span>
                <span className="hidden w-20 text-right font-mono text-xs tabular-nums text-neutral-500 sm:block">
                  {index === 0 ? '—' : row.gap}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  );
};

export default RaceXPPreview;
