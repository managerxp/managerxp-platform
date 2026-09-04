import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, adminAuth, dateTime, relativeTime } from '../../lib/adminApi';
import {
  Page, Panel, Table, Pill, Banner, Skeleton, Empty, Button, Field, Input, Select, CopyableSecret
} from '../../components/admin/ui';

/*
 * Administrators, and what each role may do.
 *
 * The screen that can lock everybody out, so the dangerous states are labelled
 * rather than merely guarded: the account you are signed in as, and the last
 * super admin, both say so on the row. The server refuses either way — this is
 * so nobody is surprised by the refusal.
 *
 * Nobody sets anybody's password here. A new administrator gets a setup link,
 * shown on screen whether or not the email went, because an administrator who
 * exists and cannot sign in is worse than one who does not exist.
 */

const STATUS_TONE = { ACTIVE: 'good', SUSPENDED: 'warn', DISABLED: 'mute' };

/* ==========================================================================
   ADMINISTRATORS
   ========================================================================== */
export const AdminUsers = () => {
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [setupLink, setSetupLink] = useState(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', admin_role_id: '' });
  const [busy, setBusy] = useState(null);

  const mayManage = adminAuth.can('admins.manage');

  const load = useCallback(() => {
    Promise.all([adminApi.adminUsers(), adminApi.roles()])
      .then(([u, r]) => { setData(u); setRoles(r.roles || []); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setNotice(null);
    try {
      const r = await adminApi.createAdminUser({
        ...form, admin_role_id: Number(form.admin_role_id)
      });
      setSetupLink({ url: r.setup_url, name: r.name, email: r.email, sent: r.email_result?.sent });
      setCreating(false);
      setForm({ name: '', email: '', admin_role_id: '' });
      load();
      setNotice({ tone: r.email_result?.sent ? 'good' : 'warn', text: r.message });
    } catch (err) { setNotice({ tone: 'bad', text: err.message }); }
  };

  const change = async (u, patch, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(u.admin_user_id);
    try {
      const r = await adminApi.updateAdminUser(u.admin_user_id, patch);
      load();
      setNotice({ tone: 'good', text: r.message || 'Saved' });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  const reset = async (u) => {
    setBusy(u.admin_user_id);
    try {
      const r = await adminApi.resetAdminPassword(u.admin_user_id);
      setSetupLink({ url: r.setup_url, name: u.name, email: u.email, sent: r.email_result?.sent });
      setNotice({ tone: r.email_result?.sent ? 'good' : 'warn', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
    finally { setBusy(null); }
  };

  const openHistory = async (u) => {
    try {
      const events = await adminApi.adminLogins(u.admin_user_id);
      setHistory({ user: u, events });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  if (error) return <Page title="Admin Users"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Admin Users"><Skeleton rows={4} height="h-14" /></Page>;

  const assignable = roles.filter((r) => !r.is_superuser || data.can_create_superuser);

  return (
    <Page
      title="Admin Users"
      lede="Who can sign in to ManagerXP, and what each of them may do."
      actions={mayManage && (
        <Button onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : 'Add administrator'}
        </Button>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {!data.mail_configured && (
        <Banner tone="warn">
          Email is not configured, so setup links cannot be sent. They are still generated and shown
          here — pass them on yourself.
        </Banner>
      )}

      {setupLink && (
        <Panel
          title={`Setup link for ${setupLink.name}`}
          description={setupLink.sent
            ? `Emailed to ${setupLink.email}. The link is below in case it needs sending again.`
            : `Not emailed — send this to ${setupLink.email} yourself.`}
        >
          <CopyableSecret
            label="One-time setup link"
            value={setupLink.url}
            note="Works once and expires in 24 hours. Anyone holding it can set this administrator's password, so send it the way you would send a password."
          />
          <Button variant="ghost" className="mt-3" onClick={() => setSetupLink(null)}>Close</Button>
        </Panel>
      )}

      {creating && (
        <Panel
          title="New administrator"
          description="They will receive a link to choose their own password. You never set it — and there is no way to."
        >
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" id="au-name" required>
              <Input id="au-name" value={form.name} onChange={set('name')} required placeholder="Priya Nair" />
            </Field>
            <Field label="Email" id="au-email" required hint="They sign in with this">
              <Input id="au-email" type="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Role" id="au-role" required>
              <Select id="au-role" value={form.admin_role_id} onChange={set('admin_role_id')} required>
                <option value="">Choose a role…</option>
                {assignable.map((r) => <option key={r.admin_role_id} value={r.admin_role_id}>{r.label}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-3"><Button type="submit">Create and send link</Button></div>
          </form>
        </Panel>
      )}

      <Table columns={['Administrator', 'Role', 'Last sign-in', 'Status', '']}>
        {data.items.map((u) => (
          <tr key={u.admin_user_id} className={`hover:bg-white/[0.03] ${u.status === 'ACTIVE' ? '' : 'opacity-60'}`}>
            <td className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white">{u.name}</span>
                {u.is_self && <Pill tone="info">you</Pill>}
                {u.is_last_super_admin && <Pill tone="bad">last super admin</Pill>}
                {u.pending_setup && <Pill tone="warn">setup pending</Pill>}
                {u.locked && <Pill tone="bad">locked out</Pill>}
              </div>
              <div className="text-[11px] text-neutral-500">{u.email}</div>
            </td>
            <td className="px-4 py-2.5">
              {mayManage && !u.is_self ? (
                <Select
                  value={u.admin_role_id}
                  disabled={busy === u.admin_user_id}
                  onChange={(e) => change(u, { admin_role_id: Number(e.target.value) })}
                  className="!w-auto"
                >
                  {roles.map((r) => (
                    <option key={r.admin_role_id} value={r.admin_role_id}>{r.label}</option>
                  ))}
                </Select>
              ) : (
                <Pill tone={u.is_superuser ? 'bad' : 'mute'}>{u.role_label}</Pill>
              )}
            </td>
            <td className="px-4 py-2.5">
              <button type="button" onClick={() => openHistory(u)}
                      className="text-left text-[11px] text-neutral-400 hover:text-white">
                {u.last_login_at ? relativeTime(u.last_login_at) : 'never'}
                <div className="text-[10px] text-neutral-600">
                  {u.sign_ins} sign-in{u.sign_ins === 1 ? '' : 's'} · view history
                </div>
              </button>
            </td>
            <td className="px-4 py-2.5">
              <Pill tone={STATUS_TONE[u.status] || 'mute'}>{u.status.toLowerCase()}</Pill>
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              {mayManage && (
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" className="!px-2 !py-1 !text-xs"
                          disabled={busy === u.admin_user_id || u.status !== 'ACTIVE'}
                          onClick={() => reset(u)}>
                    Reset password
                  </Button>
                  {u.status === 'ACTIVE' ? (
                    <Button
                      variant="danger" className="!px-2 !py-1 !text-xs"
                      /* Disabled rather than hidden, so the reason is
                         discoverable instead of the button simply missing. */
                      disabled={busy === u.admin_user_id || u.is_self || u.is_last_super_admin}
                      title={u.is_self ? 'You cannot disable your own account'
                        : u.is_last_super_admin ? 'The last super admin cannot be disabled' : ''}
                      onClick={() => change(u, { status: 'DISABLED' },
                        `Disable ${u.name}?\n\nThey will not be able to sign in. Nothing they did is removed.`)}
                    >
                      Disable
                    </Button>
                  ) : (
                    <Button variant="good" className="!px-2 !py-1 !text-xs"
                            disabled={busy === u.admin_user_id}
                            onClick={() => change(u, { status: 'ACTIVE' })}>
                      Reactivate
                    </Button>
                  )}
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>

      {history && (
        <Panel title={`Sign-in history — ${history.user.name}`}
               description="Every attempt, including the ones that failed.">
          {history.events.length === 0
            ? <p className="text-xs text-neutral-600">Nothing recorded.</p>
            : (
              <Table columns={['When', 'Outcome', 'IP', 'Device']}>
                {history.events.map((e) => (
                  <tr key={e.event_id}>
                    <td className="whitespace-nowrap px-4 py-2 text-[11px] text-neutral-500">
                      {dateTime(e.created_at)}
                    </td>
                    <td className="px-4 py-2">
                      <Pill tone={e.outcome === 'SUCCESS' ? 'good'
                        : e.outcome === 'BAD_PASSWORD' || e.outcome === 'LOCKED' ? 'bad' : 'warn'}>
                        {e.outcome.replace('_', ' ').toLowerCase()}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-neutral-500">{e.ip || '—'}</td>
                    <td className="max-w-[280px] truncate px-4 py-2 text-[10px] text-neutral-600">
                      {e.user_agent || '—'}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          <Button variant="ghost" className="mt-3" onClick={() => setHistory(null)}>Close</Button>
        </Panel>
      )}
    </Page>
  );
};

/* ==========================================================================
   ROLES
   ========================================================================== */
export const Roles = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ role_key: '', label: '', description: '' });

  const load = useCallback(() => {
    adminApi.roles()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (role) => {
    setEditing(role.admin_role_id);
    setDraft(new Set(role.permissions));
    setNotice(null);
  };

  const toggle = (key) => setDraft((d) => {
    const next = new Set(d);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const save = async (role) => {
    try {
      const r = await adminApi.setRolePermissions(role.admin_role_id, [...draft]);
      setEditing(null);
      load();
      setNotice({ tone: 'good', text: r.message });
    } catch (e) { setNotice({ tone: 'bad', text: e.message }); }
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await adminApi.createRole(form);
      setCreating(false);
      setForm({ role_key: '', label: '', description: '' });
      load();
      setNotice({ tone: 'good', text: r.message || 'Role created' });
    } catch (err) { setNotice({ tone: 'bad', text: err.message }); }
  };

  if (error) return <Page title="Roles & Permissions"><Banner tone="bad">{error}</Banner></Page>;
  if (!data) return <Page title="Roles & Permissions"><Skeleton rows={3} height="h-32" /></Page>;

  return (
    <Page
      title="Roles & Permissions"
      lede="What each kind of administrator may do. The backend checks these on every request — this is not only what the sidebar offers."
      actions={data.can_edit && (
        <Button onClick={() => setCreating((c) => !c)}>{creating ? 'Cancel' : 'New role'}</Button>
      )}
    >
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {creating && (
        <Panel title="New role" description="Created with no permissions. Grant it what it needs afterwards.">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-3">
            <Field label="Label" id="rl-label" required>
              <Input id="rl-label" value={form.label} required
                     onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                     placeholder="Billing Support" />
            </Field>
            <Field label="Key" id="rl-key" required hint="Uppercase, used in code">
              <Input id="rl-key" value={form.role_key} required
                     onChange={(e) => setForm((f) => ({ ...f, role_key: e.target.value.toUpperCase() }))}
                     placeholder="BILLING_SUPPORT" />
            </Field>
            <Field label="Description" id="rl-desc">
              <Input id="rl-desc" value={form.description}
                     onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
            <div className="sm:col-span-3"><Button type="submit">Create role</Button></div>
          </form>
        </Panel>
      )}

      {data.roles.map((role) => {
        const isEditing = editing === role.admin_role_id;
        const shown = isEditing ? draft : new Set(role.permissions);
        return (
          <Panel
            key={role.admin_role_id}
            title={role.label}
            description={role.description || undefined}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Pill tone={role.is_superuser ? 'bad' : 'mute'}>{role.role_key}</Pill>
              {role.is_system && <Pill tone="info">built in</Pill>}
              <Pill tone={role.admin_count > 0 ? 'good' : 'mute'}>
                {role.admin_count} administrator{role.admin_count === 1 ? '' : 's'}
              </Pill>
              <Pill tone="mute">{shown.size} permissions</Pill>
            </div>

            {role.is_superuser ? (
              /* Not rendered as a checkbox grid at all. Showing 33 permanently
                 ticked, permanently disabled boxes would invite someone to try
                 unticking one and conclude the screen is broken. */
              <p className="text-xs leading-relaxed text-neutral-500">
                Super admin holds every permission, including any added in future. It cannot be
                narrowed — one role must always be able to restore the others.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.permissions.map((group) => (
                    <div key={group.resource} className="rounded-lg border border-white/10 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                        {group.resource}
                      </div>
                      <div className="space-y-1.5">
                        {group.items.map((p) => (
                          <label key={p.permission_key}
                                 className={`flex items-start gap-2 text-xs ${
                                   isEditing ? 'cursor-pointer text-neutral-300' : 'text-neutral-500'
                                 }`}>
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 accent-red-500"
                              checked={shown.has(p.permission_key)}
                              disabled={!isEditing}
                              onChange={() => toggle(p.permission_key)}
                            />
                            <span>{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {data.can_edit && (
                  <div className="mt-4 flex gap-2">
                    {isEditing ? (
                      <>
                        <Button onClick={() => save(role)}>Save permissions</Button>
                        <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </>
                    ) : (
                      <Button variant="ghost" onClick={() => open(role)}>Edit permissions</Button>
                    )}
                  </div>
                )}
              </>
            )}
          </Panel>
        );
      })}
    </Page>
  );
};
