/*
 * Border Beam from Magic UI (https://magicui.design/docs/components/border-beam),
 * also listed on 21st.dev as magicui/border-beam. MIT licence. Vendored
 * 2026-11-04: TypeScript removed, cn() replaced with a template string,
 * framer-motion instead of motion/react, and it renders nothing under
 * prefers-reduced-motion (offset-path animation is not covered by
 * MotionConfig's reduced-motion handling).
 */
import { motion as Motion, useReducedMotion } from 'framer-motion';

export const BorderBeam = ({
  className = '',
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}) => {
  const reduce = useReducedMotion();
  if (reduce) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ '--border-beam-width': `${borderWidth}px` }}
    >
      <Motion.div
        className={`absolute aspect-square bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent ${className}`}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
          ...style,
        }}
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{
          offsetDistance: reverse
            ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
            : [`${initialOffset}%`, `${100 + initialOffset}%`],
        }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay, ...transition }}
      />
    </div>
  );
};

export default BorderBeam;
