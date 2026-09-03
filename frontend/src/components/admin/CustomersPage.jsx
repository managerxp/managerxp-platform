import React, { useCallback, useEffect, useState } from 'react';
import { platformApi, formatMoney, formatDate } from '../../lib/platformApi';
import NewCustomerForm from './NewCustomerForm';
import { Button } from './ui';

/*
 * Every café running the software, and the levers over each one.
 *
 * The two things a vendor actually needs at a glance are here rather than a
 * click away: how long until the subscription lapses, and whether the install
 * is running more stations than it has paid for. Both are the reasons anyone
 * opens this page.
 */

const Pill = ({ tone, children }) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
    mute: 'bg-neutral-800 text-neutral-400 border-neutral-700'
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
};

const CustomersPage = ({ onCreateLink }) => {
  const [cafes, setCafes] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback((term) => {
    setLoading(true);
    platformApi.cafes(term)
      .then((d) => { setCafes(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(''); }, [load]);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const suspend = async (cafe) => {
    const reason = window.prompt(
      `Suspend ${cafe.name}?\n\nTheir console stops working until this is lifted.\nGive a reason — the customer will be told this:`,
      'Payment overdue'
    );
    // Cancelled, or cleared to empty: both mean "don't".
    if (!reason || !reason.trim()) return;

    setBusyId(cafe.cafe_id);
    try {
      await platformApi.setCafeStatus(cafe.cafe_id, false, reason.trim());
      load(search.trim());
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const reactivate = async (cafe) => {
    setBusyId(cafe.cafe_id);
    try {
      await platformApi.setCafeStatus(cafe.cafe_id, true, null);
      load(search.trim());
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Customers</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Every café install, its licence, and what it is using.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search café, owner or email…"
            className="w-full max-w-xs rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-red-500/50"
          />
          {!adding && (
            <Button type="button" onClick={() => setAdding(true)}>New customer</Button>
          )}
        </div>
      </header>

      {adding && (
        <NewCustomerForm
          onDone={() => load(search.trim())}
          onCancel={() => setAdding(false)}
        />
      )}

      {error && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40" />
          ))}
        </div>
      )}

      {!loading && cafes.length === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center">
          <p className="text-sm text-neutral-400">
            {search ? 'No customer matches that search.' : 'No cafés have signed up yet.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {cafes.map((cafe) => {
          const sub = cafe.subscription;
          const days = sub?.days_remaining;

          // The subscription's state in one word, chosen once so the pill and
          // the copy below can never disagree.
          const subTone = !sub ? 'mute'
            : days == null ? 'mute'
            : days < 0 ? 'bad'
            : days <= 14 ? 'warn'
            : 'good';

          const subLabel = !sub ? 'No subscription'
            : days < 0 ? `Lapsed ${Math.abs(days)}d ago`
            : `${days}d remaining`;

          return (
            <article
              key={cafe.cafe_id}
              className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{cafe.name}</h3>
                    {cafe.is_active
                      ? <Pill tone="good">Active</Pill>
                      : <Pill tone="bad">Suspended</Pill>}
                    <Pill tone={subTone}>{subLabel}</Pill>
                    {cafe.usage.over_licence && <Pill tone="warn">Over licence</Pill>}
                    {sub?.is_freetrial && <Pill tone="mute">Trial</Pill>}
                  </div>
                  <p className="mt-1 text-sm text-neutral-400">
                    {cafe.owner
                      ? <>{cafe.owner.name} · {cafe.owner.email}{cafe.owner.phone ? ` · ${cafe.owner.phone}` : ''}</>
                      : 'No owner account linked'}
                  </p>
                  {!cafe.is_active && cafe.suspended_reason && (
                    <p className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
                      Suspended {formatDate(cafe.suspended_at)} — {cafe.suspended_reason}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-lg font-bold text-white">{formatMoney(cafe.paid_lifetime)}</div>
                  <div className="text-[11px] uppercase tracking-wider text-neutral-500">paid to date</div>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-neutral-800 pt-4 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Plan</dt>
                  <dd className="mt-0.5 text-sm text-white">
                    {sub?.plan_name || '—'}
                    {sub?.price > 0 && (
                      <span className="text-neutral-500"> · {formatMoney(sub.price, sub.currency)}/{sub.billing_period}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Renews</dt>
                  <dd className="mt-0.5 text-sm text-white">{formatDate(sub?.end_date)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Stations</dt>
                  <dd className={`mt-0.5 text-sm ${cafe.usage.over_licence ? 'text-amber-300' : 'text-white'}`}>
                    {cafe.usage.stations}
                    {sub?.licensed_pcs != null && <span className="text-neutral-500"> / {sub.licensed_pcs} licensed</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Last seen</dt>
                  <dd className="mt-0.5 text-sm text-white">
                    {cafe.last_seen ? formatDate(cafe.last_seen) : <span className="text-neutral-500">never reported</span>}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onCreateLink?.(cafe)}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-400"
                >
                  Send payment link
                </button>
                {cafe.is_active ? (
                  <button
                    type="button"
                    disabled={busyId === cafe.cafe_id}
                    onClick={() => suspend(cafe)}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-300 transition hover:border-red-500/50 hover:text-white disabled:opacity-50"
                  >
                    {busyId === cafe.cafe_id ? 'Working…' : 'Suspend install'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === cafe.cafe_id}
                    onClick={() => reactivate(cafe)}
                    className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {busyId === cafe.cafe_id ? 'Working…' : 'Reactivate'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default CustomersPage;
