import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Check, Loader2, LogOut, RefreshCw, ShieldCheck, ShieldX, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL;

/*
 * Store console.
 *
 * Two jobs:
 *   1. Show whoever signed in exactly what their role allows.
 *   2. Prove it — by calling the real endpoints and reporting what the server
 *      actually said, rather than trusting the permission list in the token.
 *
 * That second part matters: the list in a token is a claim, and the only thing
 * that counts is what the API does when asked. A row that says "allowed" here
 * means a real request came back 2xx.
 */

/*
 * The permission catalogue, grouped the way the backend groups it.
 *
 * `probe`     — a safe GET whose guard is exactly this key, so the server's
 *               answer is a real test of it.
 * `enforced`  — false when no route checks this key at all. Such a key is
 *               currently decorative: granting or withholding it changes
 *               nothing, because the endpoints behind it accept any staff
 *               token. Saying so is the whole point of this page.
 * `readOpen`  — the key guards writes, while the matching read is open to all
 *               staff by design. A 200 on the read is not a contradiction.
 */
const AREAS = [
  {
    area: 'Floor & stations',
    checks: [
      { key: 'floor.view', label: 'See the floor', enforced: false },
      { key: 'floor.manage', label: 'Add or edit a station', enforced: false },
      {
        key: 'floor.layout', label: 'Arrange zones and the floor layout',
        probe: { method: 'GET', path: '/api/floor-zones' }, readOpen: true,
      },
      { key: 'telemetry.view', label: 'Read hardware telemetry', probe: { method: 'GET', path: '/api/telemetry/latest' } },
      { key: 'station.power', label: 'Restart or shut down a station', probe: { method: 'GET', path: '/api/stations/power/actions' } },
    ],
  },
  {
    area: 'Sessions',
    checks: [
      { key: 'sessions.view', label: 'See sessions', enforced: false },
      { key: 'sessions.start', label: 'Start a session', enforced: false },
      { key: 'sessions.end', label: 'End a session', enforced: false },
      { key: 'sessions.manage', label: 'Pause, extend or transfer', enforced: false },
    ],
  },
  {
    area: 'Customers & wallet',
    checks: [
      { key: 'customers.view', label: 'See the customer directory', enforced: false },
      { key: 'customers.manage', label: 'Add or edit a customer' },
      { key: 'wallet.view', label: 'See a wallet balance', enforced: false },
      { key: 'wallet.credit', label: 'Add XP Coin', enforced: false },
      { key: 'wallet.debit', label: 'Deduct XP Coin', enforced: false },
    ],
  },
  {
    area: 'Billing',
    checks: [
      { key: 'billing.view', label: 'See bills', enforced: false },
      { key: 'billing.counter', label: 'Use the counter till', enforced: false },
      { key: 'billing.payment', label: 'Take payment', enforced: false },
      { key: 'billing.discount', label: 'Apply a discount', enforced: false },
      { key: 'billing.void', label: 'Void a bill', enforced: false },
      {
        key: 'discounts.manage', label: 'Create discount codes',
        probe: { method: 'GET', path: '/api/discounts' }, readOpen: true,
      },
    ],
  },
  {
    area: 'Catalogue & orders',
    checks: [
      { key: 'products.view', label: 'See products', enforced: false },
      { key: 'products.manage', label: 'Edit products', enforced: false },
      { key: 'inventory.adjust', label: 'Adjust stock', enforced: false },
      { key: 'pricing.manage', label: 'Change gaming prices', enforced: false },
      { key: 'packages.manage', label: 'Edit packages', enforced: false },
      { key: 'orders.view', label: 'See orders', enforced: false },
      { key: 'orders.manage', label: 'Change an order', enforced: false },
    ],
  },
  {
    area: 'Management',
    checks: [
      { key: 'reports.view', label: 'See reports', probe: { method: 'GET', path: '/api/reports/summary' } },
      { key: 'audit.view', label: 'Read the audit trail', probe: { method: 'GET', path: '/api/audit?limit=1' } },
      { key: 'staff.view', label: 'See staff accounts', probe: { method: 'GET', path: '/api/staff' } },
      { key: 'staff.manage', label: 'Add or edit staff' },
      { key: 'settings.view', label: 'See settings', probe: { method: 'GET', path: '/api/settings' } },
      { key: 'settings.manage', label: 'Change settings' },
    ],
  },
];

