import React, { useEffect, useState } from 'react';
import { platformApi, formatMoney } from '../../lib/platformApi';

/*
 * The platform overview.
 *
 * Deliberately answers "active users" three ways rather than picking one.
 * The phrase means different things depending on who is asking — accounts on
 * the platform, staff logging into consoles, or the end customers those cafés
 * serve — and a single unlabelled number would be read as whichever the
 * reader had in mind.
 */

const Stat = ({ label, value, sub, tone = 'default' }) => {
  const tones = {
    default: 'border-neutral-800',
    good: 'border-emerald-500/30',
    warn: 'border-amber-500/35',
    bad: 'border-red-500/35'
  };
  return (
    <div className={`rounded-xl border ${tones[tone]} bg-neutral-900/60 p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
};

const OverviewPage = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    platformApi.overview()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200">
        {error}
      </div>
    );
  }

  const { cafes, users, subscriptions, mrr, revenue, payment_links: links } = data;

  return (
    <div className="space-y-7">
      <header>
        <h2 className="text-lg font-semibold text-white">Overview</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Every café running CafeXP, and what they are worth.
        </p>
      </header>

      {/* ---- money ---- */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Revenue</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="MRR"
            value={formatMoney(mrr)}
            sub="from live subscriptions"
            tone={mrr > 0 ? 'good' : 'default'}
          />
          <Stat label="This month" value={formatMoney(revenue.this_month)} sub="payments received" />
          <Stat label="Last 30 days" value={formatMoney(revenue.last_30d)} />
          <Stat label="Lifetime" value={formatMoney(revenue.lifetime)} />
        </div>
      </section>

      {/* ---- customers ---- */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Customers</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cafés" value={cafes.total} sub={`${cafes.active} active`} />
          <Stat
            label="Suspended"
            value={cafes.suspended}
            sub={cafes.suspended ? 'consoles locked' : 'none'}
            tone={cafes.suspended > 0 ? 'bad' : 'default'}
          />
          <Stat
            label="Active subscriptions"
            value={subscriptions.active}
            sub={`${subscriptions.expired} lapsed`}
            tone={subscriptions.active > 0 ? 'good' : 'default'}
          />
          <Stat
            label="Expiring in 14 days"
            value={subscriptions.expiring_soon}
            sub={subscriptions.expiring_soon ? 'chase these' : 'nothing due'}
            tone={subscriptions.expiring_soon > 0 ? 'warn' : 'default'}
          />
        </div>
      </section>

      {/* ---- usage ----
          Three readings of "active users", each labelled, because the term is
          ambiguous and an unlabelled number invites the wrong one. */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Users &amp; usage
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Platform accounts" value={users.accounts} sub="café owners signed up" />
          <Stat label="Café staff" value={users.active_staff} sub="active logins across all cafés" />
          <Stat label="End customers" value={users.end_customers} sub="players in those cafés" />
          <Stat label="Live stations" value={users.active_stations} sub="PCs under licence" />
        </div>
      </section>

      {/* ---- links ---- */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Payment links
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Awaiting payment"
            value={links.open}
            sub={`${formatMoney(links.open_value)} outstanding`}
            tone={links.open > 0 ? 'warn' : 'default'}
          />
          <Stat label="Paid (30 days)" value={links.paid_30d} tone={links.paid_30d > 0 ? 'good' : 'default'} />
        </div>
      </section>
    </div>
  );
};

export default OverviewPage;
