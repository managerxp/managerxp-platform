/*
 * Shared marketing-site visual tokens.
 *
 * The glass-panel shell (`glassPanel`) was the identical string, retyped
 * with a slightly different shadow spread each time, in six separate
 * components — BillingDesk, CafeXPAI, PeopleOps, TelemetryPanel,
 * StationOps, AnalyticsPeak. Importing it here instead means one edit
 * reaches all six, the same reasoning
 * `components/portal/ui.jsx` and `components/admin/ui.jsx` already apply to
 * their own `surface` constant — this is that same pattern extended to the
 * marketing layer, which never had it.
 *
 * CommandCenter's panel is deliberately NOT on this list: its shadow is a
 * genuinely different two-layer treatment (a soft drop shadow plus a 1px
 * highlight ring) built for the site's single flagship visual, not a
 * one-off variant of this one — collapsing it into the shared token would
 * be a downgrade, not a consolidation.
 *
 * A plain string, not a wrapping component: two of the six attach a ref
 * to this exact element (TelemetryPanel and AnalyticsPeak, for their
 * Anime.js/IntersectionObserver setup), so the element itself has to stay
 * each component's own — only the class value is shared.
 */
export const glassPanel =
  'overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl shadow-glow-lg';
