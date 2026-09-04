import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalApi, relativeTime, shortDate } from '../../lib/portalApi';
import { usePortal } from '../../components/portal/PortalShell';
import { Page, Card, Button, Pill, Banner, Skeleton, Empty, StatusDot } from '../../components/portal/ui';

/*
 * Installations — the CafeXP server running at each branch.
 *
 * Revoking one cuts that machine off: a stolen server, a closed branch, a
 * replacement. The devices behind it stay, because their session and billing
 * history is the trading record, and clearing it to tidy up an installation
 * would be data loss dressed as housekeeping.
 */
const Installations = () => {
  const { branchId } = usePortal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    portalApi.installations()
      .then((d) => { setItems(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, branchId]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('cxp:branch-changed', handler);
    return () => window.removeEventListener('cxp:branch-changed', handler);
  }, [load]);

  const revoke = async (item) => {
    const reason = window.prompt(
      `Revoke ${item.name || item.public_id}?\n\n` +
      'That machine stops working immediately and has to sign in again to come back.\n' +
      'Why are you revoking it?',
      'Replaced hardware'
    );
    if (!reason || !reason.trim()) return;

    setBusy(item.installation_id);
    try {
      await portalApi.revokeInstallation(item.installation_id, reason.trim());
      load();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page
      title="Installations"
      lede="Each branch runs one CafeXP server. It signs in with your account — there is no licence key to manage."
    >
      {error && <Banner tone="bad">{error}</Banner>}

      {loading ? <Skeleton rows={2} height="h-28" />
        : items.length === 0 ? (
          <Empty
            title="Nothing installed yet"
            text="Download CafeXP Server, run it, sign in with this account and choose a branch. It registers itself."
            action={<Link to="/dashboard/downloads"><Button>Download CafeXP</Button></Link>}
          />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.installation_id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-white">
                        {item.name || 'Unnamed installation'}
                      </h2>
                      <Pill tone={
                        item.status === 'ACTIVE' ? 'good'
                          : item.status === 'REVOKED' ? 'bad'
                          : item.status === 'SUSPENDED' ? 'warn' : 'mute'
                      }>
                        {item.status.toLowerCase()}
                      </Pill>
                      <StatusDot online={item.online} />
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-neutral-600">{item.public_id}</p>
                    <p className="mt-2 text-sm text-neutral-400">
                      {item.branch_name || 'No branch'} · {item.device_count} device
                      {item.device_count === 1 ? '' : 's'}
                      {item.version ? ` · v${item.version}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right text-xs text-neutral-500">
                      <div>Registered {shortDate(item.registered_at)}</div>
                      <div>Last seen {relativeTime(item.last_seen_at)}</div>
                    </div>
                    {item.status !== 'REVOKED' && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy === item.installation_id}
                        onClick={() => revoke(item)}
                      >
                        {busy === item.installation_id ? 'Revoking…' : 'Revoke'}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
    </Page>
  );
};

export default Installations;
