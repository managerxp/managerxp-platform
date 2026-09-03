import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, adminAuth, money, shortDate, dateTime, relativeTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select, CopyableSecret
} from '../../components/admin/ui';

/*
 * Payment links — a bill before there is an invoice to bill against.
 *
 * A renewal quoted over the phone, a deposit from a prospect who is not set up
 * yet, an upgrade agreed mid-cycle. The old console could raise these but
 * never send them; the admin copied a URL out of a table and pasted it into
 * their own mail client.
 *
 * The link is always shown after creation, whether or not the email went. If
 * the message is filtered, the address is stale, or SMTP is not configured,
 * the operator still has something to paste into a chat window — and is told
 * plainly which of those happened.
 */

const STATUS_TONE = { open: 'info', paid: 'good', expired: 'mute', cancelled: 'mute' };

const PaymentLinks = () => {
  const [data, setData] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [created, setCreated] = useState(null);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);

  const [form, setForm] = useState({
    organization_id: '', plan_id: '', amount: '', purpose: 'subscription',
    description: '', customer_email: '', expires_in_days: '', send_email: true
  });
  const set = (k) => (e) => setForm((f) => ({
    ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
  }));

  const mayCreate = adminAuth.can('payments.view');
  const mayCancel = adminAuth.can('subscriptions.edit');

  const load = useCallback(() => {
    adminApi.paymentLinks({ status, size: 100 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    adminApi.organizations({ size: 100 }).then((d) => setOrgs(d.items || [])).catch(() => {});
    adminApi.packages().then(setPlans).catch(() => {});
  }, []);

  /* Choosing a customer fills their address in, because the commonest reason a
     link never arrives is that nobody noticed the field was empty. */
  const pickOrg = (e) => {
    const id = e.target.value;
    const org = orgs.find((o) => String(o.organization_id) === String(id));
    setForm((f) => ({
      ...f,
      organization_id: id,
      customer_email: f.customer_email || org?.owner_email || org?.email || ''
    }));
  };

  const create = async (e) => {
    e.preventDefault();
    setNotice(null);
    try {
      const r = await adminApi.createPaymentLinkStandalone({
        ...form,
        organization_id: form.organization_id || undefined,
        plan_id: form.plan_id || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
        expires_in_days: form.expires_in_days ? Number(form.expires_in_days) : undefined
      });
      setCreated(r);
      setCreating(false);
      setForm({ organization_id: '', plan_id: '', amount: '', purpose: 'subscription',
                description: '', customer_email: '', expires_in_days: '', send_email: true });
      load();
      setNotice({ tone: r.email?.sent ? 'good' : 'warn', text: r.message || 'Payment link created' });
    } catch (err) { setNotice({ tone: 'bad', text: err.message }); }
  };

  const resend = async (l) => {
    const to = window.prompt('Send this link to which address?', l.customer_email || '');
    if (to === null) return;
    setBusy(l.link_id);
    try {
      const r = await adminApi.sendPaymentLink(l.link_id, { email: to.trim() });
      load();
      setNotice({ tone: r.data?.email?.sent ? 'good' : 'warn', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  const cancel = async (l) => {
    if (!window.confirm(
      `Cancel this ${money(l.amount, l.currency)} link?\n\n` +
      'The customer can no longer pay it. If they already have it, they will see ' +
      'a dead link — tell them a new one is coming.'
    )) return;
    setBusy(l.link_id);
    try {
      const r = await adminApi.cancelPaymentLink(l.link_id);
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  const chosenPlan = plans.find((p) => String(p.plan_id) === String(form.plan_id));
  const monthly = chosenPlan?.prices?.find((x) => x.billing_period === 'monthly');

  return (
    <Page
      title="Payment Links"
      lede="Ask a customer to pay without raising an invoice first — a renewal, an upgrade, or a deposit from a prospect."
      actions={mayCreate && (
        <Button onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : 'New payment link'}
        </Button>
      )}
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {data && !data.mail_configured && (
        <Banner tone="warn">
          Email is not configured, so links cannot be sent automatically. They are still created and
          shown here — copy the URL to the customer yourself.
        </Banner>
      )}

      {created && (
        <Panel
          title="Payment link ready"
          description={created.email?.sent
            ? 'Emailed to the customer. The link is below in case it needs sending again by hand.'
            : 'Not emailed — copy this to the customer.'}
        >
          <CopyableSecret
            label="Payment link"
            value={created.url}
            note={`For ${money(created.amount, created.currency)}. Expires ${shortDate(created.expires_at)}. Anyone holding this link can pay it, and it is worth exactly one payment.`}
          />
          <Button variant="ghost" className="mt-3" onClick={() => setCreated(null)}>Close</Button>
        </Panel>
      )}

      {creating && (
        <Panel
          title="New payment link"
          description="Choosing a package copies its price onto the link. If the price list changes afterwards, the customer still pays what they were quoted."
        >
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Customer" id="pl-org" hint="Leave blank for a prospect with no account yet">
              <Select id="pl-org" value={form.organization_id} onChange={pickOrg}>
                <option value="">No customer — one-off</option>
                {orgs.map((o) => (
                  <option key={o.organization_id} value={o.organization_id}>{o.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Package" id="pl-plan" hint="Optional — sets the price and what it grants">
              <Select id="pl-plan" value={form.plan_id} onChange={set('plan_id')}>
                <option value="">No package</option>
                {plans.filter((p) => !p.is_freetrial).map((p) => (
                  <option key={p.plan_id} value={p.plan_id}>{p.name}</option>
                ))}
              </Select>
            </Field>

            <Field
              label="Amount"
              id="pl-amount"
              hint={chosenPlan
                ? `Leave blank to charge ${money(monthly?.price ?? chosenPlan.price)}`
                : 'Required when no package is chosen'}
            >
              <Input id="pl-amount" type="number" min="1" value={form.amount}
                     onChange={set('amount')} placeholder={monthly ? String(monthly.price) : ''} />
            </Field>

            <Field label="Purpose" id="pl-purpose">
              <Select id="pl-purpose" value={form.purpose} onChange={set('purpose')}>
                {['subscription', 'renewal', 'upgrade', 'addon', 'other'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </Field>

            <Field label="Send to" id="pl-email" hint="Leave blank to create the link without emailing">
              <Input id="pl-email" type="email" value={form.customer_email}
                     onChange={set('customer_email')} placeholder="owner@cafe.com" />
            </Field>

            <Field label="Expires in (days)" id="pl-exp" hint="Default 14">
              <Input id="pl-exp" type="number" min="1" value={form.expires_in_days}
                     onChange={set('expires_in_days')} placeholder="14" />
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Description" id="pl-desc" hint="What the customer sees on the pay page">
                <Input id="pl-desc" value={form.description} onChange={set('description')}
                       placeholder="Advanced plan — renewal for September" />
              </Field>
            </div>

            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" className="h-3.5 w-3.5 accent-red-500"
                       checked={form.send_email} onChange={set('send_email')} />
                Email it to the customer
              </label>
              <Button type="submit">Create link</Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel>
        <div className="w-52">
          <Field label="Status" id="pl-status">
            <Select id="pl-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
      </Panel>

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0
          ? <Empty title="No payment links"
                   text="Create one to ask a customer to pay without raising an invoice." />
          : (
            <Table columns={['Created', 'Customer', 'For', 'Amount', 'Sent', 'Expires', 'Status', '']}>
              {data.items.map((l) => (
                <tr key={l.link_id} className={`hover:bg-white/[0.03] ${l.payable ? '' : 'opacity-60'}`}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-neutral-500">
                    {shortDate(l.created_at)}
                    {l.created_by_email && (
                      <div className="text-[10px] text-neutral-700">{l.created_by_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-neutral-300">{l.organization_name || l.customer_name || 'One-off'}</div>
                    {l.customer_email && (
                      <div className="text-[10px] text-neutral-600">{l.customer_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-neutral-400">
                    {l.invoice_no
                      ? <span className="font-mono">{l.invoice_no}</span>
                      : (l.description || l.purpose)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-white">{money(l.amount, l.currency)}</td>
                  <td className="px-4 py-2.5 text-[11px]">
                    {l.send_count > 0
                      ? <span className="text-neutral-400">
                          {relativeTime(l.last_sent_at)}
                          {l.send_count > 1 && <span className="text-neutral-600"> ×{l.send_count}</span>}
                        </span>
                      /* Never sent is worth seeing: a link nobody was told
                         about will never be paid. */
                      : <span className="text-amber-400">not sent</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-neutral-500">{shortDate(l.expires_at)}</td>
                  <td className="px-4 py-2.5">
                    <Pill tone={STATUS_TONE[l.status] || 'mute'}>
                      {l.status === 'open' && !l.payable ? 'expired' : l.status}
                    </Pill>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      {l.payable && (
                        <Button className="!px-2 !py-1 !text-xs" disabled={busy === l.link_id}
                                onClick={() => resend(l)}>
                          {l.send_count > 0 ? 'Resend' : 'Send'}
                        </Button>
                      )}
                      {l.status !== 'paid' && (
                        <Button variant="ghost" className="!px-2 !py-1 !text-xs"
                                onClick={() => navigator.clipboard?.writeText(l.url)
                                  .then(() => setNotice({ tone: 'good', text: 'Link copied' }))
                                  .catch(() => window.prompt('Copy this link:', l.url))}>
                          Copy
                        </Button>
                      )}
                      {mayCancel && l.status === 'open' && (
                        <Button variant="danger" className="!px-2 !py-1 !text-xs"
                                disabled={busy === l.link_id} onClick={() => cancel(l)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
    </Page>
  );
};

export default PaymentLinks;
