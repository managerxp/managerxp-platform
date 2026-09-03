import React from 'react';
import { motion as Motion } from 'framer-motion';
import { Boxes, Gamepad2, Flag } from 'lucide-react';
import { EASE_MOTION, VIEWPORT } from '../lib/motion';

/**
 * The ManagerXP product tree: platform -> CafeXP (shipping, three packages)
 * -> RaceXP (Phase 2, two future forms). Connectors are plain elements rather
 * than an absolutely-positioned SVG so the diagram reflows safely on mobile.
 */

const lineVariants = {
  hidden: { scaleY: 0, opacity: 0 },
  visible: { scaleY: 1, opacity: 1, transition: { duration: 0.6, ease: EASE_MOTION } }
};

const nodeVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_MOTION } }
};

const treeVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.11 } }
};

const Connector = ({ label }) => (
  <div className="flex flex-col items-center py-2" aria-hidden="true">
    <Motion.span
      variants={lineVariants}
      className="h-8 w-px origin-top bg-gradient-to-b from-red-500/70 to-red-500/10"
    />
    {label && (
      <span className="mt-1 text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600">{label}</span>
    )}
  </div>
);

const ProductEcosystem = () => {
  return (
    <Motion.div
      variants={treeVariants}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
      className="mx-auto max-w-3xl"
    >
      {/* Platform */}
      <Motion.div
        variants={nodeVariants}
        className="mx-auto w-fit rounded-2xl border border-white/15 bg-white/[0.04] px-6 py-4 text-center backdrop-blur-sm"
      >
        <span className="flex items-center justify-center gap-2 text-sm font-semibold text-white">
          <Boxes className="w-4 h-4 text-red-500" aria-hidden="true" />
          ManagerXP
        </span>
        <span className="mt-1 block text-[10px] font-mono uppercase tracking-wider text-neutral-500">
          The platform
        </span>
      </Motion.div>

      <Connector />

      {/* CafeXP */}
      <Motion.div
        variants={nodeVariants}
        className="mx-auto w-fit rounded-2xl border border-red-500/40 bg-red-500/[0.07] px-6 py-4 text-center shadow-[0_0_40px_-18px_rgba(220,38,38,0.9)] backdrop-blur-sm"
      >
        <span className="flex items-center justify-center gap-2 text-base font-semibold text-white">
          <Gamepad2 className="w-4 h-4 text-red-500" aria-hidden="true" />
          CafeXP
        </span>
        <span className="mt-1 block text-[10px] font-mono uppercase tracking-wider text-red-400">
          Primary product · available
        </span>
      </Motion.div>

      <Connector />

      {/* Packages */}
      <div className="grid grid-cols-3 gap-3">
        {['Basic', 'Pro', 'Elite'].map((tier) => (
          <Motion.div
            key={tier}
            variants={nodeVariants}
            className={`rounded-xl border px-3 py-3 text-center backdrop-blur-sm ${
              tier === 'Pro'
                ? 'border-red-500/40 bg-red-500/[0.06]'
                : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            <span className="block text-sm font-semibold text-white">{tier}</span>
            <span className="mt-0.5 block text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              Package
            </span>
          </Motion.div>
        ))}
      </div>

      <Connector label="Phase 2" />

      {/* RaceXP */}
      <Motion.div
        variants={nodeVariants}
        className="mx-auto w-fit rounded-2xl border border-white/15 bg-white/[0.03] px-6 py-4 text-center backdrop-blur-sm"
      >
        <span className="flex items-center justify-center gap-2 text-base font-semibold text-white">
          <Flag className="w-4 h-4 text-red-500" aria-hidden="true" />
          RaceXP
        </span>
        <span className="mt-1 block text-[10px] font-mono uppercase tracking-wider text-neutral-500">
          Sim racing · in development
        </span>
      </Motion.div>

      <Connector />

      {/* RaceXP forms */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { title: 'CafeXP + RaceXP', sub: 'Add-on' },
          { title: 'RaceXP', sub: 'Standalone' }
        ].map((item) => (
          <Motion.div
            key={item.sub}
            variants={nodeVariants}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-center backdrop-blur-sm"
          >
            <span className="block text-sm font-semibold text-neutral-200">{item.title}</span>
            <span className="mt-0.5 block text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              {item.sub}
            </span>
          </Motion.div>
        ))}
      </div>
    </Motion.div>
  );
};

export default ProductEcosystem;
