import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { hasConsent } from '../../lib/consent';

/*
 * A playable race start for the RaceXP page: a reaction test.
 *
 * Press Start: the five lights come on one by one, hold for a random time,
 * then go out. Click the lights or press Space as soon as they go out; the
 * timer stops and your reaction time is set against real Formula 1 starts.
 * Going before lights out is a jump start.
 *
 * Benchmarks (real, sourced): the FIA put Valtteri Bottas's reaction at the
 * 2017 Austrian Grand Prix at 0.201 s, and Sebastian Vettel said after that
 * race that drivers' reaction times "are around 0.2 for everyone" (Reuters,
 * via Daily Mail, 9 July 2017).
 *
 * The running timer writes to its text node directly, so it never
 * re-renders React. Your best stays for this visit only; nothing is stored.
 */
const PODS = 5;
const STEP = 800; // ms between lights coming on
const HOLD_MIN = 400; // random hold before lights out
const HOLD_MAX = 2600;

const BENCHMARKS = [
  { who: 'Valtteri Bottas', note: 'Austrian GP 2017, as timed by the FIA', ms: 201 },
  { who: 'Typical F1 driver', note: 'about 0.2 s, per Sebastian Vettel', ms: 200 },
];

const secs = (ms) => (ms / 1000).toFixed(3);

/*
 * Start-light sounds, synthesised with the Web Audio API (no audio files):
 * a clean beep as each light comes on, silence at lights out (as in F1),
 * a low tone for a jump start. The context is created on the Start press, as
 * browsers require a user gesture before playing sound.
 */
let audioCtx = null;
const getAudio = () => {
  if (typeof window === 'undefined') return null;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
};
const tone = (freq, ms, { type = 'square', gain = 0.06 } = {}) => {
  const ac = getAudio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const t0 = ac.currentTime;
  osc.type = type;
  osc.frequency.value = freq;
  // Quick attack and release, so beeps click in and out cleanly.
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  amp.gain.setValueAtTime(gain, t0 + ms / 1000 - 0.02);
  amp.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
};
// Like the F1 broadcast: a clean (sine) beep per light, all the same pitch,
// and silence at lights out: drivers react to the lights, not a sound.
const SOUNDS = {
  light: () => tone(1000, 220, { type: 'sine', gain: 0.16 }),
  out: () => {},
  jump: () => tone(160, 450, { type: 'triangle', gain: 0.14 }),
};

