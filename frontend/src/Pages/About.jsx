import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
import ProductMark from '../components/site/ProductMark';
import ProductLink from '../components/site/ProductLink';
import startupIndiaBadge from '../assets/startupIndiaBadge.png';
import { PRODUCTS } from '../lib/products';

const founders = [
  {
    name: 'Abdul Hayyu',
    role: 'Founder',
    initials: 'AH',
    origin: 'Hyderabad',
    bio: [
      'I’m a Computer Science Engineer and developer driven by a passion for building technology that solves real-world problems. I founded ManagerXP with the vision of creating practical, scalable, and industry-focused software that makes business operations simpler and more efficient.',
      'I’m deeply involved in the product, technology, and overall direction of ManagerXP. From understanding customer challenges to designing solutions, developing products, and continuously improving them, I remain closely connected to every stage of the journey. I believe in building with consistency, learning continuously, and staying committed until an idea becomes a reliable product that people can genuinely depend on.',
      'My focus is not just on building software, but on creating technology that delivers real value, improves everyday operations, and can grow alongside the businesses that use it.',
    ],
  },
  {
    name: 'Mubashir Lone',
    role: 'Co-Founder',
    initials: 'ML',
    origin: 'Hyderabad',
    bio: [
      'I’m a Computer Science Engineer and co-founder of ManagerXP, passionate about technology, product development, and solving complex problems through software. I work closely with the team to turn ideas and business requirements into reliable, scalable, and practical technology solutions.',
      'I’m committed to the continuous development of ManagerXP and contribute across product development, technology, and execution. I believe great products are built through attention to detail, continuous improvement, and a strong understanding of the people and businesses they are designed for.',
      'As a co-founder, my focus is on supporting the company’s vision, strengthening its technology foundation, and helping transform ideas into products that businesses can use and rely on every day.',
    ],
  },
];

const principles = [
  ['Show working software', 'We prove capability with products people run every day, not with claims.'],
  ['Company first, products second', 'CafeXP, RaceXP and FlowXP are what our engineering has built so far, not the limit of it.'],
  ['Honest status', 'What is in development is labelled as such. What is a target is called a target.'],
  ['One clear next step', 'Every conversation ends with a plan you can act on.'],
];

const About = () => (
  <div className="bg-ink font-sans text-paper antialiased">
    <Seo
      title="About ManagerXP | AI-Powered Business Technology Company"
      description="ManagerXP Private Limited is a Hyderabad technology company building intelligent software products and custom solutions. Meet the founders and see what drives the work."
      path="/about"
    />

    <div className="wrap pb-20 pt-12 sm:pt-16">
      <SectionHeading
        as="h1"
        title="An engineering company that ships its own products."
        description="ManagerXP builds intelligent software products and custom technology solutions that help businesses simplify operations, automate complex workflows, and scale with confidence."
      />

      {/* Who we are */}
      <section aria-labelledby="who-title" className="mt-20 grid gap-10 border-t border-white/[0.08] pt-12 lg:grid-cols-12">
        <h2 id="who-title" className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] text-paper lg:col-span-4">
          Who we are
        </h2>
        <div className="space-y-5 text-[17px] leading-relaxed text-mute lg:col-span-8">
          <p className="max-w-[64ch]">
            Founded in <span className="text-paper">2026</span> in Hyderabad, <span className="text-paper">ManagerXP Private Limited</span> is an AI-powered business technology company. We design and build software for operations where timing, money and people all move at once: live sessions billed against the clock, stock that changes with every sale, teams spread across branches.
          </p>
          <p className="max-w-[64ch]">
            We started with gaming cafés, an environment that punishes slow or unreliable software. That work became CafeXP, then RaceXP for sim racing and FlowXP for billing and business management. The same engineering now goes into custom systems for businesses whose operations do not fit a template.
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-3 pt-2 text-[14px]">
            {PRODUCTS.map((p) => (
              <li key={p.id}>
                <ProductLink product={p} className="inline-flex items-center gap-2 text-paper hover:text-white">
                  <ProductMark product={p} size="sm" />
                  {p.name}
                  <span className="text-mute">· {p.statusLabel}</span>
                </ProductLink>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Vision and mission */}
      <section aria-label="Vision and mission" className="mt-20 grid gap-4 md:grid-cols-2">
        <div className="surface p-8 sm:p-10">
          <h2 className="text-[15px] font-semibold text-paper">Vision</h2>
          <p className="mt-4 font-display text-[clamp(1.4rem,2.4vw,2rem)] font-semibold leading-snug text-paper">
            To be the technology partner businesses trust with their most complex operations.
          </p>
        </div>
        <div className="surface p-8 sm:p-10">
          <h2 className="text-[15px] font-semibold text-paper">Mission</h2>
          <p className="mt-4 font-display text-[clamp(1.4rem,2.4vw,2rem)] font-semibold leading-snug text-paper">
            To turn hard operational problems into intelligent software that simplifies work and helps businesses grow.
          </p>
        </div>
      </section>

      {/* Principles */}
      <section aria-labelledby="principles-title" className="mt-20 grid gap-10 lg:grid-cols-12">
        <h2 id="principles-title" className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] text-paper lg:col-span-4">
          How we work
        </h2>
        <dl className="grid gap-x-10 sm:grid-cols-2 lg:col-span-8">
          {principles.map(([name, desc]) => (
            <div key={name} className="border-t border-white/[0.08] py-6">
              <dt className="text-[16px] font-semibold text-paper">{name}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-mute">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Founders */}
      <section aria-labelledby="founders-title" className="mt-20 border-t border-white/[0.08] pt-12">
        <h2 id="founders-title" className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] text-paper">
          Founders
        </h2>
        <div className="mt-10 grid gap-12 md:grid-cols-2 md:gap-10">
          {founders.map((person) => (
            <article key={person.name}>
              <div className="flex items-center gap-4">
                <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] text-lg font-semibold text-paper">
                  {person.initials}
                </span>
                <div>
                  <h3 className="font-display text-[22px] font-semibold text-paper">{person.name}</h3>
                  <p className="text-[14px] text-mute">{person.role} · {person.origin}</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {person.bio.map((paragraph, i) => (
                  <p key={i} className="max-w-[62ch] text-[15px] leading-relaxed text-mute">{paragraph}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Recognition + close */}
      <section className="mt-20 grid gap-10 border-t border-white/[0.08] pt-12 lg:grid-cols-12 lg:items-center">
        <div className="flex items-center gap-4 lg:col-span-5">
          <span className="inline-flex shrink-0 items-center rounded-lg bg-white px-3 py-2">
            <img src={startupIndiaBadge} alt="Startup India, recognised by DPIIT, Government of India" className="h-10 w-auto" />
          </span>
          <p className="text-[14px] leading-relaxed text-mute">Recognised by DPIIT, Government of India, under Startup India.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:col-span-7 lg:justify-end">
          <Link to="/contact" className="btn-primary">
            Let's Build Together
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link to="/solutions" className="btn-secondary">Explore our solutions</Link>
        </div>
      </section>
    </div>
  </div>
);

export default About;
