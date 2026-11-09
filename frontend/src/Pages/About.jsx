import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
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

const Dot = () => <span className="text-signal">.</span>;

const About = () => (
  <div className="bg-sheet font-display text-carbon antialiased">
    <Seo
      title="About ManagerXP | AI-Powered Business Technology Company"
      description="ManagerXP Private Limited is a Hyderabad technology company building intelligent software products and custom solutions. Meet the founders and see what drives the work."
      path="/about"
    />

    <header className="wrap pb-16 pt-10 sm:pt-16">
      <SectionHeading
        as="h1"
        title="An engineering company that ships its own products"
        description="ManagerXP builds intelligent software products and custom technology that help businesses simplify operations, automate complex work and scale with confidence."
      />
    </header>

    {/* Who we are */}
    <section aria-labelledby="who-title" className="wrap grid gap-8 border-t border-carbon py-14 md:grid-cols-12">
      <h2 id="who-title" className="text-lg font-semibold md:col-span-4">Who we are</h2>
      <div className="space-y-5 text-[clamp(1.25rem,1.8vw,1.6rem)] leading-snug tracking-[-0.01em] md:col-span-8">
        <p className="max-w-[40ch]">
          Founded in 2026 in Hyderabad, ManagerXP Private Limited designs and builds software for operations where timing, money and people move at once.
        </p>
        <p className="max-w-[40ch] text-graphite">
          We started with gaming cafés, an environment that punishes slow or unreliable software. That work became CafeXP, then RaceXP for sim racing and FlowXP for billing and business management. The same engineering now goes into custom systems for other businesses.
        </p>
        <ul className="flex flex-wrap gap-x-8 gap-y-2 pt-2 text-lg font-semibold">
          {PRODUCTS.map((p) => (
            <li key={p.id}>
              <ProductLink product={p} className="link-quiet">{p.name}</ProductLink>
              {p.status === 'development' && <span className="font-normal text-graphite"> (in development)</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>

    {/* Vision and mission */}
    <section aria-label="Vision and mission" className="bg-carbon text-sheet">
      <div className="wrap grid gap-14 py-20 sm:py-28 md:grid-cols-2">
        <div>
          <h2 className="text-lg text-sheet/60">Vision</h2>
          <p className="poster-h mt-4 text-[clamp(2rem,3.6vw,3.25rem)] leading-[1]">
            The technology partner businesses trust with their hardest operations<Dot />
          </p>
        </div>
        <div>
          <h2 className="text-lg text-sheet/60">Mission</h2>
          <p className="poster-h mt-4 text-[clamp(2rem,3.6vw,3.25rem)] leading-[1]">
            Turn hard operational problems into software that simplifies work<Dot />
          </p>
        </div>
      </div>
    </section>

    {/* Principles */}
    <section aria-labelledby="principles-title" className="wrap grid gap-8 py-20 sm:py-28 md:grid-cols-12">
      <h2 id="principles-title" className="text-lg font-semibold md:col-span-4">How we work</h2>
      <dl className="border-b border-carbon md:col-span-8">
        {principles.map(([name, desc]) => (
          <div key={name} className="grid gap-1 border-t border-carbon py-6 sm:grid-cols-2 sm:gap-6">
            <dt className="text-[22px] font-bold tracking-[-0.02em]">{name}</dt>
            <dd className="text-lg leading-snug text-graphite">{desc}</dd>
          </div>
        ))}
      </dl>
    </section>

    {/* Founders */}
    <section aria-labelledby="founders-title" className="wrap border-t border-carbon py-14">
      <h2 id="founders-title" className="text-lg font-semibold">Founders</h2>
      <div className="mt-10 grid gap-14 md:grid-cols-2 md:gap-12">
        {founders.map((person) => (
          <article key={person.name}>
            <h3 className="poster-h text-[clamp(2.25rem,4vw,3.5rem)]">{person.name}</h3>
            <p className="mt-2 text-lg text-graphite">{person.role}, {person.origin}</p>
            <div className="mt-6 space-y-4">
              {person.bio.map((paragraph, i) => (
                <p key={i} className="max-w-[60ch] text-[17px] leading-relaxed text-carbon/80">{paragraph}</p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>

    {/* Recognition + close */}
    <section className="bg-carbon text-sheet">
      <div className="wrap grid gap-10 py-16 md:grid-cols-12 md:items-center">
        <div className="flex items-center gap-4 md:col-span-6">
          <span className="inline-flex shrink-0 items-center bg-white px-3 py-2">
            <img src={startupIndiaBadge} alt="Startup India, recognised by DPIIT, Government of India" className="h-10 w-auto" />
          </span>
          <p className="max-w-[30ch] text-lg leading-snug text-sheet/70">Recognised by DPIIT, Government of India, under Startup India.</p>
        </div>
        <div className="md:col-span-6 md:text-right">
          <Link to="/contact" className="btn-light">
            Let's build together <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  </div>
);

export default About;
