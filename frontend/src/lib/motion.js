/**
 * Animation architecture
 * ----------------------
 * Motion (framer-motion v12) drives the general product UI: reveals, hero
 * entrance, cards, accordions, pricing, navigation.
 *
 * Anime.js is reserved for the RaceXP engineering visuals — draggable telemetry
 * cursor, SVG track drawing, motion-path marker and the race timeline — where
 * its SVG/draggable primitives are a better fit.
 *
 * The two are never used on the same element.
 */

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pointer parallax is desktop-only: coarse pointers have no hover to track and
 * small screens cannot spare the work.
 */
export const supportsPointerParallax = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
  window.innerWidth >= 1024 &&
  !prefersReducedMotion();

/* -- Motion presets -------------------------------------------------------- */

/** House spring: physical but not bouncy. */
export const SPRING = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 };
export const SPRING_SOFT = { type: 'spring', stiffness: 170, damping: 26 };
export const EASE_MOTION = [0.22, 1, 0.36, 1];

/** Standard reveal used by the Reveal component and section content. */
export const revealVariants = {
  hidden: (direction = 'up') => ({
    opacity: 0,
    y: direction === 'up' ? 26 : direction === 'down' ? -26 : 0,
    x: direction === 'left' ? 26 : direction === 'right' ? -26 : 0,
    scale: direction === 'none' ? 0.97 : 1
  }),
  visible: {
    opacity: 1,
    y: 0,
    x: 0,
    scale: 1,
    transition: { duration: 0.7, ease: EASE_MOTION }
  }
};

/** Parent that staggers its children in. */
export const staggerParent = (stagger = 0.08, delayChildren = 0) => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } }
});

/** Child item for a staggered parent. */
export const staggerItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_MOTION } }
};

/** Shared viewport config so reveals trigger consistently site-wide. */
export const VIEWPORT = { once: true, amount: 0.15, margin: '0px 0px -60px 0px' };

/* -- Anime.js (RaceXP only) ------------------------------------------------ */

export const EASE_OUT = 'out(3)';
