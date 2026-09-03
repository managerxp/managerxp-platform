import React, { useCallback, useEffect, useState } from 'react';
import { portalApi, portalAuth } from '../../lib/portalApi';
import { Page, Card, Button, Field, Input, Pill, Banner, Empty, Skeleton, StatusDot, Meter } from '../../components/portal/ui';
import TimePicker from '../../components/ui/TimePicker';

const API_BASE_URL = import.meta.env.VITE_API_URL;

/*
 * Branches — the physical locations a business trades from.
 *
 * The limit is shown before the Add button rather than after the refusal,
 * because "you have used 3 of 3" is a fact an owner can plan around, and
 * "you have reached your limit" after filling in a form is a wasted minute.
 * The backend enforces it regardless; this is courtesy, not security.
 */
const Branches = () => {
  const [branches, setBranches] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', address: '', phone: '' });
  // null until known — whether this business's package includes online
  // booking, read from the same entitlement resolver the café console asks.
  // A raw fetch to the desktop-app entitlements endpoint rather than
  // portalApi (which always targets /api/portal/*): the same owner token
  // already works there, and there is no portal-specific copy of this
  // resolver to duplicate.
  const [bookingEnabled, setBookingEnabled] = useState(null);
  const [copiedBranchId, setCopiedBranchId] = useState(null);
  // Draft store hours per branch, seeded from the loaded data and edited
  // independently of it — so typing in one branch's fields never touches
  // another's, and a failed save leaves the draft as typed rather than
  // reverting silently.
  const [hoursDraft, setHoursDraft] = useState({});
  const [savingHoursId, setSavingHoursId] = useState(null);
  const [hoursError, setHoursError] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    portalApi.branches()
      .then((res) => {
        setBranches(res.data);
        setMeta(res.meta || {});
        setError(null);
        setHoursDraft(Object.fromEntries((res.data || []).map((b) => [
          b.branch_id, { opening_time: b.opening_time || '', closing_time: b.closing_time || '' }
        ])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let ignore = false;
    const token = portalAuth.token();
    if (!token) return undefined;

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/entitlements/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const body = await res.json();
        if (ignore) return;
        // Unresolved (a business that predates organizations) defaults to
        // shown — the same "can't tell, don't brick it" call the café
        // console makes for the same situation.
        setBookingEnabled(body?.data?.resolved ? !!body.data.features?.RESERVATIONS?.enabled : true);
      } catch {
        if (!ignore) setBookingEnabled(true);
      }
    })();

    return () => { ignore = true; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setHoursField = (branchId, field) => (value) =>
    setHoursDraft((d) => ({ ...d, [branchId]: { ...d[branchId], [field]: value } }));

  const saveHours = async (branchId) => {
    setSavingHoursId(branchId);
    setHoursError((e) => ({ ...e, [branchId]: null }));
    const draft = hoursDraft[branchId] || {};
    try {
      await portalApi.updateBranch(branchId, {
        opening_time: draft.opening_time || null,
        closing_time: draft.closing_time || null
      });
      load();
    } catch (err) {
      setHoursError((e) => ({ ...e, [branchId]: err.message }));
    } finally {
      setSavingHoursId(null);
    }
  };

  const copyBookingLink = async (branchId, url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedBranchId(branchId);
      setTimeout(() => setCopiedBranchId((id) => (id === branchId ? null : id)), 2000);
    } catch {
      // Clipboard access can be refused; the link is still visible to copy by hand.
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Give the branch a name');
    setSaving(true);
    setError(null);
    try {
      await portalApi.createBranch({
        name: form.name.trim(),
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined
      });
      setForm({ name: '', city: '', address: '', phone: '' });
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const atLimit = meta.max_branches != null && branches.length >= meta.max_branches;

  return (
    <Page
      title="Branches"
      lede="Each branch is a location with its own PCs, staff and CafeXP installation."
      actions={
        !adding && (
          <Button onClick={() => setAdding(true)} disabled={atLimit}
                  title={atLimit ? 'You have reached your branch limit' : undefined}>
            Add branch
          </Button>
        )
      }
    >
      {error && <Banner tone="bad">{error}</Banner>}

      {meta.max_branches != null && (
        <Card>
          <Meter used={branches.length} max={meta.max_branches} label="Branches used" />
          {atLimit && (
            <p className="mt-3 text-xs text-amber-300">
              You have used every branch your plan allows. Upgrade to add more.
            </p>
          )}
        </Card>
      )}

      {adding && (
        <Card title="New branch" description="You can fill in the address later.">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch name" id="br-name" required>
              <Input id="br-name" value={form.name} onChange={set('name')} placeholder="Bangalore" autoFocus />
            </Field>
            <Field label="City" id="br-city">
              <Input id="br-city" value={form.city} onChange={set('city')} placeholder="Bengaluru" />
            </Field>
            <Field label="Address" id="br-address">
              <Input id="br-address" value={form.address} onChange={set('address')} placeholder="Indiranagar" />
            </Field>
            <Field label="Phone" id="br-phone">
              <Input id="br-phone" value={form.phone} onChange={set('phone')} placeholder="98765 00022" />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add branch'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? <Skeleton rows={2} height="h-32" />
        : branches.length === 0 ? (
          <Empty title="No branches yet" text="Add your first location to get started."
                 action={<Button onClick={() => setAdding(true)}>Add branch</Button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {branches.map((b) => (
              <article key={b.branch_id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-white">{b.name}</h2>
                      <Pill tone={b.status === 'ACTIVE' ? 'good' : 'mute'}>{b.status.toLowerCase()}</Pill>
                      {b.code && <span className="font-mono text-[11px] text-neutral-600">{b.code}</span>}
                    </div>
                    <p className="mt-1 text-sm text-neutral-400">
                      {[b.address, b.city].filter(Boolean).join(', ') || 'No address yet'}
                    </p>
                  </div>
                  {/* Installation state is the thing an owner checks first —
                      a branch whose server is down is not trading. */}
                  <StatusDot
                    online={b.installation_online}
                    label={
                      b.installation_status === 'NOT_INSTALLED' ? 'Not installed'
                        : b.installation_online ? 'CafeXP online' : 'CafeXP offline'
                    }
                  />
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Gaming PCs</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-white">{b.pc_count}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Team</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-white">{b.user_count}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Phone</dt>
                    <dd className="mt-0.5 text-sm text-neutral-300">{b.phone || '—'}</dd>
                  </div>
                </dl>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">Store hours</p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Reservations can only be booked inside this window. Leave blank for open around the clock.
                  </p>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <Field label="Opens" id={`br-open-${b.branch_id}`}>
                      <TimePicker
                        id={`br-open-${b.branch_id}`}
                        value={hoursDraft[b.branch_id]?.opening_time || ''}
                        onChange={setHoursField(b.branch_id, 'opening_time')}
                      />
                    </Field>
                    <Field label="Closes" id={`br-close-${b.branch_id}`}>
                      <TimePicker
                        id={`br-close-${b.branch_id}`}
                        value={hoursDraft[b.branch_id]?.closing_time || ''}
                        onChange={setHoursField(b.branch_id, 'closing_time')}
                      />
                    </Field>
                    <Button
                      type="button" variant="ghost"
                      disabled={savingHoursId === b.branch_id}
                      onClick={() => saveHours(b.branch_id)}
                    >
                      {savingHoursId === b.branch_id ? 'Saving…' : 'Save hours'}
                    </Button>
                  </div>
                  {hoursError[b.branch_id] && (
                    <p className="mt-2 text-xs text-red-300">{hoursError[b.branch_id]}</p>
                  )}
                </div>

                {b.cafe_slug && bookingEnabled && (
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                    <span className="truncate font-mono text-[11px] text-neutral-400">
                      {`${window.location.origin}/book/${b.cafe_slug}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => copyBookingLink(b.branch_id, `${window.location.origin}/book/${b.cafe_slug}`)}
                    >
                      {copiedBranchId === b.branch_id ? 'Copied' : 'Copy booking link'}
                    </Button>
                  </div>
                )}

                {b.cafe_slug && bookingEnabled === false && (
                  <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/80">
                    Online booking isn&apos;t included in your current package.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
    </Page>
  );
};

export default Branches;
