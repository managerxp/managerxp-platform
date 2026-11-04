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
      <div className="border-t border-rule bg-ink-2 px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-rule text-mute">
              <Cookie className="h-4 w-4" />
            </span>
            <p className="text-sm text-mute">
              We use cookies to keep you signed in and to remember your preferences. By continuing
              to use ManagerXP, you agree to this. See our{' '}
              <Link to="/privacy-policy" className="text-paper underline underline-offset-4 hover:text-white">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
          <div className="flex shrink-0 gap-3 pl-11 sm:pl-0">
            <button
              type="button"
              onClick={() => respond('declined')}
              className="rounded-full border border-rule px-4 py-2 text-xs font-medium text-paper transition-colors hover:border-paper"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => respond('accepted')}
              className="rounded-full bg-paper px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white"
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
