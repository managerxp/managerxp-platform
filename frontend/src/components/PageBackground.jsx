import React from 'react';
import ParticleBackground from './ParticleBackground';

/**
 * The shared ManagerXP background stack: tech grid, particle canvas, ambient red
 * glow and racing light streaks. Previously duplicated verbatim across every
 * page/section; keep visual changes here so the whole site stays consistent.
 *
 * variant="hero"   larger grid + brighter, higher-centred glow for landing views
 * variant="section" subtler grid for content sections
 */
const PageBackground = ({
  variant = 'section',
  streakTop = 'top-1/3',
  streakBottom = 'bottom-1/4'
}) => {
  const isHero = variant === 'hero';

  return (
    <>
      {/* 1. Tech Grid */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 z-0 ${
          isHero
            ? 'opacity-10 bg-[length:60px_60px]'
            : 'opacity-[0.03] bg-[length:40px_40px]'
        }
        [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),
                           linear-gradient(to_top,rgba(255,255,255,0.06)_1px,transparent_1px)]`}
      />

      {/* 2. Canvas Particles */}
      <ParticleBackground />

      {/* 3. Ambient Red Glow */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 z-[1] opacity-70 ${
          isHero
            ? '[background:radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(185,28,28,0.15),transparent_70%)]'
            : '[background:radial-gradient(ellipse_60%_50%_at_50%_30%,rgba(185,28,28,0.15),transparent_70%)]'
        }`}
      />

      {/* 4. Racer Light Streaks */}
      <div aria-hidden="true" className={`absolute ${streakTop} left-0 w-full h-[1px] z-[2] overflow-hidden`}>
        <div className="w-1/3 h-full bg-gradient-to-r from-transparent via-red-600/60 to-transparent absolute animate-racer-fast blur-[1px]" />
      </div>
      <div aria-hidden="true" className={`absolute ${streakBottom} left-0 w-full h-[1px] z-[2] overflow-hidden`}>
        <div className="w-1/4 h-full bg-gradient-to-r from-transparent via-red-500/40 to-transparent absolute animate-racer-slow blur-[1px]" />
      </div>
    </>
  );
};

export default PageBackground;
