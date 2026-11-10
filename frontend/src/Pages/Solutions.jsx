import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
import { capabilities, solutionCategories, industries, engagement } from '../lib/company';

const Dot = () => <span className="text-signal">.</span>;

const Solutions = () => (
  <div className="bg-sheet font-display text-carbon antialiased">
    <Seo
      title="Solutions & Custom Software Development | ManagerXP"
      description="AI-powered products, custom software engineering, intelligent automation, system integration and data intelligence, engineered around how your business operates."
      path="/solutions"
    />

    <header className="wrap pb-16 pt-10 sm:pt-16">
      <SectionHeading
        as="h1"
        title="Built around how you operate"
        description="We design, build and run software for operations that off-the-shelf tools fit badly. Start from one of our products or from a blank page."
      />
      <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-lg">
        <Link to="/contact" className="link-arrow">Discuss your project <ArrowRight aria-hidden="true" className="h-5 w-5" /></Link>
        <Link to="/products" className="inline-flex items-center gap-2 font-semibold hover:text-signal">See our products <ArrowRight aria-hidden="true" className="h-5 w-5" /></Link>
      </div>
    </header>

    {/* Capabilities as typographic rows */}
    <section aria-labelledby="capabilities-title" className="wrap py-16 sm:py-24">
      <h2 id="capabilities-title" className="text-lg font-semibold">What we do</h2>
      <dl className="mt-6 border-b border-carbon">
        {capabilities.map(([name, desc]) => (
          <div key={name} className="grid gap-2 border-t border-carbon py-7 md:grid-cols-12 md:gap-6">
            <dt className="text-[clamp(1.6rem,2.8vw,2.5rem)] font-[800] leading-[1.02] tracking-[-0.04em] md:col-span-6">{name}</dt>
            <dd className="max-w-[48ch] text-lg leading-snug text-graphite md:col-span-6">{desc}</dd>
          </div>
        ))}
      </dl>
    </section>

    {/* Custom development */}
    <section id="custom" aria-labelledby="custom-title" className="scroll-mt-20 bg-carbon text-sheet">
      <div className="wrap py-16 sm:py-20">
        <h2 id="custom-title" className="poster-h max-w-[14ch] text-[clamp(2.25rem,4.4vw,4rem)]">
          Your challenge. Our engineering<Dot />
        </h2>
        <p className="mt-6 max-w-[50ch] text-lg leading-snug text-sheet/70">
          From intelligent automation to complex business systems, built by the same team that ships CafeXP and FlowXP.
        </p>

        <ul className="mt-14 grid gap-x-10 border-t border-sheet/20 sm:grid-cols-2">
          {solutionCategories.map(([name, desc]) => (
            <li key={name} className="border-b border-sheet/20 py-6">
              <p className="text-[22px] font-bold tracking-[-0.02em]">{name}</p>
              <p className="mt-1 text-[16px] text-sheet/60">{desc}</p>
            </li>
          ))}
        </ul>

        <h3 className="mt-20 text-lg text-sheet/60">How an engagement runs</h3>
        <ol className="mt-6 grid gap-8 md:grid-cols-5 md:gap-6">
          {engagement.map(([step, desc], i) => (
            <li key={step} className="border-t-2 border-sheet pt-4 first:border-signal">
              <p className="text-[15px] tabular-nums text-sheet/50">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-2 text-[22px] font-bold tracking-[-0.02em]">{step}</p>
              <p className="mt-2 text-[15px] leading-snug text-sheet/65">{desc}</p>
            </li>
          ))}
        </ol>

        <Link to="/contact" className="btn-light mt-16">
          Discuss your project <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </section>

    {/* Industries */}
    <section aria-labelledby="industries-title" className="wrap py-16 sm:py-20">
      <h2 id="industries-title" className="text-lg font-semibold">Environments we build for</h2>
      <p className="mt-6 max-w-[24ch] text-[clamp(2rem,3.6vw,3.5rem)] font-[750] leading-[1.04] tracking-[-0.045em]">
        {industries.join(', ')}<Dot />
      </p>
      <p className="mt-6 max-w-[56ch] text-lg text-graphite">
        These are the sectors our engineering is aimed at, not a list of past clients.
      </p>
    </section>

    {/* Close */}
    <section className="bg-carbon text-sheet">
      <div className="wrap py-16 sm:py-20">
        <p className="text-lg text-sheet/70">Have a complex challenge?</p>
        <h2 className="mt-4">
          <Link to="/contact" className="poster-h group inline-flex flex-wrap items-center gap-x-6 text-[clamp(2.75rem,5.8vw,5.75rem)] hover:text-signal">
            <span>Let's engineer it<Dot /></span>
            <ArrowRight aria-hidden="true" className="h-[0.55em] w-[0.55em] transition-transform group-hover:translate-x-3" strokeWidth={2.25} />
          </Link>
        </h2>
      </div>
    </section>
  </div>
);

export default Solutions;
