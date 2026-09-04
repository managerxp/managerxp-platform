import React, { useEffect, useState } from 'react';

/*
 * Files on a support message.
 *
 * Every byte comes from an authenticated fetch — never a plain URL — so the
 * same Bearer token this app already uses for every other call is what an
 * attachment needs too. See portalApi.attachmentBlob for why that matters:
 * a token in a URL can end up in browser history or a proxy log and stays
 * valid for the rest of the session, where a fetch header does not.
 */

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv';

const sizeLabel = (bytes) => (
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
);

/**
 * The file picker for composing a ticket or a reply.
 *
 * Kept deliberately dumb: it holds the chosen File objects and reports the
 * list up on every change. Validation here is a courtesy — the server enforces
 * the real limits — so a mistake here can only annoy, never let anything past
 * what the backend refuses anyway.
 */
export const AttachmentPicker = ({ files, onChange, disabled }) => {
  const [error, setError] = useState('');

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const combined = [...files, ...incoming];
    if (combined.length > MAX_FILES) {
      setError(`Attach at most ${MAX_FILES} files`);
      return;
    }
    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over ${Math.round(MAX_BYTES / (1024 * 1024))} MB`);
      return;
    }
    setError('');
    onChange(combined);
  };

  const remove = (index) => onChange(files.filter((_, i) => i !== index));

  return (
    <div>
      <label className={`inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-neutral-400 hover:text-neutral-200 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" />
        </svg>
        Attach files
        <input type="file" className="hidden" multiple accept={ACCEPT} disabled={disabled}
               onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </label>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-neutral-300">
              {f.name} <span className="text-neutral-500">({sizeLabel(f.size)})</span>
              <button type="button" onClick={() => remove(i)} className="text-neutral-500 hover:text-red-400" aria-label={`Remove ${f.name}`}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/** One already-uploaded attachment: an inline thumbnail for an image, a
    click-to-download chip for anything else. */
const AttachmentItem = ({ attachment, fetchBlob }) => {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!attachment.is_image) return undefined;
    let objectUrl = null;
    let cancelled = false;
    setBusy(true);
    fetchBlob(attachment.attachment_id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // attachment.attachment_id is the only input that should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.attachment_id]);

  const download = async () => {
    setBusy(true); setError('');
    try {
      const blob = await fetchBlob(attachment.attachment_id);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = attachment.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // The download has started synchronously; the object can go once the
      // event loop turns, well before any plausible download completes.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (attachment.is_image) {
    return (
      <button type="button" onClick={() => url && window.open(url, '_blank', 'noopener')}
              disabled={!url} title={attachment.name}
              className="group relative h-20 w-20 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
        {busy && !url && (
          <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">…</span>
        )}
        {url && <img src={url} alt={attachment.name} className="h-full w-full object-cover" />}
        {error && <span className="flex h-full w-full items-center justify-center px-1 text-center text-[9px] text-red-400">{error}</span>}
      </button>
    );
  }

  return (
    <button type="button" onClick={download} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-neutral-300 hover:border-white/20 disabled:opacity-60">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      </svg>
      {attachment.name} <span className="text-neutral-500">({sizeLabel(attachment.size_bytes)})</span>
      {error && <span className="text-red-400">— {error}</span>}
    </button>
  );
};

/** The row of attachments under a message. Renders nothing when there are none. */
export const AttachmentList = ({ attachments, fetchBlob }) => {
  if (!attachments || !attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      {attachments.map((a) => <AttachmentItem key={a.attachment_id} attachment={a} fetchBlob={fetchBlob} />)}
    </div>
  );
};
