/*
 * Visitor consent (DPDP Act 2023, s.6): ask before using anything beyond what
 * the site needs to work, let people accept all, keep only the necessary, or
 * choose per category, and let them change or withdraw it as easily as they
 * gave it. Every decision is saved in this browser and recorded on the server
 * (POST /api/public/consent) as proof.
 *
 * Bump CONSENT_VERSION whenever the categories or their purposes change: a
 * stored choice under an older version no longer counts, so people are asked
 * again.
 */
export const CONSENT_VERSION = '2026-11-09';
const STORAGE_KEY = 'mx_consent';
const LEGACY_KEY = 'cxp_cookie_consent';
const API_BASE_URL = import.meta.env.VITE_API_URL;

export const CATEGORIES = [
  {
    id: 'necessary',
    required: true,
    name: 'Strictly necessary',
    purpose: 'Keeps you signed in, keeps the site secure and remembers this choice. The site cannot work without these, so they are always on.',
  },
  {
    id: 'preferences',
    name: 'Preferences',
    purpose: 'Remembers optional display settings between visits. Off means the site starts from its defaults each time.',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    purpose: 'Anonymous counts of which pages are used, so we can improve them. We do not run analytics today; if we add it, it stays off unless you allow it.',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    purpose: 'Product news and offers based on what you looked at. We do not do this today; if we start, it stays off unless you allow it.',
  },
];

export const OPTIONAL = CATEGORIES.filter((c) => !c.required).map((c) => c.id);
export const NONE = Object.fromEntries(OPTIONAL.map((id) => [id, false]));
export const ALL = Object.fromEntries(OPTIONAL.map((id) => [id, true]));

const read = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** The visitor's current decision, or null when they still need to be asked. */
export const getConsent = () => {
  const stored = read();
  return stored && stored.version === CONSENT_VERSION ? stored : null;
};

/** Whether an optional category may be used. Necessary is always true. */
export const hasConsent = (category) => category === 'necessary' || Boolean(getConsent()?.choices?.[category]);

const newId = () =>
  (crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    }));

/**
 * Save a decision. `action` is one of accept_all, necessary_only, custom,
 * withdraw. The server copy is best effort: if it fails the choice still
 * holds in this browser, and it is never a reason to block the page.
 */
export const saveConsent = (choices, action) => {
  const previous = read();
  const record = {
    consentId: previous?.consentId || newId(),
    version: CONSENT_VERSION,
    choices: { ...NONE, ...choices },
    action,
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage blocked: the panel will simply ask again next visit */
  }
  if (API_BASE_URL) {
    fetch(`${API_BASE_URL}/api/public/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...record, page: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  }
  window.dispatchEvent(new CustomEvent('mx:consent-changed', { detail: record }));
  return record;
};

/** Reopen the consent panel (the footer's "Cookie & data choices" link). */
export const openConsentSettings = () => window.dispatchEvent(new Event('mx:consent-open'));
