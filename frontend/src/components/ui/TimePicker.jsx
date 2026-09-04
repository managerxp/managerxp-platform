import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { authFieldClasses } from '../AuthLayout';

const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const fromMinutes = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * A themed replacement for `<input type="time">` — same reason as
 * DatePicker: the native picker icon is unreadable on this site's black
 * fields. A scrollable list of slots rather than a clock face — this is
 * always used to pick a slot at a fixed granularity (booking a station,
 * setting store hours), never an exact-to-the-minute time.
 */
const TimePicker = ({ value, onChange, min, max, step = 30, disabled = false, id, placeholder = 'Select a time' }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const options = useMemo(() => {
    const lo = toMinutes(min) ?? 0;
    const hi = toMinutes(max) ?? 24 * 60 - step;
    const out = [];
    for (let m = lo; m <= hi; m += step) out.push(fromMinutes(m));
    return out;
  }, [min, max, step]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('[data-selected="true"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [open]);

  const format12h = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${authFieldClasses} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className={value ? 'text-white' : 'text-neutral-600'}>
          {value ? format12h(value) : placeholder}
        </span>
        <Clock className="h-4 w-4 shrink-0 text-neutral-500" />
      </button>

      {open && !disabled && (
        <div
          ref={listRef}
          className="absolute z-50 mt-2 max-h-56 w-40 overflow-y-auto rounded-xl border border-white/10 bg-neutral-950/95 p-1.5 shadow-[0_0_40px_-15px_rgba(220,38,38,0.35)] backdrop-blur-xl"
        >
          {options.length === 0 && (
            <p className="px-2 py-2 text-xs text-neutral-500">No times available.</p>
          )}
          {options.map((t) => {
            const isSelected = t === value;
            return (
              <button
                key={t}
                type="button"
                data-selected={isSelected}
                onClick={() => { onChange(t); setOpen(false); }}
                className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                  isSelected ? 'bg-red-600 text-white' : 'text-neutral-300 hover:bg-white/10'
                }`}
              >
                {format12h(t)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TimePicker;
