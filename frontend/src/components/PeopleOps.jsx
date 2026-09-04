import React, { useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { Clock, Wallet, Gamepad2, CalendarCheck, Crown } from 'lucide-react';
import DemoBadge from './DemoBadge';
import { EASE_MOTION, SPRING } from '../lib/motion';

/**
 * The people running the floor and the people on it. Two related views behind
 * one switch rather than two card grids. Sample data.
 */

const team = [
  { id: 't1', name: 'Rahul', role: 'Manager', status: 'Active', shift: '10:00 – 18:00', handled: 42, tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  { id: 't2', name: 'Arjun', role: 'Cashier', status: 'Active', shift: '12:00 – 20:00', handled: 68, tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  { id: 't3', name: 'Sara', role: 'F&B', status: 'Break', shift: '11:00 – 19:00', handled: 31, tone: 'text-amber-400', dot: 'bg-amber-400' },
  { id: 't4', name: 'Imran', role: 'Technician', status: 'Offline', shift: '18:00 – 02:00', handled: 0, tone: 'text-neutral-500', dot: 'bg-neutral-600' }
];

const customers = [
  {
    id: 'c1', name: 'Aditya R.', tier: 'Pro', since: 'Mar 2026',
    stats: [
      { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: 'Visits', value: '42' },
      { icon: <Gamepad2 className="h-3.5 w-3.5" />, label: 'Play time', value: '86h' },
      { icon: <Wallet className="h-3.5 w-3.5" />, label: 'Spend', value: '₹18,420' },
      { icon: <Clock className="h-3.5 w-3.5" />, label: 'Last visit', value: 'Today' }
    ],
    recent: ['PC-02 · 1h 24m · ₹210', 'Cold coffee ×2 · ₹240', 'PC-06 · 2h 05m · ₹310']
  },
  {
    id: 'c2', name: 'Nisha K.', tier: 'Elite', since: 'Jan 2026',
    stats: [
      { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: 'Visits', value: '87' },
      { icon: <Gamepad2 className="h-3.5 w-3.5" />, label: 'Play time', value: '164h' },
      { icon: <Wallet className="h-3.5 w-3.5" />, label: 'Spend', value: '₹41,900' },
      { icon: <Clock className="h-3.5 w-3.5" />, label: 'Last visit', value: 'Yesterday' }
    ],
    recent: ['PC-06 · 3h 10m · ₹465', 'Burger · ₹180', 'PC-06 · 2h 40m · ₹400']
  }
];

const VIEWS = [
  { id: 'team', label: 'Team on shift' },
  { id: 'customers', label: 'Customers' }
];

const PeopleOps = () => {
  const [view, setView] = useState('team');
  const [customerId, setCustomerId] = useState('c1');
  const customer = customers.find((c) => c.id === customerId);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl shadow-[0_0_60px_-30px_rgba(220,38,38,0.4)]">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3">
        <div className="flex gap-1.5" role="tablist" aria-label="People view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`relative rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                view === v.id ? 'text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {view === v.id && (
                <Motion.span layoutId="people-pill" transition={SPRING} className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-red-700 to-red-900" />
              )}
              {v.label}
            </button>
          ))}
        </div>
        <DemoBadge />
      </div>

      {/* popLayout rather than wait: the incoming view mounts immediately instead
          of queueing behind an exit animation, so the panel can never be left
          blank if that animation is throttled (background or prerendered tab). */}
      <AnimatePresence mode="popLayout">
        {view === 'team' && (
          <Motion.div
            key="team"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE_MOTION }}
            className="p-4 sm:p-5"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    {['Name', 'Role', 'Shift', 'Handled', 'Status'].map((h) => (
                      <th key={h} className="pb-2 font-mono text-[10px] font-normal uppercase tracking-wider text-neutral-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {team.map((m, i) => (
                    <Motion.tr
                      key={m.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: i * 0.06, ease: EASE_MOTION }}
                      className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                    >
                      <td className="py-3 text-sm text-neutral-200">{m.name}</td>
                      <td className="py-3 text-sm text-neutral-400">{m.role}</td>
                      <td className="py-3 font-mono text-xs text-neutral-500">{m.shift}</td>
                      <td className="py-3 font-mono text-xs tabular-nums text-neutral-300">{m.handled}</td>
                      <td className="py-3">
                        <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${m.tone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                          {m.status}
                        </span>
                      </td>
                    </Motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Motion.div>
        )}

        {view === 'customers' && (
          <Motion.div
            key="customers"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE_MOTION }}
            className="grid grid-cols-1 md:grid-cols-3"
          >
            <div className="border-b md:border-b-0 md:border-r border-white/5 p-4 sm:p-5">
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCustomerId(c.id)}
                  aria-pressed={customerId === c.id}
                  className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    customerId === c.id ? 'border-red-500/40 bg-red-500/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  <span className="text-sm text-neutral-200">{c.name}</span>
                  <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-red-400">
                    <Crown className="h-3 w-3" />
                    {c.tier}
                  </span>
                </button>
              ))}
            </div>

            <div className="md:col-span-2 p-4 sm:p-5">
              <Motion.div key={customer.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                <div className="mb-4 flex items-baseline justify-between">
                  <h4 className="text-lg font-semibold text-white">{customer.name}</h4>
                  <span className="font-mono text-[10px] text-neutral-500">Member since {customer.since}</span>
                </div>

                <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {customer.stats.map((s) => (
                    <div key={s.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <span className="mb-1.5 inline-flex text-red-500">{s.icon}</span>
                      <p className="font-mono text-sm font-semibold tabular-nums text-white">{s.value}</p>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">{s.label}</p>
                    </div>
                  ))}
                </div>

                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-neutral-500">Recent activity</p>
                <ul className="space-y-1.5">
                  {customer.recent.map((r) => (
                    <li key={r} className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                      <span className="h-1 w-1 rounded-full bg-red-500" />
                      {r}
                    </li>
                  ))}
                </ul>
              </Motion.div>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PeopleOps;
