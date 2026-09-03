import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, adminAuth, money, shortDate, dateTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select, CopyableSecret
} from '../../components/admin/ui';

/*
 * SaaS billing — invoices, payments and refunds for what cafés pay ManagerXP.
 *
 * Not the café's own till. Every figure here is subscription revenue; a
 * gamer's bill never appears, which is why these live on their own tables and
 * their own screens.
 *
 * Both pages lead with a money summary rather than a row count. "How much is
 * outstanding" is the question; "how many invoices exist" is not.
 */

const INVOICE_TONE = {
  DRAFT: 'mute', OPEN: 'info', PARTIALLY_PAID: 'warn', PAID: 'good',
  OVERDUE: 'bad', PARTIALLY_REFUNDED: 'warn', REFUNDED: 'mute', VOID: 'mute'
};
const PAYMENT_TONE = {
  PENDING: 'warn', SUCCESS: 'good', FAILED: 'bad',
  REFUNDED: 'mute', PARTIALLY_REFUNDED: 'warn'
};

const Summary = ({ items }) => (
  <div className="grid gap-3 sm:grid-cols-3">
    {items.map(([label, value, tone]) => (
      <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white'
        }`}>
          {value}
        </div>
      </div>
    ))}
  </div>
);

/* ==========================================================================
   INVOICES
   ========================================================================== */
export const Invoices = () => {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [run, setRun] = useState(null);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);

  const mayBill = adminAuth.can('subscriptions.edit');
  const mayPay = adminAuth.can('payments.view');

  const load = useCallback(() => {
    adminApi.invoices({ q: query, status, size: 100 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [query, status]);
  useEffect(() => { load(); }, [load]);

  const preview = async () => {
    setBusy(true); setNotice(null);
    try {
      const d = await adminApi.runBilling({ dry_run: true });
      setRun(d);
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    const willBill = run.results.filter((r) => r.would_bill != null);
    if (!window.confirm(
      `Issue ${willBill.length} invoice${willBill.length === 1 ? '' : 's'}?\n\n` +
      'This creates money owed by these customers. It cannot be undone — an ' +
      'invoice raised in error has to be voided, and its number stays used.'
    )) return;
    setBusy(true);
    try {
      const d = await adminApi.runBilling({ dry_run: false });
      setRun(null);
      load();
      setNotice({ tone: 'good', text: d.results ? `${d.results.filter((r) => r.invoice_no).length} invoice(s) issued` : 'Done' });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(false); }
  };

  const open = async (inv) => {
    try { setDetail(await adminApi.invoice(inv.invoice_id)); }
    catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const pay = async (inv) => {
    const balance = Number(inv.total) - Number(inv.amount_paid);
    const amount = window.prompt(
      `Record a payment against ${inv.invoice_no}.\n\nOutstanding: ${balance}`,
      String(balance)
    );
    if (!amount) return;
    const reference = window.prompt('Reference (bank ref, cheque number, transaction id)') || '';
    try {
      const r = await adminApi.recordPayment(inv.invoice_id, {
        amount: Number(amount), method: 'bank_transfer', reference
      });
      load();
      if (detail?.invoice.invoice_id === inv.invoice_id) open(inv);
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  /* One action, two outcomes, and the difference is stated rather than
     assumed: the link is always created and always shown, and whether it was
     also emailed is reported separately. A "sent" toast when SMTP is not
     configured would leave the operator waiting for a reply to a message that
     never left. */
  const sendLink = async (inv) => {
    const to = window.prompt(
      `Send a payment link for ${inv.invoice_no}?\n\n` +
      `Amount: ${Number(inv.total) - Number(inv.amount_paid)}\n\n` +
      'Email address (leave as-is to use the one on file, or clear it to just get the link):',
      inv.organization_email || ''
    );
    if (to === null) return;
    try {
      const r = await adminApi.createPaymentLink(inv.invoice_id, {
        send_email: !!to.trim(), email: to.trim() || undefined
      });
      setLink({ invoice: inv, ...r.data, message: r.message });
      setNotice({ tone: r.data?.email?.sent ? 'good' : 'warn', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const voidIt = async (inv) => {
    const reason = window.prompt(
      `Void ${inv.invoice_no}?\n\nThe invoice and its number survive — voiding is ` +
      'how a mistake is corrected without a gap in the sequence.\n\nWhy?'
    );
    if (!reason?.trim()) return;
    try {
      const r = await adminApi.voidInvoice(inv.invoice_id, reason.trim());
      load(); setDetail(null);
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const s = data?.summary;

  return (
    <Page
      title="Invoices"
      lede="What ManagerXP has billed its customers for their subscriptions."
      actions={mayBill && <Button onClick={preview} disabled={busy}>
        {busy ? 'Working…' : 'Run monthly billing'}
      </Button>}
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {run && (
        <Panel
          title="Billing preview"
          description="Nothing has been issued yet. This is what the run would do."
        >
          {run.results.filter((r) => r.would_bill != null).length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nothing is due. {run.results.filter((r) => r.skipped === 'not_due').length} subscription(s)
              are paid up to a future date.
            </p>
          ) : (
            <Table columns={['Customer', 'Package', 'Period', 'Amount']}>
              {run.results.filter((r) => r.would_bill != null).map((r) => (
                <tr key={r.subscription_id}>
                  <td className="px-4 py-2 text-neutral-200">{r.organization}</td>
                  <td className="px-4 py-2 text-neutral-400">{r.plan || '—'}</td>
                  <td className="px-4 py-2 text-[11px] text-neutral-500">
                    {r.period_start} → {r.period_end}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-white">{money(r.would_bill, r.currency)}</td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-4 flex gap-2">
            {run.results.some((r) => r.would_bill != null) && (
              <Button onClick={commit} disabled={busy}>Issue these invoices</Button>
            )}
            <Button variant="ghost" onClick={() => setRun(null)}>Close</Button>
          </div>
        </Panel>
      )}

      {link && (
        <Panel
          title={`Payment link for ${link.invoice.invoice_no}`}
          description={link.email?.sent
            ? `Emailed to ${link.invoice.organization_email || 'the customer'}. The link is below in case it needs resending by hand.`
            : 'Not emailed — copy this to the customer.'}
        >
          <CopyableSecret
            label="Payment link"
            value={link.url}
            note={`For ${money(link.amount, link.currency)}. Expires ${shortDate(link.expires_at)}. Anyone holding this link can pay it, and it is worth exactly one payment.`}
          />
          <Button variant="ghost" className="mt-3" onClick={() => setLink(null)}>Close</Button>
        </Panel>
      )}

      {s && <Summary items={[
        ['Billed', money(s.billed)],
        ['Collected', money(s.collected), 'good'],
        ['Outstanding', money(s.outstanding), s.outstanding > 0 ? 'bad' : 'default']
      ]} />}

      <Panel>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}
              className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Search" id="iv-q">
              <Input id="iv-q" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Invoice number or customer" />
            </Field>
          </div>
          <div className="w-48">
            <Field label="Status" id="iv-status">
              <Select id="iv-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {Object.keys(INVOICE_TONE).map((k) => (
                  <option key={k} value={k}>{k.replace('_', ' ').toLowerCase()}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Panel>

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0
          ? <Empty title="No invoices yet"
                   text="Run the monthly billing to raise invoices for active subscriptions." />
          : (
            <Table columns={['Invoice', 'Customer', 'Period', 'Total', 'Paid', 'Balance', 'Due', 'Status', '']}>
              {data.items.map((inv) => (
                <tr key={inv.invoice_id} className={`hover:bg-white/[0.03] ${inv.status === 'VOID' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => open(inv)}
                            className="font-mono text-xs font-semibold text-white hover:text-red-300">
                      {inv.invoice_no}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link to={`/admin/organizations/${inv.organization_id}`}
                          className="text-neutral-300 transition hover:text-white">
                      {inv.organization_name || '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-neutral-500">
                    {shortDate(inv.period_start)} → {shortDate(inv.period_end)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-white">{money(inv.total, inv.currency)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-400">{money(inv.amount_paid, inv.currency)}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    <span className={Number(inv.balance) > 0 ? 'text-amber-300' : 'text-neutral-600'}>
                      {money(inv.balance, inv.currency)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-neutral-500">{shortDate(inv.due_date)}</td>
                  <td className="px-4 py-2.5">
                    <Pill tone={INVOICE_TONE[inv.status] || 'mute'}>
                      {String(inv.status).replace('_', ' ').toLowerCase()}
                    </Pill>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      {mayPay && Number(inv.balance) > 0 && inv.status !== 'VOID' && (
                        <>
                          <Button className="!px-2 !py-1 !text-xs" onClick={() => sendLink(inv)}>
                            Send link
                          </Button>
                          <Button variant="ghost" className="!px-2 !py-1 !text-xs"
                                  onClick={() => pay(inv)}>Record payment</Button>
                        </>
                      )}
                      {mayBill && inv.status !== 'VOID' && Number(inv.amount_paid) === 0 && (
                        <Button variant="danger" className="!px-2 !py-1 !text-xs"
                                onClick={() => voidIt(inv)}>Void</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}

      {detail && (
        <Panel
          title={`${detail.invoice.invoice_no} — ${detail.invoice.organization_name}`}
          description={`${shortDate(detail.invoice.period_start)} to ${shortDate(detail.invoice.period_end)}`}
        >
          <Table columns={['Description', 'Qty', 'Unit', 'Amount']}>
            {detail.lines.map((l) => (
              <tr key={l.line_id}>
                <td className="px-4 py-2 text-neutral-200">{l.description}</td>
                <td className="px-4 py-2 tabular-nums text-neutral-400">{l.quantity}</td>
                <td className="px-4 py-2 tabular-nums text-neutral-400">{money(l.unit_price, detail.invoice.currency)}</td>
                <td className="px-4 py-2 tabular-nums text-white">{money(l.amount, detail.invoice.currency)}</td>
              </tr>
            ))}
          </Table>

          <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            {[
              ['Subtotal', detail.invoice.subtotal],
              ['Discount', -detail.invoice.discount_amount],
              [`Tax (${detail.invoice.tax_percent}%)`, detail.invoice.tax_amount]
            ].map(([label, v]) => (
              <div key={label} className="flex justify-between text-neutral-400">
                <span>{label}</span>
                <span className="tabular-nums">{money(v, detail.invoice.currency)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-white/10 pt-1 font-semibold text-white">
              <span>Total</span>
              <span className="tabular-nums">{money(detail.invoice.total, detail.invoice.currency)}</span>
            </div>
            <div className="flex justify-between text-emerald-300">
              <span>Paid</span>
              <span className="tabular-nums">{money(detail.invoice.amount_paid, detail.invoice.currency)}</span>
            </div>
            {Number(detail.invoice.amount_refunded) > 0 && (
              <div className="flex justify-between text-amber-300">
                <span>Refunded</span>
                <span className="tabular-nums">{money(detail.invoice.amount_refunded, detail.invoice.currency)}</span>
              </div>
            )}
          </div>

          {detail.payments.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Payments</div>
              {detail.payments.map((p) => (
                <div key={p.payment_id}
                     className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <span className="text-neutral-300">
                    {money(p.amount, p.currency)} · {p.method}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <span className="text-[11px] text-neutral-600">{dateTime(p.received_at)}</span>
                </div>
              ))}
            </div>
          )}

          <Button variant="ghost" className="mt-4" onClick={() => setDetail(null)}>Close</Button>
        </Panel>
      )}
    </Page>
  );
};

/* ==========================================================================
   PAYMENTS
   ========================================================================== */
export const Payments = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(null);

  const mayRefund = adminAuth.can('payments.refund');

  const load = useCallback(() => {
    adminApi.payments({ q: query, status, size: 100 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [query, status]);
  useEffect(() => { load(); }, [load]);

  const refund = async (p) => {
    const remaining = Number(p.amount) - Number(p.amount_refunded);
    const amount = window.prompt(
      `Refund against this ${money(p.amount, p.currency)} payment.\n\n` +
      `Already refunded: ${money(p.amount_refunded, p.currency)}\n` +
      `Refundable: ${money(remaining, p.currency)}\n\n` +
      'Enter an amount, or accept the full remainder.',
      String(remaining)
    );
    if (!amount) return;
    const reason = window.prompt('Why is this being refunded?');
    if (!reason?.trim()) return;

    setBusy(p.payment_id);
    try {
      const r = await adminApi.refundPayment(p.payment_id, {
        amount: Number(amount), reason: reason.trim(), method: 'original'
      });
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  const s = data?.summary;

  return (
    <Page
      title="Payments"
      lede="Subscription revenue received from cafés. A café's own takings are its business and never appear here."
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {s && <Summary items={[
        ['Received', money(s.received), 'good'],
        ['Refunded', money(s.refunded), s.refunded > 0 ? 'bad' : 'default'],
        ['Net', money(s.net)]
      ]} />}

      <Panel>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}
              className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Search" id="pm-q">
              <Input id="pm-q" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Customer, invoice, reference or transaction id" />
            </Field>
          </div>
          <div className="w-48">
            <Field label="Status" id="pm-status">
              <Select id="pm-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {Object.keys(PAYMENT_TONE).map((k) => (
                  <option key={k} value={k}>{k.replace('_', ' ').toLowerCase()}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Panel>

      {!data ? <Skeleton rows={4} height="h-12" />
        : data.items.length === 0
          ? <Empty title="No payments recorded"
                   text="Payments appear here as invoices are settled." />
          : (
            <Table columns={['Received', 'Customer', 'Invoice', 'Amount', 'Refunded', 'Net', 'Method', 'Status', '']}>
              {data.items.map((p) => {
                const remaining = Number(p.amount) - Number(p.amount_refunded);
                return (
                  <tr key={p.payment_id} className="hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-neutral-500">
                      {dateTime(p.received_at)}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-300">{p.organization_name || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-500">
                      {p.invoice_no || '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-white">{money(p.amount, p.currency)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-neutral-500">
                      {Number(p.amount_refunded) > 0 ? money(p.amount_refunded, p.currency) : '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-neutral-300">{money(p.net_amount, p.currency)}</td>
                    <td className="px-4 py-2.5 text-[11px] text-neutral-500">{p.method}</td>
                    <td className="px-4 py-2.5">
                      <Pill tone={PAYMENT_TONE[p.status] || 'mute'}>
                        {String(p.status).replace('_', ' ').toLowerCase()}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {mayRefund && remaining > 0 && p.status !== 'FAILED' && (
                        <Button variant="danger" className="!px-2 !py-1 !text-xs"
                                disabled={busy === p.payment_id}
                                onClick={() => refund(p)}>Refund</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
    </Page>
  );
};