// Your best time: kept across visits only with "Preferences" consent,
// otherwise just for this tab (the consent panel promises that).
const BEST_KEY = 'mx_racexp_best';
const readBest = () => {
  try {
    const v = Number(localStorage.getItem(BEST_KEY) || sessionStorage.getItem(BEST_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};
const saveBest = (ms) => {
  try {
    const keep = hasConsent('preferences') ? localStorage : sessionStorage;
    const drop = keep === localStorage ? sessionStorage : localStorage;
    keep.setItem(BEST_KEY, String(ms));
    drop.removeItem(BEST_KEY);
  } catch {
    /* storage blocked: the best still shows until the page closes */
  }
};

const StartLights = ({ className = '' }) => {
  // idle | arming | go | done | jump
  const [phase, setPhaseState] = useState('idle');
  const [lit, setLit] = useState(0);
  const [time, setTime] = useState(null);
  const [best, setBest] = useState(readBest);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const sound = (name) => {
    if (!mutedRef.current) SOUNDS[name]();
  };
  const timers = useRef([]);
  const goAt = useRef(0);
  const raf = useRef(0);
  const clockRef = useRef(null);
  const phaseRef = useRef('idle');
  // The phase lives in a ref too, so the key and click handlers read it
  // without waiting for a render.
  const setPhase = (p) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(raf.current);
  };
  useEffect(() => clear, []);

  const start = useCallback(() => {
    clear();
    setTime(null);
    setLit(0);
    setPhase('arming');
    if (clockRef.current) clockRef.current.textContent = secs(0);
    getAudio(); // unlock audio on this press
    for (let i = 1; i <= PODS; i += 1) {
      timers.current.push(setTimeout(() => {
        setLit(i);
        sound('light');
      }, (i - 1) * STEP)); // the first light comes on the moment Start is pressed
    }
    const hold = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
    timers.current.push(setTimeout(() => {
      setLit(0);
      setPhase('go');
      sound('out');
      goAt.current = performance.now();
      const tick = (now) => {
        if (clockRef.current) clockRef.current.textContent = secs(now - goAt.current);
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }, (PODS - 1) * STEP + hold));
  }, []);

  // One input for the whole test: click the lights, or press Space / Enter.
  const react = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'arming') {
      clear();
      setLit(0);
      setPhase('jump');
      sound('jump');
      return;
    }
    if (p === 'go') {
      const ms = Math.round(performance.now() - goAt.current);
      cancelAnimationFrame(raf.current);
      if (clockRef.current) clockRef.current.textContent = secs(ms);
      setTime(ms);
      setBest((b) => {
        if (b != null && ms >= b) return b;
        saveBest(ms);
        return ms;
      });
      setPhase('done');
      return;
    }
    start();
  }, [start]);

  useEffect(() => {
    if (phase !== 'arming' && phase !== 'go') return undefined;
    const onKey = (e) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault(); // Space would scroll the page
        react();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, react]);

  const status = {
    idle: 'Press Start, then hit Stop the moment the lights go out.',
    arming: 'Wait for it…',
    go: 'Lights out. Go!',
    done: time < 120 ? 'Faster than humanly possible. That one was a guess.' : time <= 201 ? 'Faster than Bottas in Austria.' : time <= 300 ? 'Race-ready. Go again?' : 'Off the line. Try again.',
    jump: 'Jump start. You went before lights out.',
  }[phase];

  return (
    <figure className={className}>
      {/* The lights themselves are the big target to click. */}
      <button
        type="button"
        onClick={react}
        aria-label={phase === 'arming' || phase === 'go' ? 'React' : 'Start the lights'}
        className="flex w-full cursor-pointer gap-2 outline-offset-4 sm:gap-3"
      >
        {Array.from({ length: PODS }, (_, i) => (
          <span key={i} className="flex flex-1 flex-col items-center gap-2 border border-white/10 bg-black px-2 py-3 sm:gap-3 sm:py-4">
            {[0, 1].map((row) => (
              <span
                key={row}
                className={`aspect-square w-full max-w-[3.25rem] rounded-full ${i < lit ? 'bg-[#e5322d]' : 'bg-white/[0.07]'}`}
              />
            ))}
          </span>
        ))}
      </button>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <p aria-live="polite" className={`text-[15px] ${phase === 'jump' ? 'text-[#f04a44]' : 'text-white/60'}`}>{status}</p>
            <button
              type="button"
              onClick={() => {
                mutedRef.current = !muted;
                setMuted(!muted);
              }}
              aria-label={muted ? 'Turn start-light sound on' : 'Mute start-light sound'}
              aria-pressed={muted}
              title={muted ? 'Sound off' : 'Sound on'}
              className="grid h-8 w-8 place-items-center text-white/60 hover:text-white"
            >
              {muted ? <VolumeX aria-hidden="true" className="h-4 w-4" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 font-mono text-[clamp(2rem,4vw,3rem)] leading-none tabular-nums text-white">
            <span ref={clockRef}>{phase === 'jump' ? '—' : '0.000'}</span>
            <span className="ml-1 text-[0.45em] text-white/50">s</span>
          </p>
        </div>
        {/* One button for the whole run: Start, then Stop while the lights
            are running (stopping before lights out is a jump start), then
            Go again. Clicking the lights or pressing Space does the same. */}
        {phase === 'arming' || phase === 'go' ? (
          <button
            type="button"
            onClick={react}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 bg-[#d42d28] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#b8241f]"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 border border-white/25 px-4 py-2.5 text-[15px] text-white hover:border-white"
          >
            {phase === 'idle' ? 'Start' : <><RotateCcw aria-hidden="true" className="h-4 w-4" /> Go again</>}
          </button>
        )}
      </div>

      <dl className="mt-6 divide-y divide-white/10 border-y border-white/10 text-[14px]">
        {BENCHMARKS.map((b) => (
          <div key={b.who} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt>
              <span className="text-white">{b.who}</span>
              <span className="block text-white/50 sm:ml-2 sm:inline">{b.note}</span>
            </dt>
            <dd className="shrink-0 whitespace-nowrap font-mono tabular-nums text-white">{secs(b.ms)} s</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 py-2.5">
          <dt><span className="text-white">You</span><span className="block text-white/50 sm:ml-2 sm:inline">your best</span></dt>
          <dd className={`shrink-0 whitespace-nowrap font-mono tabular-nums ${best != null && best <= 201 ? 'text-[#f04a44]' : 'text-white'}`}>{best == null ? '—' : `${secs(best)} s`}</dd>
        </div>
      </dl>
      <figcaption className="mt-3 text-[12px] text-white/45">
        F1 figures: FIA timing and Sebastian Vettel, 2017 Austrian Grand Prix (Reuters).
      </figcaption>
    </figure>
  );
};

export default StartLights;
