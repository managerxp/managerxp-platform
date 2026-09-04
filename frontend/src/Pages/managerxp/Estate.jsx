import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, adminAuth, relativeTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select
} from '../../components/admin/ui';

/*
 * Installations and Devices — sections 31 and 32.
 *
 * Both are opened for the same reason: a café has said something stopped
 * working. So both lead with status and when the thing was last heard from,
 * and both default their filter to the machines that are quiet, because that
 * is the list somebody is actually looking for.
 */

const OnlineDot = ({ online }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-neutral-700'}`} />
    <span className={`text-[11px] ${online ? 'text-emerald-300' : 'text-neutral-600'}`}>
      {online ? 'online' : 'quiet'}
    </span>
  </span>
);

const Filters = ({ children, onSubmit }) => (
  <Panel>
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">{children}</form>
  </Panel>
);

/* ==========================================================================
   INSTALLATIONS
   ========================================================================== */
export const Installations = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [online, setOnline] = useState('');
  const [busy, setBusy] = useState(null);

  const mayAct = adminAuth.can('installations.revoke');

  const load = useCallback(() => {
    adminApi.installations({ q: query, status, online, size: 100 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [query, status, online]);
  useEffect(() => { load(); }, [load]);

  const act = async (item, next) => {
    let reason = null;
    if (next !== 'ACTIVE') {
      reason = window.prompt(
        next === 'REVOKED'
          ? `Revoke ${item.name || item.public_id}?\n\n` +
            'That machine stops working immediately and its credential is destroyed. ' +
            'It has to be registered from scratch to come back — suspending is the ' +
            'reversible option.\n\nWhy are you revoking it?'
          : `Suspend ${item.name || item.public_id}?\n\n` +
            'It stops working until you restore it from this screen.\n\nWhy?'
      );
      if (!reason?.trim()) return;
    }
    setBusy(item.installation_id);
    try {
      const r = await adminApi.setInstallationStatus(item.installation_id, next, reason?.trim());
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    } finally { setBusy(null); }
  };

  const reauth = async (item) => {
    if (!window.confirm(
      `Force ${item.name || item.public_id} to sign in again?\n\n` +
      'Its stored credential stops working. Devices and history are untouched.'
    )) return;
    setBusy(item.installation_id);
    try {
      const r = await adminApi.forceReauth(item.installation_id);
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  return (
    <Page
      title="Installations"
      lede="Every CafeXP server registered on the platform. An installation is a machine, not a person — it authenticates with its own credential, which is what lets one be stopped without touching anybody's password."
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <Filters onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <div className="min-w-[220px] flex-1">
          <Field label="Search" id="in-q">
            <Input id="in-q" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Installation, customer or branch" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Status" id="in-status">
            <Select id="in-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {['ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING'].map((s) => (
                <option key={s} value={s}>{s.toLowerCase()}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="Contact" id="in-online">
            <Select id="in-online" value={online} onChange={(e) => setOnline(e.target.value)}>
              <option value="">Any</option>
              <option value="true">Online</option>
              <option value="false">Not seen recently</option>
            </Select>
          </Field>
        </div>
        <Button type="submit">Search</Button>
      </Filters>

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0
          ? <Empty title="Nothing installed" text="Installations appear here as cafés set up CafeXP." />
          : (
            <>
              <Table columns={['Installation', 'Customer', 'Branch', 'Version', 'Devices', 'Last seen', 'Status', '']}>
                {data.items.map((i) => (
                  <tr key={i.installation_id} className="align-top hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{i.name || 'Unnamed'}</div>
                      <div className="font-mono text-[10px] text-neutral-600">{i.public_id}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link to={`/admin/organizations/${i.organization_id}`}
                            className="text-neutral-300 transition hover:text-white">
                        {i.organization_name || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-400">{i.branch_name || '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-neutral-400">{i.version || '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums text-neutral-300">{i.device_count}</td>
                    <td className="px-4 py-2.5">
                      <OnlineDot online={i.online} />
                      <div className="mt-0.5 text-[10px] text-neutral-600">{relativeTime(i.last_seen_at)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill tone={
                        i.status === 'ACTIVE' ? 'good'
                          : i.status === 'REVOKED' ? 'bad'
                          : i.status === 'SUSPENDED' ? 'warn' : 'mute'
                      }>
                        {String(i.status).toLowerCase()}
                      </Pill>
                      {i.revoked_reason && i.status !== 'ACTIVE' && (
                        <div className="mt-0.5 max-w-[160px] text-[10px] text-neutral-600">{i.revoked_reason}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {mayAct && (
                        <div className="flex justify-end gap-1.5">
                          {i.status === 'ACTIVE' ? (
                            <>
                              <Button variant="ghost" className="!px-2 !py-1 !text-xs"
                                      disabled={busy === i.installation_id}
                                      onClick={() => reauth(i)}>Re-auth</Button>
                              <Button variant="danger" className="!px-2 !py-1 !text-xs"
                                      disabled={busy === i.installation_id}
                                      onClick={() => act(i, 'SUSPENDED')}>Suspend</Button>
                            </>
                          ) : i.status !== 'REVOKED' && (
                            <Button variant="good" className="!px-2 !py-1 !text-xs"
                                    disabled={busy === i.installation_id}
                                    onClick={() => act(i, 'ACTIVE')}>Restore</Button>
                          )}
                          {i.status !== 'REVOKED' && (
                            <Button variant="danger" className="!px-2 !py-1 !text-xs"
                                    disabled={busy === i.installation_id}
                                    onClick={() => act(i, 'REVOKED')}>Revoke</Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="text-xs text-neutral-500">
                {data.total} installation{data.total === 1 ? '' : 's'} ·{' '}
                {data.items.filter((i) => i.online).length} online right now
              </p>
            </>
          )}
    </Page>
  );
};

/* ==========================================================================
   DEVICES
   ========================================================================== */
const TYPE_TONE = {
  GAMING_PC: 'info', SERVER: 'bad', FRONT_DESK: 'warn', ADMIN: 'mute', MANAGER: 'mute'
};

export const Devices = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState(null);

  const mayAct = adminAuth.can('devices.disable');

  const load = useCallback(() => {
    adminApi.devices({ q: query, type, active, size: 200 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [query, type, active]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (d) => {
    let reason = null;
    if (d.is_active) {
      reason = window.prompt(
        `Disable ${d.name}?\n\n` +
        (d.device_type === 'GAMING_PC'
          ? 'It stops counting against this customer\'s PC limit and can no longer run sessions. '
          : '') +
        'Its history is kept.\n\nWhy?'
      );
      if (!reason?.trim()) return;
    }
    setBusy(d.pc_id);
    try {
      const r = await adminApi.setDeviceStatus(d.pc_id, !d.is_active, reason?.trim());
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  const gaming = data?.items.filter((d) => d.device_type === 'GAMING_PC' && d.is_active).length ?? 0;

  return (
    <Page
      title="Devices / PCs"
      lede="Every machine registered against an installation. Only gaming PCs count against a customer's limit — a till or a back-office machine does not."
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <Filters onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <div className="min-w-[220px] flex-1">
          <Field label="Search" id="dv-q">
            <Input id="dv-q" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Device name, MAC, IP or customer" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Type" id="dv-type">
            <Select id="dv-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any type</option>
              {Object.keys(TYPE_TONE).map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="State" id="dv-active">
            <Select id="dv-active" value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="">Any</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </Select>
          </Field>
        </div>
        <Button type="submit">Search</Button>
      </Filters>

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0
          ? <Empty title="No devices" text="Stations appear here as cafés register them." />
          : (
            <>
              <Table columns={['Device', 'Type', 'Customer', 'Branch', 'Installation', 'Last seen', 'State', '']}>
                {data.items.map((d) => (
                  <tr key={d.pc_id} className={`hover:bg-white/[0.03] ${d.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{d.name}</div>
                      <div className="font-mono text-[10px] text-neutral-600">
                        {d.mac_address || '—'}{d.ip_address ? ` · ${d.ip_address}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill tone={TYPE_TONE[d.device_type] || 'mute'}>
                        {String(d.device_type).replace('_', ' ').toLowerCase()}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link to={`/admin/organizations/${d.organization_id}`}
                            className="text-neutral-300 transition hover:text-white">
                        {d.organization_name || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-400">{d.branch_name || '—'}</td>
                    <td className="px-4 py-2.5">
                      {d.installation_public_id
                        ? <span className="font-mono text-[10px] text-neutral-500">{d.installation_public_id}</span>
                        /* A device with no installation predates registration —
                           it was added by hand from the console. Worth showing,
                           not worth alarming about. */
                        : <span className="text-[10px] text-neutral-700">unlinked</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <OnlineDot online={d.online} />
                      <div className="mt-0.5 text-[10px] text-neutral-600">{relativeTime(d.last_seen_at)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill tone={d.is_active ? 'good' : 'mute'}>{d.is_active ? 'enabled' : 'disabled'}</Pill>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {mayAct && (
                        <Button
                          variant={d.is_active ? 'danger' : 'good'}
                          className="!px-2 !py-1 !text-xs"
                          disabled={busy === d.pc_id}
                          onClick={() => toggle(d)}
                        >
                          {d.is_active ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="text-xs text-neutral-500">
                {data.total} device{data.total === 1 ? '' : 's'} · {gaming} gaming PC
                {gaming === 1 ? '' : 's'} counting against limits
              </p>
            </>
          )}
    </Page>
  );
};
