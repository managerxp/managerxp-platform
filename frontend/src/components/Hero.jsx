import React from 'react';
import { Link } from 'react-router-dom';
import { motion as Motion } from 'framer-motion';
import { Zap, Terminal, ArrowRight, Gamepad2, DollarSign, Monitor, BarChart3 } from 'lucide-react';
import PageBackground from './PageBackground';
import CommandCenter from './CommandCenter';
import { EASE_MOTION, SPRING, staggerItem } from '../lib/motion';

const highlights = [
  { Icon: Gamepad2, label: 'Gaming Control' },
  { Icon: DollarSign, label: 'Auto Billing' },
  { Icon: Monitor, label: 'Live Monitor' },
  { Icon: BarChart3, label: 'Analytics' }
];

// Coordinated entrance: glow expands, then copy, chips and CTAs cascade in.
const heroStage = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } }
};

const HeroSection = () => {
  return (
    <Motion.section
      initial="hidden"
      animate="visible"
      variants={heroStage}
      className="relative bg-black overflow-hidden antialiased font-sans"
    >
      <PageBackground variant="hero" streakTop="top-1/4" streakBottom="top-2/3" />

      {/* Extra ambient bloom that expands on load */}
      <Motion.div
        aria-hidden="true"
        variants={{
          hidden: { opacity: 0, scale: 0.75 },
          visible: { opacity: 0.7, scale: 1, transition: { duration: 1.4, ease: EASE_MOTION } }
        }}
        className="pointer-events-none absolute inset-x-0 top-0 h-[70vh] z-[1]
                   [background:radial-gradient(ellipse_55%_60%_at_50%_35%,rgba(220,38,38,0.20),transparent_70%)]"
      />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-6 pt-28 pb-16 sm:pt-32 sm:pb-20 text-center">

        {/* Eyebrow */}
        <Motion.div variants={staggerItem} className="flex justify-center mb-5">
          <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-neutral-500 font-mono tracking-[0.15em] sm:tracking-[0.2em] uppercase">
            <span className="w-6 sm:w-10 h-[1px] shrink-0 bg-gradient-to-r from-transparent to-neutral-700" />
            <span className="text-red-500 font-semibold">Welcome to ManagerXP Private Limited</span>
            <span className="w-6 sm:w-10 h-[1px] shrink-0 bg-gradient-to-l from-transparent to-neutral-700" />
          </div>
        </Motion.div>

        <Motion.h1
          variants={staggerItem}
          className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-white leading-[1.1] mb-5 text-balance"
        >
          Control Every PC. Track Every Minute.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-red-800">Grow Your Cafe.</span>
        </Motion.h1>

        <Motion.p
          variants={staggerItem}
          className="text-base sm:text-lg text-neutral-400 max-w-2xl mx-auto font-light leading-relaxed mb-8 text-pretty"
        >
          ManagerXP delivers gaming session management, intelligent billing, and real-time monitoring for modern internet and gaming cafes powered by AI.
        </Motion.p>

        {/* Capability chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-9 max-w-2xl mx-auto">
          {highlights.map((highlight) => (
            <Motion.div
              key={highlight.label}
              variants={staggerItem}
              whileHover={{ y: -3 }}
              transition={SPRING}
              className="group flex items-center justify-center gap-2 px-3 py-2.5 rounded-full border border-white/5 bg-white/[0.02]
                         hover:bg-white/[0.05] hover:border-red-500/25 transition-colors duration-300 cursor-default"
            >
              <highlight.Icon className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="text-[10px] sm:text-[11px] text-neutral-300 font-medium uppercase tracking-wide">
                {highlight.label}
              </span>
            </Motion.div>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch sm:items-center mb-12 sm:mb-14">
          <Motion.div variants={staggerItem} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} transition={SPRING}>
            <Link
              to="/products"
              className="group relative flex items-center justify-center gap-2 px-8 py-3.5
                         text-sm font-semibold rounded-full text-white transition-shadow duration-300
                         shadow-[0_0_20px_-5px_rgba(220,38,38,0.35)]
                         hover:shadow-[0_0_30px_-5px_rgba(220,38,38,0.6)]
                         bg-gradient-to-br from-red-700 to-red-900
                         border border-white/10 backdrop-blur-md"
            >
              <Zap className="w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
              View Products
            </Link>
          </Motion.div>

          <Motion.div variants={staggerItem} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} transition={SPRING}>
            <Link
              to="/demo"
              className="group flex items-center justify-center gap-2 px-8 py-3.5
                         text-neutral-300 font-medium text-sm transition-colors duration-300
                         rounded-full
                         bg-white/[0.05] border border-white/10 backdrop-blur-md
                         hover:bg-white/[0.08] hover:text-white hover:border-white/20"
            >
              <Terminal className="w-4 h-4 text-red-500" />
              Get a Free Demo
              <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
            </Link>
          </Motion.div>
        </div>

        {/* 3D product visual */}
        <CommandCenter />

        {/* Trust strip */}
        <Motion.div
          variants={staggerItem}
          className="mt-14 flex flex-wrap justify-center items-center gap-x-6 gap-y-3 sm:gap-x-8 text-neutral-500 text-[11px] sm:text-xs font-mono uppercase tracking-widest"
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            System Active
          </div>
          <div className="hidden sm:block h-4 w-[1px] bg-neutral-800"></div>
          <div>24/7 Support</div>
          <div className="hidden sm:block h-4 w-[1px] bg-neutral-800"></div>
          <div>Secure &amp; Reliable</div>
        </Motion.div>
      </div>
    </Motion.section>
  );
};

export default HeroSection;
