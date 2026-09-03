import React, { useEffect, useRef, useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CornerDownLeft, TrendingDown, Clock, Utensils } from 'lucide-react';
import { EASE_MOTION, SPRING, prefersReducedMotion } from '../lib/motion';

/**
 * CafeXP AI: the step from charts to an answer. Pick a question, watch the
 * analysis assemble.
 *
 * The responses here are written examples shown on the marketing site — they are
 * not generated from a live café, which the footnote states plainly.
 */

const CONVERSATIONS = [
  {
    q: 'Why was revenue lower yesterday?',
    findings: [
      { icon: <TrendingDown className="h-3.5 w-3.5" />, text: 'Revenue came in 8% under the previous Tuesday.' },
      { icon: <Clock className="h-3.5 w-3.5" />, text: 'PC occupancy dipped between 6 PM and 9 PM, normally the strongest block.' },
      { icon: <Utensils className="h-3.5 w-3.5" />, text: 'F&B held steady, so the shortfall sits with station time.' }
    ],
    action: 'Look at evening station availability — the drop is concentrated in the peak window rather than spread across the day.'
  },
  {
    q: 'When is the café busiest?',
    findings: [
      { icon: <Clock className="h-3.5 w-3.5" />, text: 'Occupancy peaks between 7 PM and 9 PM every weekday.' },
      { icon: <TrendingDown className="h-3.5 w-3.5" />, text: 'Mornings before noon run under a third of capacity.' },
      { icon: <Utensils className="h-3.5 w-3.5" />, text: 'F&B orders cluster tightly around the same evening window.' }
    ],
    action: 'Staffing and stock are best weighted toward the evening block; mornings have room for off-peak offers.'
  },
  {
    q: 'Which stations underperform?',
    findings: [
      { icon: <TrendingDown className="h-3.5 w-3.5" />, text: 'Two machines sit well below the floor average on session hours.' },
      { icon: <Clock className="h-3.5 w-3.5" />, text: 'Both show longer idle gaps between sessions than their neighbours.' },
      { icon: <Utensils className="h-3.5 w-3.5" />, text: 'Neither is flagged for maintenance.' }
    ],
    action: 'Worth checking placement and specification on those two before adding capacity elsewhere.'
  }
];

const CafeXPAI = () => {
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState('done');
  const timers = useRef([]);

  const ask = (i) => {
    timers.current.forEach(clearTimeout);
    setActive(i);
    if (prefersReducedMotion()) {
      setPhase('done');
      return;
    }
    setPhase('thinking');
    timers.current = [setTimeout(() => setPhase('done'), 900)];
  };

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const convo = CONVERSATIONS[active];

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 backdrop-blur-xl shadow-[0_0_70px_-30px_rgba(220,38,38,0.7)]">

      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-red-500" />
          CafeXP AI
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          Ready
        </span>
      </div>

      <div className="p-4 sm:p-6">
        {/* Question chips */}
        <p className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">Ask about your café</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {CONVERSATIONS.map((c, i) => (
            <Motion.button
              key={c.q}
              type="button"
              onClick={() => ask(i)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={SPRING}
              aria-pressed={active === i}
              className={`rounded-full border px-3.5 py-2 text-left text-xs transition-colors ${
                active === i
                  ? 'border-red-500/50 bg-red-500/10 text-white'
                  : 'border-white/10 bg-white/[0.03] text-neutral-400 hover:border-white/25 hover:text-white'
              }`}
            >
              {c.q}
            </Motion.button>
          ))}
        </div>

        {/* Prompt line */}
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3">
          <span className="font-mono text-sm text-red-400">&gt;</span>
          <AnimatePresence mode="wait">
            <Motion.span
              key={convo.q}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="flex-1 font-mono text-sm text-neutral-200"
            >
              {convo.q}
            </Motion.span>
          </AnimatePresence>
          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-neutral-600" aria-hidden="true" />
        </div>

        {/* Analysis */}
        <div aria-live="polite" className="min-h-[9rem]">
          <AnimatePresence mode="wait">
            {phase === 'thinking' ? (
              <Motion.div
                key="thinking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 py-6"
              >
                {[0, 1, 2].map((d) => (
                  <Motion.span
                    key={d}
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }}
                    className="h-1.5 w-1.5 rounded-full bg-red-500"
                  />
                ))}
                <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-neutral-500">Analysing</span>
              </Motion.div>
            ) : (
              <Motion.div
                key={`answer-${active}`}
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.13 } } }}
              >
                <p className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">Analysis</p>
                <ul className="mb-4 space-y-2.5">
                  {convo.findings.map((f) => (
                    <Motion.li
                      key={f.text}
                      variants={{
                        hidden: { opacity: 0, x: -10 },
                        visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE_MOTION } }
                      }}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral-300"
                    >
                      <span className="mt-0.5 shrink-0 text-red-500">{f.icon}</span>
                      {f.text}
                    </Motion.li>
                  ))}
                </ul>

                <Motion.div
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_MOTION } }
                  }}
                  className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4"
                >
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-red-400">Suggested next step</p>
                  <p className="text-sm leading-relaxed text-neutral-200">{convo.action}</p>
                </Motion.div>
              </Motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-4 border-t border-white/5 pt-3 font-mono text-[10px] leading-relaxed text-neutral-600">
          Example answers shown for illustration — not generated from a live café.
        </p>
      </div>
    </div>
  );
};

export default CafeXPAI;
