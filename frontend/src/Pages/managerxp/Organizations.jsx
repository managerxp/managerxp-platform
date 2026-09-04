import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, money, shortDate } from '../../lib/adminApi';
import { Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Input, Select } from '../../components/admin/ui';

/*
 * The customer list — section 6 and 7, which are the same table read two ways.
 * "Cafe Owners" leads with the person, "Organizations" with the business; both
 * open the same detail page, because they are the same record.
 *
 * One search box rather than six fields. An admin on a support call has
 * whichever identifier the customer happened to say — an email, a business
 * name, a branch, a subscription number — and making them choose the right
 * column first is a step that exists only for the query builder's benefit.
 */
const STATUSES = ['', 'ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED', 'CANCELLED'];

const usageTone = (used, max) => {
  if (!max) return 'mute';
  const pct = (used / max) * 100;
  return pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'mute';
};

const Organizations = ({ lens = 'organization' }) => {
  const byOwner = lens === 'owner';

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.organizations({ q: query, status, page, size: 25 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query, status, page]);

  useEffect(() => { load(); }, [load]);

  const search = (e) => {
    e.preventDefault();
    setPage(1);
    setQuery(q.trim());
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <Page
      title={byOwner ? 'Cafe Owners' : 'Organizations'}
      lede={byOwner
        ? 'The people who own a CafeXP account. Each owns one business.'
        : 'Every CafeXP customer business on the platform.'}
    >
      <Panel>
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="org-q" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Search
            </label>
            <Input
              id="org-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Business, owner name, email, phone, branch or subscription id"
            />
          </div>
          <div className="w-40">
            <label htmlFor="org-status" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Status
            </label>
            <Select id="org-status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'Any status'}</option>)}
            </Select>
          </div>
          <Button type="submit">Search</Button>
          {(query || status) && (
            <Button type="button" variant="ghost"
                    onClick={() => { setQ(''); setQuery(''); setStatus(''); setPage(1); }}>
              Clear
            </Button>
          )}
        </form>
      </Panel>

      {error && <Banner tone="bad">{error}</Banner>}

      {loading ? <Skeleton rows={4} height="h-12" />
        : !data?.items.length ? (
          <Empty
            title={query || status ? 'Nothing matched' : 'No customers yet'}
            text={query || status
              ? 'Try a different search, or clear the filters.'
              : 'Customers appear here as they sign up for a CafeXP trial.'}
          />
        ) : (
          <>
            <Table columns={byOwner
              ? ['Owner', 'Business', 'Package', 'Status', 'PCs', 'Since', '']
              : ['Business', 'Owner', 'Package', 'Status', 'Branches', 'PCs', 'Renews', '']}>
              {data.items.map((o) => {
                const suspended = o.status === 'SUSPENDED';
                const subStatus = suspended ? 'SUSPENDED' : (o.subscription_status || '—');
                return (
                  <tr key={o.organization_id} className="hover:bg-white/[0.03]">
                    {byOwner ? (
                      <>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-white">{o.owner_name || '—'}</div>
                          <div className="text-[11px] text-neutral-500">{o.owner_email}</div>
                        </td>
                        <td className="px-4 py-2.5 text-neutral-300">{o.name}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-white">{o.name}</div>
                          {o.city && <div className="text-[11px] text-neutral-500">{o.city}</div>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-neutral-300">{o.owner_name || '—'}</div>
                          <div className="text-[11px] text-neutral-500">{o.owner_email}</div>
                        </td>
                      </>
                    )}

                    <td className="px-4 py-2.5">
                      <div className="text-neutral-300">{o.plan_name || '—'}</div>
                      {o.net_price != null && (
                        <div className="text-[11px] text-neutral-500">
                          {money(o.net_price, o.subscription_currency)}
                          {o.billing_period ? ` / ${o.billing_period}` : ''}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-2.5">
                      <Pill tone={
                        suspended ? 'bad'
                          : subStatus === 'ACTIVE' ? 'good'
                          : subStatus === 'TRIAL' ? 'info'
                          : subStatus === 'EXPIRED' ? 'bad' : 'mute'
                      }>
                        {String(subStatus).toLowerCase()}
                      </Pill>
                    </td>

                    {!byOwner && (
                      <td className="px-4 py-2.5">
                        <Pill tone={usageTone(o.branches, o.max_branches)}>
                          {o.branches}{o.max_branches ? ` / ${o.max_branches}` : ''}
                        </Pill>
                      </td>
                    )}

                    <td className="px-4 py-2.5">
                      <Pill tone={usageTone(o.pcs, o.max_pcs)}>
                        {o.pcs}{o.max_pcs ? ` / ${o.max_pcs}` : ''}
                      </Pill>
                    </td>

                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-neutral-500">
                      {byOwner ? shortDate(o.created_at) : shortDate(o.end_date)}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={`/admin/organizations/${o.organization_id}`}
                        className="text-xs font-semibold text-red-400 transition hover:text-red-300"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>

            <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
              <span>
                {data.total} customer{data.total === 1 ? '' : 's'}
                {pages > 1 && ` · page ${data.page} of ${pages}`}
              </span>
              {pages > 1 && (
                <div className="flex gap-2">
                  <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
    </Page>
  );
};

export default Organizations;
