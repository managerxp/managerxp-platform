import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, adminAuth, money, dateTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select
} from '../../components/admin/ui';

/*
 * Feature Master, Add-ons and Audit Logs.
 *
 * Together in one module because each is a single table over one endpoint and
 * they are read as a set — what the product can do, what can be sold on top of
 * it, and what was changed.
 */

/* ==========================================================================
   FEATURE MASTER — section 18
   ========================================================================== */
export const Features = () => {
  const [modules, setModules] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ feature_key: '', label: '', description: '', module_key: '' });

  const mayCreate = adminAuth.can('features.create');

  const load = useCallback(() => {
    adminApi.features().then(setModules).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setNotice(null);
    try {
      const f = await adminApi.createFeature(form);
      setForm({ feature_key: '', label: '', description: '', module_key: '' });
      setAdding(false);
      load();
      setNotice({
        tone: 'good',
        text: `${f.label} created. It is off on every package until you switch it on in Package Master.`
      });
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    }
  };

  if (error) return <Page title="Feature Master"><Banner tone="bad">{error}</Banner></Page>;
  if (!modules) return <Page title="Feature Master"><Skeleton rows={4} height="h-20" /></Page>;

  const total = modules.reduce((n, m) => n + m.features.length, 0);

  return (
    <Page
      title="Feature Master"
      lede={`${total} features across ${modules.length} modules. This is what packages grant and what CafeXP asks about — adding one here needs no schema change and no deploy.`}
      actions={mayCreate && (
        <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'New feature'}</Button>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {adding && (
        <Panel title="New feature" description="A new feature starts off on every package. Switch it on where it belongs afterwards.">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <Field label="Label" id="ft-label">
              <Input id="ft-label" value={form.label} required
                     onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                     placeholder="Table reservations" />
            </Field>
            <Field label="Key" id="ft-key" hint="Uppercase; what code and the API use">
              <Input id="ft-key" value={form.feature_key} required
                     onChange={(e) => setForm((f) => ({ ...f, feature_key: e.target.value.toUpperCase() }))}
                     placeholder="RESERVATIONS" />
            </Field>
            <Field label="Module" id="ft-module">
              <Select id="ft-module" value={form.module_key}
                      onChange={(e) => setForm((f) => ({ ...f, module_key: e.target.value }))}>
                <option value="">No module</option>
                {modules.map((m) => <option key={m.module_key} value={m.module_key}>{m.label}</option>)}
              </Select>
            </Field>
            <Field label="Description" id="ft-desc">
              <Input id="ft-desc" value={form.description}
                     onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2"><Button type="submit">Create feature</Button></div>
          </form>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {modules.map((m) => (
          <Panel key={m.module_key} title={m.label}>
            <div className="space-y-2">
              {m.features.map((f) => (
                <div key={f.feature_key}
                     className="flex items-start justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-neutral-200">{f.label}</span>
                      {f.is_core && <Pill tone="info">core</Pill>}
                    </div>
                    <div className="font-mono text-[10px] text-neutral-600">{f.feature_key}</div>
                    {f.description && (
                      <div className="mt-0.5 text-[11px] text-neutral-500">{f.description}</div>
                    )}
                  </div>
                  {/* How many packages grant it — the fastest way to spot a
                      feature nobody sells, or one everybody gets for free. */}
                  <div className="shrink-0 text-right">
                    <Pill tone={f.usage?.packages_on > 0 ? 'good' : 'mute'}>
                      {f.usage ? `${f.usage.packages_on}/${f.usage.packages_total}` : '0/0'}
                    </Pill>
                    <div className="mt-0.5 text-[9px] uppercase tracking-wider text-neutral-700">packages</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </Page>
  );
};

/* ==========================================================================
   ADD-ONS — section 23
   ========================================================================== */
const ADDON_BLANK_FORM = {
  code: '', name: '', description: '', price: '', billing_period: 'monthly',
  grant_pcs: '', grant_branches: '', grant_users: '', grant_installations: '',
  features: []
};

export const Addons = () => {
  const [rows, setRows] = useState(null);
  const [moduleList, setModuleList] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // null = closed, 'new' = creating, an addon_id = editing that row. One form
  // handles both — an edit is a create with the blanks already filled in.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(ADDON_BLANK_FORM);

  const mayEdit = adminAuth.can('addons.edit');

  const load = useCallback(() => {
    adminApi.addons().then(setRows).catch((e) => setError(e.message));
    adminApi.features().then(setModuleList).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleFeature = (key) => setForm((f) => ({
    ...f,
    features: f.features.includes(key) ? f.features.filter((k) => k !== key) : [...f.features, key]
  }));

  const startCreate = () => { setForm(ADDON_BLANK_FORM); setEditing('new'); };
  const startEdit = (a) => {
    setForm({
      code: a.code, name: a.name, description: a.description || '',
      price: String(a.price ?? ''), billing_period: a.billing_period || 'monthly',
      grant_pcs: String(a.grant_pcs || ''), grant_branches: String(a.grant_branches || ''),
      grant_users: String(a.grant_users || ''), grant_installations: String(a.grant_installations || ''),
      features: a.features || []
    });
    setEditing(a.addon_id);
  };
  const cancel = () => { setEditing(null); setForm(ADDON_BLANK_FORM); };

  const handleDelete = async (a) => {
    if (!window.confirm(`Delete ${a.name}? This cannot be undone.`)) return;
    setNotice(null);
    try {
      const r = await adminApi.deleteAddon(a.addon_id);
      setNotice({ tone: 'good', text: r.message });
      if (editing === a.addon_id) cancel();
      load();
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setNotice(null);
    const payload = {
      name: form.name, description: form.description,
      price: Number(form.price) || 0,
      billing_period: form.billing_period,
      grant_pcs: Number(form.grant_pcs) || 0,
      grant_branches: Number(form.grant_branches) || 0,
      grant_users: Number(form.grant_users) || 0,
      grant_installations: Number(form.grant_installations) || 0,
      features: form.features
    };
    try {
      if (editing === 'new') {
        await adminApi.createAddon({ ...payload, code: form.code });
        setNotice({ tone: 'good', text: 'Add-on created' });
      } else {
        await adminApi.updateAddon(editing, payload);
        setNotice({ tone: 'good', text: 'Add-on saved' });
      }
      cancel();
      load();
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    }
  };

  if (error) return <Page title="Add-ons"><Banner tone="bad">{error}</Banner></Page>;

  return (
    <Page
      title="Add-ons"
      lede="Sold on top of a package. An add-on only ever grants — it can switch a feature on or raise a ceiling, never the reverse."
      actions={mayEdit && (
        <Button onClick={() => (editing ? cancel() : startCreate())}>{editing ? 'Cancel' : 'New add-on'}</Button>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {editing && (
        <Panel title={editing === 'new' ? 'New add-on' : `Edit ${form.name || 'add-on'}`}>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" id="ad-name">
              <Input id="ad-name" value={form.name} required onChange={set('name')} placeholder="Extra 25 PCs" />
            </Field>
            <Field label="Code" id="ad-code" hint={editing !== 'new' ? "Fixed once created — existing subscriptions and audit history point at it" : undefined}>
              <Input id="ad-code" value={form.code} required disabled={editing !== 'new'}
                     onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                     placeholder="EXTRA_25_PCS" />
            </Field>
            <Field label="Price" id="ad-price">
              <Input id="ad-price" type="number" min="0" value={form.price} onChange={set('price')} />
            </Field>
            <Field label="Billing period" id="ad-period">
              <Select id="ad-period" value={form.billing_period} onChange={set('billing_period')}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="half_yearly">Half-yearly</option>
                <option value="annual">Annual</option>
                <option value="one_time">One-time</option>
              </Select>
            </Field>
            <Field label="Grants gaming PCs" id="ad-pcs" hint="Per unit purchased">
              <Input id="ad-pcs" type="number" min="0" value={form.grant_pcs} onChange={set('grant_pcs')} />
            </Field>
            <Field label="Grants branches" id="ad-branches">
              <Input id="ad-branches" type="number" min="0" value={form.grant_branches} onChange={set('grant_branches')} />
            </Field>
            <Field label="Grants users" id="ad-users">
              <Input id="ad-users" type="number" min="0" value={form.grant_users} onChange={set('grant_users')} />
            </Field>
            <Field label="Grants installations" id="ad-installs">
              <Input id="ad-installs" type="number" min="0" value={form.grant_installations} onChange={set('grant_installations')} />
            </Field>
            <div className="sm:col-span-3">
              <Field label="Description" id="ad-desc">
                <Input id="ad-desc" value={form.description} onChange={set('description')} />
              </Field>
            </div>

            <div className="sm:col-span-3">
              <Field label="Grants features" id="ad-features" hint="A café without this feature on its package gets it while this add-on is active — e.g. sell Reservations or the payment gateway module on its own, without moving the whole package.">
                {!moduleList ? (
                  <div className="text-[11px] text-neutral-600">Loading the feature catalogue…</div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {moduleList.map((m) => (
                      <div key={m.module_key} className="rounded-lg border border-white/10 p-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{m.label}</div>
                        <div className="flex flex-col gap-1.5">
                          {m.features.map((f) => (
                            <label key={f.feature_key} className="flex items-center gap-2 text-[12px] text-neutral-300">
                              <input
                                type="checkbox"
                                checked={form.features.includes(f.feature_key)}
                                onChange={() => toggleFeature(f.feature_key)}
                              />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="sm:col-span-3 flex gap-2">
              <Button type="submit">{editing === 'new' ? 'Create add-on' : 'Save changes'}</Button>
              <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {!rows ? <Skeleton rows={3} height="h-14" />
        : rows.length === 0 ? <Empty title="No add-ons" text="Create one to sell capacity or a feature on top of a package." />
        : (
          <Table columns={['Add-on', 'Price', 'Grants capacity', 'Grants features', 'In use', '']}>
            {rows.map((a) => (
              <tr key={a.addon_id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-white">{a.name}</div>
                  <div className="font-mono text-[10px] text-neutral-600">{a.code}</div>
                  {a.description && <div className="mt-0.5 text-[11px] text-neutral-500">{a.description}</div>}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-300">
                  {money(a.price, a.currency)}
                  <span className="text-[11px] text-neutral-600"> / {a.billing_period}</span>
                </td>
                <td className="px-4 py-2.5 text-[11px] text-neutral-400">
                  {[
                    a.grant_pcs && `${a.grant_pcs} PCs`,
                    a.grant_branches && `${a.grant_branches} branches`,
                    a.grant_users && `${a.grant_users} users`,
                    a.grant_installations && `${a.grant_installations} installs`
                  ].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(a.features || []).length === 0
                      ? <span className="text-[11px] text-neutral-700">—</span>
                      : a.features.map((f) => <Pill key={f} tone="info">{f}</Pill>)}
                  </div>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-400">{a.active_subscriptions}</td>
                <td className="px-4 py-2.5 text-right">
                  {mayEdit && (
                    <>
                      <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => startEdit(a)}>Edit</Button>
                      <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={() => handleDelete(a)}>Delete</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
    </Page>
  );
};

/* ==========================================================================
   AUDIT LOG — section 41
   ========================================================================== */
export const AuditLogs = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  useEffect(() => {
    adminApi.audit({ page, size: 50, action })
      .then(setData).catch((e) => setError(e.message));
  }, [page, action]);

  if (error) return <Page title="Audit Logs"><Banner tone="bad">{error}</Banner></Page>;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <Page
      title="Audit Logs"
      lede="Every administrative action, with what it changed. This is what answers 'who moved that customer to Elite, and when'."
    >
      <Panel>
        <Field label="Filter by action" id="au-action" hint="Prefix match — try 'package' or 'entitlement'">
          <Input id="au-action" value={action}
                 onChange={(e) => { setPage(1); setAction(e.target.value); }}
                 placeholder="entitlement" />
        </Field>
      </Panel>

      {!data ? <Skeleton rows={5} height="h-10" />
        : data.items.length === 0 ? <Empty title="Nothing recorded" text="Administrative changes appear here as they happen." />
        : (
          <>
            <Table columns={['When', 'Who', 'Action', 'Resource', 'Customer', 'Change']}>
              {data.items.map((a) => (
                <tr key={a.audit_id} className="align-top hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap px-4 py-2 text-[11px] text-neutral-500">{dateTime(a.created_at)}</td>
                  <td className="px-4 py-2 text-[11px] text-neutral-400">{a.admin_email || 'system'}</td>
                  <td className="px-4 py-2">
                    <Pill tone={
                      /suspend|revoke|disable|cancel/.test(a.action) ? 'bad'
                        : /create|publish/.test(a.action) ? 'good' : 'info'
                    }>
                      {a.action}
                    </Pill>
                  </td>
                  <td className="px-4 py-2 text-[11px] text-neutral-400">
                    {a.resource_type}{a.resource_id ? ` #${a.resource_id}` : ''}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-neutral-400">{a.organization_name || '—'}</td>
                  <td className="px-4 py-2">
                    {/* Before and after, so a change can be read without
                        reconstructing it from the current state. */}
                    {a.old_value || a.new_value ? (
                      <details className="text-[11px] text-neutral-500">
                        <summary className="cursor-pointer hover:text-neutral-300">view</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded bg-black/40 p-2 text-[10px] text-neutral-400">
{JSON.stringify({ from: a.old_value, to: a.new_value }, null, 1)}
                        </pre>
                      </details>
                    ) : <span className="text-neutral-700">—</span>}
                  </td>
                </tr>
              ))}
            </Table>

            <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
              <span>{data.total} entries{pages > 1 && ` · page ${data.page} of ${pages}`}</span>
              {pages > 1 && (
                <div className="flex gap-2">
                  <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </div>
          </>
        )}
    </Page>
  );
};

/* ==========================================================================
   NOT BUILT YET

   Rendered for the sidebar sections whose backend does not exist. Saying so
   plainly beats an empty table that looks like a customer with no data.
   ========================================================================== */
export const NotBuilt = ({ title, what }) => (
  <Page title={title}>
    <Empty
      title="Not built yet"
      text={`${what} The navigation entry is here so the shape of the console is visible, but nothing behind it would be real yet.`}
    />
  </Page>
);
