import React, { useState } from 'react';
import { portalApi, portalAuth } from '../../lib/portalApi';
import { Button, Field, Input, Banner } from './ui';
import AuthLayout from '../AuthLayout';

/*
 * The other half of signing up.
 *
 * Someone can arrive signed in but with no business: they registered on the
 * ManagerXP site, or an invitation was withdrawn. Sending them back to the
 * public trial form would fail — their email already exists — so they finish
 * setting up here, in the dashboard, and the same page they are standing on
 * becomes their dashboard when they are done.
 *
 * The fields are the ones the trial form asks for after the account step, and
 * only the business name is required. Everything else can be filled in later
 * from Organization, and asking for it now would be a gate rather than a form.
 */
const CreateBusiness = ({ name, onDone }) => {
  const [form, setForm] = useState({
    organization_name: '', branch_name: '', city: '', address: '', pc_count: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.organization_name.trim()) return setError('What is your business called?');

    setSaving(true);
    try {
      const data = await portalApi.createOrganization({
        organization_name: form.organization_name.trim(),
        branch_name: form.branch_name.trim() || form.organization_name.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        pc_count: form.pc_count ? Number(form.pc_count) : undefined
      });

      portalAuth.setOrganization(data.organization.id);
      portalAuth.setBranch('all');
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  /* Same shell as /login and /signup — this is the last step of signing up,
     just reached from the other side, so it should not look like a different
     page than the one it continues. */
  return (
    <AuthLayout
      wide
      title={name ? `Almost there, ${name.split(' ')[0]}` : 'Tell us about your café'}
      subtitle="Name your business and we will set up your first branch and free trial. Every CafeXP feature is switched on from the moment you finish."
    >
      <div aria-live="polite">
        {error && <div className="mt-5"><Banner tone="bad">{error}</Banner></div>}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Business name" id="cb-org" required
               hint="The company or group — you can add more branches later">
          <Input id="cb-org" value={form.organization_name} onChange={set('organization_name')}
                 placeholder="Riverside Gaming Group" autoFocus />
        </Field>
        <Field label="First branch" id="cb-branch" hint="Leave blank to use your business name">
          <Input id="cb-branch" value={form.branch_name} onChange={set('branch_name')}
                 placeholder="Hyderabad" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" id="cb-city">
            <Input id="cb-city" value={form.city} onChange={set('city')} placeholder="Hyderabad" />
          </Field>
          <Field label="Number of PCs" id="cb-pcs" hint="Roughly is fine">
            <Input id="cb-pcs" type="number" min="1" value={form.pc_count}
                   onChange={set('pc_count')} placeholder="20" />
          </Field>
        </div>
        <Field label="Address" id="cb-address">
          <Input id="cb-address" value={form.address} onChange={set('address')}
                 placeholder="Road No. 12, Banjara Hills" />
        </Field>

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Setting up your business…' : 'Finish setting up'}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default CreateBusiness;
