import React, { useEffect, useState } from 'react';
import { portalApi, money, shortDate } from '../../lib/portalApi';
import { Page, Card, Stat, Meter, Pill, Banner, Skeleton, Button } from '../../components/portal/ui';

/*
 * Subscription.
 *
 * Phase 1 has no purchasing — the plans below are informational, and saying so
 * plainly is better than a Buy button that opens nothing. What this page does
 * carry is the honest state of the trial and exactly what has been used
 * against it, which is what an owner comes here to check.
 */
const Subscription = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    portalApi.subscription()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Page title="Subscription"><Skeleton rows={3} height="h-28" /></Page>;
  if (error) return <Page title="Subscription"><Banner tone="bad">{error}</Banner></Page>;

  const { subscription: sub, usage, warning, features, plans } = data;
  /* TRIAL and ACTIVE both mean "working". PAST_DUE and GRACE_PERIOD are live
     too — a failed card starts a conversation, it does not shut the café. */
  const live = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'].includes(sub?.status);
  const expired = !live;

  const locked = features.filter((f) => !f.enabled);
  const included = features.filter((f) => f.enabled);
  const currentPlanId = sub?.plan_id;

  return (
    <Page
      title={sub?.is_trial ? 'Your trial' : 'Your subscription'}
      lede={
        sub?.is_trial
          ? 'Every CafeXP feature is switched on during the trial. Only the counts are capped.'
          : 'What your plan includes.'
      }
    >
      {warning && (
        <Banner tone={warning.level === 'expired' || warning.level === 'critical' ? 'bad'
          : warning.level === 'warning' ? 'warn' : 'info'}>
          {warning.message}
        </Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Plan"
          value={sub?.is_trial ? 'Full feature trial' : (sub?.plan_name || 'Subscription')}
          /* What they actually pay, not what the package lists. A discount is
             the whole reason those two numbers can differ. */
          sub={sub?.is_trial
            ? 'every feature included'
            : sub?.net_price != null
              ? `${money(sub.net_price, sub.currency)}${sub.billing_period ? ` / ${sub.billing_period}` : ''}`
              : sub?.type?.toLowerCase()}
        />
        <Stat
          label="Status"
          value={expired ? 'Expired' : 'Active'}
          tone={expired ? 'bad' : 'good'}
          sub={expired ? 'features are switched off' : 'everything working'}
        />
        <Stat label="Started" value={shortDate(sub?.started_at)} />
        <Stat
          label={expired ? 'Ended' : 'Renews'}
          value={shortDate(sub?.expires_at)}
          sub={sub?.days_remaining != null && !expired ? `${sub.days_remaining} days left` : undefined}
          tone={!expired && sub?.days_remaining != null && sub.days_remaining <= 7 ? 'warn' : 'default'}
        />
      </div>

      <Card title="What you are using" description="Counts against your plan limits.">
        <div className="grid gap-5 sm:grid-cols-3">
          <Meter used={usage.branches} max={sub?.limits.max_branches} label="Branches" />
          <Meter used={usage.pcs} max={sub?.limits.max_pcs} label="Gaming PCs" />
          <Meter used={usage.users} max={sub?.limits.max_users} label="Users" />
        </div>
      </Card>

      <Card
        title="What's included"
        description={expired
          ? 'Switched off until you subscribe. Your data is untouched and returns with them.'
          : locked.length === 0
            ? 'Every CafeXP feature is available to you right now.'
            : `${included.length} of ${features.length} features are on your package.`}
      >
        <div className="flex flex-wrap gap-2">
          {included.map((f) => (
            <Pill key={f.key} tone="good">✓ {f.label}</Pill>
          ))}
        </div>
      </Card>

      {/* Only shown when something actually is locked. A permanently-present
          "not included" card on a full plan is furniture the eye learns to
          skip, and it makes an Elite customer feel sold-to for no reason. */}
      {locked.length > 0 && !expired && (
        <Card
          title="Not on your package"
          description="Available on a higher package, or as an add-on. Nothing here is switched on until you ask for it."
        >
          <div className="flex flex-wrap gap-2">
            {locked.map((f) => (
              <Pill key={f.key} tone="mute">🔒 {f.label}</Pill>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="ghost">Upgrade plan</Button>
            <Button variant="ghost">Contact sales</Button>
          </div>
        </Card>
      )}

      {plans?.length > 0 && (
        <Card
          title="Packages"
          description={sub?.is_trial
            ? 'What is available when your trial ends. Purchasing is not open yet — talk to us and we will set it up.'
            : 'Other packages. Purchasing is not open yet — talk to us and we will move you.'}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = String(p.sub_id) === String(currentPlanId);
              /* The monthly figure is the one to lead with — it is what the
                 other packages are being compared on. */
              const monthly = (p.prices || []).find((x) => x.billing_period === 'monthly');
              const headline = monthly ? monthly.price : p.price;
              return (
                <div
                  key={p.sub_id}
                  className={`rounded-xl border p-4 ${
                    isCurrent ? 'border-red-500/50 bg-red-500/5' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    {isCurrent && <Pill tone="bad">current</Pill>}
                  </div>
                  <div className="mt-1 text-2xl font-bold text-white">
                    {Number(headline) > 0 ? money(headline, p.currency) : '—'}
                    {Number(headline) > 0 && (
                      <span className="text-sm font-normal text-neutral-500">/month</span>
                    )}
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-neutral-400">
                    <li>{p.max_pcs} gaming PC{p.max_pcs === 1 ? '' : 's'}</li>
                    <li>{p.max_branches} branch{p.max_branches === 1 ? '' : 'es'}</li>
                    {p.max_users && <li>{p.max_users} staff accounts</li>}
                    {p.description && <li className="pt-1 text-neutral-500">{p.description}</li>}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="ghost">Contact sales</Button>
          </div>
        </Card>
      )}
    </Page>
  );
};

export default Subscription;
