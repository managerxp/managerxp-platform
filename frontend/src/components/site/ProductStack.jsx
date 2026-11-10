import React from 'react';

/*
 * The hero's 3D piece: the three products as floating plates, CafeXP in red
 * on top, turning slowly. Pure CSS 3D in the site's flat colours; decorative
 * (aria-hidden) and still under prefers-reduced-motion (.mx-spin-z in
 * index.css).
 */
const PLATES = [
  { name: 'FlowXP', z: 0, cls: 'bg-sheet text-carbon' },
  { name: 'RaceXP', z: 70, cls: 'bg-sheet text-carbon' },
  { name: 'CafeXP', z: 140, cls: 'bg-signal text-white' },
];

const ProductStack = ({ size = 300 }) => (
  <div aria-hidden="true" className="relative mx-auto grid place-items-center" style={{ width: size * 1.45, height: size * 1.45, perspective: '1600px' }}>
    <div className="relative" style={{ width: size, height: size, transformStyle: 'preserve-3d', transform: 'rotateX(58deg)' }}>
      <div className="mx-spin-z absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
        {PLATES.map((p) => (
          <div
            key={p.name}
            className={`absolute inset-0 flex items-end border-2 border-carbon p-5 ${p.cls}`}
            style={{ transform: `translateZ(${p.z}px)` }}
          >
            <span className="poster-h text-[44px]">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ProductStack;
