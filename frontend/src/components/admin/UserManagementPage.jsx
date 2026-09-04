import React, { useCallback, useEffect, useState } from 'react';
import { platformApi, formatDate } from '../../lib/platformApi';
import { Page, Panel, Button, Field, Input, Select, Pill, Banner, Empty, Skeleton, Table, CopyableSecret } from './ui';

/*
 * Platform accounts — the people who sign in to ManagerXP itself.
 *
 * Two things this page did not do before: let anyone create an account, and
 * send an Authorization header. The second mattered more than it looked: the
 * listing endpoint returned every customer's name, email, phone and address
 * to anyone who found the URL. It is guarded now, so this page has to
 * authenticate like everything else.
 *
 * Note what is NOT here: café staff. They belong to a café, live in their own
 * table with their own roles and permissions, and are managed from inside that
 * café's console — not from the vendor's.
 */
const UserManagementPage = () => {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState(null);   // { label, value, who }
  const [form, setForm] = useState({ name: '', email: '', phone_number: '', role: 'user' });

  const load = useCallback((term) => {
    setLoading(true);
    platformApi.users(term)
      .then((d) => { setUsers(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(''); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await platformApi.createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        phone_number: form.phone_number.trim() || undefined,
        role: form.role
      });
      setSecret({
        label: 'Temporary password',
        value: created.temporary_password,
        who: `${created.name} <${created.email}>`
      });
      setForm({ name: '', email: '', phone_number: '', role: 'user' });
      setAdding(false);
      load(search.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (user) => {
    if (!window.confirm(
      `Reset the password for ${user.email}?\n\nTheir current password stops working immediately.`
    )) return;
    try {
      const res = await platformApi.resetUserPassword(user.id);
      setSecret({
        label: 'New temporary password',
        value: res.temporary_password,
        who: `${res.name} <${res.email}>`
      });
    } catch (e) { window.alert(e.message); }
  };

  return (
    <Page
      title="User accounts"
      lede="People who sign in to ManagerXP — café owners and your own staff. Café staff are managed inside each café's own console."
      actions={
        !adding && <Button type="button" onClick={() => setAdding(true)}>Add account</Button>
      }
    >
      {error && <Banner tone="bad">{error}</Banner>}

      {secret && (
        <div className="space-y-2">
          <CopyableSecret
            label={`${secret.label} for ${secret.who}`}
            value={secret.value}
            note="Shown once. If it is lost, reset the password again rather than guessing."
          />
          <Button variant="ghost" type="button" onClick={() => setSecret(null)}>Dismiss</Button>
        </div>
      )}

      {adding && (
        <Panel title="New account" description="A temporary password is generated and shown once.">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Full name" id="u-name">
              <Input id="u-name" value={form.name} required
                     onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Email" id="u-email">
              <Input id="u-email" type="email" value={form.email} required
                     onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Phone" id="u-phone">
              <Input id="u-phone" value={form.phone_number}
                     onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} />
            </Field>
            <Field label="Role" id="u-role" hint="Admin sees every customer's billing">
              <Select id="u-role" value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="user">Café owner</option>
                <option value="admin">ManagerXP admin</option>
              </Select>
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</Button>
              <Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="w-full max-w-xs rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none focus:border-red-500/50"
        />
        <span className="whitespace-nowrap text-sm text-neutral-500">{users.length} accounts</span>
      </div>

      {loading ? <Skeleton rows={3} height="h-14" />
        : users.length === 0 ? (
          <Empty
            title={search ? 'No account matches that search' : 'No accounts yet'}
            text={search ? undefined : 'Add one above, or set up a customer — onboarding creates the owner account for you.'}
          />
        ) : (
          <Table columns={['Name', 'Email', 'Phone', 'Role', 'Cafés', 'Joined', '']}>
            {users.map((u) => (
              <tr key={u.id} className="text-neutral-300">
                <td className="px-4 py-3 font-medium text-white">{u.name || '—'}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{u.phone_number || <span className="text-neutral-600">—</span>}</td>
                <td className="px-4 py-3">
                  <Pill tone={u.role === 'admin' ? 'bad' : 'mute'}>
                    {u.role === 'admin' ? 'ManagerXP admin' : 'Café owner'}
                  </Pill>
                </td>
                <td className="px-4 py-3">
                  {u.cafe_count > 0
                    ? <span title={u.cafes.map((c) => c.name).join(', ')}>
                        {u.cafes.map((c) => c.name).join(', ')}
                      </span>
                    : <span className="text-neutral-600">none</span>}
                </td>
                <td className="px-4 py-3 text-neutral-500">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" type="button" className="!px-2 !py-1 !text-xs"
                          onClick={() => resetPassword(u)}>
                    Reset password
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
    </Page>
  );
};

export default UserManagementPage;
