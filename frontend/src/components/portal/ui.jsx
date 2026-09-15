import React from 'react';

/*
 * Portal primitives.
 *
 * Nearly everything here now lives in components/shared/dashboardUi.jsx,
 * shared with the ManagerXP admin console — the two consoles had drifted
 * into retyping the identical Card/Button/Field/Banner/etc, which is most
 * of why they read as two different half-finished products instead of one.
 * Re-exported under the names this file's own pages already call them
 * (`CopyBox` for what the shared module names `CopySecret`) so nothing
 * calling into this file had to change.
 *
 * `Pill` stays local, deliberately: the customer portal leans warmer and
 * calmer than the admin kit — status carried by a soft ring rather than a
 * hard border — which is a real, documented difference in how the two
 * consoles should feel, not drift to unify away.
 */
/* eslint-disable react-refresh/only-export-components -- re-exporting the shared
   module's own mix of components and constants (surface, inputClass);
   dashboardUi.jsx is the file that actually defines them. */
export {
  surface, Page, Card, Button, Field, inputClass, Input, Select,
  Banner, Empty, Skeleton, Table, StatusDot, Stat, Meter,
  CopySecret as CopyBox
} from '../shared/dashboardUi';
/* eslint-enable react-refresh/only-export-components */

export const Pill = ({ tone = 'mute', children }) => {
  const tones = {
    good: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
    warn: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
    bad: 'bg-red-500/10 text-red-300 ring-red-500/25',
    info: 'bg-sky-500/10 text-sky-300 ring-sky-500/25',
    mute: 'bg-white/[0.06] text-neutral-400 ring-white/10'
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
};
