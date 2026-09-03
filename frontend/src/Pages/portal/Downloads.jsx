import React from 'react';
import { usePortal } from '../../components/portal/PortalShell';
import { Page, Card, Button, Banner, Pill } from '../../components/portal/ui';

/*
 * Downloads and the setup guide.
 *
 * The steps are numbered because they genuinely are a sequence — you cannot
 * register a PC before the server is signed in — and the ordering is the
 * information, not decoration.
 *
 * The download buttons are honest about not being wired yet rather than
 * pretending: a button that downloads nothing is worse than one that says so.
 */

const STEPS = [
  { title: 'Download CafeXP Server', body: 'Install it on the machine at your counter — the one that will run the café.' },
  { title: 'Run the installer', body: 'Windows may ask you to confirm. It installs for all users on that machine.' },
  { title: 'Sign in', body: 'Use this same CafeXP account. No licence key, no activation code.' },
  { title: 'Choose your branch', body: 'If you have more than one, pick which location this server runs.' },
  { title: 'It registers itself', body: 'The installation appears in your portal within a few seconds.' },
  { title: 'Install CafeXP Client on each gaming PC', body: 'Point it at your server and it finds it on the network.' },
  { title: 'PCs register automatically', body: 'Each station appears under Devices as it connects.' },
  { title: 'Invite your staff', body: 'Give managers and cashiers their own sign-ins from Users & Staff.' }
];

const Downloads = () => {
  const { me } = usePortal();

  return (
    <Page
      title="Downloads"
      lede="CafeXP runs on Windows. The server manages your café; the client runs on each gaming PC."
    >
      <Banner tone="info">
        <strong className="mr-1">Signed in as {me?.user?.email}.</strong>
        Use this same account when CafeXP asks you to sign in — that is how it knows which branch it belongs to.
      </Banner>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="CafeXP Server"
          description="Runs at the counter. Manages sessions, billing, stock and every station."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="info">Windows</Pill>
            <Pill tone="mute">64-bit</Pill>
          </div>
          <p className="mt-4 text-sm text-neutral-400">
            One per branch. Sign in with your account and pick the branch it runs.
          </p>
          <Button className="mt-5 w-full" disabled title="Not published yet">
            Download — coming soon
          </Button>
        </Card>

        <Card
          title="CafeXP Client"
          description="Runs on each gaming PC. Handles the session, the games and the customer screen."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="info">Windows</Pill>
            <Pill tone="mute">64-bit</Pill>
          </div>
          <p className="mt-4 text-sm text-neutral-400">
            One per station. It finds your server on the local network automatically.
          </p>
          <Button className="mt-5 w-full" disabled title="Not published yet">
            Download — coming soon
          </Button>
        </Card>
      </div>

      <Card title="Installation guide" description="Eight steps, in order.">
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-800 text-[11px] font-bold text-neutral-400">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">{step.title}</div>
                <p className="mt-0.5 text-sm leading-relaxed text-neutral-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </Page>
  );
};

export default Downloads;
