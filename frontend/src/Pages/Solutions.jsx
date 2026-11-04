import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Code2, Workflow, Plug, LineChart, Rocket, Sparkles,
  BrainCircuit, AppWindow, GitBranch, Cable, Database, Building2,
  Search, PenTool, Hammer, Send, RefreshCw,
} from 'lucide-react';
import Seo from '../components/site/Seo';
import Reveal from '../components/Reveal';
import { capabilities, solutionCategories, industries, engagement } from '../lib/company';

const capIcons = [Sparkles, Code2, Workflow, Plug, LineChart, Rocket];
const catIcons = [BrainCircuit, AppWindow, GitBranch, Cable, Database, Building2];
const stepIcons = [Search, PenTool, Hammer, Send, RefreshCw];

const H2 = ({ id, children }) => (
  <h2 id={id} className="max-w-3xl text-[clamp(2rem,3.6vw,3rem)] font-semibold leading-[1.08] tracking-tight text-paper text-balance">
    {children}
  </h2>
);

const Solutions = () => (
  <div className="bg-ink font-sans text-paper antialiased">
    <Seo
      title="Solutions & Custom Software Development | ManagerXP"
      description="AI-powered products, custom software engineering, intelligent automation, system integration and data intelligence, engineered around how your business operates."
      path="/solutions"
    />

    {/* Header */}
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_60%_at_85%_0%,rgb(229_50_45/0.12),transparent_70%)]" />
      <div className="wrap relative pb-16 pt-14 sm:pt-20">
        <h1 className="max-w-4xl text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-paper text-balance">
          Solutions engineered around how you operate.
        </h1>
        <p className="mt-6 max-w-[56ch] text-lg leading-relaxed text-mute">
          We design, build and run software for operations that off-the-shelf tools fit badly. Start from one of our products or from a blank page.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link to="/contact" className="btn-primary">
            Discuss Your Project
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link to="/products" className="btn-secondary">See our products</Link>
        </div>
      </div>
    </section>

    {/* Capabilities: a 3-column card grid */}
    <section aria-labelledby="capabilities-title" className="band border-t border-white/[0.06]">
      <div className="wrap">
        <Reveal><H2 id="capabilities-title">What we do</H2></Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(([name, desc], i) => {
            const Icon = capIcons[i];
            return (
              <Reveal key={name} delay={(i % 3) * 60} className="surface block p-7 transition-colors hover:border-white/20">
                <Icon aria-hidden="true" className="h-6 w-6 text-signal" strokeWidth={1.75} />
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-paper">{name}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-mute">{desc}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>

    {/* Custom development */}
    <section id="custom" aria-labelledby="custom-title" className="band scroll-mt-16 border-t border-white/[0.06]">
      <div className="wrap">
        <div className="grid gap-12 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <H2 id="custom-title">Custom development: your challenge, our engineering.</H2>
              <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-mute">
                From intelligent automation to complex business systems, built by the same team that ships CafeXP and FlowXP.
              </p>
              <Link to="/contact" className="btn-primary mt-8">
                Discuss Your Project
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:col-span-7">
            {solutionCategories.map(([name, desc], i) => {
              const Icon = catIcons[i];
              return (
                <Reveal key={name} delay={(i % 2) * 70}>
                  <div>
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                      <Icon aria-hidden="true" className="h-5 w-5 text-paper" strokeWidth={1.75} />
                    </span>
                    <h3 className="mt-5 text-[17px] font-semibold text-paper">{name}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-mute">{desc}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>

        {/* How an engagement runs */}
        <Reveal className="surface mt-20 block p-8 sm:p-10">
          <h3 className="text-2xl font-semibold tracking-tight text-paper">How an engagement runs</h3>
          <ol className="relative mt-10 grid gap-8 md:grid-cols-5 md:gap-6">
            <span aria-hidden="true" className="absolute left-5 top-5 hidden h-px w-[calc(100%-2.5rem)] bg-gradient-to-r from-signal/60 via-white/20 to-white/5 md:block" />
            {engagement.map(([step, desc], i) => {
              const Icon = stepIcons[i];
              return (
                <li key={step} className="relative flex gap-4 md:block">
                  <span className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-ink-2 ${i === 0 ? 'border-signal/70' : 'border-white/15'}`}>
                    <Icon aria-hidden="true" className="h-4 w-4 text-paper" strokeWidth={1.75} />
                  </span>
                  <div className="md:mt-5">
                    <p className="text-[16px] font-semibold text-paper">{step}</p>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>

    {/* Industries */}
    <section aria-labelledby="industries-title" className="band border-t border-white/[0.06]">
      <div className="wrap">
        <Reveal>
          <H2 id="industries-title">Environments we build for</H2>
          <p className="mt-5 max-w-[60ch] text-[17px] leading-relaxed text-mute">
            Target sectors where operations run in real time, across locations or under regulation. These are where our engineering is aimed, not a list of past clients.
          </p>
        </Reveal>
        <ul className="mt-12 flex flex-wrap gap-3">
          {industries.map((name) => (
            <li key={name} className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-[16px] font-medium text-paper">
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>

    {/* Close */}
    <section className="pb-24 sm:pb-32">
      <div className="wrap">
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-2 px-6 py-16 sm:px-12">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_90%_at_100%_100%,rgb(229_50_45/0.25),transparent_70%)]" />
          <div className="relative grid gap-8 lg:grid-cols-12 lg:items-center">
            <h2 className="text-[clamp(1.9rem,3.6vw,2.9rem)] font-semibold leading-[1.08] tracking-tight text-paper text-balance lg:col-span-8">
              Have a complex challenge? Let's engineer the solution.
            </h2>
            <div className="lg:col-span-4 lg:text-right">
              <Link to="/contact" className="btn-primary">
                Start a Conversation
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
);

export default Solutions;
