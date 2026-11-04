import React from 'react';
import { Link } from 'react-router-dom';
import { motion as Motion } from 'framer-motion';
import {
  ArrowRight, Code2, Workflow, Plug, LineChart, Rocket, Sparkles,
  Cpu, Puzzle, Layers, Gauge, Zap, Users, Search, PenTool, Hammer, Send, RefreshCw,
} from 'lucide-react';
import Seo from '../components/site/Seo';
import Reveal from '../components/Reveal';
import CommandCenter from '../components/CommandCenter';
import ProductCards from '../components/site/ProductCards';
import BlurText from '../components/ui/BlurText';
import SpotlightCard from '../components/ui/SpotlightCard';
import BorderBeam from '../components/ui/BorderBeam';
import { capabilities, solutionCategories, industries, reasons, engagement } from '../lib/company';
import { staggerItem } from '../lib/motion';
import flowxpAi from '../assets/products/flowxp-ai.png';

const capIcons = [Sparkles, Code2, Workflow, Plug, LineChart, Rocket];
const reasonIcons = [Cpu, Puzzle, Layers, Gauge, Zap, Users];
const stepIcons = [Search, PenTool, Hammer, Send, RefreshCw];

const H2 = ({ id, children, className = '' }) => (
  <h2 id={id} className={`max-w-3xl text-[clamp(2rem,3.6vw,3rem)] font-semibold leading-[1.08] tracking-tight text-paper text-balance ${className}`}>
    {children}
  </h2>
);

const Lead = ({ children, className = '' }) => (
  <p className={`mt-5 max-w-[60ch] text-[17px] leading-relaxed text-mute text-pretty ${className}`}>{children}</p>
);

const tile = 'h-full rounded-2xl p-7';

// Bento placement, one entry per capability (exactly six cells).
const capLayout = [
  'md:col-span-2 lg:row-span-2',
  '',
  '',
  'md:col-span-2',
  'lg:col-span-2',
  'lg:col-span-2',
];

