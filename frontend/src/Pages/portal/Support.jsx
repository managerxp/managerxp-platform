import React, { useCallback, useEffect, useState } from 'react';
import { portalApi, relativeTime } from '../../lib/portalApi';
import {
  Page, Card, Button, Field, Input, Select, Pill, Banner, Empty, Skeleton, inputClass
} from '../../components/portal/ui';
import { AttachmentPicker, AttachmentList } from '../../components/portal/Attachments';

/*
 * The café's side of support: raise a ticket, follow the thread, close it.
 *
 * A thread, not a form that disappears. The most common support complaint is
 * not knowing whether anyone read it, so every ticket keeps its replies on
 * screen and says plainly which side is waiting on the other.
 */

const CATEGORIES = [
  ['TECHNICAL', 'Technical problem'],
  ['BILLING', 'Billing or payment'],
  ['ACCOUNT', 'Account or access'],
  ['FEATURE', 'Feature request'],
  ['OTHER', 'Something else']
];

const PRIORITIES = [['LOW', 'Low'], ['NORMAL', 'Normal'], ['HIGH', 'High'], ['URGENT', 'Urgent']];

const statusTone = (s) => ({
  OPEN: 'warn', PENDING: 'warn', ANSWERED: 'good', RESOLVED: 'good', CLOSED: 'mute'
}[s] || 'mute');

const Support = () => {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'TECHNICAL', priority: 'NORMAL', message: '' });
  const [newFiles, setNewFiles] = useState([]);
  const [replyFiles, setReplyFiles] = useState([]);

  const load = useCallback(() => {
    portalApi.tickets().then(setTickets).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openThread = (id) => {
    setOpenId(id);
    setThread(null);
    portalApi.ticket(id).then(setThread).catch((e) => setError(e.message));
  };

  const submitNew = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const created = await portalApi.createTicket({ ...form, files: newFiles });
      setForm({ subject: '', category: 'TECHNICAL', priority: 'NORMAL', message: '' });
      setNewFiles([]);
      setComposing(false);
      setNotice(`Ticket ${created.reference} raised. We will reply here.`);
      load();
      openThread(created.ticket_id);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!reply.trim() && !replyFiles.length) return;
    setBusy(true); setError('');
    try {
      await portalApi.replyTicket(openId, reply, replyFiles);
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

  const close = async () => {
    setBusy(true);
    try {
      await portalApi.closeTicket(openId);
      setNotice('Ticket closed. Reply any time to reopen it.');
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
      title="Support"
      lede="Raise a ticket with the ManagerXP team and follow the conversation here."
      actions={
        <Button onClick={() => { setComposing((v) => !v); setNotice(''); }}>
          {composing ? 'Cancel' : 'New ticket'}
        </Button>
      }
    >
      {error && <Banner tone="bad" title="Something went wrong">{error}</Banner>}
      {notice && <Banner tone="good">{notice}</Banner>}

      {composing && (
        <Card title="Raise a ticket" description="Tell us what is happening and we will pick it up.">
          <form onSubmit={submitNew} className="grid gap-4">
            <Field label="Subject" id="t-subject" required>
              <Input id="t-subject" value={form.subject} required maxLength={200}
                     placeholder="Station PC-03 will not connect"
                     onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" id="t-category">
                <Select id="t-category" value={form.category}
                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Priority" id="t-priority" hint="Tell us how much it is hurting.">
                <Select id="t-priority" value={form.priority}
                        onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                  {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="What is happening?" id="t-message" required>
              <textarea id="t-message" required rows={5} maxLength={8000}
                        className={inputClass} value={form.message}
                        placeholder="What you saw, what you expected, and anything you have already tried."
                        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </Field>
            <AttachmentPicker files={newFiles} onChange={setNewFiles} disabled={busy} />
            <div>
              <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Raise ticket'}</Button>
            </div>
          </form>
        </Card>
      )}

      {!tickets && <Skeleton rows={3} />}

      {tickets && tickets.length === 0 && !composing && (
        <Empty
          title="No tickets yet"
          text="When something needs the ManagerXP team, raise a ticket and it will appear here with our replies."
          action={<Button onClick={() => setComposing(true)}>New ticket</Button>}
        />
      )}

      {tickets && tickets.length > 0 && (
        <Card title="Your tickets">
          <div className="divide-y divide-white/5">
            {tickets.map((t) => (
              <button
                key={t.ticket_id}
                onClick={() => openThread(t.ticket_id)}
                className={`flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-white/[0.03] ${
                  openId === t.ticket_id ? 'bg-white/[0.04]' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-neutral-500">{t.reference}</span>
                    <span className="text-sm font-semibold text-neutral-100">{t.subject}</span>
                    <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                    {t.awaiting_customer && <Pill tone="good">Reply from support</Pill>}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {t.category} · {t.priority} · last activity {relativeTime(t.last_reply_at)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {openId && (
        <Card
          title={thread ? `${thread.ticket.reference} — ${thread.ticket.subject}` : 'Loading…'}
          description={thread ? `${thread.ticket.category} · ${thread.ticket.priority} · ${thread.ticket.status}` : ''}
          actions={
            thread && thread.ticket.status !== 'CLOSED' ? (
              <Button variant="ghost" onClick={close} disabled={busy}>Close ticket</Button>
            ) : null
          }
        >
          {!thread && <Skeleton rows={2} />}
          {thread && (
            <div className="grid gap-4">
              <div className="grid gap-3">
                {thread.messages.map((m) => (
                  <div
                    key={m.message_id}
                    className={`rounded-xl border p-3 ${
                      m.author_type === 'support'
                        ? 'border-red-500/20 bg-red-500/[0.06]'
                        : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-500">
                      <span className="font-semibold text-neutral-300">
                        {m.author_type === 'support' ? 'ManagerXP Support' : m.author_name}
                      </span>
                      <span>{relativeTime(m.created_at)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-neutral-200">{m.body}</div>
                    <AttachmentList attachments={m.attachments} fetchBlob={portalApi.attachmentBlob} />
                  </div>
                ))}
              </div>

              <Field label="Reply" id="t-reply">
                <textarea id="t-reply" rows={3} className={inputClass} value={reply}
                          placeholder={thread.ticket.status === 'CLOSED'
                            ? 'Replying reopens this ticket.'
                            : 'Add anything that might help us…'}
                          onChange={(e) => setReply(e.target.value)} />
              </Field>
              <AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={busy} />
              <div>
                <Button onClick={sendReply} disabled={busy || (!reply.trim() && !replyFiles.length)}>
                  {busy ? 'Sending…' : 'Send reply'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </Page>
  );
};

export default Support;