const StoreConsole = () => {
  const { user, token, kind, permissions, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [probes, setProbes] = useState({});
  const [running, setRunning] = useState(false);
  const denied = location.state?.denied;

  /** Every check that has a live endpoint behind it. */
  const probeable = useMemo(
    () => AREAS.flatMap((a) => a.checks.filter((c) => c.probe).map((c) => ({ ...c, area: a.area }))),
    []
  );

  const allChecks = useMemo(() => AREAS.flatMap((a) => a.checks), []);
  const totalChecks = allChecks.length;
  const unenforcedCount = allChecks.filter((c) => c.enforced === false).length;

  const runProbes = useCallback(async () => {
    if (!token) return;
    setRunning(true);
    setProbes({});

    // Sequential rather than parallel: this is a diagnostic on a café's own
    // server, and a burst of concurrent calls tells you less than a clean
    // one-at-a-time trace when something fails.
    for (const check of probeable) {
      try {
        const response = await fetch(`${API_BASE_URL}${check.probe.path}`, {
          method: check.probe.method,
          headers: { Authorization: `Bearer ${token}` },
        });

        let message = '';
        try {
          const parsed = await response.json();
          message = parsed.message || '';
        } catch {
          message = '';
        }

        setProbes((prev) => ({
          ...prev,
          [check.key]: {
            status: response.status,
            allowed: response.ok,
            message: message || (response.ok ? 'OK' : `HTTP ${response.status}`),
          },
        }));
      } catch (err) {
        // A network failure is not a permission answer, and saying so avoids
        // reading a dead backend as "everything is denied".
        setProbes((prev) => ({
          ...prev,
          [check.key]: { status: 0, allowed: null, message: `Could not reach the server (${err.message})` },
        }));
      }
    }

    setRunning(false);
  }, [token, probeable]);

  useEffect(() => { runProbes(); }, [runProbes]);

  const onSignOut = () => {
    logout();
    navigate('/store-login', { replace: true });
  };

  const grantedCount = kind === 'owner' ? 'all' : (permissions || []).length;

  return (
    <div className="min-h-screen bg-black text-white px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">

        {/* ---------- who ---------- */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-red-500/80">Store console</p>
            <h1 className="mt-1 text-3xl font-bold">{user?.name || user?.email}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {kind === 'owner' ? (
                <>Signed in as the <strong className="text-white">café owner</strong> — full authority</>
              ) : (
                <>
                  Role <strong className="text-white">{user?.role || 'unknown'}</strong>
                  {' · '}{grantedCount} permission{grantedCount === 1 ? '' : 's'}
                </>
              )}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={runProbes}
              disabled={running}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2
                         text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-60"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Re-test
            </button>
            <button
              onClick={onSignOut}
              className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2
                         text-sm font-medium text-red-300 hover:bg-red-500/20 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </header>

        {denied && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10
                          px-4 py-3 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              That page needs <code className="font-mono text-amber-100">{denied}</code>, which your role
              does not include. Ask the café owner to grant it from Staff → Roles.
            </span>
          </div>
        )}

        {kind === 'owner' && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5
                          px-4 py-3 text-sm text-neutral-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>
              An owner token carries no permission list because the backend treats it as full
              authority — so every check below passes by design. To see the role rules actually
              bite, sign in through <strong className="text-white">Store sign in</strong> as a staff
              member instead.
            </span>
          </div>
        )}

        {/* ---------- what the server actually allows ---------- */}
        <section className="mt-10 space-y-8">
          {AREAS.map((area) => (
            <div key={area.area}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
                {area.area}
              </h2>

              <div className="mt-3 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10">
                {area.checks.map((check) => {
                  const claimed = can(check.key);
                  const probe = probes[check.key];
                  const unenforced = check.enforced === false;

                  // A real disagreement: the token claims one thing and the
                  // server does another. Keys whose read is deliberately open
                  // to all staff are excluded — a 200 there is by design.
                  const mismatch =
                    probe && probe.allowed !== null && probe.allowed !== claimed && !check.readOpen;

                  return (
                    <div
                      key={check.key}
                      className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${
                        mismatch ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <span className="flex-1 min-w-[200px]">
                        <span className="block font-medium">{check.label}</span>
                        <span className="block font-mono text-[10px] text-neutral-500">{check.key}</span>
                      </span>

                      {/* what the token claims */}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          claimed
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'bg-neutral-800 text-neutral-500'
                        }`}
                      >
                        {claimed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {claimed ? 'Granted' : 'Not granted'}
                      </span>

                      {/* what the server did when asked */}
                      {check.probe ? (
                        probe ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              probe.allowed === null
                                ? 'bg-neutral-800 text-neutral-400'
                                : probe.allowed
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-red-500/10 text-red-300'
                            }`}
                            title={probe.message}
                          >
                            {probe.allowed === null
                              ? <AlertCircle className="h-3 w-3" />
                              : probe.allowed
                              ? <ShieldCheck className="h-3 w-3" />
                              : <ShieldX className="h-3 w-3" />}
                            server: {probe.status || 'error'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-800
                                           px-2.5 py-1 text-[11px] text-neutral-500">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            testing
                          </span>
                        )
                      ) : unenforced ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10
                                     px-2.5 py-1 text-[11px] font-semibold text-amber-300"
                          title="No route checks this key — the endpoints behind it accept any staff token"
                        >
                          <AlertCircle className="h-3 w-3" />
                          not enforced
                        </span>
                      ) : (
                        <span className="rounded-full px-2.5 py-1 text-[11px] text-neutral-600">
                          write-only guard
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <div className="mt-10 space-y-3 text-xs leading-relaxed text-neutral-500">
          <p>
            <strong className="text-neutral-400">Granted</strong> is what the token claims.{' '}
            <strong className="text-neutral-400">server</strong> is the HTTP status a real request to
            that endpoint came back with — 200 allowed, 403 refused. An amber row is a genuine
            disagreement between the two.
          </p>
          <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-200/80">
            <strong className="text-amber-200">not enforced</strong> means no route checks that key
            yet: the endpoints behind it accept any staff token, so granting or withholding it
            changes nothing today. {unenforcedCount} of {totalChecks} keys are in that state — the
            permission catalogue is more granular than the enforcement behind it. Those rows are the
            work still outstanding, not a fault in the role you are signed in as.
          </p>
          <p>
            <strong className="text-neutral-400">write-only guard</strong> means the key protects a
            write, which cannot be probed without changing real data.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StoreConsole;
