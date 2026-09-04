import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi, adminAuth, money, shortDate, relativeTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button
} from '../../components/admin/ui';

/*
 * One customer, in full.
 *
 * The Features tab is the reason this page exists. When a customer says "I
 * can't see Inventory", the question is which layer switched it off — the
 * package, an override, an add-on, or an expired subscription — and every
 * other way of answering it involves reading four tables by hand. Section 49
 * asks for that as a table; this is it, with the answer editable in place.
 */

const TABS = ['Overview', 'Features', 'Branches', 'Users', 'Installations'];

const Meter = ({ label, used, max }) => {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const tone = !max ? 'bg-neutral-700'
    : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-neutral-400">{label}</span>
        {/* An explicit separator, not just a margin. "1 / 3" followed by "33%"
            with four pixels between them reads as "1 / 333%". */}
        <span className="tabular-nums text-neutral-300">
          {used}{max ? ` / ${max}` : ''}
          {max ? <span className="text-neutral-600"> · {pct}%</span> : null}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

/* The three-state control the matrix needs. An override is not a checkbox:
   "follow the package" is a distinct third answer from on and off, and
   collapsing it into a checkbox makes it impossible to remove an override
   once set. */
const OverrideControl = ({ value, disabled, onChange }) => {
  const options = [
    { v: true, label: 'On' },
    { v: null, label: 'Package' },
    { v: false, label: 'Off' }
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
              active
                ? o.v === true ? 'bg-emerald-500/20 text-emerald-300'
                  : o.v === false ? 'bg-red-500/20 text-red-300'
                  : 'bg-neutral-800 text-neutral-300'
                : 'text-neutral-600 hover:text-neutral-300'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const OrganizationDetail = () => {
  const { id } = useParams();
  const [tab, setTab] = useState('Overview');
  const [data, setData] = useState(null);
  const [ent, setEnt] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const mayEdit = adminAuth.can('subscriptions.edit');
  const maySuspend = adminAuth.can('organizations.suspend');

  const load = useCallback(() => {
    Promise.all([adminApi.organization(id), adminApi.entitlements(id)])
      .then(([d, e]) => { setData(d); setEnt(e); setError(null); })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setOverride = async (featureKey, enabled) => {
    setBusyKey(featureKey);
    setNotice(null);
    try {
      await adminApi.setOverride(id, featureKey, {
        enabled,
        note: enabled === null ? null : 'Set from ManagerXP'
      });
      const fresh = await adminApi.entitlements(id);
      setEnt(fresh);
      setNotice({ tone: 'good', text: `${featureKey} updated for this customer. The package is unchanged.` });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSuspend = async () => {
    const suspended = data.organization.status === 'SUSPENDED';
    let reason = null;
    if (!suspended) {
      reason = window.prompt(
        `Suspend ${data.organization.name}?\n\n` +
        'Every CafeXP feature stops working for this customer immediately. ' +
        'Nothing is deleted.\n\nWhy are you suspending them?'
      );
      if (!reason || !reason.trim()) return;
    } else if (!window.confirm(`Resume ${data.organization.name}? Their features come back on immediately.`)) {
      return;
    }

    try {
      await adminApi.setOrganizationStatus(id, suspended ? 'ACTIVE' : 'SUSPENDED', reason?.trim());
      load();
      setNotice({ tone: 'good', text: suspended ? 'Customer resumed' : 'Customer suspended' });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    }
  };

  if (error) return <Page title="Customer"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Customer"><Skeleton rows={3} height="h-24" /></Page>;

  const { organization: org, subscription: sub, usage, owners, branches, installations } = data;
  const suspended = org.status === 'SUSPENDED';

  return (
    <Page
      title={org.name}
      lede={[org.city, org.country].filter(Boolean).join(', ') || undefined}
      actions={maySuspend && (
        <Button variant={suspended ? 'good' : 'danger'} onClick={toggleSuspend}>
          {suspended ? 'Resume customer' : 'Suspend customer'}
        </Button>
      )}
    >
      {suspended && (
        <Banner tone="bad">
          This customer is suspended. Every CafeXP feature is switched off for them; their data is untouched.
        </Banner>
      )}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="!p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Package</div>
          <div className="mt-1 text-lg font-semibold text-white">{sub?.plan_name || '—'}</div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            {sub?.net_price != null
              ? `${money(sub.net_price, sub.currency)}${sub.billing_period ? ` / ${sub.billing_period}` : ''}`
              : sub?.is_trial ? 'free trial' : '—'}
          </div>
        </Panel>
        <Panel className="!p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Subscription</div>
          <div className="mt-1.5">
            <Pill tone={
              sub?.status === 'ACTIVE' || sub?.status === 'TRIAL' ? 'good'
                : sub?.status === 'SUSPENDED' || sub?.status === 'EXPIRED' ? 'bad' : 'mute'
            }>
              {String(sub?.status || 'none').toLowerCase()}
            </Pill>
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-500">
            {sub?.days_remaining != null && sub.days_remaining > 0
              ? `${sub.days_remaining} days left`
              : sub?.expires_at ? `ended ${shortDate(sub.expires_at)}` : '—'}
          </div>
        </Panel>
        <Panel className="!p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Started</div>
          <div className="mt-1 text-lg font-semibold text-white">{shortDate(sub?.started_at)}</div>
          <div className="mt-0.5 text-[11px] text-neutral-500">renews {shortDate(sub?.expires_at)}</div>
        </Panel>
        <Panel className="!p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Discount</div>
          <div className="mt-1 text-lg font-semibold text-white">
            {sub?.discount_type && sub.discount_type !== 'NO_DISCOUNT'
              ? (sub.discount_type === 'PERCENTAGE' ? `${sub.discount_value}%` : money(sub.discount_value, sub.currency))
              : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            {sub?.list_price != null ? `list ${money(sub.list_price, sub.currency)}` : 'no discount'}
          </div>
        </Panel>
      </div>

      <Panel title="Usage" description="Against the limits on this customer's subscription, including any add-ons.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Meter label="Branches" used={usage.branches} max={sub?.limits.max_branches} />
          <Meter label="Gaming PCs" used={usage.pcs} max={sub?.limits.max_pcs} />
          <Meter label="Users" used={usage.users} max={sub?.limits.max_users} />
          <Meter label="Installations" used={usage.installations} max={sub?.limits.max_installations} />
        </div>
      </Panel>

      <div className="flex flex-wrap gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t
                ? 'border-red-500 text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <Panel title="Business details">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Email', org.email], ['Phone', org.phone], ['Tax number', org.tax_number],
              ['Address', org.address], ['City', org.city], ['State', org.state],
              ['Country', org.country], ['Currency', org.currency], ['Timezone', org.timezone],
              ['Customer since', shortDate(org.created_at)]
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{k}</dt>
                <dd className="mt-0.5 text-sm text-neutral-300">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      {tab === 'Features' && ent && (
        <Panel
          title="Effective features"
          description={mayEdit
            ? 'What the package grants, what has been overridden for this customer, and what they therefore get. Changing an override here never changes the package.'
            : 'What the package grants and what this customer therefore gets. Your role cannot change these.'}
        >
          <Table columns={['Feature', 'Package', 'Override', 'Add-on', 'Effective']}>
            {ent.matrix.map((f) => (
              <tr key={f.feature_key} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2">
                  <div className="text-sm text-neutral-200">{f.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-600">
                    {f.module_label}{f.is_core ? ' · core' : ''}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {/* null means the package has no opinion — a trial, or a
                      subscription with no package attached. Not the same as OFF. */}
                  {f.plan === null
                    ? <span className="text-xs text-neutral-600">all</span>
                    : <Pill tone={f.plan ? 'good' : 'mute'}>{f.plan ? 'on' : 'off'}</Pill>}
                </td>
                <td className="px-4 py-2">
                  <OverrideControl
                    value={f.override}
                    disabled={!mayEdit || f.is_core || busyKey === f.feature_key}
                    onChange={(v) => setOverride(f.feature_key, v)}
                  />
                </td>
                <td className="px-4 py-2">
                  {f.addon
                    ? <Pill tone="info">{f.addon}</Pill>
                    : <span className="text-xs text-neutral-700">—</span>}
                </td>
                <td className="px-4 py-2">
                  <Pill tone={f.effective ? 'good' : 'bad'}>{f.effective ? 'ON' : 'OFF'}</Pill>
                  {!f.effective && f.reason && (
                    <div className="mt-0.5 text-[10px] text-neutral-600">{f.reason.replace(/_/g, ' ')}</div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {tab === 'Branches' && (
        branches.length === 0
          ? <Empty title="No branches" text="This customer has not created a location yet." />
          : (
            <Table columns={['Branch', 'Code', 'City', 'Gaming PCs', 'Installations', 'Status']}>
              {branches.map((b) => (
                <tr key={b.branch_id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-medium text-white">{b.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{b.code || '—'}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{b.city || '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-300">{b.pcs}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-300">{b.installations}</td>
                  <td className="px-4 py-2.5">
                    <Pill tone={b.status === 'ACTIVE' ? 'good' : 'mute'}>{String(b.status).toLowerCase()}</Pill>
                  </td>
                </tr>
              ))}
            </Table>
          )
      )}

      {tab === 'Users' && (
        <Table columns={['Name', 'Email', 'Phone', 'Role', 'Status', 'Joined']}>
          {owners.map((u) => (
            <tr key={u.id} className="hover:bg-white/[0.03]">
              <td className="px-4 py-2.5 font-medium text-white">{u.name}</td>
              <td className="px-4 py-2.5 text-neutral-400">{u.email}</td>
              <td className="px-4 py-2.5 text-neutral-400">{u.phone_number || '—'}</td>
              <td className="px-4 py-2.5">
                <Pill tone={u.role === 'OWNER' ? 'bad' : 'info'}>{u.role.replace('_', ' ').toLowerCase()}</Pill>
              </td>
              <td className="px-4 py-2.5">
                <Pill tone={u.status === 'ACTIVE' ? 'good' : 'warn'}>{String(u.status).toLowerCase()}</Pill>
              </td>
              <td className="px-4 py-2.5 text-[11px] text-neutral-500">{shortDate(u.accepted_at)}</td>
            </tr>
          ))}
        </Table>
      )}

      {tab === 'Installations' && (
        installations.length === 0
          ? <Empty title="Nothing installed" text="This customer has not registered a CafeXP server yet." />
          : (
            <Table columns={['Installation', 'Branch', 'Version', 'Devices', 'Last seen', 'Status']}>
              {installations.map((i) => (
                <tr key={i.installation_id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{i.name || 'Unnamed'}</div>
                    <div className="font-mono text-[10px] text-neutral-600">{i.public_id}</div>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400">{i.branch_name || '—'}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{i.version || '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-300">{i.device_count}</td>
                  <td className="px-4 py-2.5 text-[11px] text-neutral-500">{relativeTime(i.last_seen_at)}</td>
                  <td className="px-4 py-2.5">
                    <Pill tone={i.status === 'ACTIVE' ? 'good' : 'bad'}>{String(i.status).toLowerCase()}</Pill>
                  </td>
                </tr>
              ))}
            </Table>
          )
      )}
    </Page>
  );
};

export default OrganizationDetail;
