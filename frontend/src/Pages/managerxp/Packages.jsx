import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { adminApi, adminAuth, money } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Button, Field, Input, Select
} from '../../components/admin/ui';

const CYCLES = [
  ['monthly', 'Monthly'], ['quarterly', 'Quarterly'],
  ['half_yearly', 'Half-yearly'], ['annual', 'Annual']
];

/* ==========================================================================
   THE LIST
   ========================================================================== */
export const PackageList = () => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '', copy_from: '' });
  const navigate = useNavigate();
  const mayCreate = adminAuth.can('packages.create');

  const load = useCallback(() => {
    adminApi.packages().then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const plan = await adminApi.createPackage({
        code: form.code, name: form.name, description: form.description,
        copy_from: form.copy_from || undefined
      });
      navigate(`/admin/packages/${plan.plan_id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Page
      title="Package Master"
      lede="What each package includes and what it costs. Editing a package changes it for every customer on it — a single customer is changed from their own page."
      actions={mayCreate && (
        <Button onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : 'New package'}
        </Button>
      )}
    >
      {error && <Banner tone="bad">{error}</Banner>}

      {creating && (
        <Panel title="New package" description="Copy an existing package to start from its feature set rather than an empty one.">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" id="pk-name">
              <Input id="pk-name" value={form.name} required
                     onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                     placeholder="Professional" />
            </Field>
            <Field label="Code" id="pk-code" hint="Uppercase, used in APIs and support conversations">
              <Input id="pk-code" value={form.code} required
                     onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                     placeholder="PROFESSIONAL" />
            </Field>
            <Field label="Description" id="pk-desc">
              <Input id="pk-desc" value={form.description}
                     onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
            <Field label="Copy features and pricing from" id="pk-copy">
              <Select id="pk-copy" value={form.copy_from}
                      onChange={(e) => setForm((f) => ({ ...f, copy_from: e.target.value }))}>
                <option value="">Start empty</option>
                {(rows || []).map((p) => <option key={p.plan_id} value={p.plan_id}>{p.name}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Create package</Button>
            </div>
          </form>
        </Panel>
      )}

      {!rows ? <Skeleton rows={3} height="h-14" /> : (
        <Table columns={['Package', 'Status', 'Monthly', 'Limits', 'Features', 'In use', '']}>
          {rows.map((p) => {
            const monthly = (p.prices || []).find((x) => x.billing_period === 'monthly');
            return (
              <tr key={p.plan_id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-white">{p.name}</div>
                  <div className="font-mono text-[10px] text-neutral-600">{p.code}</div>
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={
                    p.is_freetrial ? 'info'
                      : p.status === 'ACTIVE' ? 'good'
                      : p.status === 'ARCHIVED' ? 'mute' : 'warn'
                  }>
                    {p.is_freetrial ? 'trial' : String(p.status).toLowerCase()}
                  </Pill>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-300">
                  {monthly ? money(monthly.price) : '—'}
                </td>
                <td className="px-4 py-2.5 text-[11px] text-neutral-400">
                  {p.max_pcs} PCs · {p.max_branches} branch{p.max_branches === 1 ? '' : 'es'}
                  {p.max_users ? ` · ${p.max_users} users` : ''}
                  {p.station_limits && Object.keys(p.station_limits).length > 0 && (
                    <span className="block text-neutral-500">
                      {Object.entries(p.station_limits).map(([c, n]) => `${c} ${n}`).join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={p.features_on > 0 ? 'good' : 'warn'}>{p.features_on} on</Pill>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-400">{p.subscriptions}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link to={`/admin/packages/${p.plan_id}`}
                        className="text-xs font-semibold text-red-400 transition hover:text-red-300">
                    Edit
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Page>
  );
};

/* ==========================================================================
   THE EDITOR — section 50
   ========================================================================== */
export const PackageEditor = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  const [general, setGeneral] = useState({});
  const [prices, setPrices] = useState({});
  const [features, setFeatures] = useState({});
  // Per-station-type caps, edited as rows so a type can be added or removed.
  const [stationLimits, setStationLimits] = useState([]);
  /* The types to choose from, fetched rather than hard-coded — the set is
     café-extensible, so any list written here would be wrong for somebody. */
  const [stationTypes, setStationTypes] = useState([]);

  const mayEdit = adminAuth.can('packages.edit');

  const load = useCallback(() => {
    adminApi.package(id).then((d) => {
      setData(d);
      setGeneral({});
      setPrices(Object.fromEntries((d.prices || []).map((p) => [p.billing_period, p.price])));
      setFeatures(Object.fromEntries(
        d.modules.flatMap((m) => m.features.map((f) => [f.feature_key, f.enabled]))
      ));
      setStationLimits(Object.entries(d.plan.station_limits || {})
        .map(([category, max]) => ({ category, max: String(max) })));
      setError(null);
    }).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  /* Independent of the plan: the type list is the same whichever plan is open,
     and a failure here must not stop the plan from being edited — the caps
     already set stay visible and saveable either way. */
  useEffect(() => {
    adminApi.stationTypes().then((t) => setStationTypes(t || [])).catch(() => {});
  }, []);

  if (error) return <Page title="Package"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Package"><Skeleton rows={4} height="h-24" /></Page>;

  const { plan, modules, subscriptions } = data;
  const value = (k) => (general[k] !== undefined ? general[k] : (plan[k] ?? ''));
  const setG = (k) => (e) => setGeneral((g) => ({ ...g, [k]: e.target.value }));

  const featureCount = Object.values(features).filter(Boolean).length;

  /* Per-type caps as editable rows. Empty rows and non-positive numbers are
     dropped when building the object to save, matching what the server stores. */
  const addLimitRow = () => setStationLimits((r) => [...r, { category: '', max: '' }]);
  const setLimitRow = (i, key, v) =>
    setStationLimits((r) => r.map((row, j) => (j === i ? { ...row, [key]: v } : row)));
  const removeLimitRow = (i) => setStationLimits((r) => r.filter((_, j) => j !== i));
  const stationLimitsObject = () => {
    const o = {};
    stationLimits.forEach(({ category, max }) => {
      const name = String(category).trim();
      const n = Math.floor(Number(max));
      if (name && Number.isFinite(n) && n > 0) o[name] = n;
    });
    return o;
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const nextLimits = stationLimitsObject();
      const limitsChanged =
        JSON.stringify(nextLimits) !== JSON.stringify(plan.station_limits || {});
      if (Object.keys(general).length || limitsChanged) {
        await adminApi.updatePackage(id, {
          ...general,
          ...(limitsChanged ? { station_limits: nextLimits } : {})
        });
      }
      await adminApi.setPackageFeatures(id, features);
      await adminApi.setPackagePrices(id,
        CYCLES.map(([period]) => ({ billing_period: period, price: Number(prices[period]) || 0 })));
      load();
      setNotice({
        tone: 'good',
        text: subscriptions > 0
          ? `Saved. ${subscriptions} customer${subscriptions === 1 ? '' : 's'} on this package will see the change on their next entitlement refresh.`
          : 'Saved.'
      });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      title={plan.name}
      lede={`Package code ${plan.code}${subscriptions > 0 ? ` · ${subscriptions} active subscription${subscriptions === 1 ? '' : 's'}` : ''}`}
      actions={mayEdit && (
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save package'}</Button>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {subscriptions > 0 && (
        <Banner tone="warn">
          {subscriptions} customer{subscriptions === 1 ? ' is' : 's are'} on this package. Switching a
          feature off here removes it for all of them — to change one customer, use their own page.
        </Banner>
      )}

      <Panel title="General">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" id="pe-name">
            <Input id="pe-name" value={value('name')} onChange={setG('name')} disabled={!mayEdit} />
          </Field>
          <Field label="Code" id="pe-code" hint="Cannot be changed once customers are on it">
            <Input id="pe-code" value={plan.code || ''} disabled />
          </Field>
          <Field label="Status" id="pe-status">
            <Select id="pe-status" value={value('status')} onChange={setG('status')} disabled={!mayEdit}>
              {['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Sort order" id="pe-sort" hint="Lower shows first">
            <Input id="pe-sort" type="number" value={value('sort_order')} onChange={setG('sort_order')} disabled={!mayEdit} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="Description" id="pe-desc">
              <Input id="pe-desc" value={value('description')} onChange={setG('description')} disabled={!mayEdit} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Pricing" description="What a new customer is quoted. Existing subscriptions keep the price they were sold at.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CYCLES.map(([period, label]) => (
            <Field key={period} label={label} id={`pe-${period}`}>
              <Input
                id={`pe-${period}`}
                type="number"
                min="0"
                value={prices[period] ?? ''}
                disabled={!mayEdit}
                onChange={(e) => setPrices((p) => ({ ...p, [period]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="Limits" description="Ceilings for a customer on this package. A single customer can be given a different ceiling from their own page.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['max_branches', 'Branches'], ['max_pcs', 'Gaming PCs'], ['max_users', 'Users'],
            ['max_managers', 'Managers'], ['max_installations', 'Installations']
          ].map(([key, label]) => (
            <Field key={key} label={label} id={`pe-${key}`}>
              <Input id={`pe-${key}`} type="number" min="0" value={value(key)}
                     onChange={setG(key)} disabled={!mayEdit} />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel
        title="Station type limits"
        description="Optional caps per station type. Gaming PCs above counts PC stations only — a PS5, Pool table or VR rig is capped here, not against that total, and a type with no cap here is uncapped."
      >
        <div className="space-y-2">
          {stationLimits.length === 0 && (
            <p className="text-sm text-neutral-500">No per-type caps. Add one to limit a specific station type.</p>
          )}
          {stationLimits.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
              <Field label={i === 0 ? 'Station type' : ''} id={`pe-sl-cat-${i}`}>
                <Select id={`pe-sl-cat-${i}`} value={row.category} disabled={!mayEdit}
                        onChange={(e) => setLimitRow(i, 'category', e.target.value)}>
                  <option value="">— Select type —</option>
                  {/* A cap already saved against a type that has since gone
                      out of use still has to be selectable, or opening the
                      plan would silently drop it on the next save. */}
                  {(stationTypes.includes(row.category) || !row.category
                    ? stationTypes
                    : [...stationTypes, row.category].sort()
                  ).map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label={i === 0 ? 'Max stations' : ''} id={`pe-sl-max-${i}`}>
                <Input id={`pe-sl-max-${i}`} type="number" min="1" placeholder="e.g. 4"
                       value={row.max} disabled={!mayEdit}
                       onChange={(e) => setLimitRow(i, 'max', e.target.value)} />
              </Field>
              {mayEdit && (
                <Button variant="ghost" type="button" onClick={() => removeLimitRow(i)}>Remove</Button>
              )}
            </div>
          ))}
          {mayEdit && (
            <Button variant="ghost" type="button" onClick={addLimitRow}>+ Add a station type</Button>
          )}
        </div>
      </Panel>

      <Panel
        title="Features"
        description={`${featureCount} of ${Object.keys(features).length} on. Core features cannot be switched off — a package without them is a broken product, not a cheaper one.`}
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m.module_key} className="rounded-lg border border-white/10 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                {m.label}
              </div>
              <div className="space-y-1.5">
                {m.features.map((f) => (
                  <label
                    key={f.feature_key}
                    className={`flex items-center gap-2 text-sm ${
                      f.is_core ? 'cursor-not-allowed text-neutral-500' : 'cursor-pointer text-neutral-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-red-500"
                      checked={!!features[f.feature_key]}
                      disabled={!mayEdit || f.is_core}
                      onChange={(e) =>
                        setFeatures((s) => ({ ...s, [f.feature_key]: e.target.checked }))}
                    />
                    <span>{f.label}</span>
                    {f.is_core && <span className="text-[9px] uppercase text-neutral-700">core</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {mayEdit && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save package'}</Button>
          <Button variant="ghost" onClick={load} disabled={saving}>Discard changes</Button>
        </div>
      )}
    </Page>
  );
};
