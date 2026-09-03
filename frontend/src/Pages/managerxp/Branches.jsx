import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, adminAuth, relativeTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select
} from '../../components/admin/ui';

/*
 * Every branch on the platform, across every customer.
 *
 * The column that earns its place is PC usage against allocation. An
 * organization buys a pool — 250 PCs on Elite — and divides it between
 * locations; the question an operator actually asks is "who is about to run
 * out", and that is only answerable when used, allocated and entitled sit next
 * to each other.
 *
 * Allocation is editable inline because it is the one field that changes
 * often and always for the same reason: a café is opening another room.
 */

const usageTone = (used, cap) => {
  if (!cap) return 'mute';
  const pct = (used / cap) * 100;
  return pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
};

const PoolPanel = ({ pool }) => {
  if (!pool) return null;
  const pct = pool.entitled ? Math.min(100, Math.round((pool.used / pool.entitled) * 100)) : 0;
  return (
    <Panel
      title="PC pool"
      description="Capacity the subscription entitles, how much is handed to branches, and how much is actually plugged in."
    >
      {pool.oversubscribed && (
        <div className="mb-3">
          <Banner tone="bad">
            {pool.allocated} PCs are allocated against an entitlement of {pool.entitled}. Lower a
            branch's allocation or raise the subscription's limit.
          </Banner>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Entitled', pool.entitled, 'from the subscription'],
          ['Allocated', pool.allocated, `${pool.unallocated} unallocated`],
          ['Registered', pool.used, `${pool.available} available`],
          ['Branches', pool.branches.length, '']
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border border-white/10 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-white">{value}</div>
            {sub && <div className="mt-0.5 text-[11px] text-neutral-600">{sub}</div>}
          </div>
        ))}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-600">{pct}% of the pool is in use</p>
    </Panel>
  );
};

const Branches = () => {
  const [data, setData] = useState(null);
  const [pool, setPool] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});

  const mayEdit = adminAuth.can('branches.edit');

  const load = useCallback(() => {
    adminApi.branches({ q: query, status, organization_id: orgFilter, size: 100 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [query, status, orgFilter]);
  useEffect(() => { load(); }, [load]);

  /* The pool only makes sense for one organization at a time — summing
     entitlements across customers would produce a number that means nothing. */
  useEffect(() => {
    if (!orgFilter) { setPool(null); return; }
    adminApi.pcPool(orgFilter).then(setPool).catch(() => setPool(null));
  }, [orgFilter, data]);

  const openEdit = (b) => {
    setEditing(b.branch_id);
    setDraft({ name: b.name || '', city: b.city || '', status: b.status, max_pcs: b.max_pcs ?? '' });
    setNotice(null);
  };

  const save = async (b) => {
    try {
      await adminApi.updateBranch(b.branch_id, {
        ...draft,
        max_pcs: draft.max_pcs === '' ? null : Number(draft.max_pcs)
      });
      setEditing(null);
      load();
      setNotice({ tone: 'good', text: `${draft.name || b.name} saved.` });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    }
  };

  const organizations = data
    ? [...new Map(data.items.map((b) => [b.organization_id, b.organization_name])).entries()]
      .filter(([id]) => id).sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    : [];

  return (
    <Page
      title="Branches"
      lede="Every location on the platform. Pick a customer to see how their PC pool is divided."
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <Panel>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}
              className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Search" id="br-q">
              <Input id="br-q" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Branch, city, code or business" />
            </Field>
          </div>
          <div className="w-56">
            <Field label="Customer" id="br-org">
              <Select id="br-org" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="">All customers</option>
                {organizations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="Status" id="br-status">
              <Select id="br-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </Select>
            </Field>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Panel>

      <PoolPanel pool={pool} />

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0
          ? <Empty title="No branches" text="Locations appear here as customers create them." />
          : (
            <>
              <Table columns={['Branch', 'Customer', 'Package', 'Gaming PCs', 'Allocation', 'Installation', 'Status', '']}>
                {data.items.map((b) => {
                  const isEditing = editing === b.branch_id;
                  return (
                    <tr key={b.branch_id} className="align-top hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                        ) : (
                          <>
                            <div className="font-medium text-white">{b.name || 'Unnamed'}</div>
                            <div className="text-[10px] text-neutral-600">
                              {b.code || '—'}{b.city ? ` · ${b.city}` : ''}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link to={`/admin/organizations/${b.organization_id}`}
                              className="text-neutral-300 transition hover:text-white">
                          {b.organization_name || '—'}
                        </Link>
                        {b.organization_status === 'SUSPENDED' && (
                          <div className="mt-0.5"><Pill tone="bad">customer suspended</Pill></div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-400">{b.plan_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <Pill tone={usageTone(b.pcs, b.max_pcs)}>
                          {b.pcs}{b.max_pcs ? ` / ${b.max_pcs}` : ''}
                        </Pill>
                        {b.devices > b.pcs && (
                          <div className="mt-0.5 text-[10px] text-neutral-600">
                            +{b.devices - b.pcs} other device{b.devices - b.pcs === 1 ? '' : 's'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <Input type="number" min="0" className="!w-24" value={draft.max_pcs}
                                 placeholder="none"
                                 onChange={(e) => setDraft((d) => ({ ...d, max_pcs: e.target.value }))} />
                        ) : (
                          /* No allocation is a real state, not a missing value:
                             the branch draws on the pool without a local cap. */
                          <span className="text-sm text-neutral-400">
                            {b.max_pcs ?? <span className="text-neutral-600">from pool</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {b.installation_id ? (
                          <>
                            <Pill tone={b.installation_status === 'ACTIVE' ? 'good' : 'mute'}>
                              {b.version || 'connected'}
                            </Pill>
                            <div className="mt-0.5 text-[10px] text-neutral-600">
                              seen {relativeTime(b.last_seen_at)}
                            </div>
                          </>
                        ) : <span className="text-xs text-neutral-700">not installed</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <Select value={draft.status}
                                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
                            <option value="ACTIVE">Active</option>
                            <option value="SUSPENDED">Suspended</option>
                          </Select>
                        ) : (
                          <Pill tone={b.status === 'ACTIVE' ? 'good' : 'warn'}>
                            {String(b.status).toLowerCase()}
                          </Pill>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {!mayEdit ? null : isEditing ? (
                          <div className="flex justify-end gap-1.5">
                            <Button className="!px-2 !py-1 !text-xs" onClick={() => save(b)}>Save</Button>
                            <Button variant="ghost" className="!px-2 !py-1 !text-xs"
                                    onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" className="!px-2 !py-1 !text-xs"
                                  onClick={() => openEdit(b)}>Edit</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <p className="text-xs text-neutral-500">
                {data.total} branch{data.total === 1 ? '' : 'es'}
              </p>
            </>
          )}
    </Page>
  );
};

export default Branches;
