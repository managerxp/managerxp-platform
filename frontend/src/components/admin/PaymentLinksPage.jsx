import React, { useCallback, useEffect, useState } from 'react';
import { platformApi, formatMoney, formatDate } from '../../lib/platformApi';

/*
 * Payment links: generate a URL for an amount, send it, watch it settle.
 *
 * The amount is fixed on the server when the link is created and the pay page
 * only ever renders it — so nothing here, and nothing the customer can do in
 * their browser, changes what gets charged. Choosing a plan fills the amount
 * in as a convenience; the figure is still frozen server-side at creation, so
 * a later price change cannot alter a quote already sent.
 */

const STATUS_TONE = {
  open: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  expired: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  cancelled: 'bg-neutral-800 text-neutral-500 border-neutral-700'
};

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Awaiting payment' },
  { id: 'paid', label: 'Paid' },
  { id: 'expired', label: 'Expired' }
];

const PaymentLinksPage = ({ prefillCafe, onPrefillUsed }) => {
  const [links, setLinks] = useState([]);
  const [cafes, setCafes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const [form, setForm] = useState({
    cafe_id: '', sub_id: '', amount: '', purpose: 'subscription',
    description: '', expires_in_days: 14,
    customer_name: '', customer_email: ''
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      platformApi.paymentLinks(filter || undefined),
      platformApi.cafes().catch(() => []),
      platformApi.plans().catch(() => [])
    ])
      .then(([l, c, p]) => { setLinks(l); setCafes(c); setPlans(p); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Arriving from "Send payment link" on a customer card.
  useEffect(() => {
    if (!prefillCafe) return;
    setForm((f) => ({ ...f, cafe_id: String(prefillCafe.cafe_id) }));
    onPrefillUsed?.();
  }, [prefillCafe, onPrefillUsed]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /* Picking a plan fills the amount so the admin sees what will be charged
     before sending. They may still override it — a discount is a normal thing
     to want — and whatever is showing is what the server freezes. */
  const chosenPlan = plans.find((p) => String(p.sub_id) === String(form.sub_id));
  const suggested = chosenPlan ? Number(chosenPlan.price) + Number(chosenPlan.setup_fee || 0) : null;
  const effectiveAmount = form.amount !== '' ? Number(form.amount) : suggested;

  const submit = async (e) => {
    e.preventDefault();
    if (!effectiveAmount || effectiveAmount <= 0) {
      setError('Enter an amount, or choose a plan that has a price.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const created = await platformApi.createPaymentLink({
        cafe_id: form.cafe_id || null,
        sub_id: form.sub_id || null,
        amount: form.amount !== '' ? Number(form.amount) : undefined,
        purpose: form.purpose,
        description: form.description || undefined,
        expires_in_days: Number(form.expires_in_days) || 14,
        customer_name: form.customer_name || undefined,
        customer_email: form.customer_email || undefined
      });

      setForm((f) => ({ ...f, amount: '', description: '', customer_name: '', customer_email: '' }));
      load();

      // The link is useless until it is somewhere the admin can paste it.
      try {
        await navigator.clipboard.writeText(created.url);
        setCopiedId(created.link_id);
        setTimeout(() => setCopiedId(null), 2500);
      } catch {
        /* Clipboard is blocked in some browsers; the row shows the URL anyway. */
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copy = async (link) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.link_id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt('Copy this link:', link.url);
    }
  };

  const cancel = async (link) => {
    if (!window.confirm(`Cancel this ${formatMoney(link.amount, link.currency)} link? It stops working immediately.`)) return;
    try {
      await platformApi.cancelPaymentLink(link.link_id);
      load();
    } catch (e) {
      window.alert(e.message);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-red-500/50';
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5';

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-white">Payment links</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Generate a link for an amount and send it. Paying it renews the subscription automatically.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      {/* ---- generator ---- */}
      <form onSubmit={submit} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">New link</h3>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="pl-cafe">Customer</label>
            <select id="pl-cafe" value={form.cafe_id} onChange={set('cafe_id')} className={inputClass}>
              <option value="">Not a registered café</option>
              {cafes.map((c) => (
                <option key={c.cafe_id} value={c.cafe_id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="pl-plan">Plan</label>
            <select id="pl-plan" value={form.sub_id} onChange={set('sub_id')} className={inputClass}>
              <option value="">No plan — just an amount</option>
              {plans.map((p) => (
                <option key={p.sub_id} value={p.sub_id}>
                  {p.name} — {formatMoney(p.price, p.currency)}/{p.billing_period}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="pl-amount">Amount</label>
            <input
              id="pl-amount"
              type="number"
              min="1"
              step="1"
              value={form.amount}
              onChange={set('amount')}
              placeholder={suggested != null ? String(suggested) : 'e.g. 2499'}
              className={inputClass}
            />
            {suggested != null && form.amount === '' && (
              <p className="mt-1 text-xs text-neutral-500">
                Using the plan price: {formatMoney(suggested)}
              </p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="pl-purpose">Purpose</label>
            <select id="pl-purpose" value={form.purpose} onChange={set('purpose')} className={inputClass}>
              <option value="subscription">New subscription</option>
              <option value="renewal">Renewal</option>
              <option value="upgrade">Upgrade</option>
              <option value="addon">Add-on</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="pl-expiry">Link valid for</label>
            <select id="pl-expiry" value={form.expires_in_days} onChange={set('expires_in_days')} className={inputClass}>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="pl-desc">Description</label>
            <input
              id="pl-desc"
              type="text"
              value={form.description}
              onChange={set('description')}
              placeholder={chosenPlan ? `${chosenPlan.name} — ${chosenPlan.no_of_days} days` : 'What is this for?'}
              className={inputClass}
            />
          </div>
        </div>

        {!form.cafe_id && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="pl-name">Send to (name)</label>
              <input id="pl-name" type="text" value={form.customer_name} onChange={set('customer_name')}
                     placeholder="Prospect name" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="pl-email">Send to (email)</label>
              <input id="pl-email" type="email" value={form.customer_email} onChange={set('customer_email')}
                     placeholder="name@cafe.com" className={inputClass} />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
          >
            {creating ? 'Generating…' : 'Generate link'}
          </button>
          {effectiveAmount > 0 && (
            <span className="text-sm text-neutral-400">
              Will charge <strong className="text-white">{formatMoney(effectiveAmount)}</strong>
              {chosenPlan && <> for {chosenPlan.no_of_days} days</>}
            </span>
          )}
        </div>
      </form>

      {/* ---- filters ---- */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              filter === f.id
                ? 'border-red-500/40 bg-red-500/15 text-white'
                : 'border-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ---- list ---- */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40" />
          ))}
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center text-sm text-neutral-400">
          No payment links yet. Generate one above and send it to a customer.
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <article key={link.link_id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-white">
                      {formatMoney(link.amount, link.currency)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[link.status]}`}>
                      {link.status === 'open' ? 'awaiting payment' : link.status}
                    </span>
                    {link.plan_name && (
                      <span className="text-xs text-neutral-500">{link.plan_name}</span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-neutral-400">
                    {link.cafe_name || link.customer_name || 'Unassigned'}
                    {link.customer_email && <span className="text-neutral-500"> · {link.customer_email}</span>}
                  </p>
                  {link.description && (
                    <p className="mt-0.5 text-xs text-neutral-500">{link.description}</p>
                  )}

                  <p className="mt-2 truncate font-mono text-xs text-neutral-500">{link.url}</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="text-right text-xs text-neutral-500">
                    {link.status === 'paid'
                      ? <>paid {formatDate(link.paid_at)}</>
                      : <>expires {formatDate(link.expires_at)}</>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => copy(link)}
                      className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-300 transition hover:border-red-500/50 hover:text-white"
                    >
                      {copiedId === link.link_id ? 'Copied' : 'Copy link'}
                    </button>
                    {link.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => cancel(link)}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-400 transition hover:border-red-500/50 hover:text-red-300"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default PaymentLinksPage;
