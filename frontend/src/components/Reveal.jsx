import React from 'react';
import { motion as Motion } from 'framer-motion';
import { revealVariants, VIEWPORT } from '../lib/motion';

/**
 * Scroll reveal for general product UI, driven by Motion.
 *
 * Motion respects `prefers-reduced-motion` natively (it drops the transform and
 * keeps the element visible), so no manual guard is needed here.
 */
const Reveal = ({ children, className = '', delay = 0, direction = 'up' }) => (
  <Motion.div
    className={className}
    custom={direction}
    variants={revealVariants}
    initial="hidden"
    whileInView="visible"
    viewport={VIEWPORT}
    transition={{ delay: delay / 1000 }}
  >
    {children}
  </Motion.div>
);

export default Reveal;
