import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalApi, money, relativeTime } from '../../lib/portalApi';
import { usePortal } from '../../components/portal/PortalShell';
import { Page, Card, Stat, Meter, Button, Skeleton, Banner, StatusDot, Empty } from '../../components/portal/ui';

/*
 * The customer dashboard.
 *
 * Two audiences in one page: someone who set up ten minutes ago and needs to
 * be told what to do next, and someone six months in who wants today's
 * takings. The setup checklist leads while it is incomplete and disappears
 * once it is done, so the page grows up with the account rather than carrying
 * a permanently-ticked list nobody reads.
 */

const STEPS = [
  { key: 'account_created', label: 'Account created' },
  { key: 'business_created', label: 'Business created' },
  { key: 'branch_created', label: 'Branch created', to: '/dashboard/branches' },
  { key: 'installed', label: 'Install CafeXP', to: '/dashboard/downloads' },
  { key: 'connected', label: 'Connect installation', to: '/dashboard/installations' },
  { key: 'pcs_registered', label: 'Register PCs', to: '/dashboard/devices' },
  { key: 'staff_invited', label: 'Invite staff', to: '/dashboard/users' },
  { key: 'first_session', label: 'Start first session' }
];

const Dashboard = () => {
  const { branchId } = usePortal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    portalApi.dashboard()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, branchId]);

  // The shell changes branch without a route change, so the page listens.
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('cxp:branch-changed', onChange);
    return () => window.removeEventListener('cxp:branch-changed', onChange);
  }, [load]);

  if (loading) return <Page title="Dashboard"><Skeleton rows={3} height="h-28" /></Page>;
  if (error) return <Page title="Dashboard"><Banner tone="bad">{error}</Banner></Page>;

  const { organization, subscription, usage, setup, today, installations, branches } = data;
  const done = STEPS.filter((s) => setup[s.key]).length;
  const setupComplete = done === STEPS.length;
  const multiBranch = branches.length > 1;

  return (
    <Page
      title={`Welcome back${data.organization.name ? `, ${organization.name}` : ''}`}
      lede={
        subscription?.is_trial && subscription.status === 'ACTIVE'
          ? `Your trial runs for another ${subscription.days_remaining} days, with every feature switched on.`
          : 'Your business at a glance.'
      }
    >
      {/* ── setup, while it matters ── */}
      {!setupComplete && (
        <Card
          title="Finish setting up"
          description={`${done} of ${STEPS.length} done — the rest takes a few minutes.`}
        >
          <ol className="space-y-2">
            {STEPS.map((step) => {
              const complete = !!setup[step.key];
              const isNext = !complete && STEPS.findIndex((s) => !setup[s.key]) === STEPS.indexOf(step);
              return (
                <li
                  key={step.key}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                    isNext ? 'bg-red-500/5 ring-1 ring-red-500/20' : ''
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                      complete ? 'bg-emerald-500/20 text-emerald-300' : 'bg-neutral-800 text-neutral-600'
                    }`}
                  >
                    {complete ? '✓' : ''}
                  </span>
                  <span className={`flex-1 text-sm ${complete ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}>
                    {step.label}
                  </span>
                  {/* Only the next incomplete step gets a button. Five buttons
                      at once is a menu, not a next action. */}
                  {isNext && step.to && (
                    <Link to={step.to}><Button size="sm">Do this</Button></Link>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {/* ── today ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Today's revenue"
          value={money(today.revenue, organization.currency)}
          sub={`${today.bills} bill${today.bills === 1 ? '' : 's'}`}
        />
        <Stat
          label="Active sessions"
          value={today.active_sessions}
          sub={today.active_sessions > 0 ? 'playing now' : 'nobody playing'}
          tone={today.active_sessions > 0 ? 'good' : 'default'}
        />
        <Stat
          label={multiBranch ? 'Branches' : 'Gaming PCs'}
          value={multiBranch ? usage.branches : usage.pcs}
          sub={multiBranch ? `${usage.pcs} PCs across them` : 'registered'}
        />
        <Stat
          label="Team"
          value={usage.users}
          sub={usage.users === 1 ? 'just you' : 'people with access'}
        />
      </div>

      {/* ── what the plan allows ── */}
      <Card title="Your plan" description={
        subscription?.is_trial
          ? 'Trial limits. Every feature is available; only the counts are capped.'
          : 'What your subscription includes.'
      }>
        <div className="grid gap-5 sm:grid-cols-3">
          <Meter used={usage.branches} max={subscription?.limits.max_branches} label="Branches" />
          <Meter used={usage.pcs} max={subscription?.limits.max_pcs} label="Gaming PCs" />
          <Meter used={usage.users} max={subscription?.limits.max_users} label="Users" />
        </div>
      </Card>

      {/* ── installations ── */}
      <Card
        title="CafeXP installations"
        description="The server running at each branch."
        actions={<Link to="/dashboard/installations"><Button variant="ghost" size="sm">Manage</Button></Link>}
      >
        {installations.length === 0 ? (
          <Empty
            title="CafeXP is not installed yet"
            text="Download CafeXP Server, sign in with this account and pick a branch. No licence key needed."
            action={<Link to="/dashboard/downloads"><Button>Download CafeXP</Button></Link>}
          />
        ) : (
          <ul className="space-y-2">
            {installations.map((i) => (
              <li key={i.installation_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">{i.name || i.public_id}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-neutral-600">{i.public_id}</div>
                </div>
                <div className="flex items-center gap-4">
                  {i.version && <span className="text-xs text-neutral-500">v{i.version}</span>}
                  <StatusDot
                    online={i.online}
                    label={i.online ? 'Online' : `Last seen ${relativeTime(i.last_seen_at)}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
};

export default Dashboard;
