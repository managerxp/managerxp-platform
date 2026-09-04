import React, { useEffect, useState } from 'react';
import { platformApi, formatMoney } from '../../lib/platformApi';

/*
 * Pricing for each plan.
 *
 * Kept apart from the plan editor above it on purpose. That form defines what
 * a plan *allows* — branches, stations, telemetry — and posts to an open
 * endpoint. Price is what a plan *costs*, it is the number a payment link
 * charges, and it belongs behind the platform-admin guard. Mixing the two
 * would have meant either loosening that guard or locking down a form that
 * works today.
 */
const PlanPricingPanel = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // sub_id
  const [draft, setDraft] = useState({ price: '', billing_period: 'monthly', setup_fee: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    platformApi.plans()
      .then((d) => { setPlans(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const startEdit = (plan) => {
    setEditing(plan.sub_id);
    setDraft({
      price: String(plan.price ?? ''),
      billing_period: plan.billing_period || 'monthly',
      setup_fee: String(plan.setup_fee ?? '')
    });
  };

  const save = async (plan) => {
    setSaving(true);
    try {
      await platformApi.updatePlanPricing(plan.sub_id, {
        price: Number(draft.price) || 0,
        billing_period: draft.billing_period,
        setup_fee: Number(draft.setup_fee) || 0,
        currency: plan.currency || 'INR'
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="mb-6 h-28 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40" />;
  }

  return (
    <section className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">Pricing</h3>
        <p className="mt-1 text-xs text-neutral-400">
          What each plan costs. Payment links use these figures, and a link keeps the price it was
          created with even if you change it here afterwards.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/35 bg-red-500/10 p-2.5 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="pb-2 font-semibold">Plan</th>
              <th className="pb-2 font-semibold">Price</th>
              <th className="pb-2 font-semibold">Billing</th>
              <th className="pb-2 font-semibold">Setup fee</th>
              <th className="pb-2 font-semibold">Monthly value</th>
              <th className="pb-2 font-semibold">Live</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {plans.map((plan) => {
              const isEditing = editing === plan.sub_id;
              const inputClass =
                'w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500/50';

              return (
                <tr key={plan.sub_id} className="text-neutral-300">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-white">{plan.name}</span>
                    {plan.is_freetrial && (
                      <span className="ml-2 rounded-full border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-400">
                        trial
                      </span>
                    )}
                  </td>

                  <td className="py-2.5 pr-4">
                    {isEditing ? (
                      <input
                        type="number" min="0" value={draft.price}
                        onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                        className={inputClass} aria-label={`Price for ${plan.name}`}
                      />
                    ) : plan.price > 0 ? (
                      <span className="font-semibold text-white">{formatMoney(plan.price, plan.currency)}</span>
                    ) : (
                      /* Zero is a real answer for a trial but a mistake for
                         anything else, so it is called out rather than shown
                         as a confident ₹0. */
                      <span className={plan.is_freetrial ? 'text-neutral-500' : 'text-amber-300'}>
                        {plan.is_freetrial ? 'Free' : 'Not priced'}
                      </span>
                    )}
                  </td>

                  <td className="py-2.5 pr-4">
                    {isEditing ? (
                      <select
                        value={draft.billing_period}
                        onChange={(e) => setDraft((d) => ({ ...d, billing_period: e.target.value }))}
                        className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white outline-none focus:border-red-500/50"
                        aria-label={`Billing period for ${plan.name}`}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                        <option value="one_time">One-time</option>
                      </select>
                    ) : (
                      <span className="capitalize">{(plan.billing_period || '').replace('_', ' ')}</span>
                    )}
                  </td>

                  <td className="py-2.5 pr-4">
                    {isEditing ? (
                      <input
                        type="number" min="0" value={draft.setup_fee}
                        onChange={(e) => setDraft((d) => ({ ...d, setup_fee: e.target.value }))}
                        className={inputClass} aria-label={`Setup fee for ${plan.name}`}
                      />
                    ) : Number(plan.setup_fee) > 0 ? (
                      formatMoney(plan.setup_fee, plan.currency)
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>

                  <td className="py-2.5 pr-4 text-neutral-400">
                    {plan.billing_period === 'one_time'
                      ? <span className="text-neutral-600" title="One-off sales are revenue but not recurring">—</span>
                      : formatMoney(plan.monthly_value, plan.currency)}
                  </td>

                  <td className="py-2.5 pr-4 text-neutral-400">{plan.active_subscriptions}</td>

                  <td className="py-2.5 text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button" disabled={saving} onClick={() => save(plan)}
                          className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button" onClick={() => setEditing(null)}
                          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-400 transition hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button" onClick={() => startEdit(plan)}
                        className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300 transition hover:border-red-500/50 hover:text-white"
                      >
                        Set price
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default PlanPricingPanel;
