import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, adminAuth, dateTime } from '../../lib/adminApi';
import {
  Page, Panel, Pill, Banner, Skeleton, Button, Field, Input, Select, Table, CopyableSecret
} from '../../components/admin/ui';

/*
 * ManagerXP's own merchant account, and the email that carries its links.
 *
 * Secrets are write-only from here. The API returns a masked value and there is
 * no endpoint that reveals one, so this form can save a key but never show it
 * back — which is why an empty secret field means "leave the stored one alone"
 * rather than "erase it". Re-saving a form that displays a mask must not
 * silently break a working gateway.
 *
 * Only one gateway is live at a time. The payer is sent to whichever is
 * enabled, and two would make that a coin toss.
 */

const GatewayCard = ({ p, onSave, onVerify, busy }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ mode: p.mode, key_id: p.key_id || '', key_secret: '', webhook_secret: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Panel
      title={p.label}
      description={p.configured
        ? `Set up in ${p.mode} mode.`
        : 'Not set up. Paste the credentials from the provider dashboard.'}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {p.is_enabled
          ? <Pill tone="good">live gateway</Pill>
          : p.configured ? <Pill tone="mute">standby</Pill> : <Pill tone="mute">not configured</Pill>}
        <Pill tone={p.mode === 'live' ? 'bad' : 'info'}>{p.mode}</Pill>
        {p.last_verified_at && <Pill tone="good">verified {dateTime(p.last_verified_at)}</Pill>}
        {p.last_error && <Pill tone="bad">{p.last_error}</Pill>}
      </div>

      {!open ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setOpen(true)}>
            {p.configured ? 'Edit credentials' : 'Set up'}
          </Button>
          {p.configured && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => onVerify(p.provider)}>
                Test credentials
              </Button>
              {!p.is_enabled && (
                <Button disabled={busy}
                        onClick={() => onSave(p.provider, { mode: p.mode, is_enabled: true })}>
                  Make live
                </Button>
              )}
            </>
          )}
          {p.docs && (
            <a href={p.docs} target="_blank" rel="noreferrer"
               className="self-center text-xs text-neutral-500 underline hover:text-neutral-300">
              Where to find these
            </a>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); onSave(p.provider, form); setOpen(false); }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Mode" id={`gw-mode-${p.provider}`}
                 hint="Test mode moves no real money">
            <Select id={`gw-mode-${p.provider}`} value={form.mode} onChange={set('mode')}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </Select>
          </Field>
          {Object.entries(p.fields || {}).map(([key, f]) => (
            <Field key={key} label={f.label} id={`gw-${p.provider}-${key}`}
                   hint={p.configured && f.secret ? 'Leave blank to keep the stored value' : f.hint}>
              <Input
                id={`gw-${p.provider}-${key}`}
                type={f.secret ? 'password' : 'text'}
                value={form[key] ?? ''}
                onChange={set(key)}
                autoComplete="off"
                placeholder={p.configured && f.secret ? '••••••••' : ''}
              />
            </Field>
          ))}
          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit">Save</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </Panel>
  );
};

const Gateways = () => {
  const [data, setData] = useState(null);
  const [outbox, setOutbox] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const mayEdit = adminAuth.can('settings.edit') || adminAuth.can('payments.view');

  const load = useCallback(() => {
    Promise.all([adminApi.gateways(), adminApi.emailOutbox({ size: 20 })])
      .then(([g, o]) => { setData(g); setOutbox(o); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (provider, payload) => {
    setBusy(true); setNotice(null);
    try {
      const r = await adminApi.saveGateway(provider, payload);
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(false); }
  };

  const verify = async (provider) => {
    setBusy(true); setNotice(null);
    try {
      const r = await adminApi.verifyGateway(provider);
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) {
      load();
      setNotice({ tone: 'bad', text: e.message });
    } finally { setBusy(false); }
  };

  if (error) return <Page title="Payment gateway"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Payment gateway"><Skeleton rows={3} height="h-32" /></Page>;

  return (
    <Page
      title="Payment gateway"
      lede="How ManagerXP collects subscription payments. This is the vendor's own merchant account — separate from the gateways each café configures for its own customers."
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {!data.active && (
        <Banner tone="warn">
          No gateway is live, so payment links cannot be paid online. Set one up and make it live,
          or collect by bank transfer and record the payment by hand.
        </Banner>
      )}
      {!data.mail_configured && (
        <Banner tone="warn">
          Email is not configured, so links cannot be sent automatically. They are still created —
          copy the URL to the customer yourself. Configure SMTP under mail settings to change that.
        </Banner>
      )}

      {data.providers.map((p) => (
        <GatewayCard key={p.provider} p={p} onSave={save} onVerify={verify} busy={busy || !mayEdit} />
      ))}

      <Panel
        title="Email log"
        description="Every message ManagerXP tried to send. A queued message is one with nowhere to go yet — it was written down, not lost."
      >
        {!outbox?.items?.length
          ? <p className="text-xs text-neutral-600">Nothing sent yet.</p>
          : (
            <Table columns={['When', 'To', 'Subject', 'Kind', 'Status']}>
              {outbox.items.map((e) => (
                <tr key={e.outbox_id} className="hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap px-4 py-2 text-[11px] text-neutral-500">
                    {dateTime(e.created_at)}
                  </td>
                  <td className="px-4 py-2 text-neutral-300">{e.to_email}</td>
                  <td className="px-4 py-2 text-[11px] text-neutral-400">{e.subject}</td>
                  <td className="px-4 py-2 text-[11px] text-neutral-500">{e.kind}</td>
                  <td className="px-4 py-2">
                    <Pill tone={e.status === 'SENT' ? 'good' : e.status === 'FAILED' ? 'bad' : 'warn'}>
                      {e.status.toLowerCase()}
                    </Pill>
                    {e.error && <div className="mt-0.5 max-w-[220px] text-[10px] text-neutral-600">{e.error}</div>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
      </Panel>
    </Page>
  );
};

export default Gateways;
