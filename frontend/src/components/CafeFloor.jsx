import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Wifi, Clock, IndianRupee, Activity } from 'lucide-react';
import PageBackground from './PageBackground';
import SectionHeading from './SectionHeading';
import Reveal from './Reveal';
import DemoBadge from './DemoBadge';

/**
 * Animated gaming-floor visualisation. Stations mirror the shape of the real
 * `pcs` record (name / ip_address / status) and the branch tabs mirror the
 * `branches` table, so the mock-up matches what ManagerXP actually models.
 * All values shown are sample data.
 */

const STATUSES = {
  session: { label: 'In session', dot: 'bg-red-500', ring: 'border-red-500/50', glow: 'shadow-[0_0_18px_-4px_rgba(220,38,38,0.65)]', text: 'text-red-400' },
  available: { label: 'Available', dot: 'bg-emerald-400', ring: 'border-emerald-400/30', glow: '', text: 'text-emerald-400' },
  maintenance: { label: 'Maintenance', dot: 'bg-amber-400', ring: 'border-amber-400/30', glow: '', text: 'text-amber-400' }
};

const branches = [
  { id: 'hyd-01', name: 'Banjara Hills', stations: 12 },
  { id: 'hyd-02', name: 'Gachibowli', stations: 12 }
];

const seedFloor = (offset) =>
  Array.from({ length: 12 }, (_, i) => {
    const n = (i + offset) % 5;
    return {
      id: `PC-${String(i + 1).padStart(2, '0')}`,
      ip: `192.168.${offset + 1}.${20 + i}`,
      status: n === 4 ? 'maintenance' : n % 2 === 0 ? 'session' : 'available',
      minutes: n % 2 === 0 ? 20 + ((i * 13) % 90) : 0
    };
  });

const CafeFloor = () => {
  const [branchIndex, setBranchIndex] = useState(0);
  const [stations, setStations] = useState(() => seedFloor(0));
  const sectionRef = useRef(null);

  // Cycle a single station at a time so the floor feels live without the whole
  // grid flickering. Paused off-screen and when reduced motion is requested.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const node = sectionRef.current;
    if (!node) return;

    let intervalId;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        setStations((prev) => {
          const next = [...prev];
          const i = Math.floor(Math.random() * next.length);
          const current = next[i];
          if (current.status === 'maintenance') return prev;
          const becomingSession = current.status === 'available';
          next[i] = {
            ...current,
            status: becomingSession ? 'session' : 'available',
            minutes: becomingSession ? 15 + Math.floor(Math.random() * 90) : 0
          };
          return next;
        });
      }, 2200);
    };

    const stop = () => {
      clearInterval(intervalId);
      intervalId = undefined;
    };

    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0.15 }
    );
    observer.observe(node);

    return () => {
      stop();
      observer.disconnect();
    };
  }, []);

  const selectBranch = (index) => {
    setBranchIndex(index);
    setStations(seedFloor(index));
  };

  const inSession = stations.filter((s) => s.status === 'session').length;
  const available = stations.filter((s) => s.status === 'available').length;
  const offline = stations.filter((s) => s.status === 'maintenance').length;
  const utilisation = Math.round((inSession / stations.length) * 100);

  const summary = [
    { icon: <Activity className="w-4 h-4" />, label: 'In session', value: inSession },
    { icon: <Monitor className="w-4 h-4" />, label: 'Available', value: available },
    { icon: <Wifi className="w-4 h-4" />, label: 'Maintenance', value: offline },
    { icon: <Clock className="w-4 h-4" />, label: 'Utilisation', value: `${utilisation}%` }
  ];

  return (
    <section ref={sectionRef} className="section-seam relative bg-black overflow-hidden antialiased font-sans text-white">
      <PageBackground streakTop="top-1/4" streakBottom="bottom-1/4" />

      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-6 section-y">
        <SectionHeading
          eyebrow="Live Floor View"
          title="Every station,"
          highlight="one screen."
          description="ManagerXP registers each PC with its name, IP and status, so the floor is visible at a glance instead of walked end to end."
          className="mb-6"
        />

        <Reveal className="flex justify-center mb-10">
          <DemoBadge />
        </Reveal>

        <Reveal>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md overflow-hidden shadow-[0_0_60px_-25px_rgba(220,38,38,0.35)]">

            {/* Window chrome + branch tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-2" role="tablist" aria-label="Branch">
                {branches.map((branch, index) => (
                  <button
                    key={branch.id}
                    type="button"
                    role="tab"
                    aria-selected={branchIndex === index}
                    onClick={() => selectBranch(index)}
                    className={`px-3 py-1.5 rounded-full text-xs font-mono transition-all duration-200 border ${
                      branchIndex === index
                        ? 'bg-red-500/15 border-red-500/40 text-white'
                        : 'bg-white/[0.03] border-white/10 text-neutral-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {branch.name}
                  </button>
                ))}
              </div>
              <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">
                managerxp · floor_view
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">

              {/* Station grid */}
              <div className="lg:col-span-2 p-5 sm:p-6 border-b lg:border-b-0 lg:border-r border-white/5">
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {stations.map((station) => {
                    const status = STATUSES[station.status];
                    return (
                      <div
                        key={station.id}
                        className={`rounded-xl border bg-white/[0.03] p-3 transition-all duration-500 ${status.ring} ${status.glow}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs text-white">{station.id}</span>
                          <span className={`h-2 w-2 rounded-full ${status.dot} transition-colors duration-500`} />
                        </div>
                        <Monitor className={`w-5 h-5 mb-2 transition-colors duration-500 ${status.text}`} />
                        <p className="font-mono text-[10px] text-neutral-500 truncate">{station.ip}</p>
                        <p className={`font-mono text-[10px] mt-1 transition-colors duration-500 ${status.text}`}>
                          {station.status === 'session' ? `${station.minutes} min` : status.label}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 pt-4 border-t border-white/5">
                  {Object.entries(STATUSES).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                      <span className={`h-1.5 w-1.5 rounded-full ${value.dot}`} />
                      {value.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary rail */}
              <div className="p-5 sm:p-6 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {summary.map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center gap-2 text-red-500 mb-2">{item.icon}</div>
                      <p className="text-xl font-semibold text-white tabular-nums">{item.value}</p>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mt-0.5">
                        {item.label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Utilisation bar */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Floor utilisation</span>
                    <span className="text-xs font-mono text-white tabular-nums">{utilisation}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 transition-[width] duration-700 ease-out"
                      style={{ width: `${utilisation}%` }}
                    />
                  </div>
                </div>

                {/* Session ticker */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-3">
                    Active sessions
                  </p>
                  <ul className="space-y-2.5">
                    {stations.filter((s) => s.status === 'session').slice(0, 4).map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs font-mono">
                        <span className="text-neutral-300">{s.id}</span>
                        <span className="flex items-center gap-1.5 text-neutral-500">
                          <Clock className="w-3 h-3" />
                          {s.minutes} min
                        </span>
                      </li>
                    ))}
                    {inSession === 0 && (
                      <li className="text-xs font-mono text-neutral-600">No active sessions</li>
                    )}
                  </ul>
                </div>

                <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-600">
                  <IndianRupee className="w-3 h-3" />
                  Billing follows session time automatically
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};

export default CafeFloor;
