import React from 'react';
import { Activity, Monitor, IndianRupee, TrendingUp } from 'lucide-react';
import DemoBadge from './DemoBadge';

/**
 * Compact owner-view mock-up for the hero. Mirrors the data ManagerXP models
 * (sessions on registered PCs, branch, time-based takings) using sample values.
 */
const tiles = [
  { icon: <Activity className="w-4 h-4" />, label: 'Active sessions', value: '18' },
  { icon: <Monitor className="w-4 h-4" />, label: 'Available PCs', value: '6' },
  { icon: <IndianRupee className="w-4 h-4" />, label: 'Today', value: '12,480' },
  { icon: <TrendingUp className="w-4 h-4" />, label: 'Peak hour', value: '7–8 PM' }
];

// Relative bar heights for the illustrative hourly chart.
const hours = [28, 35, 30, 46, 52, 61, 74, 88, 96, 78, 64, 44];

const DashboardPreview = () => {
  return (
    <div className="relative">
      {/* Ambient glow behind the panel */}
      <div
        aria-hidden="true"
        className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-red-600/15 via-red-500/5 to-transparent blur-2xl"
      />

      <div className="relative rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl overflow-hidden shadow-[0_0_60px_-25px_rgba(220,38,38,0.5)]">

        {/* Chrome */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>
          <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider truncate">
            owner_view · banjara hills
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-red-400 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        </div>

        <div className="p-4 sm:p-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {tiles.map((tile) => (
              <div key={tile.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left">
                <span className="text-red-500 inline-flex mb-2">{tile.icon}</span>
                <p className="text-lg sm:text-xl font-semibold text-white tabular-nums leading-none">{tile.value}</p>
                <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mt-1.5">{tile.label}</p>
              </div>
            ))}
          </div>

          {/* Hourly chart */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                Sessions by hour
              </span>
              <span className="text-[10px] font-mono text-neutral-600">12h</span>
            </div>
            <div className="flex items-end gap-1.5 h-20" aria-hidden="true">
              {hours.map((height, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-gradient-to-t from-red-800/60 to-red-500/80"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 flex justify-center">
            <DemoBadge />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPreview;
