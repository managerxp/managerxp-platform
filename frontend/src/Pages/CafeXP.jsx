import React, { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import ProductHeader from '../components/site/ProductHeader';
import StationGrid from '../components/site/StationGrid';
import CommandCenter from '../components/CommandCenter';
import StationOps from '../components/StationOps';
import BillingDesk from '../components/BillingDesk';
import PeopleOps from '../components/PeopleOps';
import FnbInventory from '../components/FnbInventory';
import CafeXPAI from '../components/CafeXPAI';
import LazyMount from '../components/LazyMount';
import PricingPlans from '../components/PricingPlans';
import FAQ from '../components/FAQ';
import Reveal from '../components/Reveal';
import { PRODUCTS } from '../lib/products';

// Anime.js stays off the initial payload: analytics loads when scrolled toward.
const AnalyticsPeak = lazy(() => import('../components/AnalyticsPeak'));

const product = PRODUCTS.find((p) => p.id === 'cafexp');

const Spinner = () => (
  <div className="flex min-h-[26rem] items-center justify-center">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/[0.08] border-t-paper" />
  </div>
);

/** A module of the product: a short statement on the left, the interface doing the talking. */
const Module = ({ title, lead, children, side = false }) => (
  <section className="border-t border-sheet/15 py-16 sm:py-24">
    <div className={side ? 'grid items-center gap-10 lg:grid-cols-12' : ''}>
      <div className={side ? 'lg:col-span-4' : 'mb-10 max-w-2xl'}>
        <h2 className="poster-h text-[clamp(2rem,3.6vw,3.25rem)] leading-[0.98] text-sheet">{title}</h2>
        <p className="mt-4 max-w-[52ch] text-lg leading-snug text-sheet/65">{lead}</p>
      </div>
      <Reveal className={side ? 'lg:col-span-8' : ''}>{children}</Reveal>
    </div>
  </section>
);

const CafeXP = () => (
  <div className="tone-dark bg-carbon font-display text-sheet antialiased">
    <Seo
      title="CafeXP | Gaming Café Management Software by ManagerXP"
      description="CafeXP runs gaming and internet cafés: PC sessions, billing against the live clock, F&B stock, staff, multi-branch control and AI analytics. Start a free trial."
      path="/products/cafexp"
    />

    <ProductHeader
      product={product}
      title="Every machine, session, tab and shift on one screen"
      lead={product.description}
      actions={
        <>
          <Link to="/signup" className="btn-light">
            Start free trial
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link to="/demo" className="inline-flex min-h-[3.25rem] items-center px-2 font-semibold underline underline-offset-4 hover:text-signal">Book a demo</Link>
        </>
      }
      visual={<StationGrid />}
    />

    {/* The product UI is dark, so it lives on one black band. */}
    <div className="border-t border-sheet/15">
    <div className="wrap">
      <div className="py-16 sm:py-24">
        <CommandCenter />
      </div>

      <Module title="The whole floor, at a glance." lead="Machines, zones and running sessions in one view. Select a station to take control of it.">
        <StationOps />
      </Module>

      <Module title="Play time and the tab, on one bill." lead="The session clock and anything ordered against it settle into a single total. Add an item and watch it land.">
        <BillingDesk />
      </Module>

      <Module title="Your team and your regulars." lead="Who is on shift and what they are handling, alongside the customers keeping the floor busy.">
        <PeopleOps />
      </Module>

      <Module title="What sells, and what is running out." lead="Kitchen sales and the stock behind them move together, so a low shelf is visible before it empties.">
        <FnbInventory />
      </Module>

      <Module side title="When your café is actually busy." lead="Drag across the trading day to read occupancy, revenue and customer counts hour by hour.">
        <LazyMount minHeight="26rem">
          <Suspense fallback={<Spinner />}>
            <AnalyticsPeak />
          </Suspense>
        </LazyMount>
      </Module>

      <Module title="From the numbers to the answer." lead="Ask a question about the operation and get the analysis behind it, not just another chart.">
        <CafeXPAI />
      </Module>

      <section className="border-t border-sheet/15 py-16 sm:py-24">
        <div className="mb-12 max-w-2xl">
          <h2 className="poster-h text-[clamp(2rem,3.6vw,3.25rem)] leading-[0.98] text-sheet">Choose your level of CafeXP</h2>
          <p className="mt-4 text-lg leading-snug text-sheet/65">
            Built around how many machines and branches you run, and how deep you want the monitoring to go.
          </p>
        </div>
        <PricingPlans />
      </section>
    </div>
    </div>

    <div className="wrap border-t border-sheet/15 py-16 sm:py-20">
      <FAQ dark />
    </div>

    <section className="border-t border-sheet/15">
      <div className="wrap grid gap-8 py-16 sm:py-20 lg:grid-cols-12 lg:items-end">
        <h2 className="poster-h text-[clamp(2.5rem,5vw,4.5rem)] lg:col-span-8">
          Run your café on CafeXP<span className="text-signal">.</span>
        </h2>
        <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
          <Link to="/signup" className="btn-light">
            Start free trial
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link to="/contact" className="inline-flex min-h-[3.25rem] items-center px-2 font-semibold underline underline-offset-4 hover:text-signal">Talk to us</Link>
        </div>
      </div>
    </section>
  </div>
);

export default CafeXP;
