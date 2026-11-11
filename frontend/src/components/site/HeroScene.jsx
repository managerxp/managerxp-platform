import React, { useEffect, useRef, useState } from 'react';
import poster from '../../assets/hero/network-poster.webp';

/*
 * The hero's interactive 3D India map. On capable desktops the three.js +
 * GSAP scene loads in its own chunk after first paint and plays its own
 * entrance, so no poster is shown first (a finished poster followed by an
 * entrance would jump). Phones, reduced motion, Save-Data, no WebGL,
 * software WebGL and low-power devices get the still poster instead, as do
 * devices the scene's frame-time watchdog finds too slow.
 */
const canRunScene = () => {
  if (!window.matchMedia('(min-width: 1024px)').matches) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (navigator.connection?.saveData) return false;
  if ((navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2) return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    // Software WebGL draws on the CPU and blocks the page: poster instead.
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
};

// The map is a cropped region; its edges fade into the page instead of
// stopping at a hard rectangle.
const EDGE_FADE = 'radial-gradient(closest-side, #000 66%, transparent 100%)'; // fully clear at every edge
const fadeStyle = { maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE };

const HeroScene = ({ className = '' }) => {
  const hostRef = useRef(null);
  const [capable] = useState(canRunScene);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!capable) return undefined;
    let dispose;
    let cancelled = false;
    const start = () => {
      import('../../lib/heroScene').then(({ mountHeroScene }) => {
        if (cancelled || !hostRef.current) return;
        try {
          dispose = mountHeroScene(hostRef.current, {
            // Frames too slow for this device: drop back to the poster.
            onSlow: () => {
              setSlow(true);
              dispose?.();
              dispose = undefined;
            },
          });
        } catch {
          setSlow(true); // WebGL failed after all: show the poster
        }
      });
    };
    const idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 2000 }) : window.setTimeout(start, 700);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      dispose?.();
    };
  }, [capable]);

  return (
    <div ref={hostRef} aria-hidden="true" style={fadeStyle} className={`relative select-none ${className}`}>
      {(!capable || slow) && (
        <img
          src={poster}
          alt=""
          width="1200"
          height="1100"
          decoding="async"
          fetchPriority="high"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
      )}
    </div>
  );
};

export default HeroScene;
