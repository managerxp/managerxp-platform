import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import logo from '../../assets/whitelogo.png';
import PageBackground from '../PageBackground';

/*
 * Same visual language as AuthLayout (/login, /signup) — the HUD-strip card,
 * the ambient glow, the racer streaks — rather than a plain text page. Not
 * vertically centered like the auth card, since a 15-section document needs
 * to scroll, not sit in one viewport.
 */
export const LegalPage = ({ title, hudLabel, lastUpdated, effectiveDate, children }) => (
  <section className="relative bg-black text-white overflow-hidden antialiased font-sans min-h-screen px-4 py-10 sm:py-14">
    <PageBackground streakTop="top-1/4" streakBottom="bottom-1/3" />

    <div className="relative z-10 mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center hover:opacity-80 transition-opacity">
          <img src={logo} alt="ManagerXP" className="h-7 w-auto" />
        </Link>
        <Link
          to="/"
          className="group inline-flex items-center gap-1.5 text-xs font-mono text-neutral-500 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-0.5" />
          Back to site
        </Link>
      </div>

      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute -inset-1 bg-gradient-to-r from-red-500/20 to-black rounded-2xl blur-xl opacity-30"
        />

        <div className="relative border border-white/10 rounded-2xl bg-neutral-950/70 backdrop-blur-xl shadow-[0_0_50px_-20px_rgba(220,38,38,0.25)] overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="ml-2 text-[10px] font-mono text-neutral-600 uppercase tracking-wider">
              {hudLabel}
            </span>
          </div>

          <div className="p-6 sm:p-10">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">{title}</h1>
            <p className="mt-2 text-xs font-mono uppercase tracking-wide text-neutral-500">
              Last updated: {lastUpdated}
            </p>

            <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-neutral-300">
              {children}
            </div>

            {effectiveDate && (
              <p className="mt-16 border-t border-white/10 pt-6 text-xs font-mono text-neutral-600">
                Effective date: {effectiveDate}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  </section>
);

export const Section = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-24">
    <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
    <div className="space-y-3">{children}</div>
  </section>
);

export const BulletList = ({ items }) => (
  <ul className="list-disc list-inside space-y-1.5 marker:text-red-500">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);
