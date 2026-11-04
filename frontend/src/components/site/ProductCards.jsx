import React from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { PRODUCTS } from '../../lib/products';
import ProductLink from './ProductLink';
import ProductMark from './ProductMark';
import SpotlightCard from '../ui/SpotlightCard';
import flowxpDashboard from '../../assets/products/flowxp-dashboard.png';

const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

export const StatusPill = ({ product }) => {
  const live = product.status !== 'development';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${
        live ? 'border-white/10 bg-white/[0.06] text-paper' : 'border-white/10 text-mute'
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-400' : 'border border-mute'}`} />
      {product.statusLabel}
    </span>
  );
};

export const ModuleChips = ({ product }) => (
  <ul className="flex flex-wrap gap-2" aria-label={`${product.name} modules`}>
    {product.stations.map((s) => (
      <li key={s} className="rounded-full border border-white/10 px-3 py-1 text-[13px] text-paper/80">
        {s}
      </li>
    ))}
  </ul>
);

// The CTA stretches over its card, so the whole card is one target.
const CardLink = ({ product }) => (
  <ProductLink
    product={product}
    className="mt-8 inline-flex items-center gap-2 text-[15px] font-semibold text-paper after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-signal"
  >
    {product.cta}
    {product.external ? (
      <ArrowUpRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    ) : (
      <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
    )}
  </ProductLink>
);

const Head = ({ product, as }) => {
  const H = as;
  return (
  <>
    <div className="flex items-center justify-between gap-4">
      <ProductMark product={product} size="lg" />
      <StatusPill product={product} />
    </div>
    <H className="mt-8 text-3xl font-semibold tracking-tight text-paper sm:text-4xl">{product.name}</H>
    <p className="mt-1.5 text-[15px] font-medium text-paper/70">{product.category}</p>
    <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-mute">{product.description}</p>
  </>
  );
};

// SpotlightCard (React Bits) draws the surface, border and cursor light.
const cardBase =
  'group rounded-2xl p-7 transition-transform duration-300 hover:-translate-y-1 sm:p-9 motion-reduce:hover:translate-y-0';
const spot = { intensity: 0.12, spotlightSize: 360, borderGlow: 0.6 };

/**
 * The three products as an asymmetric set: CafeXP and RaceXP side by side,
 * FlowXP full width with a real screen from the product.
 */
const ProductCards = ({ headingLevel = 'h3' }) => {
  const { cafexp, racexp, flowxp } = byId;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <SpotlightCard
        {...spot}
        className={`${cardBase} lg:col-span-7`}
        style={{ backgroundImage: 'radial-gradient(120% 90% at 100% 0%, rgb(229 50 45 / 0.22), transparent 60%)' }}
      >
        <Head product={cafexp} as={headingLevel} />
        <div className="mt-7"><ModuleChips product={cafexp} /></div>
        <CardLink product={cafexp} />
      </SpotlightCard>

      <SpotlightCard
        {...spot}
        className={`${cardBase} lg:col-span-5`}
        style={{
          backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <Head product={racexp} as={headingLevel} />
        <div className="mt-7"><ModuleChips product={racexp} /></div>
        <CardLink product={racexp} />
      </SpotlightCard>

      <SpotlightCard {...spot} className={`${cardBase} grid items-center gap-10 lg:col-span-12 lg:grid-cols-12 lg:py-0 lg:pr-0`}>
        <div className="lg:col-span-5 lg:py-10">
          <Head product={flowxp} as={headingLevel} />
          <div className="mt-7"><ModuleChips product={flowxp} /></div>
          <CardLink product={flowxp} />
        </div>
        <div className="-mb-7 sm:-mb-9 lg:col-span-7 lg:mb-0 lg:self-end lg:pt-12">
          <img
            src={flowxpDashboard}
            alt="FlowXP dashboard for a demo restaurant: today's sales, bills, average bill, a 14-day sales chart and items needing attention."
            width="2880"
            height="1800"
            loading="lazy"
            decoding="async"
            className="w-full rounded-t-xl border border-b-0 border-white/10 object-cover object-left-top shadow-[0_-20px_60px_-30px_rgb(0_0_0/0.8)] lg:rounded-tr-none lg:border-r-0"
          />
        </div>
      </SpotlightCard>
    </div>
  );
};

export default ProductCards;
