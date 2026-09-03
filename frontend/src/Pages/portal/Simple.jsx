import React, { useState } from 'react';
import { usePortal } from '../../components/portal/PortalShell';
import { portalAuth } from '../../lib/portalApi';
import { Page, Card, Button, Field, Input, Banner, Pill } from '../../components/portal/ui';

/*
 * The lighter portal pages: profile, security, billing, help and support.
 *
 * Grouped in one file because each is small and they share the same shape.
 * Splitting them into five files of thirty lines would spread one idea across
 * five places to look.
 *
 * Where something is not built yet, these say so rather than showing a control
 * that quietly does nothing — a disabled button with a reason is honest; an
 * enabled one that fails is not.
 */

/* ── Profile ───────────────────────────────────────────────────────────── */
export const Profile = () => {
  const { me } = usePortal();
  const user = me?.user || {};

  return (
    <Page title="Profile" lede="Your personal details on this account.">
      <Card title="You">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" id="pf-name">
            <Input id="pf-name" defaultValue={user.name || ''} disabled />
          </Field>
          <Field label="Email" id="pf-email" hint="You sign in with this">
            <Input id="pf-email" defaultValue={user.email || ''} disabled />
          </Field>
          <Field label="Phone" id="pf-phone">
            <Input id="pf-phone" defaultValue={user.phone_number || ''} disabled />
          </Field>
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          Editing your profile is coming shortly. Ask support if you need a detail changed now.
        </p>
      </Card>

      <Card title="Your access" description="Which businesses and branches you can reach.">
        <div className="space-y-3">
          {(me?.organizations || []).map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-3">
              <span className="text-sm font-medium text-white">{o.name}</span>
              <Pill tone={o.role === 'OWNER' ? 'bad' : 'info'}>{o.role.replace('_', ' ').toLowerCase()}</Pill>
            </div>
          ))}
        </div>
      </Card>
    </Page>
  );
};

/* ── Security ──────────────────────────────────────────────────────────── */
export const Security = () => {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [notice, setNotice] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (form.next.length < 8) return setNotice({ tone: 'bad', text: 'Use a password of at least 8 characters' });
    if (form.next !== form.confirm) return setNotice({ tone: 'bad', text: 'Those passwords do not match' });
    /* The endpoint is not built. Saying so beats a spinner that resolves into
       a lie about having changed something. */
    setNotice({ tone: 'warn', text: 'Changing your password from the portal is not available yet — contact support and we will do it for you.' });
  };

  return (
    <Page title="Security" lede="Your password and the sessions signed in to this account.">
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <Card title="Change password">
        <form onSubmit={submit} className="max-w-md space-y-4">
          <Field label="Current password" id="sc-current">
            <Input id="sc-current" type="password" value={form.current} onChange={set('current')} autoComplete="current-password" />
          </Field>
          <Field label="New password" id="sc-next" hint="At least 8 characters">
            <Input id="sc-next" type="password" value={form.next} onChange={set('next')} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" id="sc-confirm">
            <Input id="sc-confirm" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </Field>
          <Button type="submit">Change password</Button>
        </form>
      </Card>

      <Card title="This device" description="Signing out clears your session on this browser only.">
        <Button variant="ghost" onClick={() => { portalAuth.signOut(); window.location.href = '/login'; }}>
          Sign out
        </Button>
      </Card>
    </Page>
  );
};

/* ── Billing ───────────────────────────────────────────────────────────── */
export const Billing = () => (
  <Page title="Billing" lede="Invoices and payment methods for your CafeXP subscription.">
    <Banner tone="info">
      You are on a free trial, so there is nothing to pay and no invoices yet. When you subscribe,
      your payment history and receipts appear here.
    </Banner>

    <Card title="Payment method">
      <p className="text-sm text-neutral-400">No payment method on file.</p>
      <Button className="mt-4" disabled title="Available when subscriptions open">
        Add payment method — coming soon
      </Button>
    </Card>

    <Card title="Invoices">
      <p className="text-sm text-neutral-400">No invoices yet.</p>
    </Card>
  </Page>
);

/* ── Help ──────────────────────────────────────────────────────────────── */
const FAQS = [
  {
    q: 'Do I need a licence key?',
    a: 'No. CafeXP signs in with your account. Install it, sign in, pick your branch — that is the whole activation.'
  },
  {
    q: 'Can I run more than one café on one account?',
    a: 'Yes. Add a branch for each location. Your subscription covers the business, and you can see all of them or one at a time.'
  },
  {
    q: 'What happens when my trial ends?',
    a: 'CafeXP features switch off, but nothing is deleted. Subscribe and everything comes back exactly as you left it.'
  },
  {
    q: 'What if the internet goes down?',
    a: 'CafeXP keeps running. It works from its last successful authorisation for a grace period, so a brief outage does not stop your café trading.'
  },
  {
    q: 'Can a manager see only their own branch?',
    a: 'Yes. Invite them as a branch manager and pick which branches they get. They cannot see the others at all.'
  }
];

export const Help = () => (
  <Page title="Help Center" lede="The questions we are asked most.">
    <div className="space-y-3">
      {FAQS.map((f) => (
        <details key={f.q} className="group rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-white marker:hidden">
            <span className="mr-2 text-neutral-600 transition group-open:rotate-90 inline-block">›</span>
            {f.q}
          </summary>
          <p className="mt-2.5 pl-5 text-sm leading-relaxed text-neutral-400">{f.a}</p>
        </details>
      ))}
    </div>
  </Page>
);

/* ── Support ───────────────────────────────────────────────────────────── */
export const Support = () => {
  const { me, subscription } = usePortal();
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <Page title="Support" lede="Stuck on something? Tell us what is happening.">
      {sent && (
        <Banner tone="warn">
          Ticket submission is not connected yet. In the meantime, email{' '}
          <a className="underline" href="mailto:support@managerxp.com">support@managerxp.com</a> and
          quote your business name — we will pick it up from there.
        </Banner>
      )}

      <Card title="Submit a ticket">
        <form onSubmit={submit} className="max-w-xl space-y-4">
          <Field label="Subject" id="sp-subject" required>
            <Input id="sp-subject" value={form.subject} onChange={set('subject')}
                   placeholder="A station will not connect" required />
          </Field>
          <Field label="What is happening?" id="sp-message" required
                 hint="What you expected, what happened instead, and which branch.">
            <textarea
              id="sp-message"
              rows={5}
              value={form.message}
              onChange={set('message')}
              required
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-red-500/60"
              placeholder="PC-04 at the Hyderabad branch shows offline in the portal, but it is switched on and CafeXP is running."
            />
          </Field>
          <Button type="submit">Submit ticket</Button>
        </form>
      </Card>

      {/* Attached automatically so a customer is not asked to look it up. */}
      <Card title="What we will see" description="Sent with your ticket so you do not have to find it.">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Account</dt>
            <dd className="mt-0.5 text-neutral-300">{me?.user?.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Business</dt>
            <dd className="mt-0.5 text-neutral-300">{me?.organizations?.[0]?.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-neutral-500">Subscription</dt>
            <dd className="mt-0.5 text-neutral-300">
              {subscription?.subscription
                ? `${subscription.subscription.type} · ${subscription.subscription.status}`
                : '—'}
            </dd>
          </div>
        </dl>
      </Card>
    </Page>
  );
};
