import React, { useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, Flag, ArrowRight, Play } from 'lucide-react';
import PageBackground from '../components/PageBackground';
import SectionHeading from '../components/SectionHeading';
import Reveal from '../components/Reveal';
import CommandCenter from '../components/CommandCenter';
import StationOps from '../components/StationOps';
import BillingDesk from '../components/BillingDesk';
import PeopleOps from '../components/PeopleOps';
import FnbInventory from '../components/FnbInventory';
import CafeXPAI from '../components/CafeXPAI';
import LazyMount from '../components/LazyMount';
import PricingPlans from '../components/PricingPlans';
import ProductEcosystem from '../components/ProductEcosystem';
import { EASE_MOTION, SPRING, staggerItem } from '../lib/motion';

// The two Anime.js consumers are split out so the engine stays off the initial
// payload: RaceXP loads on tab open, analytics loads when scrolled toward.
const RaceXPPreview = lazy(() => import('../components/RaceXPPreview'));
const AnalyticsPeak = lazy(() => import('../components/AnalyticsPeak'));

const TABS = [
  { id: 'cafexp', label: 'CafeXP' },
  { id: 'racexp', label: 'RaceXP', note: 'Phase 2' }
];

const panelVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_MOTION, staggerChildren: 0.07 } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.25, ease: EASE_MOTION } }
};

/**
 * Section shell: a short lead-in, then the product doing the talking. Each block
 * gets its own interface rather than another row of feature cards.
 */
const Block = ({ eyebrow, title, highlight, lead, children, className = '' }) => (
  <section className={`scroll-mt-24 ${className}`}>
    <Reveal>
      <div className="mb-6 max-w-2xl">
        <p className="mb-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-red-500">
          <span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-red-500 to-transparent" />
          {eyebrow}
        </p>
        <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white text-balance">
          {title}{' '}
          {highlight && (
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-red-700">{highlight}</span>
          )}
        </h3>
        {lead && <p className="mt-3 text-sm leading-relaxed text-neutral-400 text-pretty">{lead}</p>}
      </div>
    </Reveal>
    <Reveal>{children}</Reveal>
  </section>
);

