import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import ProductRows from '../components/site/ProductRows';
import CommandCenter from '../components/CommandCenter';
import ProductStack from '../components/site/ProductStack';
import { industries } from '../lib/company';

const build = ['AI products', 'custom software', 'automation', 'integrations', 'data and dashboards', 'digital products'];

const Dot = () => <span className="text-signal">.</span>;

const Home = () => (
  <div className="bg-sheet font-display text-carbon antialiased">
    <Seo
      title="ManagerXP | Software for businesses that never stop"
      description="ManagerXP designs and builds AI-powered products and custom systems for operations that run in real time. Makers of CafeXP, RaceXP and FlowXP."
      path="/"
    />

    {/* Hero: the poster, at its natural height. Stretching it to fill the
        screen left a gap between headline and intro on tall phones and,
        once the headline stopped growing with screen width, on desktops. */}
    <section aria-labelledby="hero-title" className="wrap pb-12 pt-10 sm:pt-16 lg:pb-16 lg:pt-20">
      <div className="lg:grid lg:grid-cols-12 lg:items-center lg:gap-10">
        <h1 id="hero-title" className="poster-h animate-enter-up max-w-[14ch] text-[clamp(2.75rem,5.8vw,5.75rem)] lg:col-span-7">
          Software for businesses that never stop<Dot />
        </h1>
        {/* The 3D product stack fills the right half on wide screens; phones
            go straight from the headline to the intro. */}
        <div className="hidden overflow-hidden lg:col-span-5 lg:block">
          <ProductStack />
        </div>
      </div>
      <div className="mt-12 grid gap-8 border-t border-carbon pt-6 sm:mt-16 md:grid-cols-12">
        <p className="max-w-[44ch] text-lg leading-snug md:col-span-6">
          ManagerXP designs and builds AI-powered products and custom systems for operations that run in real time.
        </p>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 text-lg md:col-span-6 md:justify-end">
          <Link to="/contact" className="link-arrow">
            Build with ManagerXP <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </Link>
          <Link to="/solutions" className="inline-flex items-center gap-2 font-semibold hover:text-signal">
            Explore solutions <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </section>

    {/* Products */}
    <section aria-labelledby="built-title" className="wrap py-14 sm:py-20">
      <h2 id="built-title" className="text-lg font-semibold">What we have built</h2>
      <div className="mt-6">
        <ProductRows />
      </div>
    </section>

    {/* Proof: the real product, live */}
    <section aria-labelledby="proof-title" className="bg-carbon text-sheet">
      <div className="wrap py-16 sm:py-20">
        <div className="grid gap-8 md:grid-cols-12 md:items-end">
          <h2 id="proof-title" className="poster-h text-[clamp(2.25rem,4.4vw,4rem)] md:col-span-7">
            The products are the proof<Dot />
          </h2>
          <p className="max-w-[42ch] text-lg leading-snug text-sheet/70 md:col-span-5">
            CafeXP runs gaming cafés live: every PC session timed, billed and watched from one console. This is it, running on sample data.
          </p>
        </div>
        <div className="mt-12 sm:mt-16">
          <CommandCenter />
        </div>
      </div>
    </section>

    {/* What we build for you */}
    <section aria-labelledby="build-title" className="wrap py-16 sm:py-20">
      <h2 id="build-title" className="text-lg font-semibold">What we build for you</h2>
      <p className="mt-6 max-w-[28ch] text-[clamp(2rem,3.6vw,3.5rem)] font-[750] leading-[1.02] tracking-[-0.045em]">
        {build.map((b, i) => (
          <React.Fragment key={b}>
            {i === 0 ? b.charAt(0).toUpperCase() + b.slice(1) : b}
            {i < build.length - 1 ? ', ' : ''}
          </React.Fragment>
        ))}
        <Dot />
      </p>
      <div className="mt-12 grid gap-6 border-t border-carbon pt-6 md:grid-cols-12">
        <p className="max-w-[56ch] text-lg leading-snug text-graphite md:col-span-8">
          For {industries.map((n) => n.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1')}: anywhere off-the-shelf software falls short.
        </p>
        <div className="md:col-span-4 md:text-right">
          <Link to="/solutions" className="link-arrow text-lg">
            How we work <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </section>

    {/* Close */}
    <section aria-labelledby="close-title" className="bg-carbon text-sheet">
      <div className="wrap py-16 sm:py-20">
        <p className="text-lg text-sheet/70">Have a problem software should solve?</p>
        <h2 id="close-title" className="mt-4">
          <Link to="/contact" className="poster-h group inline-flex flex-wrap items-center gap-x-6 text-[clamp(2.75rem,5.8vw,5.75rem)] hover:text-signal">
            <span>Let's build it<Dot /></span>
            <ArrowRight aria-hidden="true" className="h-[0.55em] w-[0.55em] transition-transform group-hover:translate-x-3" strokeWidth={2.25} />
          </Link>
        </h2>
        <p className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-lg text-sheet/70">
          <a href="mailto:managerxp2026@gmail.com" className="link-quiet hover:text-sheet">managerxp2026@gmail.com</a>
          <a href="tel:+919679549136" className="link-quiet hover:text-sheet">+91 96795 49136</a>
        </p>
      </div>
    </section>
  </div>
);

export default Home;
