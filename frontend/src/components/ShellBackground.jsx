import React from 'react';

/*
 * The ground under the signed-in shells — the café owner's portal and the
 * ManagerXP console.
 *
 * It is the static half of the treatment on /login: the tech grid and the red
 * ambient glow, so walking from the login card into a dashboard feels like the
 * same room. What it deliberately leaves out is the particle canvas and the
 * racing streaks. Those earn their keep behind a single card somebody looks at
 * for ten seconds; behind dense tables an operator reads all day they are a
 * moving distraction and a canvas animating forever.
 *
 * Fixed rather than absolute, so it stays put while a long table scrolls over
 * it instead of sliding away at the top of the page.
 */
const ShellBackground = () => (
  <>
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.03] bg-[length:40px_40px]
                 [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),
                                    linear-gradient(to_top,rgba(255,255,255,0.06)_1px,transparent_1px)]"
    />
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-70
                 [background:radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(185,28,28,0.12),transparent_70%)]"
    />
  </>
);

export default ShellBackground;
