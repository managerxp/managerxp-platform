import React, { useEffect, useState } from 'react';
import { motion as Motion, AnimatePresence, animate } from 'framer-motion';
import { Plus, Minus, Receipt, CheckCircle2, IndianRupee } from 'lucide-react';
import DemoBadge from './DemoBadge';
import { EASE_MOTION, SPRING, prefersReducedMotion } from '../lib/motion';

/**
 * Billing counter: a live session charge plus anything ordered against it.
 * The visitor can add or remove items and watch the bill settle. Sample data.
 */

const MENU = [
  { id: 'burger', name: 'Burger', price: 180 },
  { id: 'fries', name: 'Fries', price: 90 },
  { id: 'coffee', name: 'Cold coffee', price: 120 },
  { id: 'drink', name: 'Soft drink', price: 60 }
];

const RATE_PER_HOUR = 150;

const AnimatedAmount = ({ value }) => {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const controls = animate(shown, value, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (v) => setShown(v)
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{Math.round(shown).toLocaleString('en-IN')}</>;
};

const BillingDesk = () => {
  const [seconds, setSeconds] = useState(4980);
  const [items, setItems] = useState({ burger: 1, coffee: 2 });
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion() || paid) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [paid]);

  const change = (id, delta) =>
    setItems((prev) => {
      const next = { ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) };
      if (next[id] === 0) delete next[id];
      return next;
    });

  const sessionCharge = Math.round((seconds / 3600) * RATE_PER_HOUR);
  const lines = MENU.filter((m) => items[m.id]).map((m) => ({ ...m, qty: items[m.id], sum: m.price * items[m.id] }));
  const fnbTotal = lines.reduce((a, l) => a + l.sum, 0);
  const total = sessionCharge + fnbTotal;

  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

      {/* Order side */}
      <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-neutral-500">Add to the tab</p>
        <div className="space-y-2">
          {MENU.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div>
                <p className="text-sm text-neutral-200">{m.name}</p>
                <p className="font-mono text-[10px] text-neutral-500">₹{m.price}</p>
              </div>
              <div className="flex items-center gap-2">
                <Motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => change(m.id, -1)}
                  aria-label={`Remove one ${m.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-neutral-400 hover:border-red-500/40 hover:text-white"
                >
                  <Minus className="h-3 w-3" />
                </Motion.button>
                <span className="w-5 text-center font-mono text-xs tabular-nums text-white">{items[m.id] || 0}</span>
                <Motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => change(m.id, 1)}
                  aria-label={`Add one ${m.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-neutral-400 hover:border-red-500/40 hover:text-white"
                >
                  <Plus className="h-3 w-3" />
                </Motion.button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bill side */}
      <div className="lg:col-span-3 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl shadow-[0_0_60px_-30px_rgba(220,38,38,0.5)]">
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-5 py-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-white">
            <Receipt className="h-4 w-4 text-red-500" />
            Customer #1024 · PC-02
          </span>
          <DemoBadge />
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between border-b border-white/5 py-2.5">
            <div>
              <p className="text-sm text-neutral-200">Gaming session</p>
              <p className="font-mono text-[10px] text-neutral-500 tabular-nums">
                {hh}:{mm}:{ss} · ₹{RATE_PER_HOUR}/hr
              </p>
            </div>
            <span className="font-mono text-sm tabular-nums text-neutral-200">
              ₹<AnimatedAmount value={sessionCharge} />
            </span>
          </div>

          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <Motion.div
                key={l.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.28, ease: EASE_MOTION }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-white/5 py-2.5">
                  <p className="text-sm text-neutral-300">
                    {l.name} <span className="font-mono text-[10px] text-neutral-500">×{l.qty}</span>
                  </p>
                  <span className="font-mono text-sm tabular-nums text-neutral-300">₹{l.sum.toLocaleString('en-IN')}</span>
                </div>
              </Motion.div>
            ))}
          </AnimatePresence>

          <div className="mt-4 flex items-end justify-between">
            <span className="text-sm font-semibold text-white">Total</span>
            <span className="flex items-center font-mono text-2xl font-semibold tabular-nums text-red-400">
              <IndianRupee className="h-5 w-5" />
              <AnimatedAmount value={total} />
            </span>
          </div>

          <Motion.button
            type="button"
            onClick={() => setPaid(true)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.99 }}
            transition={SPRING}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-gradient-to-br from-red-700 to-red-900 py-3 text-sm font-semibold text-white shadow-[0_0_24px_-8px_rgba(220,38,38,0.8)]"
          >
            {paid ? <CheckCircle2 className="h-4 w-4" /> : null}
            {paid ? 'Paid · receipt issued' : 'Take payment'}
          </Motion.button>

          <AnimatePresence>
            {paid && (
              <Motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 text-center font-mono text-[10px] text-neutral-500"
              >
                Session closed · added to customer history
              </Motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default BillingDesk;
