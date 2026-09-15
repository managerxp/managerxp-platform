import React from 'react';

/*
 * Shared admin primitives.
 *
 * Nearly everything here now lives in components/shared/dashboardUi.jsx,
 * shared with the café-owner portal — the two consoles had drifted into
 * retyping the identical Card/Button/Field/Banner/etc, which is most of why
 * they read as two different half-finished products instead of one.
 * Re-exported under the names this console's own pages already call them
 * (`Panel` for what the shared module names `Card`, `CopyableSecret` for
 * `CopySecret`) so nothing calling into this file had to change.
 *
 * `Pill` stays local, deliberately: this console reads sharper and denser
 * than the portal — status carried by a solid border, not a soft ring —
 * which is a real, documented difference in how the two consoles should
 * feel, not drift to unify away.
 */
/* eslint-disable react-refresh/only-export-components -- re-exporting the shared
   module's own mix of components and constants (surface, primaryButtonClass,
   inputClass); dashboardUi.jsx is the file that actually defines them. */
export {
  surface, primaryButtonClass, Page, Card as Panel, Button, Field, inputClass, Input, Select,
  Banner, Empty, Skeleton, Table, CopySecret as CopyableSecret
} from '../shared/dashboardUi';
/* eslint-enable react-refresh/only-export-components */

export const Pill = ({ tone = 'mute', children }) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
    info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    mute: 'bg-white/[0.06] text-neutral-400 border-white/10'
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
};
