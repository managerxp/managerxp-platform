import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { adminApi, adminAuth, money, shortDate } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select
} from '../../components/admin/ui';

const STATUS_TONE = {
  TRIAL: 'info', ACTIVE: 'good', PAST_DUE: 'warn', GRACE_PERIOD: 'warn',
  EXPIRED: 'bad', SUSPENDED: 'bad', CANCELLED: 'mute'
};

/* ==========================================================================
   THE LIST
   ========================================================================== */
export const SubscriptionList = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    adminApi.subscriptions({ q: query, status, size: 100 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [query, status]);

  return (
    <Page
      title="Subscriptions"
      lede="What each customer actually agreed to. Sorted by what expires first, because that is the list worth working through."
    >
      {error && <Banner tone="bad">{error}</Banner>}

      <Panel>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}
              className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Search" id="sb-q">
              <Input id="sb-q" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Customer or package" />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Status" id="sb-status">
              <Select id="sb-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {Object.keys(STATUS_TONE).map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Panel>

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0 ? <Empty title="No subscriptions" text="They appear as customers sign up." />
        : (
          <>
            <Table columns={['Customer', 'Package', 'Cycle', 'List', 'Discount', 'Pays', 'Renews', 'Status', '']}>
              {data.items.map((s) => {
                const expiringSoon = s.days_left != null && s.days_left <= 7
                  && ['TRIAL', 'ACTIVE'].includes(s.status);
                return (
                  <tr key={s.subscription_id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5">
                      <Link to={`/admin/organizations/${s.organization_id}`}
                            className="font-medium text-white transition hover:text-red-300">
                        {s.organization_name}
                      </Link>
                      <div className="text-[10px] text-neutral-600">#{s.subscription_id}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-300">
                      {s.plan_name || '—'}
                      {s.addons > 0 && <Pill tone="info">+{s.addons}</Pill>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-neutral-500">{s.billing_period || '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums text-neutral-500">
                      {s.list_price != null ? money(s.list_price, s.currency) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-neutral-400">
                      {s.discount_type && s.discount_type !== 'NO_DISCOUNT'
                        ? (s.discount_type === 'PERCENTAGE'
                            ? `${s.discount_value}%`
                            : money(s.discount_value, s.currency))
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-medium tabular-nums text-white">
                      {s.net_price != null ? money(s.net_price, s.currency) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-[11px] text-neutral-400">{shortDate(s.trial_ends_at || s.end_date)}</div>
                      {expiringSoon && (
                        <Pill tone={s.days_left <= 1 ? 'bad' : 'warn'}>
                          {s.days_left === 0 ? 'today' : `${s.days_left}d`}
                        </Pill>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill tone={STATUS_TONE[s.status] || 'mute'}>
                        {String(s.status).replace('_', ' ').toLowerCase()}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link to={`/admin/subscriptions/${s.subscription_id}`}
                            className="text-xs font-semibold text-red-400 transition hover:text-red-300">
                        Manage
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
            <p className="text-xs text-neutral-500">{data.total} subscriptions</p>
          </>
        )}
    </Page>
  );
};

/* ==========================================================================
   THE EDITOR — section 48
   ========================================================================== */
export const SubscriptionEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [addon, setAddon] = useState('');

  const mayEdit = adminAuth.can('subscriptions.edit');
  const mayCancel = adminAuth.can('subscriptions.cancel');

  const load = useCallback(() => {
    adminApi.subscription(id)
      .then((d) => { setData(d); setDraft({}); setError(null); })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Page title="Subscription"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Subscription"><Skeleton rows={4} height="h-24" /></Page>;

  const { subscription: s, resolved, usage, plans, addons, subscription_addons: mine } = data;
  const value = (k, fallback) => (draft[k] !== undefined ? draft[k] : (s[k] ?? fallback ?? ''));
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const dirty = Object.keys(draft).length > 0;

  /* The figure the customer will be billed, recomputed as the operator types.
     The server derives it too and its answer is the one that counts — this is
     so nobody has to save to find out what they just did. */
  const listPrice = Number(value('list_price', 0)) || 0;
  const discountType = value('discount_type', 'NO_DISCOUNT');
  const discountValue = Number(value('discount_value', 0)) || 0;
  const preview = discountType === 'PERCENTAGE' ? Math.max(0, Math.round(listPrice * (1 - discountValue / 100)))
    : discountType === 'FIXED_AMOUNT' ? Math.max(0, listPrice - discountValue)
    : discountType === 'CUSTOM_PRICE' ? Math.max(0, discountValue)
    : listPrice;

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      await adminApi.updateSubscription(id, draft);
      load();
      setNotice({ tone: 'good', text: 'Saved. The customer\'s entitlements update on their next refresh.' });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    } finally { setSaving(false); }
  };

  const extend = async () => {
    const days = window.prompt('Extend by how many days?', s.type === 'TRIAL' ? '15' : '30');
    if (!days) return;
    try {
      const r = await adminApi.extendSubscription(id, Number(days));
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const changeStatus = async (status) => {
    let reason = null;
    if (['SUSPENDED', 'CANCELLED'].includes(status)) {
      reason = window.prompt(
        `${status === 'CANCELLED' ? 'Cancel' : 'Suspend'} this subscription?\n\n` +
        'Every CafeXP feature stops working for this customer. Nothing is deleted.\n\nWhy?'
      );
      if (!reason?.trim()) return;
    }
    try {
      const r = await adminApi.setSubscriptionStatus(id, status, reason?.trim());
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const attachAddon = async () => {
    if (!addon) return;
    try {
      const r = await adminApi.addAddon(id, Number(addon), 1);
      setAddon(''); load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const activeAddons = mine.filter((a) => a.status === 'ACTIVE');

  return (
    <Page
      title={s.organization_name}
      lede={`Subscription #${s.subscription_id}`}
      actions={mayEdit && (
        <>
          <Button variant="ghost" onClick={extend}>Extend</Button>
          {['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'].includes(s.status)
            ? <Button variant="danger" onClick={() => changeStatus('SUSPENDED')}>Suspend</Button>
            : <Button variant="good" onClick={() => changeStatus('ACTIVE')}>Resume</Button>}
          {mayCancel && s.status !== 'CANCELLED' && (
            <Button variant="danger" onClick={() => changeStatus('CANCELLED')}>Cancel</Button>
          )}
        </>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Status', String(resolved?.status || s.status).replace('_', ' ').toLowerCase()],
          ['Type', String(s.type || '').toLowerCase()],
          ['Pays', s.net_price != null ? money(s.net_price, s.currency) : '—'],
          ['Renews', shortDate(s.trial_ends_at || s.end_date)]
        ].map(([label, v]) => (
          <Panel key={label} className="!p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-white">{v}</div>
          </Panel>
        ))}
      </div>

      <Panel title="Package and pricing"
             description="Everything here is a snapshot. Changing the package's own price later will not change what this customer pays.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Package" id="se-plan">
            <Select id="se-plan" value={value('sub_id')} onChange={set('sub_id')} disabled={!mayEdit}>
              <option value="">No package</option>
              {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Billing cycle" id="se-cycle">
            <Select id="se-cycle" value={value('billing_period', 'monthly')}
                    onChange={set('billing_period')} disabled={!mayEdit}>
              {['monthly', 'quarterly', 'half_yearly', 'annual'].map((c) => (
                <option key={c} value={c}>{c.replace('_', '-')}</option>
              ))}
            </Select>
          </Field>
          <Field label="List price" id="se-list" hint="What the package costs">
            <Input id="se-list" type="number" min="0" value={value('list_price')}
                   onChange={set('list_price')} disabled={!mayEdit} />
          </Field>
          <Field label="Discount type" id="se-dt">
            <Select id="se-dt" value={discountType} onChange={set('discount_type')} disabled={!mayEdit}>
              <option value="NO_DISCOUNT">None</option>
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED_AMOUNT">Fixed amount</option>
              <option value="CUSTOM_PRICE">Custom price</option>
            </Select>
          </Field>
          {discountType !== 'NO_DISCOUNT' && (
            <Field label={discountType === 'PERCENTAGE' ? 'Percent off'
              : discountType === 'CUSTOM_PRICE' ? 'Customer price' : 'Amount off'} id="se-dv">
              <Input id="se-dv" type="number" min="0" value={value('discount_value')}
                     onChange={set('discount_value')} disabled={!mayEdit} />
            </Field>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/40 px-4 py-3">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">Customer pays</span>
          <span className="text-xl font-semibold text-white">{money(preview, s.currency)}</span>
          <span className="text-xs text-neutral-500">
            / {value('billing_period', 'monthly').replace('_', '-')}
          </span>
          {preview !== listPrice && (
            <span className="text-xs text-neutral-600 line-through">{money(listPrice, s.currency)}</span>
          )}
          {dirty && <Pill tone="warn">unsaved</Pill>}
        </div>
      </Panel>

      <Panel title="Limits"
             description="Overrides for this customer only. Leaving one blank falls back to the package.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['max_pcs', 'Gaming PCs', usage.pcs],
            ['max_branches', 'Branches', usage.branches],
            ['max_users', 'Users', usage.users],
            ['max_installations', 'Installations', usage.installations]
          ].map(([key, label, used]) => (
            <Field key={key} label={label} id={`se-${key}`} hint={`${used} in use`}>
              <Input id={`se-${key}`} type="number" min="0" value={value(key)}
                     onChange={set(key)} disabled={!mayEdit} placeholder="from package" />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="Dates">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start" id="se-start">
            <Input id="se-start" type="date" disabled={!mayEdit}
                   value={String(value('start_date')).slice(0, 10)} onChange={set('start_date')} />
          </Field>
          <Field label="Ends / renews" id="se-end">
            <Input id="se-end" type="date" disabled={!mayEdit}
                   value={String(value('end_date')).slice(0, 10)} onChange={set('end_date')} />
          </Field>
          <Field label="Promotional price ends" id="se-promo"
                 hint="After this, the price reverts">
            <Input id="se-promo" type="date" disabled={!mayEdit}
                   value={String(value('promo_ends_at')).slice(0, 10)} onChange={set('promo_ends_at')} />
          </Field>
        </div>
      </Panel>

      <Panel title="Add-ons" description="Extras sold on top of the package. Each only ever grants.">
        {activeAddons.length === 0
          ? <p className="text-xs text-neutral-600">No add-ons on this subscription.</p>
          : (
            <div className="space-y-2">
              {activeAddons.map((a) => (
                <div key={a.subscription_addon_id}
                     className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
                  <div>
                    <span className="text-sm text-neutral-200">{a.name}</span>
                    {a.quantity > 1 && <span className="ml-1 text-xs text-neutral-500">×{a.quantity}</span>}
                    <div className="text-[10px] text-neutral-600">
                      {[a.grant_pcs && `+${a.grant_pcs * a.quantity} PCs`,
                        a.grant_branches && `+${a.grant_branches * a.quantity} branches`,
                        a.grant_users && `+${a.grant_users * a.quantity} users`]
                        .filter(Boolean).join(' · ') || 'grants a feature'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums text-neutral-300">
                      {money(a.price_snapshot, a.currency)}
                    </span>
                    {mayEdit && (
                      <Button variant="danger" className="!px-2 !py-1 !text-xs"
                              onClick={async () => {
                                await adminApi.removeAddon(id, a.subscription_addon_id);
                                load();
                              }}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        {mayEdit && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Field label="Add an add-on" id="se-addon">
                <Select id="se-addon" value={addon} onChange={(e) => setAddon(e.target.value)}>
                  <option value="">Choose…</option>
                  {addons.map((a) => (
                    <option key={a.addon_id} value={a.addon_id}>
                      {a.name} — {money(a.price, a.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button onClick={attachAddon} disabled={!addon}>Add</Button>
          </div>
        )}
      </Panel>

      {mayEdit && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save subscription' : 'Saved'}
          </Button>
          {dirty && <Button variant="ghost" onClick={() => setDraft({})}>Discard</Button>}
          <Button variant="ghost" onClick={() => navigate(`/admin/organizations/${s.organization_id}`)}>
            Open customer
          </Button>
        </div>
      )}
    </Page>
  );
};
