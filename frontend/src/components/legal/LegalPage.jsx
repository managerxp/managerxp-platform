import React from 'react';
import { useLocation } from 'react-router-dom';
import Seo from '../site/Seo';

/*
 * Privacy Policy and Terms: reading pages, so they sit inside the normal site
 * nav and footer on the light sheet, set for comfortable reading (one column,
 * ~68 characters a line). `hudLabel` is accepted for older call sites.
 */
export const LegalPage = ({ title, lastUpdated, effectiveDate, children }) => {
  const { pathname } = useLocation();
  return (
    <article className="bg-sheet font-display text-carbon antialiased">
      <Seo title={`${title} | ManagerXP`} description={`${title} for ManagerXP Private Limited and its products CafeXP, RaceXP and FlowXP.`} path={pathname} />
      <header className="wrap pb-12 pt-10 sm:pt-16">
        <h1 className="poster-h text-[clamp(2.5rem,5vw,4.5rem)]">
          {title}<span className="text-signal">.</span>
        </h1>
        <p className="mt-6 text-lg text-graphite">ManagerXP Private Limited · Last updated {lastUpdated}</p>
      </header>

      <div className="wrap border-t border-carbon pb-24 pt-12">
        <div className="max-w-[68ch] space-y-12 text-[17px] leading-relaxed text-carbon/85">
          {children}
        </div>
        {effectiveDate && (
          <p className="mt-16 max-w-[68ch] border-t border-carbon/20 pt-6 text-[15px] text-graphite">
            Effective date: {effectiveDate}
          </p>
        )}
      </div>
    </article>
  );
};

export const Section = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-24">
    <h2 className="mb-4 text-[26px] font-bold leading-tight tracking-[-0.025em] text-carbon">{title}</h2>
    <div className="space-y-3">{children}</div>
  </section>
);

export const BulletList = ({ items }) => (
  <ul className="list-disc space-y-2 pl-5 marker:text-signal">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);
