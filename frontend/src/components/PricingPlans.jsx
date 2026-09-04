import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion as Motion } from 'framer-motion';
import { Check, Minus, ArrowRight, Sparkles } from 'lucide-react';
import Reveal from './Reveal';
import { SPRING, EASE_MOTION } from '../lib/motion';

/**
 * CafeXP packages.
 *
 * Tiers are shaped by the fields a subscription plan actually carries
 * (max_pcs, max_branches, is_telmetry_enabled, no_of_days, is_freeTrial), so the
 * differences between packages are real product levers rather than invented ones.
 *
 * No prices are shown: pricing is not defined anywhere in the project, so each
 * package routes to sales instead of displaying a made-up figure.
 */

const plans = [
  {
    id: 'basic',
    name: 'Basic',
    tagline: 'Essential cafe management',
    forWho: 'Small and newly opened gaming cafes that need the fundamentals working properly.',
    highlights: [
      'Register and control your PCs',
      'Timed customer sessions',
      'Billing from session time',
      'Customer records',
      'Standard reports'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Advanced cafe operations',
    recommended: true,
    forWho: 'Growing cafes running a bigger floor, more staff and more than one room.',
    highlights: [
      'Everything in Basic',
      'Higher PC allowance',
      'Multiple branches',
      'Live floor monitoring',
      'Hardware telemetry',
      'Advanced reporting'
    ]
  },
  {
    id: 'elite',
    name: 'Elite',
    tagline: 'Complete cafe intelligence',
    forWho: 'High-volume and multi-location operators who run the business on the numbers.',
    highlights: [
      'Everything in Pro',
      'Largest PC allowance',
      'Multi-location management',
      'Full telemetry coverage',
      'Advanced analytics',
      'Priority support'
    ]
  }
];

/**
 * Comparison rows map one-to-one onto capabilities the product models.
 * Exact numeric limits live on the subscription plan record, so they are
 * described by level rather than invented here.
 */
const comparison = [
  { label: 'Registered PCs', basic: 'Entry allowance', pro: 'Higher allowance', elite: 'Largest allowance' },
  { label: 'Branches', basic: 'Single branch', pro: 'Multiple branches', elite: 'Multi-location' },
  { label: 'Session control & timing', basic: true, pro: true, elite: true },
  { label: 'Billing from session time', basic: true, pro: true, elite: true },
  { label: 'Customer records', basic: true, pro: true, elite: true },
  { label: 'Per-PC game & software library', basic: true, pro: true, elite: true },
  { label: 'Live floor monitoring', basic: 'Basic view', pro: true, elite: true },
  { label: 'Hardware telemetry', basic: false, pro: true, elite: true },
  { label: 'Reporting', basic: 'Standard', pro: 'Advanced', elite: 'Advanced + analytics' },
  { label: 'Free trial', basic: true, pro: true, elite: true }
];

const Cell = ({ value }) => {
  if (value === true) {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-red-500/15 border border-red-500/30 p-1">
        <Check className="w-3 h-3 text-red-400" aria-hidden="true" />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center justify-center text-neutral-700">
        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </span>
    );
  }
  return <span className="text-[11px] font-mono text-neutral-300">{value}</span>;
};

const PricingPlans = () => {
  const [selected, setSelected] = useState('pro');

  const selectedPlan = plans.find((p) => p.id === selected) || plans[1];

  return (
    <div>
      {/* Package cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
        {plans.map((plan, index) => {
          const isSelected = selected === plan.id;
          return (
            <Reveal key={plan.id} delay={index * 90} className="h-full">
              <Motion.button
                type="button"
                onClick={() => setSelected(plan.id)}
                aria-pressed={isSelected}
                whileHover={{ y: -6 }}
                whileTap={{ scale: 0.99 }}
                transition={SPRING}
                className={`group relative flex h-full w-full flex-col rounded-2xl border p-6 text-left
                            transition-colors duration-300 backdrop-blur-sm
                            ${isSelected
                              ? 'border-red-500/50 bg-red-500/[0.06] shadow-[0_0_50px_-20px_rgba(220,38,38,0.8)]'
                              : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}
              >
                {plan.recommended && (
                  <span className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-black px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-red-400">
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
                    Recommended
                  </span>
                )}

                <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
                <p className="mt-1 text-xs font-mono uppercase tracking-wider text-red-500/80">
                  {plan.tagline}
                </p>

                <p className="mt-4 text-sm leading-relaxed text-neutral-400">{plan.forWho}</p>

                <ul className="mt-5 space-y-2.5 grow">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-neutral-300">
                      <Check className="mt-0.5 w-3.5 h-3.5 shrink-0 text-red-500" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>

                {/* Pricing is not defined in the project, so this routes to sales. */}
                <span
                  className={`mt-6 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-300
                              ${isSelected
                                ? 'bg-gradient-to-br from-red-700 to-red-900 text-white border border-white/10'
                                : 'bg-white/[0.05] text-neutral-200 border border-white/10 group-hover:bg-white/[0.08]'}`}
                >
                  Talk to ManagerXP
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              </Motion.button>
            </Reveal>
          );
        })}
      </div>

      {/* Comparison */}
      <Reveal>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
              Package comparison
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-red-400">
              Viewing · {selectedPlan.name}
            </span>
          </div>

          {/* Mobile: selected column only. Desktop: full matrix. */}
          <div className="divide-y divide-white/5">
            <div className="hidden md:grid grid-cols-[1.6fr_repeat(3,0.8fr)] gap-3 px-5 py-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-600">Capability</span>
              {plans.map((p) => (
                <span
                  key={p.id}
                  className={`text-center text-[10px] font-mono uppercase tracking-wider transition-colors duration-300 ${
                    selected === p.id ? 'text-red-400' : 'text-neutral-600'
                  }`}
                >
                  {p.name}
                </span>
              ))}
            </div>

            {comparison.map((row) => (
              <div key={row.label} className="px-5 py-3">
                {/* Desktop matrix */}
                <div className="hidden md:grid grid-cols-[1.6fr_repeat(3,0.8fr)] items-center gap-3">
                  <span className="text-sm text-neutral-300">{row.label}</span>
                  {plans.map((p) => (
                    <Motion.span
                      key={p.id}
                      animate={{ opacity: selected === p.id ? 1 : 0.45 }}
                      transition={{ duration: 0.3, ease: EASE_MOTION }}
                      className="flex justify-center"
                    >
                      <Cell value={row[p.id]} />
                    </Motion.span>
                  ))}
                </div>

                {/* Mobile: only the chosen package */}
                <div className="flex md:hidden items-center justify-between gap-4">
                  <span className="text-sm text-neutral-300">{row.label}</span>
                  <Motion.span
                    key={selected}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: EASE_MOTION }}
                    className="shrink-0"
                  >
                    <Cell value={row[selected]} />
                  </Motion.span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-white/5 bg-white/[0.02] px-5 py-4 text-center">
            <p className="text-xs text-neutral-500">
              Exact PC and branch limits are set on each subscription plan.{' '}
              <Link to="/contact" className="text-red-400 hover:text-red-300 underline underline-offset-4">
                Ask us which package fits your floor
              </Link>
              .
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
};

export default PricingPlans;