const Home = () => (
  <div className="bg-ink font-sans text-paper antialiased">
    <Seo
      title="ManagerXP | AI-Powered Software Products & Custom Technology"
      description="ManagerXP builds intelligent software products and custom technology solutions that simplify complex operations, automate workflows and help businesses scale. Makers of CafeXP, RaceXP and FlowXP."
      path="/"
    />

    {/* Hero: the message on the left, a live product on the right */}
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(50%_40%_at_50%_70%,rgb(229_50_45/0.10),transparent_70%)]"
      />
      <div className="wrap relative pb-16 pt-14 sm:pt-20">
        <Motion.div
          className="relative z-10 grid gap-8 lg:grid-cols-12 lg:items-end"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } }}
        >
          <BlurText
            as="h1"
            id="hero-title"
            text="Building intelligent technology for complex business challenges."
            trigger="load"
            animateBy="words"
            delay={70}
            blur={8}
            distance={18}
            className="text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-paper lg:col-span-8"
          />
          <Motion.div variants={staggerItem} className="lg:col-span-4 lg:pb-2">
            <p className="max-w-[44ch] text-[17px] leading-relaxed text-mute text-pretty">
              Intelligent software products, custom digital solutions and AI-powered systems that simplify complex operations and accelerate growth.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Link to="/solutions" className="btn-primary">
                Explore Our Solutions
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link to="/contact" className="btn-secondary">Build With ManagerXP</Link>
            </div>
          </Motion.div>
        </Motion.div>

        <div className="mt-16 sm:mt-20">
          <CommandCenter />
        </div>
      </div>
    </section>

    {/* What we do: a bento with one cell per capability */}
    <section aria-labelledby="what-title" className="band">
      <div className="wrap">
        <Reveal>
          <H2 id="what-title">Technology built around your business.</H2>
          <Lead>Six disciplines, one engineering team. We build the products we sell, and systems for operations that do not fit a template.</Lead>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {capabilities.map(([name, desc], i) => {
            const Icon = capIcons[i];
            return (
              <Reveal key={name} delay={i * 60} className={capLayout[i]}>
                <SpotlightCard className={`${tile} ${i === 0 ? 'flex flex-col' : ''}`} intensity={0.1} spotlightSize={320} borderGlow={0.5}>
                {i === 4 && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background:radial-gradient(90%_120%_at_0%_100%,rgb(229_50_45/0.16),transparent_60%)]" />
                )}
                {i === 3 && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(255_255_255/0.08)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent)]" />
                )}
                <div className="relative">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                    <Icon aria-hidden="true" className="h-5 w-5 text-paper" strokeWidth={1.75} />
                  </span>
                  <h3 className={`mt-6 font-semibold tracking-tight text-paper ${i === 0 ? 'text-2xl sm:text-[28px]' : 'text-lg'}`}>{name}</h3>
                  <p className={`mt-2.5 leading-relaxed text-mute ${i === 0 ? 'max-w-[44ch] text-[16px]' : 'text-[15px]'}`}>{desc}</p>
                  {i === 3 && (
                    <ul className="mt-6 flex flex-wrap gap-2" aria-label="Examples of systems we connect">
                      {['Payments', 'Accounting', 'Point of sale', 'Delivery platforms', 'Hardware', 'Internal tools'].map((t) => (
                        <li key={t} className="rounded-full border border-white/10 bg-ink px-3 py-1 text-[13px] text-paper/80">{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {i === 0 && (
                  <div className="relative -mb-7 -mr-7 mt-10 flex-1 lg:min-h-[14rem]">
                    <img
                      src={flowxpAi}
                      alt="Flow AI inside FlowXP answering 'What should I order tomorrow, and from whom?' with suggested orders drawn from the business's own stock records."
                      width="2880"
                      height="1800"
                      loading="lazy"
                      decoding="async"
                      className="w-full rounded-tl-xl border-l border-t border-white/10 object-cover object-[12%_0%] lg:absolute lg:inset-0 lg:h-full"
                    />
                  </div>
                )}
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>

    {/* Product ecosystem */}
    <section aria-labelledby="products-title" className="band border-t border-white/[0.06]">
      <div className="wrap">
        <Reveal>
          <H2 id="products-title">Three products. One engineering team.</H2>
          <Lead>Each began with a hard operational problem: billing against a live clock, GST on every bill, telemetry at racing speed.</Lead>
        </Reveal>
        <Reveal className="mt-14 block">
          <ProductCards />
        </Reveal>
      </div>
    </section>

    {/* Custom solutions */}
    <section id="custom" aria-labelledby="custom-title" className="band scroll-mt-16 border-t border-white/[0.06]">
      <div className="wrap">
        <Reveal className="mx-auto block max-w-3xl text-center">
          <H2 id="custom-title" className="mx-auto">Your challenge. Our engineering.</H2>
          <Lead className="mx-auto">From intelligent automation to complex business systems, we design and engineer technology tailored to your operational needs.</Lead>
          <ul className="mt-10 flex flex-wrap justify-center gap-2.5">
            {solutionCategories.map(([name]) => (
              <li key={name} className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] font-medium text-paper">{name}</li>
            ))}
          </ul>
          <Link to="/contact" className="btn-primary mt-10">
            Discuss Your Project
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Reveal>

        <Reveal className="mt-20 block">
          <ol className="relative grid gap-8 md:grid-cols-5 md:gap-6">
            <span aria-hidden="true" className="absolute left-5 top-5 hidden h-px w-[calc(100%-2.5rem)] bg-gradient-to-r from-white/5 via-white/20 to-white/5 md:block" />
            {engagement.map(([step, desc], i) => {
              const Icon = stepIcons[i];
              return (
                <li key={step} className="relative flex gap-4 md:block">
                  <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-ink-2">
                    <Icon aria-hidden="true" className="h-4 w-4 text-paper" strokeWidth={1.75} />
                  </span>
                  <div className="md:mt-5">
                    <h3 className="text-[16px] font-semibold text-paper">{step}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>

    {/* Industries: one marquee, the only one on the page */}
    <section aria-labelledby="industries-title" className="band border-t border-white/[0.06]">
      <div className="wrap">
        <Reveal>
          <H2 id="industries-title">Environments we build for.</H2>
          <Lead>Target sectors where operations run in real time, across locations or under regulation, and off-the-shelf software falls short.</Lead>
        </Reveal>
      </div>
      <div className="marquee relative mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <ul className="sr-only">
          {industries.map((name) => <li key={name}>{name}</li>)}
        </ul>
        <div aria-hidden="true" className="marquee-track flex w-max">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {industries.map((name) => (
                <span key={name} className="flex items-center whitespace-nowrap text-[clamp(1.75rem,3.4vw,3rem)] font-semibold tracking-tight text-paper/90">
                  {name}
                  <span className="mx-10 inline-block h-2 w-2 rotate-45 bg-white/20" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Why ManagerXP */}
    <section aria-labelledby="why-title" className="band border-t border-white/[0.06]">
      <div className="wrap grid gap-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <H2 id="why-title">The products are the proof.</H2>
            <Lead>We do not pitch capabilities we have not shipped. The engineering behind CafeXP and FlowXP is the engineering we bring to your project.</Lead>
          </div>
        </div>
        <dl className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:col-span-7">
          {reasons.map(([name, desc], i) => {
            const Icon = reasonIcons[i];
            return (
              <Reveal key={name} delay={(i % 2) * 80}>
                <dt>
                  <Icon aria-hidden="true" className="h-6 w-6 text-signal" strokeWidth={1.75} />
                  <span className="mt-4 block text-[17px] font-semibold text-paper">{name}</span>
                </dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-mute">{desc}</dd>
              </Reveal>
            );
          })}
        </dl>
      </div>
    </section>

    {/* Close */}
    <section aria-labelledby="start-title" className="pb-24 sm:pb-32">
      <div className="wrap">
        <Reveal className="relative block overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-2 px-6 py-20 text-center sm:px-12 sm:py-24">
          <BorderBeam size={140} duration={10} borderWidth={1.5} colorFrom="#e5322d" colorTo="rgb(255 255 255 / 0.55)" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_80%_at_50%_120%,rgb(229_50_45/0.28),transparent_70%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div className="relative mx-auto max-w-3xl">
            <h2 id="start-title" className="text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-paper text-balance">
              Have a complex challenge? Let's engineer the solution.
            </h2>
            <p className="mx-auto mt-5 max-w-[56ch] text-[17px] leading-relaxed text-mute">
              Whether you need a custom business application, intelligent automation or a scalable digital platform, we can turn the idea into working technology.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
              <Link to="/contact" className="btn-primary">
                Start a Conversation
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <a href="mailto:managerxp2026@gmail.com" className="link-quiet text-[15px]">managerxp2026@gmail.com</a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  </div>
);

export default Home;
