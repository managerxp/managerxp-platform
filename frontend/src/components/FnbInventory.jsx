import React, { useEffect, useState } from 'react';
import { motion as Motion } from 'framer-motion';
import { AlertTriangle, Utensils, Boxes } from 'lucide-react';
import DemoBadge from './DemoBadge';
import { EASE_MOTION, VIEWPORT, prefersReducedMotion } from '../lib/motion';

/**
 * F&B sales next to the stock those sales draw down — the point being that the
 * two move together. Sample data; stock ticks so the low-stock state is visible.
 */

const sales = [
  { name: 'Soft drinks', qty: 64 },
  { name: 'Burger', qty: 42 },
  { name: 'Fries', qty: 37 },
  { name: 'Cold coffee', qty: 29 },
  { name: 'Chips', qty: 21 }
];

const initialStock = [
  { name: 'Soft drinks', qty: 120, low: 30 },
  { name: 'Fries', qty: 76, low: 25 },
  { name: 'Chicken', qty: 42, low: 20 },
  { name: 'Burger buns', qty: 18, low: 24 },
  { name: 'Coffee beans', qty: 9, low: 15 }
];

const max = Math.max(...sales.map((s) => s.qty));

const FnbInventory = () => {
  const [stock, setStock] = useState(initialStock);

  // Slow drawdown so the low-stock warning is something you see happen.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => {
      setStock((prev) => {
        const i = Math.floor(Math.random() * prev.length);
        return prev.map((s, idx) =>
          idx === i ? { ...s, qty: s.qty <= 4 ? s.low + 20 : s.qty - 1 } : s
        );
      });
    }, 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

      {/* Sales */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <Utensils className="h-4 w-4 text-red-500" />
            Today's F&amp;B sales
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">units</span>
        </div>

        <div className="space-y-3">
          {sales.map((s, i) => (
            <div key={s.name}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm text-neutral-300">{s.name}</span>
                <span className="font-mono text-xs tabular-nums text-neutral-400">{s.qty}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <Motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(s.qty / max) * 100}%` }}
                  viewport={VIEWPORT}
                  transition={{ duration: 0.8, delay: i * 0.08, ease: EASE_MOTION }}
                  className="h-full rounded-full bg-gradient-to-r from-red-700 to-red-400"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stock */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <Boxes className="h-4 w-4 text-red-500" />
            Stock on hand
          </span>
          <DemoBadge />
        </div>

        <ul className="space-y-2">
          {stock.map((s) => {
            const isLow = s.qty <= s.low;
            return (
              <Motion.li
                key={s.name}
                layout
                className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors duration-500 ${
                  isLow ? 'border-amber-400/30 bg-amber-400/[0.06]' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <span className={`text-sm ${isLow ? 'text-amber-200' : 'text-neutral-300'}`}>{s.name}</span>
                <span className="flex items-center gap-2">
                  {isLow && (
                    <Motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-amber-400"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      low
                    </Motion.span>
                  )}
                  <Motion.span
                    key={s.qty}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`w-8 text-right font-mono text-sm tabular-nums ${isLow ? 'text-amber-300' : 'text-white'}`}
                  >
                    {s.qty}
                  </Motion.span>
                </span>
              </Motion.li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default FnbInventory;