const ProductsPage = () => {
  const [active, setActive] = useState('cafexp');

  return (
    <div className="relative min-h-screen bg-black overflow-hidden antialiased font-sans text-white">
      <PageBackground streakTop="top-1/3" streakBottom="top-2/3" />

      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-6 section-y">

        <SectionHeading
          as="h1"
          eyebrow="ManagerXP Platform"
          title="The operating system for a"
          highlight="modern gaming café."
          description="CafeXP runs the floor, the tab, the team and the numbers. RaceXP extends the platform into sim racing next."
          className="mb-10 sm:mb-12"
        />

        {/* Product switcher */}
        <div
          role="tablist"
          aria-label="ManagerXP products"
          className="mx-auto mb-14 flex w-fit gap-1.5 rounded-full border border-white/10 bg-white/[0.03] p-1.5 backdrop-blur-sm"
        >
          {TABS.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                onClick={() => setActive(tab.id)}
                className={`relative flex items-center gap-2 rounded-full px-5 sm:px-6 py-2.5 text-sm font-semibold transition-colors duration-300 ${
                  isActive ? 'text-white' : 'text-neutral-400 hover:text-white'
                }`}
              >
                {isActive && (
                  <Motion.span
                    layoutId="product-tab-pill"
                    transition={SPRING}
                    className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-red-700 to-red-900 shadow-[0_0_24px_-8px_rgba(220,38,38,0.9)]"
                  />
                )}
                {tab.id === 'cafexp' ? <Gamepad2 className="w-4 h-4" aria-hidden="true" /> : <Flag className="w-4 h-4" aria-hidden="true" />}
                {tab.label}
                {tab.note && (
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${isActive ? 'bg-black/30 text-white/80' : 'bg-white/5 text-neutral-500'}`}>
                    {tab.note}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* popLayout, not wait: the incoming product panel mounts immediately
            rather than queueing behind the outgoing panel's exit animation, so
            switching never lands on an empty panel if that animation is
            throttled (background or prerendered tab). */}
        <AnimatePresence mode="popLayout">
          {/* ============================ CafeXP ============================ */}
          {active === 'cafexp' && (
            <Motion.div
              key="cafexp"
              id="panel-cafexp"
              role="tabpanel"
              aria-labelledby="tab-cafexp"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="space-y-20 sm:space-y-24"
            >
              {/* CafeXP identity + command center */}
              <div>
                <div className="mb-10 text-center">
                  <Motion.h2 variants={staggerItem} className="text-3xl sm:text-5xl font-semibold tracking-tight text-white text-balance">
                    CafeXP
                  </Motion.h2>
                  <Motion.p variants={staggerItem} className="mx-auto mt-4 max-w-xl text-sm sm:text-base leading-relaxed text-neutral-400 text-pretty">
                    Every machine, session, tab and shift on one screen.
                  </Motion.p>
                  <Motion.div variants={staggerItem} className="mt-7 flex flex-col sm:flex-row justify-center gap-3">
                    <Link
                      to="/demo"
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-gradient-to-br from-red-700 to-red-900 px-7 py-3 text-sm font-semibold text-white shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] transition-shadow hover:shadow-[0_0_30px_-5px_rgba(220,38,38,0.65)]"
                    >
                      Book a demo
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <Link
                      to="/contact"
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-7 py-3 text-sm font-medium text-neutral-300 backdrop-blur-md transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      Talk to us
                    </Link>
                  </Motion.div>
                </div>

                <CommandCenter />
              </div>

              <Block
                eyebrow="Stations"
                title="The whole floor,"
                highlight="at a glance."
                lead="Machines, zones and running sessions in one view. Select a station to take control of it."
              >
                <StationOps />
              </Block>

              <Block
                eyebrow="Billing"
                title="Play time and the tab,"
                highlight="on one bill."
                lead="The session clock and anything ordered against it settle into a single total. Add an item and watch it land."
              >
                <BillingDesk />
              </Block>

              <Block
                eyebrow="People"
                title="Your team and"
                highlight="your regulars."
                lead="Who is on shift and what they are handling, alongside the customers keeping the floor busy."
              >
                <PeopleOps />
              </Block>

              <Block
                eyebrow="F&B and stock"
                title="What sells, and"
                highlight="what is running out."
                lead="Kitchen sales and the stock behind them move together, so a low shelf is visible before it empties."
              >
                <FnbInventory />
              </Block>

              <Block
                eyebrow="Analytics"
                title="When your café is"
                highlight="actually busy."
                lead="Drag across the trading day to read occupancy, revenue and customer counts hour by hour."
              >
                <LazyMount minHeight="26rem">
                  <Suspense
                    fallback={
                      <div className="flex min-h-[26rem] items-center justify-center">
                        <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-800 border-t-red-500" />
                      </div>
                    }
                  >
                    <AnalyticsPeak />
                  </Suspense>
                </LazyMount>
              </Block>

              <Block
                eyebrow="CafeXP AI"
                title="From the numbers to"
                highlight="the answer."
                lead="Ask a question about the operation and get the analysis behind it, not just another chart."
              >
                <CafeXPAI />
              </Block>

              {/* Packages */}
              <section className="scroll-mt-24">
                <Reveal>
                  <div className="mb-8 text-center">
                    <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                      Choose your level of CafeXP
                    </h3>
                    <p className="mx-auto mt-3 max-w-xl text-sm text-neutral-400 text-pretty">
                      Built around how many machines and branches you run, and how deep you want the monitoring to go.
                    </p>
                  </div>
                </Reveal>
                <PricingPlans />
              </section>

              {/* Demo */}
              <Block
                eyebrow="See it running"
                title="A walkthrough of"
                highlight="a live shift."
                lead="A recorded product tour is on the way. In the meantime, a live walkthrough with us covers the same ground against your own floor plan."
              >
                <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl">
                  <div className="aspect-video w-full">
                    <div aria-hidden="true" className="absolute inset-0 [background:radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(220,38,38,0.18),transparent_70%)]" />
                    <div aria-hidden="true" className="absolute inset-0 opacity-[0.05] bg-[length:36px_36px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.5)_1px,transparent_1px)]" />

                    <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                      <Motion.span
                        whileHover={{ scale: 1.06 }}
                        transition={SPRING}
                        className="flex h-16 w-16 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 shadow-[0_0_36px_-8px_rgba(220,38,38,0.9)]"
                      >
                        <Play className="ml-0.5 h-6 w-6 text-red-400" aria-hidden="true" />
                      </Motion.span>
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
                        Product tour · coming soon
                      </p>
                      <Link
                        to="/demo"
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-5 py-2.5 text-sm text-neutral-200 backdrop-blur-md transition-colors hover:bg-white/[0.09] hover:text-white"
                      >
                        Book a live walkthrough
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>
              </Block>
            </Motion.div>
          )}

          {/* ============================ RaceXP ============================ */}
          {active === 'racexp' && (
            <Motion.div
              key="racexp"
              id="panel-racexp"
              role="tabpanel"
              aria-labelledby="tab-racexp"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Suspense
                fallback={
                  <div className="flex min-h-[50vh] items-center justify-center">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-red-500" />
                  </div>
                }
              >
                <RaceXPPreview />
              </Suspense>
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Ecosystem */}
        <div className="mt-20 sm:mt-24">
          <SectionHeading eyebrow="Product Ecosystem" title="How it all" highlight="fits together." className="mb-10" />
          <Reveal>
            <ProductEcosystem />
          </Reveal>
        </div>

        {/* Closing CTA */}
        <Reveal className="block mt-16 sm:mt-20">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 sm:p-10 text-center backdrop-blur-sm">
            <h2 className="mb-3 text-xl sm:text-2xl font-semibold text-white text-balance">
              Run your café on CafeXP
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-sm text-neutral-400 text-pretty">
              We'll walk your floor plan through the platform and show you exactly how it fits.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link
                to="/demo"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-gradient-to-br from-red-700 to-red-900 px-8 py-3.5 text-sm font-semibold text-white shadow-[0_0_20px_-5px_rgba(220,38,38,0.35)] transition-shadow hover:shadow-[0_0_30px_-5px_rgba(220,38,38,0.6)]"
              >
                Book a Demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-8 py-3.5 text-sm font-medium text-neutral-300 backdrop-blur-md transition-colors hover:bg-white/[0.08] hover:text-white hover:border-white/20"
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
};

export default ProductsPage;
