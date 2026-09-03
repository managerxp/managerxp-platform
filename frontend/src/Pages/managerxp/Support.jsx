import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, adminAuth } from '../../lib/adminApi';
import {
  Page, Panel, Pill, Banner, Skeleton, Button, Field, Input, Select, inputClass
} from '../../components/admin/ui';
// Generic — takes fetchBlob as a prop, so the same component serves both the
// café portal and this console without hardcoding which API client to use.
import { AttachmentPicker, AttachmentList } from '../../components/portal/Attachments';

/*
 * The ManagerXP support desk.
 *
 * The queue is ordered by who is waiting on whom rather than by date: a ticket
 * the customer answered an hour ago outranks one nobody has touched since we
 * replied last week. That ordering is done by the server, so every agent sees
 * the same queue.
 *
 * An internal note is written here and never leaves — the café's own screen is
 * served by a query that excludes them.
 */

const STATUSES = ['OPEN', 'PENDING', 'ANSWERED', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const statusTone = (s) => ({
  OPEN: 'warn', PENDING: 'warn', ANSWERED: 'good', RESOLVED: 'good', CLOSED: 'mute'
}[s] || 'mute');
const priorityTone = (p) => ({ URGENT: 'bad', HIGH: 'warn' }[p] || 'mute');

const when = (value) => {
  if (!value) return '—';
  const secs = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

const Support = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState({ status: '', search: '' });
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [replyFiles, setReplyFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const mayManage = adminAuth.can('support.manage');

  const load = useCallback(() => {
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.search) params.search = filter.search;
    adminApi.tickets(params).then(setData).catch((e) => setError(e.message));
  }, [filter.status, filter.search]);
  useEffect(() => { load(); }, [load]);

  const openThread = (id) => {
    setOpenId(id);
    setThread(null);
    setInternal(false);
    setReplyFiles([]);
    adminApi.ticket(id).then(setThread).catch((e) => setError(e.message));
  };

  const send = async () => {
    if (!reply.trim() && !replyFiles.length) return;
    setBusy(true); setError('');
    try {
      await adminApi.replyTicket(openId, reply, internal, replyFiles);
      setNotice(internal ? 'Internal note added — the café cannot see it.' : 'Reply sent.');
      setReply('');
      setReplyFiles([]);
      openThread(openId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (changes) => {
    setBusy(true); setError('');
    try {
      await adminApi.updateTicket(openId, changes);
      openThread(openId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Support tickets"
      lede="Every café's tickets, with the ones waiting on us first."
    >
      {error && <Banner tone="bad">{error}</Banner>}
      {notice && <Banner tone="good">{notice}</Banner>}

      {data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            ['Open', data.counts.open, 'mute'],
            ['Waiting on us', data.counts.awaiting, data.counts.awaiting > 0 ? 'warn' : 'mute'],
            ['Urgent', data.counts.urgent, data.counts.urgent > 0 ? 'bad' : 'mute']
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-2xl font-bold tabular-nums text-white">{value}</span>
                {value > 0 && tone !== 'mute' && <Pill tone={tone}>attention</Pill>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Panel title="Queue">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Status" id="f-status">
            <Select id="f-status" value={filter.status}
                    onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All</option>
              <option value="OPEN,PENDING,ANSWERED">Not resolved</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Search" id="f-search">
            <Input id="f-search" value={filter.search} placeholder="Reference, subject or café"
                   onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
          </Field>
        </div>

        {!data && <Skeleton rows={4} height="h-16" />}
        {data && data.items.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-500">No tickets match.</p>
        )}
        {data && data.items.length > 0 && (
          <div className="divide-y divide-white/5">
            {data.items.map((t) => (
              <button key={t.ticket_id} onClick={() => openThread(t.ticket_id)}
                      className={`flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-white/[0.03] ${
                        openId === t.ticket_id ? 'bg-white/[0.04]' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-neutral-500">{t.reference}</span>
                    <span className="text-sm font-semibold text-neutral-100">{t.subject}</span>
                    <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                    <Pill tone={priorityTone(t.priority)}>{t.priority}</Pill>
                    {t.awaiting_support && <Pill tone="warn">Waiting on us</Pill>}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {t.organization_name || 'Unknown café'} · {t.category} · {when(t.last_reply_at)}
                    {t.assigned_admin_name ? ` · ${t.assigned_admin_name}` : ' · unassigned'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {openId && (
        <Panel
          title={thread ? `${thread.ticket.reference} — ${thread.ticket.subject}` : 'Loading…'}
          description={thread
            ? `${thread.ticket.organization_name || 'Unknown café'} · raised by ${thread.ticket.created_by_name || thread.ticket.created_by_email || 'a customer'}`
            : ''}
        >
          {!thread && <Skeleton rows={3} />}
          {thread && (
            <div className="grid gap-4">
              {mayManage && (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Status" id="t-status">
                    <Select id="t-status" value={thread.ticket.status} disabled={busy}
                            onChange={(e) => patch({ status: e.target.value })}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Field>
                  <Field label="Priority" id="t-priority">
                    <Select id="t-priority" value={thread.ticket.priority} disabled={busy}
                            onChange={(e) => patch({ priority: e.target.value })}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </Field>
                </div>
              )}

              <div className="grid gap-3">
                {thread.messages.map((m) => (
                  <div key={m.message_id}
                       className={`rounded-xl border p-3 ${
                         m.is_internal
                           ? 'border-amber-500/30 bg-amber-500/[0.07]'
                           : m.author_type === 'support'
                             ? 'border-red-500/20 bg-red-500/[0.06]'
                             : 'border-white/10 bg-white/[0.03]'}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                      <span className="font-semibold text-neutral-300">{m.author_name}</span>
                      <span>{when(m.created_at)}</span>
                      {m.is_internal && <Pill tone="warn">Internal — café cannot see this</Pill>}
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-neutral-200">{m.body}</div>
                    <AttachmentList attachments={m.attachments} fetchBlob={adminApi.attachmentBlob} />
                  </div>
                ))}
              </div>

              {mayManage && (
                <>
                  <Field label={internal ? 'Internal note' : 'Reply to the café'} id="t-reply">
                    <textarea id="t-reply" rows={4} className={inputClass} value={reply}
                              placeholder={internal
                                ? 'Only ManagerXP staff will ever see this.'
                                : 'Written to the café — they see this in their portal.'}
                              onChange={(e) => setReply(e.target.value)} />
                  </Field>
                  <AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={busy} />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-amber-500"
                             checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                      Internal note (not sent to the café)
                    </label>
                    <Button onClick={send} disabled={busy || (!reply.trim() && !replyFiles.length)}>
                      {busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Panel>
      )}
    </Page>
  );
};

export default Support;
