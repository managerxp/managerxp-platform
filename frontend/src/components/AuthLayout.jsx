import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import logo from '../assets/whitelogo-sm.webp';
import StationGrid from './site/StationGrid';

/**
 * Shared field styling for the auth forms (also reused by dashboard forms).
 *
 * `[color-scheme:dark]` matters for `type="date"`/`type="time"` inputs: it
 * makes the browser draw its picker icon light, so it stays visible on this
 * dark field.
 */
export const authFieldClasses =
  'w-full bg-white/[0.04] border border-white/15 px-3.5 py-3 text-[15px] text-white ' +
  'placeholder-neutral-400 outline-none transition-colors [color-scheme:dark] ' +
  'focus:border-white focus:bg-white/[0.06]';

export const authLabelClasses = 'block text-sm font-medium text-neutral-300 mb-1.5';

/**
 * A mandatory, never-pre-checked consent checkbox for a form collecting
 * someone's personal data for the first time (DPDP Act, 2023 requires
 * informed consent captured this way: an unticked box the person actively
 * checks, not a default-on one).
 */
export const ConsentCheckbox = ({ id, checked, onChange, children }) => (
  <label htmlFor={id} className="flex items-start gap-2.5 text-sm text-neutral-400 cursor-pointer select-none">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/[0.03] accent-[#e5322d]"
    />
    <span>{children}</span>
  </label>
);

const BRANDS = {
  cafexp: {
    name: 'CafeXP',
    line: 'Every PC, session and bill in your café, on one console.',
  },
  managerxp: {
    name: 'ManagerXP',
    line: 'The ManagerXP team console.',
  },
};

/**
 * The CafeXP account shell for /login, /signup and the other sign-in pages.
 * These routes hide the site nav and footer. On a wide screen the left half
 * says plainly whose door this is (CafeXP, by ManagerXP) over a live café
 * floor; on a phone that shrinks to a header line above the form.
 */
const AuthLayout = ({ title, subtitle, children, footer, wide = false, brand = 'cafexp' }) => {
  const b = BRANDS[brand] ?? BRANDS.cafexp;
  const isCafe = brand === 'cafexp';

  return (
    <section className="grid min-h-[100dvh] bg-carbon font-display text-sheet antialiased lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <aside className="hidden flex-col justify-between border-r border-white/10 p-10 xl:p-14 lg:flex">
        <Link to="/" aria-label="ManagerXP home" className="w-fit hover:opacity-80">
          <img src={logo} alt="ManagerXP" width="294" height="56" className="h-6 w-auto" />
        </Link>

        <div>
          {isCafe && <p className="text-lg text-sheet/55">by ManagerXP</p>}
          <p className="poster-h mt-2 text-[clamp(3.5rem,6vw,6rem)]">
            {b.name}<span className="text-signal">.</span>
          </p>
          <p className="mt-5 max-w-[34ch] text-xl leading-snug text-sheet/70">{b.line}</p>
        </div>

        {isCafe ? <StationGrid count={18} /> : <span />}
      </aside>

      {/* Form side */}
      <div className="flex flex-col px-5 py-6 sm:px-10 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-baseline gap-2 lg:invisible" aria-label={`${b.name} by ManagerXP, back to the ManagerXP site`}>
            <span className="poster-h text-[28px]">{b.name}<span className="text-signal">.</span></span>
            {isCafe && <span className="text-[14px] text-sheet/55">by ManagerXP</span>}
          </Link>
          <Link to="/" className="group inline-flex items-center gap-1.5 text-[14px] text-sheet/60 hover:text-sheet">
            <ArrowLeft aria-hidden="true" className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            Back to site
          </Link>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className={`mx-auto w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
            <p className="inline-flex items-center gap-2 border border-white/15 px-2.5 py-1 text-[13px] font-semibold text-sheet/80">
              <span aria-hidden="true" className="h-1.5 w-1.5 bg-signal" />
              {b.name} account
            </p>
            <h1 className="poster-h mt-5 text-[clamp(2.5rem,5vw,3.5rem)]">{title}</h1>
            {subtitle && <p className="mt-3 text-[17px] text-sheet/65">{subtitle}</p>}

            {children}

            {footer && <div className="mt-8 border-t border-white/10 pt-6 text-[15px] text-sheet/65">{footer}</div>}
          </div>
        </div>
      </div>
    </section>
  );
};

export default AuthLayout;
