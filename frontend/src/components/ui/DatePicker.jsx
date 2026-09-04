import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isAfter,
  isBefore, isEqual, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns';
import { authFieldClasses } from '../AuthLayout';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const toDate = (iso) => {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

/**
 * A themed replacement for `<input type="date">` — the native control's
 * calendar icon renders unreadably dark on this site's black fields (see
 * authFieldClasses), and the popup itself is the browser's own generic one
 * rather than anything that looks like ManagerXP. Same string-in/string-out
 * contract a native date input would have (`value`/`onChange` as
 * "YYYY-MM-DD"), so it drops into a form the same way.
 */
const DatePicker = ({ value, onChange, min, max, disabled = false, id, placeholder = 'Select a date' }) => {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => toDate(value), [value]);
  const minDate = useMemo(() => toDate(min), [min]);
  const maxDate = useMemo(() => toDate(max), [max]);
  const [viewMonth, setViewMonth] = useState(() => selected || minDate || new Date());
  const rootRef = useRef(null);

  const toggleOpen = () => {
    if (!open) setViewMonth(selected || minDate || new Date());
    setOpen(!open);
  };

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

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth));
    const end = endOfWeek(endOfMonth(viewMonth));
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const isDisabled = (day) => {
    if (minDate && isBefore(day, minDate) && !isSameDay(day, minDate)) return true;
    if (maxDate && isAfter(day, maxDate) && !isSameDay(day, maxDate)) return true;
    return false;
  };

  const pick = (day) => {
    if (isDisabled(day)) return;
    onChange(format(day, 'yyyy-MM-dd'));
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={toggleOpen}
        className={`${authFieldClasses} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className={selected ? 'text-white' : 'text-neutral-600'}>
          {selected ? format(selected, 'dd MMM yyyy') : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-neutral-500" />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-2 w-72 rounded-xl border border-white/10 bg-neutral-950/95 p-3 shadow-[0_0_40px_-15px_rgba(220,38,38,0.35)] backdrop-blur-xl">
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-mono uppercase tracking-wide text-neutral-300">
              {format(viewMonth, 'MMMM yyyy')}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 px-1 pb-1 text-center text-[10px] font-mono uppercase text-neutral-600">
            {WEEKDAYS.map((w, i) => <div key={i}>{w}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1 px-1">
            {days.map((day) => {
              const outOfMonth = !isSameMonth(day, viewMonth);
              const isSelected = selected && isEqual(day, selected);
              const isToday = isSameDay(day, new Date());
              const blocked = isDisabled(day);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={blocked}
                  onClick={() => pick(day)}
                  className={[
                    'aspect-square rounded-lg text-xs transition-colors',
                    blocked ? 'cursor-not-allowed text-neutral-800' :
                      outOfMonth ? 'text-neutral-700 hover:bg-white/5' : 'text-neutral-200 hover:bg-white/10',
                    isSelected ? 'bg-red-600 text-white hover:bg-red-600' : '',
                    !isSelected && isToday ? 'ring-1 ring-inset ring-red-500/50' : '',
                  ].join(' ')}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
