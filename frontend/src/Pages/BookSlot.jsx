import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, CalendarCheck } from 'lucide-react';
import AuthLayout, { authFieldClasses, authLabelClasses, ConsentCheckbox } from '../components/AuthLayout';
import DatePicker from '../components/ui/DatePicker';
import TimePicker from '../components/ui/TimePicker';

/*
 * The public booking page — managerxp.com/book/:slug.
 *
 * No account, no session: a café hands this link to its customers, and the
 * slug in the URL is the only thing that says which café. Everything here
 * reads and writes through /api/public/cafes/:slug/*, which resolves the
 * café from that slug server-side rather than trusting anything the page
 * sends — this page could not name a different café's stations if it tried.
 *
 * Shares AuthLayout with /login and /signup rather than its own shell, so a
 * customer arriving from a café's link sees the same ManagerXP branding
 * they'd recognise from anywhere else on the site.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL;

const DURATIONS = [
  [30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours']
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const nextHalfHour = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d.toTimeString().slice(0, 5);
};

const BookSlot = () => {
  const { slug } = useParams();
  const [cafe, setCafe] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState('');
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(nextHalfHour());
  const [duration, setDuration] = useState(60);
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);

  const [avail, setAvail] = useState(null);
  const [checking, setChecking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState(null);
  const [booked, setBooked] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/public/cafes/${slug}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || 'This link could not be opened');
        if (cancelled) return;
        setCafe(body.data);
        if (body.data.categories?.length) setCategory(body.data.categories[0].category);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const window_ = useMemo(() => {
    if (!date || !time) return null;
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + Number(duration) * 60000);
    return { start, end };
  }, [date, time, duration]);

  const checkAvailability = useCallback(async () => {
    if (!category || !window_) return;
    setChecking(true);
    setAvail(null);
    try {
      const params = new URLSearchParams({
        category, start_time: window_.start.toISOString(), end_time: window_.end.toISOString()
      });
      const res = await fetch(`${API_BASE_URL}/api/public/cafes/${slug}/availability?${params}`);
      const body = await res.json();
      if (res.ok) setAvail(body.data);
    } catch {
      // Silent — the Book button's own error handles a real failure.
    } finally {
      setChecking(false);
    }
  }, [slug, category, window_]);

  useEffect(() => { checkAvailability(); }, [checkAvailability]);

  const book = async (e) => {
    e.preventDefault();
    if (!window_) return;
    setBooking(true);
    setBookError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/cafes/${slug}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category, start_time: window_.start.toISOString(), end_time: window_.end.toISOString(),
          guest_name: name, guest_phone: phone || null, notes: notes || null, quantity
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not book that slot');
      // A single booking (the common case) comes back as one object; a group
      // booking as an array — normalised to an array either way so the
      // confirmation screen only has one shape to render.
      setBooked(Array.isArray(body.data) ? body.data : [body.data]);
    } catch (e) {
      setBookError(e.message);
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <AuthLayout title="Book a station" subtitle="Loading…">
        <div className="mt-6 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-red-500" />
        </div>
      </AuthLayout>
    );
  }

  if (loadError) {
    return (
      <AuthLayout title="Link unavailable" subtitle={loadError}>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Ask the café for a fresh booking link.
        </div>
      </AuthLayout>
    );
  }

  if (booked) {
    const first = booked[0];
    const when = new Date(first.start_time).toLocaleString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    return (
      <AuthLayout title="Booked!" subtitle="See you then.">
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {booked.length > 1
              ? <>{booked.length}× {first.category} at {cafe.name}, {when}.</>
              : <>{first.category} at {cafe.name}, {when}.</>}
          </div>
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          {booked.length > 1
            ? `Show up a few minutes early — the café will have all ${booked.length} stations ready together.`
            : 'Show up a few minutes early — the café will have your station ready.'}
        </p>
      </AuthLayout>
    );
  }

  const hoursNote = cafe.opening_time && cafe.closing_time
    ? `Open ${cafe.opening_time}–${cafe.closing_time}. Pick a time, and it's held for you.`
    : "Pick a time, and it's held for you.";

  return (
    <AuthLayout title={`Book a station at ${cafe.name}`} subtitle={hoursNote}>
      {!cafe.categories?.length ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          This café hasn't set up any bookable stations yet.
        </div>
      ) : (
        <form onSubmit={book} className="mt-5 space-y-4">
          <div>
            <label className={authLabelClasses}>Station type</label>
            <select className={authFieldClasses} value={category} onChange={(e) => setCategory(e.target.value)}>
              {cafe.categories.map((c) => (
                <option key={c.category} value={c.category}>{c.category}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={authLabelClasses}>Date</label>
              <DatePicker id="book-date" value={date} min={todayISO()} onChange={setDate} />
            </div>
            <div>
              <label className={authLabelClasses}>Time</label>
              <TimePicker
                id="book-time" value={time} onChange={setTime}
                min={cafe.opening_time && cafe.opening_time < cafe.closing_time ? cafe.opening_time : undefined}
                max={cafe.closing_time && cafe.opening_time < cafe.closing_time ? cafe.closing_time : undefined}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={authLabelClasses}>Duration</label>
              <select className={authFieldClasses} value={duration} onChange={(e) => setDuration(e.target.value)}>
                {DURATIONS.map(([mins, label]) => (
                  <option key={mins} value={mins}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={authLabelClasses}>Stations (group size)</label>
              <select
                className={authFieldClasses} value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n === 1 ? '1 (just me)' : `${n} — booked together`}</option>
                ))}
              </select>
            </div>
          </div>

          {(checking || avail) && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm">
              {checking ? (
                <span className="text-neutral-500">Checking availability…</span>
              ) : (() => {
                const free = avail.total - avail.booked;
                if (!avail.available) {
                  return (
                    <span className="text-red-300">
                      {avail.message || `No ${avail.category} stations free at that time.`}
                    </span>
                  );
                }
                if (free < quantity) {
                  return (
                    <span className="text-red-300">
                      Only {free} of {avail.total} {avail.category} stations free then — not enough for a group of {quantity}.
                    </span>
                  );
                }
                return (
                  <span className="text-emerald-300">
                    {free} of {avail.total} {avail.category} station{avail.total === 1 ? '' : 's'} free then.
                  </span>
                );
              })()}
            </div>
          )}

          <div>
            <label className={authLabelClasses}>Your name</label>
            <input className={authFieldClasses} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Full name" required />
          </div>
          <div>
            <label className={authLabelClasses}>Phone (optional)</label>
            <input className={authFieldClasses} value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="For the café to reach you" />
          </div>
          <div>
            <label className={authLabelClasses}>Notes (optional)</label>
            <input className={authFieldClasses} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the café should know" />
          </div>

          <ConsentCheckbox id="book-consent" checked={consent} onChange={setConsent}>
            I agree to the{' '}
            <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer"
                  className="text-white underline underline-offset-4 hover:text-red-400">
              Privacy Policy
            </Link>, and consent to this café collecting and processing my personal data to hold this booking.
          </ConsentCheckbox>

          {bookError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {bookError}
            </div>
          )}

          <button
            type="submit"
            disabled={booking || !name.trim() || !consent || (avail ? !avail.available || (avail.total - avail.booked) < quantity : false)}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                       bg-gradient-to-br from-red-700 to-red-900 border border-white/10
                       py-2.5 text-sm font-semibold text-white
                       shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                       transition-all duration-300 active:scale-[0.99]
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {booking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Booking…
              </>
            ) : (
              <>
                <CalendarCheck className="w-4 h-4" />
                Book this slot
              </>
            )}
          </button>
        </form>
      )}
    </AuthLayout>
  );
};

export default BookSlot;
