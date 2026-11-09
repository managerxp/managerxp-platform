import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { prefersReducedMotion } from '../../lib/motion';

/*
 * A race start for the RaceXP page: five light pods come on one by one,
 * hold, then go out, and a lap timer starts. Flat red, no glow. The timer
 * writes straight to its text node so it never re-renders React. Under
 * reduced motion it shows the lights already out and a fixed lap.
 */

const PODS = 5;
const STEP = 650;
const HOLD = 900;

const fmt = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
};

const StartLights = ({ className = '' }) => {
  const [reduce] = useState(prefersReducedMotion);
  const [lit, setLit] = useState(0);
  const [out, setOut] = useState(reduce);
  const [run, setRun] = useState(0);
  const timerRef = useRef(null);

  // Light sequence
  useEffect(() => {
    if (reduce) return undefined;
    const timers = [];
    for (let i = 1; i <= PODS; i++) timers.push(setTimeout(() => setLit(i), 400 + i * STEP));
    timers.push(setTimeout(() => { setLit(0); setOut(true); }, 400 + PODS * STEP + HOLD));
    return () => timers.forEach(clearTimeout);
  }, [run, reduce]);

  // Lap timer after lights out
  useEffect(() => {
    const el = timerRef.current;
    if (!el) return undefined;
    if (reduce) {
      el.textContent = fmt(84517);
      return undefined;
    }
    if (!out) {
      el.textContent = fmt(0);
      return undefined;
    }
    const start = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      el.textContent = fmt((now - start) % 120000);
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [out, reduce]);

  const replay = () => {
    if (reduce) return;
    setOut(false);
    setLit(0);
    setRun((r) => r + 1);
  };

  return (
    <figure className={className}>
      <div aria-hidden="true" className="flex gap-2 sm:gap-3">
        {Array.from({ length: PODS }, (_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-2 border border-white/10 bg-black px-2 py-3 sm:gap-3 sm:py-4">
            {[0, 1].map((row) => (
              <span
                key={row}
                className={`aspect-square w-full max-w-[3.25rem] rounded-full transition-colors duration-100 ${
                  i < lit ? 'bg-[#e5322d]' : 'bg-white/[0.07]'
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[15px] text-white/50">{out ? 'Lights out. Lap 1' : 'Grid ready'}</p>
          <p ref={timerRef} className="mt-1 font-mono text-[clamp(2rem,4vw,3rem)] leading-none tabular-nums text-white">0:00.000</p>
        </div>
        {!reduce && (
          <button type="button" onClick={replay} className="inline-flex items-center gap-2 border border-white/20 px-3 py-2 text-[14px] text-white/80 hover:border-white hover:text-white">
            <RotateCcw aria-hidden="true" className="h-4 w-4" /> Restart
          </button>
        )}
      </div>
      <figcaption className="sr-only">An animated race start: five red lights come on and go out, then a lap timer runs.</figcaption>
    </figure>
  );
};

export default StartLights;
