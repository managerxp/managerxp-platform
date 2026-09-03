import React, { useEffect, useState } from 'react';
import { portalApi } from '../../lib/portalApi';
import { Page, Card, Button, Field, Input, Select, Banner, Skeleton } from '../../components/portal/ui';

/*
 * The business itself — the details that end up on receipts and invoices.
 *
 * Save is disabled until something actually changes, so the button is a
 * reliable signal that there is unsaved work rather than a permanent
 * fixture the eye stops seeing.
 */
const CURRENCIES = ['INR', 'USD', 'AED', 'GBP', 'EUR'];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'UTC'];

const Organization = () => {
  const [org, setOrg] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    portalApi.organization()
      .then((d) => { setOrg(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const value = (key) => (draft[key] !== undefined ? draft[key] : (org?.[key] ?? ''));
  const set = (key) => (e) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setSaved(false);
  };

  const dirty = Object.keys(draft).length > 0;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await portalApi.updateOrganization(draft);
      setOrg(updated);
      setDraft({});
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Page title="Organization"><Skeleton rows={2} height="h-40" /></Page>;

  return (
    <Page title="Organization" lede="Your business details. These appear on receipts and invoices.">
      {error && <Banner tone="bad">{error}</Banner>}
      {saved && <Banner tone="good">Saved.</Banner>}

      <form onSubmit={submit} className="space-y-5">
        <Card title="Business">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" id="og-name" required>
              <Input id="og-name" value={value('name')} onChange={set('name')} />
            </Field>
            <Field label="Tax number" id="og-tax" hint="GSTIN or equivalent, printed on invoices">
              <Input id="og-tax" value={value('tax_number')} onChange={set('tax_number')}
                     placeholder="29ABCDE1234F1Z5" />
            </Field>
            <Field label="Email" id="og-email">
              <Input id="og-email" type="email" value={value('email')} onChange={set('email')} />
            </Field>
            <Field label="Phone" id="og-phone">
              <Input id="og-phone" value={value('phone')} onChange={set('phone')} />
            </Field>
          </div>
        </Card>

        <Card title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Street" id="og-address">
              <Input id="og-address" value={value('address')} onChange={set('address')} />
            </Field>
            <Field label="City" id="og-city">
              <Input id="og-city" value={value('city')} onChange={set('city')} />
            </Field>
            <Field label="State" id="og-state">
              <Input id="og-state" value={value('state')} onChange={set('state')} />
            </Field>
            <Field label="Postal code" id="og-postal">
              <Input id="og-postal" value={value('postal_code')} onChange={set('postal_code')} />
            </Field>
            <Field label="Country" id="og-country">
              <Input id="og-country" value={value('country')} onChange={set('country')} />
            </Field>
          </div>
        </Card>

        <Card
          title="Regional"
          description="Currency and timezone affect how money and times are shown across CafeXP."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency" id="og-currency">
              <Select id="og-currency" value={value('currency')} onChange={set('currency')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Timezone" id="og-tz">
              <Select id="og-tz" value={value('timezone')} onChange={set('timezone')}>
                {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => { setDraft({}); setError(null); }}>
              Discard
            </Button>
          )}
        </div>
      </form>
    </Page>
  );
};

export default Organization;
