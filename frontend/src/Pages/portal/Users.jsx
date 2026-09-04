import React, { useCallback, useEffect, useState } from 'react';
import { portalApi, shortDate } from '../../lib/portalApi';
import { usePortal } from '../../components/portal/PortalShell';
import { Page, Card, Table, Button, Field, Input, Select, Pill, Banner, Skeleton, CopyBox } from '../../components/portal/ui';

/*
 * Users & staff.
 *
 * An invitation, not an account creation: the person sets their own password
 * when they accept, so nobody — including the owner — ever knows it. The
 * owner gets a link to send, because email delivery is a later piece and
 * waiting on it would leave this flow unusable today.
 */

const ROLES = [
  { id: 'BRANCH_MANAGER', label: 'Branch manager', hint: 'Runs one or more branches' },
  { id: 'STAFF', label: 'Staff', hint: 'Day-to-day floor work' },
  { id: 'CASHIER', label: 'Cashier', hint: 'The counter and payments' },
  { id: 'TECHNICIAN', label: 'Technician', hint: 'Stations and hardware' }
];

const roleTone = (role) =>
  role === 'OWNER' ? 'bad' : role === 'BRANCH_MANAGER' ? 'info' : 'mute';

const Users = () => {
  const { branches } = usePortal();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'STAFF', branch_ids: [] });

  const load = useCallback(() => {
    setLoading(true);
    portalApi.users()
      .then((d) => { setUsers(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleBranch = (id) =>
    setForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(id)
        ? f.branch_ids.filter((b) => b !== id)
        : [...f.branch_ids, id]
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await portalApi.inviteUser({
        name: form.name.trim() || undefined,
        email: form.email.trim(),
        role: form.role,
        branch_ids: form.branch_ids
      });
      setInvite(created);
      setForm({ name: '', email: '', role: 'STAFF', branch_ids: [] });
      setInviting(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inviteUrl = invite
    ? `${window.location.origin}/accept-invite?token=${invite.invite_token}`
    : null;

  return (
    <Page
      title="Users & staff"
      lede="People who can sign in to your CafeXP account. Café floor staff with their own tills are managed inside CafeXP itself."
      actions={!inviting && <Button onClick={() => setInviting(true)}>Invite someone</Button>}
    >
      {error && <Banner tone="bad">{error}</Banner>}

      {invite && inviteUrl && (
        <div className="space-y-2">
          <CopyBox
            label={`Invitation link for ${invite.email}`}
            value={inviteUrl}
            note="Send this to them. It expires in 14 days, and they choose their own password when they accept."
          />
          <Button variant="quiet" size="sm" onClick={() => setInvite(null)}>Dismiss</Button>
        </div>
      )}

      {inviting && (
        <Card title="Invite someone" description="They set their own password when they accept.">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" id="in-name">
                <Input id="in-name" value={form.name} onChange={set('name')} placeholder="Rahul Sharma" />
              </Field>
              <Field label="Email" id="in-email" required>
                <Input id="in-email" type="email" value={form.email} onChange={set('email')}
                       placeholder="rahul@riverside.com" required autoFocus />
              </Field>
              <Field label="Role" id="in-role">
                <Select id="in-role" value={form.role} onChange={set('role')}>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
              </Field>
            </div>

            {/* Branch access is the whole point of the role split, so it is
                asked here rather than left to a second screen. */}
            {branches.length > 0 && (
              <Field label="Which branches?" id="in-branches"
                     hint="Leave empty for none. Owners always see every branch.">
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => {
                    const on = form.branch_ids.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => toggleBranch(b.id)}
                        aria-pressed={on}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                          on ? 'bg-red-500/15 text-white ring-red-500/35'
                             : 'bg-white/[0.03] text-neutral-400 ring-white/10 hover:text-white'
                        }`}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invitation'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setInviting(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? <Skeleton rows={3} height="h-14" /> : (
        <Table columns={['Name', 'Email', 'Role', 'Branches', 'Status', 'Joined']}>
          {users.map((u) => (
            <tr key={u.organization_user_id} className="text-neutral-300">
              <td className="px-4 py-3 font-medium text-white">{u.name || '—'}</td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3">
                <Pill tone={roleTone(u.role)}>{u.role.replace('_', ' ').toLowerCase()}</Pill>
              </td>
              <td className="px-4 py-3">
                {u.role === 'OWNER'
                  ? <span className="text-neutral-500">All branches</span>
                  : u.branches.length
                    ? u.branches.map((b) => b.name).join(', ')
                    : <span className="text-neutral-600">none</span>}
              </td>
              <td className="px-4 py-3">
                <Pill tone={u.status === 'ACTIVE' ? 'good' : u.status === 'INVITED' ? 'warn' : 'mute'}>
                  {u.status.toLowerCase()}
                </Pill>
              </td>
              <td className="px-4 py-3 text-neutral-500">
                {u.accepted_at ? shortDate(u.accepted_at) : <span className="text-amber-400">pending</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  );
};

export default Users;
