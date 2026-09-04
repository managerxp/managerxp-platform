import React, { useCallback, useEffect, useState } from 'react';
import { platformApi, formatMoney, formatDate } from '../../lib/platformApi';

/*
 * Selling and renewing subscriptions by hand — for the money that arrives
 * outside a payment link: a bank transfer, a cheque, a deal done on a call.
 *
 * Renewals extend from the current end date rather than from today, so a
 * customer who renews early keeps the days they already paid for. The form
 * says so explicitly, because the opposite behaviour is common enough
 * elsewhere that an operator would reasonably expect it and be wrong.
 */

const SubscriptionsPage = () => {
  const [subs, setSubs] = useState([]);
  const [cafes, setCafes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const [form, setForm] = useState({
    cafe_id: '', sub_id: '', days: '', max_pcs: '',
    record_payment: false, amount: '', method: 'bank_transfer', reference: ''
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      platformApi.subscriptions(),
      platformApi.cafes().catch(() => []),
      platformApi.plans().catch(() => []),
      platformApi.payments().catch(() => [])
    ])
      .then(([s, c, p, pay]) => { setSubs(s); setCafes(c); setPlans(p); setPayments(pay); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const chosenPlan = plans.find((p) => String(p.sub_id) === String(form.sub_id));
  const existing = subs.find(
    (s) => String(s.cafe_id) === String(form.cafe_id) && s.is_active && s.days_remaining > 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.cafe_id || !form.sub_id) {
      setError('Choose a customer and a plan.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await platformApi.createSubscription({
        cafe_id: Number(form.cafe_id),
        sub_id: Number(form.sub_id),
        days: form.days ? Number(form.days) : undefined,
        max_pcs: form.max_pcs ? Number(form.max_pcs) : undefined,
        record_payment: form.record_payment,
        amount: form.record_payment ? Number(form.amount) : undefined,
        method: form.method,
        reference: form.reference || undefined
      });
      setNotice(res.message);
      setTimeout(() => setNotice(null), 4000);
      setForm((f) => ({ ...f, days: '', max_pcs: '', amount: '', reference: '', record_payment: false }));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-red-500/50';
  const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5';

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-white">Subscriptions</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Start or renew a subscription directly — for money that arrived outside a payment link.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>
      )}

      {/* ---- create / renew ---- */}
      <form onSubmit={submit} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Start or renew</h3>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="sb-cafe">Customer</label>
            <select id="sb-cafe" value={form.cafe_id} onChange={set('cafe_id')} className={inputClass} required>
              <option value="">Choose a café…</option>
              {cafes.map((c) => <option key={c.cafe_id} value={c.cafe_id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="sb-plan">Plan</label>
            <select id="sb-plan" value={form.sub_id} onChange={set('sub_id')} className={inputClass} required>
              <option value="">Choose a plan…</option>
              {plans.map((p) => (
                <option key={p.sub_id} value={p.sub_id}>
                  {p.name} — {formatMoney(p.price, p.currency)}/{p.billing_period}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="sb-days">Days</label>
            <input id="sb-days" type="number" min="1" value={form.days} onChange={set('days')}
                   placeholder={chosenPlan ? String(chosenPlan.no_of_days) : 'plan default'}
                   className={inputClass} />
          </div>

          <div>
            <label className={labelClass} htmlFor="sb-pcs">Stations licensed</label>
            <input id="sb-pcs" type="number" min="1" value={form.max_pcs} onChange={set('max_pcs')}
                   placeholder={chosenPlan ? String(chosenPlan.max_pcs) : 'plan default'}
                   className={inputClass} />
          </div>
        </div>

        {/* The behaviour an operator would otherwise have to discover. */}
        {existing && (
          <p className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-400">
            This customer already has {existing.days_remaining} days left on {existing.plan_name}.
            Renewing <strong className="text-white">adds to</strong> that rather than restarting from today.
          </p>
        )}

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-neutral-300">
          <input type="checkbox" checked={form.record_payment} onChange={set('record_payment')}
                 className="mt-0.5 accent-red-500" />
          <span>
            Record a payment with this
            <span className="block text-xs text-neutral-500">
              Tick only if the money has already arrived. A payment link records its own.
            </span>
          </span>
        </label>

        {form.record_payment && (
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="sb-amount">Amount received</label>
              <input id="sb-amount" type="number" min="1" value={form.amount} onChange={set('amount')}
                     placeholder={chosenPlan ? String(chosenPlan.price) : '0'} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="sb-method">How</label>
              <select id="sb-method" value={form.method} onChange={set('method')} className={inputClass}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="sb-ref">Reference</label>
              <input id="sb-ref" type="text" value={form.reference} onChange={set('reference')}
                     placeholder="UTR / cheque no." className={inputClass} />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
        >
          {saving ? 'Saving…' : existing ? 'Renew subscription' : 'Start subscription'}
        </button>
      </form>

      {/* ---- live subscriptions ---- */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white">Current subscriptions</h3>
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40" />
        ) : subs.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center text-sm text-neutral-400">
            Nothing sold yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900/80 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold">Plan</th>
                  <th className="px-4 py-2.5 font-semibold">Stations</th>
                  <th className="px-4 py-2.5 font-semibold">Renews</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {subs.map((s) => {
                  const lapsed = s.days_remaining != null && s.days_remaining < 0;
                  const soon = s.days_remaining != null && s.days_remaining >= 0 && s.days_remaining <= 14;
                  return (
                    <tr key={s.subscription_id} className="text-neutral-300">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{s.cafe_name}</div>
                        <div className="text-xs text-neutral-500">{s.owner_email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {s.plan_name}
                        {s.price > 0 && (
                          <div className="text-xs text-neutral-500">
                            {formatMoney(s.price, s.currency)}/{s.billing_period}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{s.max_pcs}</td>
                      <td className="px-4 py-3">{formatDate(s.end_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          lapsed ? 'border-red-500/30 bg-red-500/15 text-red-300'
                            : soon ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                            : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                        }`}>
                          {lapsed ? `lapsed ${Math.abs(s.days_remaining)}d ago` : `${s.days_remaining}d left`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- money in ---- */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white">Payments received</h3>
        {payments.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center text-sm text-neutral-400">
            No payments recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900/80 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Received</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">How</th>
                  <th className="px-4 py-2.5 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {payments.map((p) => (
                  <tr key={p.payment_id} className="text-neutral-300">
                    <td className="px-4 py-3">{formatDate(p.received_at)}</td>
                    <td className="px-4 py-3">{p.cafe_name || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-white">{formatMoney(p.amount, p.currency)}</td>
                    <td className="px-4 py-3">{p.method.replace('_', ' ')}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default SubscriptionsPage;
