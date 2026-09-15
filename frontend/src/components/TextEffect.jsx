import React from 'react';
import { motion as Motion } from 'framer-motion';
import { EASE_MOTION, prefersReducedMotion } from '../lib/motion';

/*
 * A small port of motion-primitives' TextEffect, scoped to what this site
 * actually uses: a stagger-in fade, per character or per word. Not the full
 * upstream library (blur/scale/shake presets, exit animations, line-level
 * splitting) — nothing here calls for those, so they aren't built.
 *
 * Self-contained (own initial/animate), not a `variants={staggerItem}` child
 * of a parent stagger group — nesting two independently-timed stagger
 * systems is how you get an effect that finishes invisibly behind its own
 * still-fading-in parent. Use `delay` to place it in a sequence instead.
 */
const PRESETS = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.4, ease: EASE_MOTION } }
  }
};

export const TextEffect = ({
  children,
  per = 'word',
  preset = 'fade',
  as: Tag = 'p',
  className = '',
  delay = 0,
  speed = 1,
  ...props
}) => {
  const text = typeof children === 'string' ? children : '';

  // Static text beats an animation neither asked for nor able to be skipped.
  if (prefersReducedMotion()) {
    return <Tag className={className} {...props}>{text}</Tag>;
  }

  const segments = per === 'char' ? text.split('') : text.split(/(\s+)/).filter(Boolean);
  const itemVariants = PRESETS[preset] || PRESETS.fade;
  const stagger = (per === 'char' ? 0.025 : 0.08) / speed;

  const container = {
    hidden: {},
    visible: { transition: { staggerChildren: stagger, delayChildren: delay } }
  };

  const MotionTag = Motion[Tag] || Motion.span;

  return (
    <MotionTag
      initial="hidden"
      animate="visible"
      variants={container}
      aria-label={text}
      className={className}
      {...props}
    >
      {segments.map((segment, i) => (
        <Motion.span
          key={i}
          aria-hidden="true"
          variants={itemVariants}
          style={{ display: 'inline-block', whiteSpace: /^\s+$/.test(segment) ? 'pre' : undefined }}
        >
          {segment}
        </Motion.span>
      ))}
    </MotionTag>
  );
};

export default TextEffect;
