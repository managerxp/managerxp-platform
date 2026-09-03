import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalApi, relativeTime } from '../../lib/portalApi';
import { usePortal } from '../../components/portal/PortalShell';
import { Page, Card, Table, Pill, Banner, Skeleton, Empty, StatusDot, Meter, Button } from '../../components/portal/ui';

/*
 * Devices — every machine registered against this account.
 *
 * Gaming PCs are metered separately from the till and the server, because a
 * café should not have its front desk counted against the stations it paid
 * for. The list shows every device type; only GAMING_PC moves the meter.
 *
 * There is nothing to add by hand here. A station registers itself when
 * CafeXP connects, which is the only way the count can stay honest.
 */
const TYPE_LABEL = {
  GAMING_PC: 'Gaming PC',
  SERVER: 'Server',
  FRONT_DESK: 'Front desk',
  ADMIN: 'Admin',
  MANAGER: 'Manager'
};

const Devices = () => {
  const { branchId } = usePortal();
  const [devices, setDevices] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    portalApi.devices()
      .then((res) => { setDevices(res.data); setMeta(res.meta || {}); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, branchId]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('cxp:branch-changed', handler);
    return () => window.removeEventListener('cxp:branch-changed', handler);
  }, [load]);

  return (
    <Page
      title="Devices"
      lede="Gaming PCs and the machines that run your counter. They register themselves when CafeXP connects — there is nothing to type here."
    >
      {error && <Banner tone="bad">{error}</Banner>}

      <Card>
        <Meter used={meta.gaming_pcs || 0} max={meta.max_pcs} label="Gaming PCs" />
        {meta.remaining === 0 && (
          <p className="mt-3 text-xs text-amber-300">
            You have registered every PC your plan allows. New stations will be refused until you upgrade.
          </p>
        )}
      </Card>

      {loading ? <Skeleton rows={3} height="h-14" />
        : devices.length === 0 ? (
          <Empty
            title="No devices yet"
            text="Install CafeXP on a station and it appears here automatically once it connects."
            action={<Link to="/dashboard/downloads"><Button>Download CafeXP</Button></Link>}
          />
        ) : (
          <Table columns={['Name', 'Branch', 'Type', 'Status', 'Last seen', 'Address']}>
            {devices.map((d) => (
              <tr key={d.pc_id} className="text-neutral-300">
                <td className="px-4 py-3 font-medium text-white">{d.name}</td>
                <td className="px-4 py-3">{d.branch_name || '—'}</td>
                <td className="px-4 py-3">
                  <Pill tone={d.device_type === 'GAMING_PC' ? 'info' : 'mute'}>
                    {TYPE_LABEL[d.device_type] || d.device_type}
                  </Pill>
                </td>
                <td className="px-4 py-3"><StatusDot online={d.online} /></td>
                <td className="px-4 py-3 text-neutral-500">{relativeTime(d.last_seen_at)}</td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-600">{d.ip_address || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
    </Page>
  );
};

export default Devices;
