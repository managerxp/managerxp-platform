/*
 * Date resolution for CafeXP AI.
 *
 * The model is never asked what day it is. Every window below is computed from
 * the server clock, because a language model has no reliable notion of "today"
 * and a wrong date silently poisons every number downstream — the answer looks
 * confident and is about the wrong day.
 *
 * A café's trading day is also not a calendar day: a session that starts at
 * 11pm and ends at 1am belongs to the night it started. `dayStartHour` shifts
 * the boundary so "yesterday" means the night the staff would call yesterday.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
];

/** Start of the trading day that `at` falls within. */
const dayStart = (at, dayStartHour) => {
  const d = new Date(at);
  d.setHours(dayStartHour, 0, 0, 0);
  // Before the boundary we are still in the previous trading day.
  if (at.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  return d;
};

const addDays = (d, n) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

const range = (from, to, label, grain) => ({
  from: from.toISOString(),
  to: to.toISOString(),
  label,
  grain,
  // Kept as Date objects for comparison arithmetic; not serialised.
  _from: from,
  _to: to
});

/**
 * Resolve a natural-language period from a question.
 *
 * Returns null when the question names no period at all, so the caller can
 * choose a default rather than this guessing one.
 */
export const resolvePeriod = (question, options = {}) => {
  const now = options.now ? new Date(options.now) : new Date();
  const dayStartHour = Number.isInteger(options.dayStartHour) ? options.dayStartHour : 0;
  const q = String(question || '').toLowerCase();

  const today = dayStart(now, dayStartHour);
  const tomorrow = addDays(today, 1);

  /* ---- explicit single days ---- */
  if (/\byesterday\b/.test(q)) {
    return range(addDays(today, -1), today, 'yesterday', 'day');
  }
  if (/\btoday\b|\bso far today\b/.test(q)) {
    return range(today, tomorrow, 'today', 'day');
  }

  /* ---- "last <weekday>" ---- */
  const weekdayMatch = q.match(/\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const target = WEEKDAYS.indexOf(weekdayMatch[1]);
    let d = addDays(today, -1);
    // Walk back to the most recent occurrence, never landing on today.
    while (d.getDay() !== target) d = addDays(d, -1);
    return range(d, addDays(d, 1), `last ${weekdayMatch[1]}`, 'day');
  }

  /* ---- rolling windows ---- */
  const lastN = q.match(/\blast (\d{1,3}) days?\b/) || q.match(/\bpast (\d{1,3}) days?\b/);
  if (lastN) {
    const n = Math.min(Math.max(parseInt(lastN[1], 10), 1), 365);
    return range(addDays(today, -n), today, `the last ${n} days`, n > 45 ? 'month' : 'day');
  }

  /* ---- weeks ---- */
  if (/\blast week\b/.test(q)) {
    const thisWeekStart = addDays(today, -((today.getDay() + 6) % 7)); // Monday
    const start = addDays(thisWeekStart, -7);
    return range(start, thisWeekStart, 'last week', 'day');
  }
  if (/\bthis week\b|\bweek to date\b/.test(q)) {
    const start = addDays(today, -((today.getDay() + 6) % 7));
    return range(start, tomorrow, 'this week', 'day');
  }

  /* ---- months ---- */
  if (/\blast month\b/.test(q)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1, dayStartHour, 0, 0, 0);
    const end = new Date(today.getFullYear(), today.getMonth(), 1, dayStartHour, 0, 0, 0);
    return range(start, end, 'last month', 'day');
  }
  if (/\bthis month\b|\bmonth to date\b/.test(q)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1, dayStartHour, 0, 0, 0);
    return range(start, tomorrow, 'this month', 'day');
  }

  return null;
};

/**
 * An hour window inside a period, e.g. "between 6 and 9 PM".
 * Returned separately from the period so a follow-up can narrow an existing
 * period without restating it.
 */
export const resolveHourWindow = (question) => {
  const q = String(question || '').toLowerCase();

  // "6 pm to 9 pm", "6-9pm", "between 6 and 9 pm"
  const m = q.match(/\b(\d{1,2})\s*(?:am|pm)?\s*(?:to|-|–|and|until)\s*(\d{1,2})\s*(am|pm)\b/);
  if (m) {
    let start = parseInt(m[1], 10);
    let end = parseInt(m[2], 10);
    const meridiem = m[3];
    if (meridiem === 'pm') {
      if (end < 12) end += 12;
      // "6 to 9 pm" means 18:00–21:00, not 06:00–21:00.
      if (start < 12 && start <= end - 12) start += 12;
      else if (start < 12) start += 12;
    }
    if (start >= 0 && start < 24 && end > 0 && end <= 24 && end > start) {
      return { startHour: start, endHour: end, label: `${m[1]}–${m[2]}${meridiem}` };
    }
  }

  if (/\bevening\b/.test(q)) return { startHour: 18, endHour: 23, label: 'the evening' };
  if (/\bmorning\b/.test(q)) return { startHour: 6, endHour: 12, label: 'the morning' };
  if (/\bafternoon\b/.test(q)) return { startHour: 12, endHour: 18, label: 'the afternoon' };
  if (/\bnight\b/.test(q)) return { startHour: 21, endHour: 24, label: 'the night' };

  return null;
};

/**
 * Choose the comparison window for a period, and say which was chosen.
 *
 * A single day compares against the same weekday a week earlier rather than
 * simply the day before: a café's Tuesday looks nothing like its Saturday, so
 * "down on yesterday" is usually noise. Longer windows compare against the
 * immediately preceding window of equal length.
 */
export const comparisonFor = (period) => {
  const from = period._from;
  const to = period._to;
  const spanMs = to - from;

  if (spanMs <= DAY_MS * 1.5) {
    const prevFrom = addDays(from, -7);
    const prevTo = addDays(to, -7);
    return {
      ...range(prevFrom, prevTo, `the previous ${WEEKDAYS[from.getDay()]}`, 'day'),
      type: 'previous_same_weekday',
      // Stated in the answer so nobody has to guess the baseline.
      basis: `the previous ${WEEKDAYS[from.getDay()].replace(/^./, (c) => c.toUpperCase())}`
    };
  }

  const prevTo = new Date(from);
  const prevFrom = new Date(from.getTime() - spanMs);
  return {
    ...range(prevFrom, prevTo, 'the preceding period', 'day'),
    type: 'preceding_period',
    basis: 'the preceding period of the same length'
  };
};

/** A default window for questions that name no period. */
export const defaultPeriod = (options = {}) => {
  const now = options.now ? new Date(options.now) : new Date();
  const dayStartHour = Number.isInteger(options.dayStartHour) ? options.dayStartHour : 0;
  const today = dayStart(now, dayStartHour);
  return range(addDays(today, -7), addDays(today, 1), 'the last 7 days', 'day');
};

export const describeRange = (period) => period.label;
