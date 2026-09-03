import React, { useCallback, useEffect, useState } from 'react';
import { platformApi, formatDate } from '../../lib/platformApi';
import { Page, Panel, Button, Field, Input, Select, Pill, Banner, Empty, Skeleton, Table, CopyableSecret } from './ui';

/*
 * Licence keys — what actually lets a customer's install run.
 *
 * Separate from subscriptions on purpose: a customer whose PC dies needs their
 * key moved, not their billing changed, and the two should never have to be
 * touched together.
 */

const STATUS = {
  issued:    { tone: 'info', label: 'not yet used' },
  active:    { tone: 'good', label: 'in use' },
  suspended: { tone: 'warn', label: 'suspended' },
  revoked:   { tone: 'bad',  label: 'revoked' },
  expired:   { tone: 'mute', label: 'expired' }
};

const LicensesPage = () => {
  const [licenses, setLicenses] = useState([]);
  const [cafes, setCafes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);      // the key just created
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ cafe_id: '', product: 'cafexp', notes: '' });
  const [history, setHistory] = useState({ id: null, rows: [] });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([platformApi.licenses(), platformApi.cafes().catch(() => [])])
      .then(([l, c]) => { setLicenses(l); setCafes(c); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const issue = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const key = await platformApi.createLicense({
        cafe_id: form.cafe_id || null,
        product: form.product,
        notes: form.notes || undefined
      });
      setIssued(key);
      setForm((f) => ({ ...f, notes: '' }));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (lic) => {
    const reason = window.prompt(
      `Revoke ${lic.license_key}?\n\nThe install stops working immediately.\nWhy are you revoking it?`,
      'Chargeback'
    );
    if (!reason || !reason.trim()) return;
    try {
      await platformApi.revokeLicense(lic.license_id, reason.trim());
      load();
    } catch (e) { window.alert(e.message); }
  };

  const unbind = async (lic) => {
    if (!window.confirm(
      `Release ${lic.license_key} from ${lic.machine_label || lic.machine_id}?\n\n` +
      'The customer can then activate it on a replacement machine.'
    )) return;
    try {
      await platformApi.unbindLicense(lic.license_id);
      load();
    } catch (e) { window.alert(e.message); }
  };

  const showHistory = async (lic) => {
    if (history.id === lic.license_id) { setHistory({ id: null, rows: [] }); return; }
    try {
      const rows = await platformApi.licenseActivations(lic.license_id);
      setHistory({ id: lic.license_id, rows });
    } catch (e) { window.alert(e.message); }
  };

  return (
    <Page
      title="Licence keys"
      lede="A key is what lets an install run. Issue one per site, and release it when a customer changes machine."
    >
      {error && <Banner tone="bad">{error}</Banner>}

      {issued && (
        <CopyableSecret
          label={`${issued.product === 'racexp' ? 'RaceXP' : 'CafeXP'} licence key`}
          value={issued.license_key}
          note="Send this to the customer. They enter it once when the software first runs."
        />
      )}

      <Panel title="Issue a key" description="Limits and expiry are taken from the customer's live subscription.">
        <form onSubmit={issue} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" id="lic-cafe">
            <Select id="lic-cafe" value={form.cafe_id}
                    onChange={(e) => setForm((f) => ({ ...f, cafe_id: e.target.value }))}>
              <option value="">Unassigned (spare key)</option>
              {cafes.map((c) => <option key={c.cafe_id} value={c.cafe_id}>{c.name}</option>)}
            </Select>
          </Field>

          <Field label="Product" id="lic-product">
            <Select id="lic-product" value={form.product}
                    onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}>
              <option value="cafexp">CafeXP</option>
              <option value="racexp">RaceXP</option>
            </Select>
          </Field>

          <Field label="Note" id="lic-notes" hint="Which site or machine this is for">
            <Input id="lic-notes" value={form.notes}
                   onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                   placeholder="e.g. second branch" />
          </Field>

          <div className="flex items-end">
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Generating…' : 'Generate key'}
            </Button>
          </div>
        </form>
      </Panel>

      {loading ? <Skeleton />
        : licenses.length === 0 ? (
          <Empty title="No licence keys yet" text="Generate one above, or set up a customer — onboarding issues a key automatically." />
        ) : (
          <Table columns={['Key', 'Customer', 'Product', 'Status', 'Machine', 'Expires', '']}>
            {licenses.map((lic) => {
              const s = STATUS[lic.status] || STATUS.issued;
              const open = history.id === lic.license_id;
              return (
                <React.Fragment key={lic.license_id}>
                  <tr className="text-neutral-300">
                    <td className="px-4 py-3">
                      <code className="select-all font-mono text-xs text-white">{lic.license_key}</code>
                      {lic.notes && <div className="mt-0.5 text-xs text-neutral-500">{lic.notes}</div>}
                    </td>
                    <td className="px-4 py-3">{lic.cafe_name || <span className="text-neutral-600">unassigned</span>}</td>
                    <td className="px-4 py-3">
                      <Pill tone={lic.product === 'racexp' ? 'info' : 'mute'}>
                        {lic.product === 'racexp' ? 'RaceXP' : 'CafeXP'}
                      </Pill>
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={s.tone}>{s.label}</Pill>
                      {lic.revoked_reason && (
                        <div className="mt-0.5 text-xs text-neutral-500">{lic.revoked_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lic.machine_id
                        ? <>
                            <div className="text-xs text-white">{lic.machine_label || 'Unnamed'}</div>
                            <div className="font-mono text-[11px] text-neutral-600">{lic.machine_id}</div>
                          </>
                        : <span className="text-neutral-600">not activated</span>}
                    </td>
                    <td className="px-4 py-3">
                      {lic.expires_at
                        ? <>
                            <div>{formatDate(lic.expires_at)}</div>
                            {lic.days_remaining != null && (
                              <div className={`text-xs ${lic.days_remaining < 0 ? 'text-red-400' : lic.days_remaining <= 14 ? 'text-amber-400' : 'text-neutral-500'}`}>
                                {lic.days_remaining < 0 ? `${Math.abs(lic.days_remaining)}d ago` : `${lic.days_remaining}d left`}
                              </div>
                            )}
                          </>
                        : <span className="text-neutral-600">never</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {lic.activation_count > 0 && (
                          <Button variant="ghost" type="button" onClick={() => showHistory(lic)}
                                  className="!px-2 !py-1 !text-xs">
                            {open ? 'Hide' : `${lic.activation_count}×`}
                          </Button>
                        )}
                        {lic.machine_id && lic.status !== 'revoked' && (
                          <Button variant="ghost" type="button" onClick={() => unbind(lic)}
                                  className="!px-2 !py-1 !text-xs">Release</Button>
                        )}
                        {lic.status !== 'revoked' && (
                          <Button variant="danger" type="button" onClick={() => revoke(lic)}
                                  className="!px-2 !py-1 !text-xs">Revoke</Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {open && (
                    <tr>
                      <td colSpan={7} className="bg-neutral-950 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                          Activation history
                        </div>
                        <ul className="mt-2 space-y-1">
                          {history.rows.map((a) => (
                            <li key={a.activation_id} className="flex flex-wrap gap-x-3 text-xs text-neutral-400">
                              <span className="text-neutral-500">{new Date(a.created_at).toLocaleString('en-IN')}</span>
                              <span className={a.outcome === 'activated' || a.outcome === 'reactivated' ? 'text-emerald-400' : 'text-red-400'}>
                                {a.outcome.replace('_', ' ')}
                              </span>
                              <span className="font-mono">{a.machine_id || '—'}</span>
                              {a.detail && <span className="text-neutral-600">{a.detail}</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
    </Page>
  );
};

export default LicensesPage;
