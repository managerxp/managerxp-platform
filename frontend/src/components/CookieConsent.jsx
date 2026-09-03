import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';

const STORAGE_KEY = 'cxp_cookie_consent';

const hasResponded = () => {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, locked-down browser) — show the banner
    // every visit rather than crash the page over it.
    return false;
  }
};

/*
 * A plain accept/decline notice, not a preference center — this site sets
 * no third-party tracking cookies today, only what keeps a signed-in session
 * working. If that changes, this is the place to add a real choice between
 * categories rather than the one blanket toggle below.
 */
const CookieConsent = () => {
  const [visible, setVisible] = useState(() => !hasResponded());

  const respond = (value) => {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* best effort */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div role="dialog" aria-label="Cookie notice" className="fixed inset-x-0 bottom-0 z-[60]">
      {/* Racer streak, same motif as the footer's top glow. */}
      <div aria-hidden="true" className="relative h-[1px] w-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/3 animate-racer-drift bg-gradient-to-r from-transparent via-red-600/60 to-transparent blur-[1px]" />
      </div>

      <div className="border-t border-white/10 bg-neutral-950/95 px-5 py-4 shadow-[0_-20px_50px_-20px_rgba(220,38,38,0.25)] backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-red-500/30 bg-red-500/10 text-red-500">
              <Cookie className="h-4 w-4" />
            </span>
            <p className="text-sm text-neutral-300">
              We use cookies to keep you signed in and to remember your preferences. By continuing
              to use ManagerXP, you agree to this — see our{' '}
              <Link to="/privacy-policy" className="text-red-400 underline hover:text-red-300">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
          <div className="flex shrink-0 gap-3 pl-11 sm:pl-0">
            <button
              type="button"
              onClick={() => respond('declined')}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/30 hover:text-white"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => respond('accepted')}
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-neutral-100"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
