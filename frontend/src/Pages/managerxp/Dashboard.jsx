import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, money, shortDate, relativeTime } from '../../lib/adminApi';
import { Page, Panel, Pill, Banner, Skeleton, Empty } from '../../components/admin/ui';

/*
 * The platform overview.
 *
 * Two halves, and the split is the point. The top is the state of the
 * business — counts that change slowly and are read to know how things are
 * going. The bottom is the queue — things somebody should act on today, each
 * linking to the record that raised it. A dashboard that mixes the two ends up
 * being neither, because the numbers make the alerts feel like decoration.
 */

const Stat = ({ label, value, sub, tone = 'default', to }) => {
  const tones = {
    default: 'text-white',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-red-300'
  };
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-500">{sub}</div>}
    </>
  );
  const className = 'rounded-xl border border-white/10 bg-white/[0.03] p-4';
  return to
    ? <Link to={to} className={`${className} block transition hover:border-red-500/40`}>{body}</Link>
    : <div className={className}>{body}</div>;
};

const AlertList = ({ title, description, items, empty, render }) => (
  <Panel title={title} description={description}>
    {items.length === 0
      ? <p className="text-xs text-neutral-600">{empty}</p>
      : <ul className="space-y-2">{items.map(render)}</ul>}
  </Panel>
);

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminApi.dashboard()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <Page title="Dashboard"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Dashboard"><Skeleton rows={3} height="h-24" /></Page>;

  const { stats: s, alerts, warn_threshold } = data;
  const totalAlerts = alerts.trials_expiring.length + alerts.usage_at_limit.length
    + alerts.installations_offline.length;

  return (
    <Page
      title="Dashboard"
      lede="Every CafeXP customer, subscription and installation on the platform."
    >
      {totalAlerts > 0 && (
        <Banner tone="warn">
          {totalAlerts} thing{totalAlerts === 1 ? '' : 's'} need attention — see below.
        </Banner>
      )}

      <div>
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Customers</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cafe owners" value={s.cafe_owners} to="/admin/cafe-owners" />
          <Stat label="Organizations" value={s.organizations}
                sub={`${s.organizations_active} active`} to="/admin/organizations" />
          <Stat label="Branches" value={s.branches} />
          <Stat
            label="Suspended"
            value={s.organizations_suspended}
            tone={s.organizations_suspended > 0 ? 'warn' : 'default'}
            sub={s.organizations_suspended > 0 ? 'not trading' : 'none'}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Revenue</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Monthly recurring"
            value={money(s.mrr)}
            /* Normalised from what customers actually pay, not what the
               package lists — a discounted customer would otherwise inflate it. */
            sub="from agreed prices, per month"
            tone={Number(s.mrr) > 0 ? 'good' : 'default'}
          />
          <Stat label="Active subscriptions" value={s.subscriptions_active} tone="good" />
          <Stat
            label="Trials"
            value={s.trials}
            sub={s.trials_expiring > 0 ? `${s.trials_expiring} ending this week` : 'none ending soon'}
            tone={s.trials_expiring > 0 ? 'warn' : 'default'}
          />
          <Stat
            label="Expired"
            value={s.subscriptions_expired}
            tone={s.subscriptions_expired > 0 ? 'bad' : 'default'}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Estate</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Gaming PCs" value={s.gaming_pcs} />
          <Stat label="Installations" value={s.installations} sub="CafeXP servers running" />
          <Stat label="Suspended subs" value={s.subscriptions_suspended} />
          <Stat label="Latest release"
                value={data.releases?.[0]?.version || '—'}
                sub={data.releases?.[0] ? `${data.releases[0].component} · ${data.releases[0].channel}` : 'none published'} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AlertList
          title="Trials ending"
          description="Within the next seven days."
          items={alerts.trials_expiring}
          empty="No trials ending this week."
          render={(t) => (
            <li key={t.organization_id}>
              <Link
                to={`/admin/organizations/${t.organization_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm transition hover:border-red-500/40"
              >
                <span className="truncate text-neutral-300">{t.name}</span>
                <Pill tone={t.days_left <= 1 ? 'bad' : t.days_left <= 3 ? 'warn' : 'info'}>
                  {t.days_left === 0 ? 'today' : `${t.days_left}d`}
                </Pill>
              </Link>
            </li>
          )}
        />

        <AlertList
          title="At or near a limit"
          description={`Customers using ${warn_threshold}% or more of their PC allowance.`}
          items={alerts.usage_at_limit}
          empty="Nobody is close to a limit."
          render={(u) => (
            <li key={u.organization_id}>
              <Link
                to={`/admin/organizations/${u.organization_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm transition hover:border-red-500/40"
              >
                <span className="truncate text-neutral-300">{u.name}</span>
                <Pill tone={u.used >= u.max ? 'bad' : 'warn'}>{u.used} / {u.max} PCs</Pill>
              </Link>
            </li>
          )}
        />

        <AlertList
          title="Installations not seen"
          description="No contact in over 24 hours."
          items={alerts.installations_offline}
          empty="Every installation has checked in."
          render={(i) => (
            <li key={i.installation_id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-neutral-300">{i.name || i.public_id}</span>
                <span className="block truncate text-[11px] text-neutral-600">{i.organization}</span>
              </span>
              <Pill tone="warn">{relativeTime(i.last_seen_at)}</Pill>
            </li>
          )}
        />

        <AlertList
          title="New this week"
          description="Customers who signed up in the last seven days."
          items={alerts.new_customers}
          empty="No new customers this week."
          render={(c) => (
            <li key={c.organization_id}>
              <Link
                to={`/admin/organizations/${c.organization_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm transition hover:border-red-500/40"
              >
                <span className="truncate text-neutral-300">{c.name}</span>
                <span className="shrink-0 text-[11px] text-neutral-600">{shortDate(c.created_at)}</span>
              </Link>
            </li>
          )}
        />
      </div>
    </Page>
  );
};

export default Dashboard;
