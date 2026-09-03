import React, { useEffect, useState } from 'react';
import { platformApi } from '../../lib/platformApi';
import { Panel, Button, Field, Input, Select, Banner, CopyableSecret } from './ui';

/*
 * Setting up a new café owner.
 *
 * One form, one call. Onboarding used to mean creating an account, then a
 * café, then a subscription, then a licence as four separate actions — and
 * every gap between them was a customer who could not start: a café with no
 * owner, an owner with no key. The server does all four in one transaction,
 * so either the customer is ready or nothing was created.
 */
const NewCustomerForm = ({ onDone, onCancel }) => {
  const [plans, setPlans] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [form, setForm] = useState({
    cafe_name: '', owner_name: '', owner_email: '', owner_phone: '',
    owner_designation: 'Owner', city: '', state: '',
    product: 'cafexp', sub_id: '', days: '', max_pcs: ''
  });

  useEffect(() => {
    platformApi.plans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const plan = plans.find((p) => String(p.sub_id) === String(form.sub_id));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = await platformApi.createCafe({
        cafe_name: form.cafe_name.trim(),
        owner_name: form.owner_name.trim(),
        owner_email: form.owner_email.trim(),
        owner_phone: form.owner_phone.trim() || undefined,
        owner_designation: form.owner_designation.trim() || 'Owner',
        address: { city: form.city.trim(), state: form.state.trim() },
        product: form.product,
        sub_id: form.sub_id || undefined,
        days: form.days ? Number(form.days) : undefined,
        max_pcs: form.max_pcs ? Number(form.max_pcs) : undefined
      });
      setResult(data);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ---- what the admin has to hand over before closing ---- */
  if (result) {
    return (
      <Panel title={`${result.cafe.name} is set up`}>
        <div className="space-y-4">
          <Banner tone="good">
            <strong>{result.owner.name}</strong> can sign in at the customer portal with{' '}
            <strong>{result.owner.email}</strong>.
            {result.subscription && (
              <> Their subscription runs to{' '}
                {new Date(result.subscription.end_date).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'long', year: 'numeric'
                })}.
              </>
            )}
          </Banner>

          {/* Both of these are shown once and are not retrievable afterwards,
              so they are given the most prominent treatment on the page. */}
          {result.temporary_password && (
            <CopyableSecret
              label="Temporary password"
              value={result.temporary_password}
              note="Give this to the owner. It cannot be shown again — you would have to reset it."
            />
          )}

          {result.license && (
            <CopyableSecret
              label={`${result.license.product === 'racexp' ? 'RaceXP' : 'CafeXP'} licence key`}
              value={result.license.license_key}
              note="Entered once when the software first runs on their machine."
            />
          )}

          <div className="flex gap-2">
            <Button type="button" onClick={() => { setResult(null); onCancel?.(); }}>Done</Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setResult(null);
                setForm((f) => ({
                  ...f, cafe_name: '', owner_name: '', owner_email: '', owner_phone: '', city: '', state: ''
                }));
              }}
            >
              Add another
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="New customer"
      description="Creates the owner's account, the café, its subscription and its licence key together."
    >
      {error && <div className="mb-4"><Banner tone="bad">{error}</Banner></div>}

      <form onSubmit={submit} className="space-y-5">
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">The café</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Café name" id="nc-cafe">
              <Input id="nc-cafe" value={form.cafe_name} onChange={set('cafe_name')}
                     placeholder="Neon Arcade" required />
            </Field>
            <Field label="Product" id="nc-product">
              <Select id="nc-product" value={form.product} onChange={set('product')}>
                <option value="cafexp">CafeXP</option>
                <option value="racexp">RaceXP</option>
              </Select>
            </Field>
            <Field label="City" id="nc-city">
              <Input id="nc-city" value={form.city} onChange={set('city')} placeholder="Kochi" />
            </Field>
            <Field label="State" id="nc-state">
              <Input id="nc-state" value={form.state} onChange={set('state')} placeholder="Kerala" />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">The owner</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Full name" id="nc-owner">
              <Input id="nc-owner" value={form.owner_name} onChange={set('owner_name')}
                     placeholder="Priya Nair" required />
            </Field>
            <Field label="Email" id="nc-email" hint="They sign in with this">
              <Input id="nc-email" type="email" value={form.owner_email} onChange={set('owner_email')}
                     placeholder="priya@neonarcade.com" required />
            </Field>
            <Field label="Phone" id="nc-phone">
              <Input id="nc-phone" value={form.owner_phone} onChange={set('owner_phone')}
                     placeholder="98765 00011" />
            </Field>
            <Field label="Designation" id="nc-desig">
              <Input id="nc-desig" value={form.owner_designation} onChange={set('owner_designation')}
                     placeholder="Owner" />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Subscription <span className="normal-case text-neutral-600">— optional, you can sell one later</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Plan" id="nc-plan">
              <Select id="nc-plan" value={form.sub_id} onChange={set('sub_id')}>
                <option value="">No plan yet</option>
                {plans.map((p) => (
                  <option key={p.sub_id} value={p.sub_id}>
                    {p.name}{p.is_freetrial ? ' (trial)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Days" id="nc-days">
              <Input id="nc-days" type="number" min="1" value={form.days} onChange={set('days')}
                     placeholder={plan ? String(plan.no_of_days) : 'plan default'} />
            </Field>
            <Field label="Stations licensed" id="nc-pcs">
              <Input id="nc-pcs" type="number" min="1" value={form.max_pcs} onChange={set('max_pcs')}
                     placeholder={plan ? String(plan.max_pcs) : 'plan default'} />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
          <Button type="submit" disabled={saving}>
            {saving ? 'Setting up…' : 'Create customer'}
          </Button>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
          <p className="w-full text-xs text-neutral-500 sm:w-auto sm:self-center">
            A licence key and a temporary password are generated and shown once.
          </p>
        </div>
      </form>
    </Panel>
  );
};

export default NewCustomerForm;
