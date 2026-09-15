import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserCheck, Building2, MapPin, Download, Radio, Monitor, Users as UsersIcon, PlayCircle,
  LayoutGrid, Library, Tag, UserCog
} from 'lucide-react';
import { usePortal } from '../../components/portal/PortalShell';
import { portalApi, portalAuth } from '../../lib/portalApi';
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
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (form.next.length < 8) return setNotice({ tone: 'bad', text: 'Use a password of at least 8 characters' });
    if (form.next !== form.confirm) return setNotice({ tone: 'bad', text: 'Those passwords do not match' });
    /* The endpoint is not built. Saying so beats a spinner that resolves into
       a lie about having changed something. */
    setNotice({ tone: 'warn', text: 'Changing your password from the portal is not available yet — contact support and we will do it for you.' });
  };

  /* Downloads the JSON directly in the browser — no server-side file to
     generate or clean up, since the export is small enough to hold in
     memory (one account, not a café's whole customer base). */
  const exportData = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const data = await portalApi.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `managerxp-account-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm(
      'Delete your ManagerXP account? This cannot be undone — your name, email and phone number will be permanently erased.'
    )) return;

    setDeleting(true);
    setNotice(null);
    try {
      await portalApi.deleteMyAccount();
      portalAuth.signOut();
      window.location.href = '/login';
    } catch (err) {
      // A blocked deletion (owns an active business) comes back with a
      // ticket reference in err.message — worth showing exactly as sent
      // rather than a generic failure.
      setNotice({ tone: err.status === 409 ? 'warn' : 'bad', text: err.message });
      setDeleting(false);
    }
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

      <Card title="Your data" description="Export everything ManagerXP holds about your account.">
        <Button variant="ghost" onClick={exportData} disabled={exporting}>
          {exporting ? 'Preparing export…' : 'Export my data'}
        </Button>
      </Card>

      <Card title="Danger zone" description="Permanently delete your account and personal data.">
        <Button variant="danger" onClick={deleteAccount} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete my account'}
        </Button>
        <p className="mt-3 text-xs text-neutral-500">
          If your account owns an active business, this opens a support ticket instead of deleting
          immediately — we will help you transfer ownership or close the business first.
        </p>
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

/*
 * The first-time setup manual.
 *
 * Mirrors the Dashboard "Finish setting up" checklist exactly — same eight
 * steps, same order, same labels — because a manual that describes a
 * different journey than the one the checklist sends you on is worse than no
 * manual. That checklist links each unfinished step straight to the page for
 * it; this is the "how" to go with its "where".
 *
 * No app screenshots: this repo has no way to capture and ship real ones, and
 * a stale or placeholder screenshot misleads worse than none. The numbered
 * icon in place of one still gives a first-time reader something to scan for.
 */
const SETUP_STEPS = [
  {
    icon: UserCheck,
    title: '1. Your account',
    body: 'Already done — creating your sign-in is how you got here. Nothing to do on this one.'
  },
  {
    icon: Building2,
    title: '2. Your business',
    body: 'Named the first time you signed up (or from "Finish setting up" if you arrived by invite). ' +
      'Change the name or address any time from Organization.',
    to: '/dashboard/organization', cta: 'Go to Organization'
  },
  {
    icon: MapPin,
    title: '3. Your first branch',
    body: 'Created in the same step as your business — one location, with its own PCs and staff. ' +
      'Running more than one café on this account? Add each one from Branches.',
    to: '/dashboard/branches', cta: 'Go to Branches'
  },
  {
    icon: Download,
    title: '4. Install CafeXP Server',
    body: 'One install, on the machine at your counter. Download it, run the installer, and sign in ' +
      'with this same account — no licence key. Pick which branch it runs when it asks.',
    to: '/dashboard/downloads', cta: 'Go to Downloads'
  },
  {
    icon: Radio,
    title: '5. Confirm it connected',
    body: 'Within a few seconds of signing in, that install registers itself here — you should see it ' +
      'listed and online.',
    to: '/dashboard/installations', cta: 'Go to Installations'
  },
  {
    icon: Monitor,
    title: '6. Install CafeXP Client on every gaming PC',
    body: 'One per station. It finds your server on the café\'s own network by itself — nothing to type. ' +
      'Each PC appears here the moment it connects.',
    to: '/dashboard/devices', cta: 'Go to Devices / PCs'
  },
  {
    icon: UsersIcon,
    title: '7. Invite your team',
    body: 'This is for people who need to sign in to the portal or the console — managers, co-owners. ' +
      'Counter staff who only take payments and start sessions are added inside CafeXP itself, not here.',
    to: '/dashboard/users', cta: 'Go to Users & Staff'
  },
  {
    icon: PlayCircle,
    title: '8. Start your first session',
    body: 'The one step that happens away from this website — at the counter, in the CafeXP Server app ' +
      'you just installed. Pick a station, pick a customer, start the clock.'
  }
];

/*
 * Setting up the CafeXP Server console — everything after step 4 above that
 * happens inside the installed app rather than on this website, so it has no
 * portal route to link to. Same reasoning as SETUP_STEPS above for skipping
 * screenshots.
 */
const CONSOLE_STEPS = [
  {
    icon: LayoutGrid,
    title: '1. Add your stations',
    body: 'Floor → Add station. A gaming PC with the CafeXP Client installed already added itself — this ' +
      'is for anything without it: pool tables, VR rigs, a PS5, a simulator. Give each one a Type ' +
      '(PC, PS5, Pool…) — that Type is what decides which prices it can be sold at.'
  },
  {
    icon: Library,
    title: '2. Build your game library',
    body: 'Game Library → pick the titles you offer from ManagerXP\'s catalog. Nothing to install by hand; ' +
      'picking a game here is what makes it launchable from a station.'
  },
  {
    icon: Tag,
    title: '3. Set your prices',
    body: 'Gaming Prices → Add activity for each category you charge for (PC, PS5, Pool…), Add session for ' +
      'the durations you sell (30 min, 1 hour…), then Add price to combine a category with a duration and ' +
      'a rate.'
  },
  {
    icon: UserCog,
    title: '4. Add your floor staff',
    body: 'Staff → Add staff member. This is separate from Users & Staff on the website — these are the ' +
      'counter sign-ins (cashiers, floor managers) with their own role and permissions, not portal access.'
  },
  {
    icon: PlayCircle,
    title: '5. Start your first session',
    body: 'Floor → click any available station → start a session. That is the whole setup, start to finish.'
  }
];

const StepList = ({ steps }) => (
  <ol className="space-y-5">
    {steps.map((step) => (
      <li key={step.title} className="flex gap-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-neutral-300">
          <step.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">{step.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-neutral-400">{step.body}</p>
          {step.to && (
            <Link to={step.to} className="mt-2 inline-block">
              <Button variant="ghost" size="sm">{step.cta}</Button>
            </Link>
          )}
        </div>
      </li>
    ))}
  </ol>
);

const SetupGuide = () => (
  <Card
    title="First-time setup, start to finish"
    description="The same eight steps as your Dashboard checklist, with what each one actually asks you to do."
  >
    <StepList steps={SETUP_STEPS} />
  </Card>
);

const ConsoleGuide = () => (
  <Card
    title="Setting up CafeXP Server"
    description="Once it's installed and signed in, this is what to do inside the console itself — on the counter machine, not this website."
  >
    <StepList steps={CONSOLE_STEPS} />
  </Card>
);

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
  <Page title="Help Center" lede="Setting up for the first time, or a question we're asked a lot — both live here.">
    <SetupGuide />
    <ConsoleGuide />

    <h2 className="text-sm font-semibold text-white">Frequently asked</h2>
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
          <a className="underline" href="mailto:managerxp2026@gmail.com">managerxp2026@gmail.com</a> and
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
