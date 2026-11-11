import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, ALL, NONE, getConsent, saveConsent } from '../lib/consent';

/*
 * The consent panel (DPDP Act 2023, s.6).
 *
 * - First visit: a bar with three equal choices, Accept all, Decline,
 *   or Choose. Saying no takes exactly as much effort as saying yes.
 * - Choose: one switch per optional category, each with its purpose in plain
 *   words. Strictly necessary is shown but cannot be switched off.
 * - Afterwards: "Cookie & data choices" in the footer reopens it on the
 *   switches, with the current choice loaded, so consent can be changed or
 *   withdrawn as easily as it was given.
 */
const CookieConsent = () => {
  const [open, setOpen] = useState(() => !getConsent());
  const [choosing, setChoosing] = useState(false);
  const [choices, setChoices] = useState(() => getConsent()?.choices ?? NONE);
  const [saved, setSaved] = useState('');
  const panelRef = useRef(null);
  const decided = Boolean(getConsent());

  // Reopen from the footer link.
  useEffect(() => {
    const onOpen = () => {
      setChoices(getConsent()?.choices ?? NONE);
      setChoosing(true);
      setSaved('');
      setOpen(true);
      requestAnimationFrame(() => panelRef.current?.focus());
    };
    window.addEventListener('mx:consent-open', onOpen);
    return () => window.removeEventListener('mx:consent-open', onOpen);
  }, []);

  // Escape closes the panel only once a decision exists.
  useEffect(() => {
    if (!open || !decided) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, decided]);

  if (!open) return null;

  const finish = (next, action) => {
    saveConsent(next, action);
    setChoices(next);
    setSaved(action === 'accept_all' ? 'All categories allowed.' : action === 'custom' ? 'Your choices are saved.' : 'Declined. Only what the site needs to work is kept.');
    setTimeout(() => setOpen(false), 900);
  };

  const anyOn = Object.values(choices).some(Boolean);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/15 bg-[#0e0e0e] font-display text-[#f2f2f2] outline-none"
    >
      <div className="wrap max-h-[85dvh] overflow-y-auto py-6 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-5">
            <h2 id="consent-title" className="text-[22px] font-bold tracking-[-0.02em]">
              Your data, your choice<span className="text-[#e5322d]">.</span>
            </h2>
            <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-white/70">
              We keep only what the site needs to work unless you allow more. Choose what we may use; you can change
              or withdraw this any time from <span className="text-white">Cookie &amp; data choices</span> in the footer.
              Details are in our{' '}
              <Link to="/privacy-policy" className="underline underline-offset-4 hover:text-[#e5322d]">Privacy Policy</Link>.
            </p>
          </div>

          {choosing ? (
            <fieldset className="lg:col-span-7">
              <legend className="sr-only">Data categories</legend>
              <ul className="divide-y divide-white/10 border-y border-white/10">
                {CATEGORIES.map((c) => {
                  const on = c.required ? true : Boolean(choices[c.id]);
                  return (
                    <li key={c.id} className="flex items-start justify-between gap-6 py-4">
                      <label htmlFor={`consent-${c.id}`} className="cursor-pointer">
                        <span className="block text-[16px] font-semibold">
                          {c.name}
                          {c.required && <span className="ml-2 text-[13px] font-normal text-white/50">Always on</span>}
                        </span>
                        <span className="mt-1 block max-w-[60ch] text-[14px] leading-snug text-white/60">{c.purpose}</span>
                      </label>
                      <input
                        id={`consent-${c.id}`}
                        type="checkbox"
                        role="switch"
                        checked={on}
                        disabled={c.required}
                        aria-checked={on}
                        onChange={(e) => setChoices((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                        className="consent-switch mt-1 shrink-0"
                      />
                    </li>
                  );
                })}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => finish(choices, decided && !anyOn ? 'withdraw' : 'custom')} className="btn-light">
                  Save my choices
                </button>
                <button type="button" onClick={() => finish(ALL, 'accept_all')} className="consent-outline">Accept all</button>
                <button type="button" onClick={() => finish(NONE, decided ? 'withdraw' : 'necessary_only')} className="consent-outline">
                  {decided ? 'Withdraw all optional' : 'Decline'}
                </button>
                {decided && (
                  <button type="button" onClick={() => setOpen(false)} className="px-2 text-[15px] text-white/60 underline underline-offset-4 hover:text-white">
                    Close
                  </button>
                )}
              </div>
            </fieldset>
          ) : (
            <div className="flex flex-wrap items-center gap-3 lg:col-span-7 lg:justify-end">
              <button type="button" onClick={() => finish(ALL, 'accept_all')} className="btn-light">Accept all</button>
              <button type="button" onClick={() => finish(NONE, 'necessary_only')} className="consent-outline">Decline</button>
              <button type="button" onClick={() => setChoosing(true)} className="consent-outline">Choose</button>
            </div>
          )}
        </div>
        <p aria-live="polite" className="mt-3 min-h-[1.25rem] text-[14px] text-white/70">{saved}</p>
      </div>
    </div>
  );
};

export default CookieConsent;
