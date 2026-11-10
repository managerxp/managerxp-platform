import { useCallback, useEffect, useState } from 'react';
import { hasConsent } from './consent';

/*
 * Light or dark for the signed-in dashboards (café-owner portal and the
 * ManagerXP admin console). Both read the same setting, so switching in one
 * carries to the other.
 *
 * The first visit follows the operating system. A choice the person makes is
 * remembered across visits only if they allowed "Preferences" in the consent
 * panel; otherwise it lasts for this browser tab, which is what the consent
 * copy promises ("Off means the site starts from its defaults each time").
 */
const KEY = 'mx_dash_theme';
const EVENT = 'mx:dash-theme';

const stored = () => {
  try {
    return localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const systemTheme = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

const initial = () => {
  const s = stored();
  return s === 'light' || s === 'dark' ? s : systemTheme();
};

const save = (theme) => {
  try {
    if (hasConsent('preferences')) {
      localStorage.setItem(KEY, theme);
      sessionStorage.removeItem(KEY);
    } else {
      sessionStorage.setItem(KEY, theme);
      localStorage.removeItem(KEY);
    }
  } catch {
    /* storage blocked: the choice holds until the page reloads */
  }
};

/** `[theme, toggle]`, where theme is 'light' or 'dark'. */
export const useDashTheme = () => {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    const onChange = (e) => setTheme(e.detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    // Switch in one frame: without this every element with a colour
    // transition fades between themes at its own speed, and the page
    // flickers through a half-light, half-dark state.
    const root = document.documentElement;
    root.classList.add('dash-switching');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('dash-switching')));
    save(next);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }, [theme]);

  return [theme, toggle];
};
