import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import logo from '../assets/whitelogo.png';
import PageBackground from './PageBackground';

/**
 * Shared field styling for the auth forms.
 *
 * `[color-scheme:dark]` matters specifically for `type="date"`/`type="time"`
 * inputs: without it the browser draws the calendar/clock picker icon in a
 * color meant for a light background, which is invisible against this
 * black field — the icon is there, just black-on-black. This tells the
 * browser to use its own dark-appropriate (light) icon instead, the same
 * fix native controls need on every dark-themed site, not just ManagerXP.
 */
export const authFieldClasses =
  'w-full bg-white/[0.03] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white ' +
  'placeholder-neutral-600 outline-none transition-colors [color-scheme:dark] ' +
  'focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20 focus:bg-white/[0.05]';

export const authLabelClasses = 'block text-xs text-neutral-400 mb-1.5 uppercase tracking-wider font-mono';

/**
 * A mandatory, never-pre-checked consent checkbox for a form collecting
 * someone's personal data for the first time (DPDP Act, 2023 requires
 * informed consent captured this way — an unticked box the person actively
 * checks, not a default-on one). `checked`/`onChange(boolean)` so it drops
 * into the same `form` state object every other field on these pages uses.
 */
export const ConsentCheckbox = ({ id, checked, onChange, children }) => (
  <label htmlFor={id} className="flex items-start gap-2.5 text-xs text-neutral-400 cursor-pointer select-none">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/[0.03] accent-red-500"
    />
    <span>{children}</span>
  </label>
);

/**
 * Branded shell for /login and /signup. Those routes hide the global navbar and
 * footer, so this supplies the logo, the back-to-site link and the ManagerXP
 * background treatment.
 */
const AuthLayout = ({ title, subtitle, children, footer, wide = false }) => {
  return (
    <section className="relative min-h-screen bg-black text-white overflow-hidden antialiased font-sans flex flex-col items-center justify-center px-4 py-10 sm:py-14">

      <PageBackground streakTop="top-1/4" streakBottom="bottom-1/4" />

      <div className={`relative z-10 w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`}>

        {/* Brand header */}
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

        {/* Card */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute -inset-1 bg-gradient-to-r from-red-500/20 to-black rounded-2xl blur-xl opacity-30"
          />

          <div className="relative border border-white/10 rounded-2xl bg-neutral-950/70 backdrop-blur-xl shadow-[0_0_50px_-20px_rgba(220,38,38,0.25)] overflow-hidden">
            {/* HUD strip */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="ml-2 text-[10px] font-mono text-neutral-600 uppercase tracking-wider">
                secure_session
              </span>
            </div>

            <div className="p-6 sm:p-7">
              <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
              {subtitle && <p className="text-sm text-neutral-400 mt-1">{subtitle}</p>}

              {children}
            </div>
          </div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-neutral-400">{footer}</div>}
      </div>
    </section>
  );
};

export default AuthLayout;
