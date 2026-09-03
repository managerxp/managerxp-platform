/*
 * Outbound email.
 *
 * The design constraint here is that this system is self-hosted and may well
 * have no mail transport configured at all. That is a normal state, not an
 * error, and it must not be papered over: a "payment link sent" toast when
 * nothing left the building is worse than no button, because the operator
 * stops watching for the customer's reply.
 *
 * So every send returns a verdict — sent, or not sent and why — and every
 * attempt is written to `email_outbox` first. The outbox is what makes a
 * failure recoverable: the message, the recipient and the body survive, so it
 * can be retried or read out over the phone.
 *
 * Configuration comes from settings, not from constants, so an operator can
 * point it at their own SMTP without a deploy — with one exception, below.
 */
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../config/database.js';
import { getSetting } from '../../config/settings.js';

/*
 * The ManagerXP mark that heads every message.
 *
 * Attached and referenced by Content-ID rather than embedded as a data: URI —
 * Gmail and Outlook both refuse to render data: images, so an inlined logo
 * would show as a broken box in the two clients most customers use. A CID
 * attachment renders everywhere and needs no public URL to host it.
 *
 * Read once at startup: it is a 37KB file that never changes between sends.
 */
const LOGO_CID = 'managerxp-logo';
const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logo.png');
let logoBuffer = null;
try {
  logoBuffer = fs.readFileSync(LOGO_PATH);
} catch (error) {
  // A missing logo must never stop mail going out — the alt text carries it.
  console.warn('Mail logo not found, sending without it:', error.message);
}

/** The logo attachment, or nothing when the file is unavailable. */
const logoAttachment = () => (logoBuffer
  ? [{ filename: 'managerxp.png', content: logoBuffer, cid: LOGO_CID, contentDisposition: 'inline' }]
  : []);

/*
 * The credential itself comes from the environment, everything else from
 * settings.
 *
 * A mailbox password sitting in a database column is one dump or one bug in
 * a settings-listing endpoint away from leaking; `.env` is not shipped
 * anywhere the database is, and it is where a credential is expected to be.
 *
 * `SMTP_PASSWORD` wins when it is set. The stored setting is kept as a
 * fallback rather than deleted, so a café that configures its own SMTP
 * through the admin screen — which is the whole reason this reads from
 * settings at all — keeps working without an environment variable of its
 * own. Only ManagerXP's own outbound mailbox needs to live in `.env`; a
 * café's does not have a `.env` to put it in.
 */
const resolveSecret = async (envVar, settingKey, fallback) => {
  const fromEnv = process.env[envVar];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return getSetting(settingKey, fallback);
};

let cached = null;
let cachedKey = '';

/**
 * Build (or reuse) the transport.
 *
 * Returns null when SMTP is not configured, which callers must treat as an
 * ordinary outcome rather than an exception.
 */
const getTransport = async () => {
  const [host, port, user, pass, secure] = await Promise.all([
    resolveSecret('SMTP_HOST', 'mail.smtp_host', ''),
    resolveSecret('SMTP_PORT', 'mail.smtp_port', 587),
    resolveSecret('SMTP_USER', 'mail.smtp_user', ''),
    resolveSecret('SMTP_PASSWORD', 'mail.smtp_password', ''),
    resolveSecret('SMTP_SECURE', 'mail.smtp_secure', false)
  ]);

  if (!host) return null;

  /* Rebuilt only when the settings actually change. A transport holds a
     connection pool; recreating it per message would open a new TCP session
     for every email. */
  const key = `${host}:${port}:${user}:${secure}`;
  if (cached && cachedKey === key) return cached;

  cached = nodemailer.createTransport({
    host: String(host),
    port: Number(port) || 587,
    secure: secure === true || secure === 'true' || Number(port) === 465,
    auth: user ? { user: String(user), pass: String(pass) } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000
  });
  cachedKey = key;
  return cached;
};

/** Drop the cached transport, so the next send picks up changed settings. */
export const resetTransport = () => { cached = null; cachedKey = ''; };

const record = async (entry) => {
  try {
    const { rows } = await pool.query(`
      INSERT INTO email_outbox
        (to_email, to_name, subject, body_html, body_text, kind, related_type,
         related_id, organization_id, status, error, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      entry.to, entry.toName || null, entry.subject,
      entry.html || null, entry.text || null,
      entry.kind || 'other', entry.relatedType || null, entry.relatedId || null,
      entry.organizationId || null, entry.status, entry.error || null,
      entry.status === 'SENT' ? new Date() : null
    ]);
    return rows[0];
  } catch (error) {
    console.error('Could not write to the email outbox:', error.message);
    return null;
  }
};

/**
 * Send one message.
 *
 * Never throws. A failed email must not roll back the thing it was describing
 * — an invoice that exists but whose notification bounced is a smaller problem
 * than an invoice that was refused because the mail server was down.
 */
export const sendMail = async ({
  to, toName, subject, html, text,
  kind = 'other', relatedType = null, relatedId = null, organizationId = null
}) => {
  if (!to || !subject) {
    return { sent: false, reason: 'missing_recipient', message: 'No recipient address' };
  }

  const transport = await getTransport();

  if (!transport) {
    /* Recorded as QUEUED rather than FAILED. Nothing is wrong with the
       message; there is simply nowhere to post it yet, and it can go the
       moment SMTP is configured. */
    const row = await record({
      to, toName, subject, html, text, kind, relatedType, relatedId, organizationId,
      status: 'QUEUED', error: 'No SMTP transport configured'
    });
    return {
      sent: false,
      reason: 'no_transport',
      message: 'Email is not configured, so nothing was sent. The link is on screen — copy it to the customer.',
      outbox_id: row?.outbox_id || null
    };
  }

  const from = await resolveSecret('MAIL_FROM_ADDRESS', 'mail.from_address', 'no-reply@managerxp.com');
  const fromName = await resolveSecret('MAIL_FROM_NAME', 'mail.from_name', 'ManagerXP');

  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${from}>`,
      to: toName ? `"${toName}" <${to}>` : to,
      subject, html, text,
      // The header logo every template references by cid.
      attachments: logoAttachment()
    });
    const row = await record({
      to, toName, subject, html, text, kind, relatedType, relatedId, organizationId,
      status: 'SENT'
    });
    return { sent: true, message: `Sent to ${to}`, message_id: info.messageId, outbox_id: row?.outbox_id };
  } catch (error) {
    console.error('Email send failed:', error.message);
    const row = await record({
      to, toName, subject, html, text, kind, relatedType, relatedId, organizationId,
      status: 'FAILED', error: String(error.message).slice(0, 500)
    });
    return {
      sent: false, reason: 'send_failed',
      message: `Email could not be sent: ${error.message}`,
      outbox_id: row?.outbox_id || null
    };
  }
};

/** Whether email is usable at all — for the UI to say so before trying. */
export const mailConfigured = async () => !!(await resolveSecret('SMTP_HOST', 'mail.smtp_host', ''));

/* ==========================================================================
   TEMPLATES

   Plain HTML with inline styles, because email clients strip <style> blocks
   and none of them support a stylesheet. A text alternative accompanies every
   message so it stays readable where HTML is refused.
   ========================================================================== */

const shell = (title, body) => `
<div style="background:#0a0a0a;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:14px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #262626">
      <img src="cid:${LOGO_CID}" width="26" height="26" alt="ManagerXP"
           style="display:inline-block;vertical-align:middle;width:26px;height:26px;border:0">
      <span style="color:#fff;font-weight:600;margin-left:8px;font-size:15px;vertical-align:middle">ManagerXP</span>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;color:#fff;font-size:17px;font-weight:600">${title}</h1>
      ${body}
    </div>
    <div style="padding:14px 24px;border-top:1px solid #262626;color:#666;font-size:11px">
      This message was sent by ManagerXP. If you were not expecting it, you can ignore it.
    </div>
  </div>
</div>`;

const inr = (n, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(Number(n || 0));

export const invoicePaymentLinkEmail = ({ invoice, link, url, organizationName }) => {
  const amount = inr(link.amount, link.currency);
  const due = invoice?.due_date
    ? new Date(invoice.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const subject = invoice
    ? `Invoice ${invoice.invoice_no} from ManagerXP — ${amount}`
    : `Payment request from ManagerXP — ${amount}`;

  const body = `
    <p style="margin:0 0 16px;color:#a3a3a3;font-size:14px;line-height:1.6">
      Hello${organizationName ? ` ${organizationName}` : ''},<br>
      ${invoice
        ? `Invoice <strong style="color:#fff">${invoice.invoice_no}</strong> for your CafeXP subscription is ready.`
        : 'A payment is due on your CafeXP subscription.'}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      <tr>
        <td style="padding:8px 0;color:#737373;font-size:13px">Amount</td>
        <td style="padding:8px 0;color:#fff;font-size:15px;font-weight:600;text-align:right">${amount}</td>
      </tr>
      ${invoice ? `<tr>
        <td style="padding:8px 0;color:#737373;font-size:13px;border-top:1px solid #262626">Period</td>
        <td style="padding:8px 0;color:#d4d4d4;font-size:13px;text-align:right;border-top:1px solid #262626">
          ${new Date(invoice.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          &ndash;
          ${new Date(invoice.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </td>
      </tr>` : ''}
      ${due ? `<tr>
        <td style="padding:8px 0;color:#737373;font-size:13px;border-top:1px solid #262626">Due by</td>
        <td style="padding:8px 0;color:#d4d4d4;font-size:13px;text-align:right;border-top:1px solid #262626">${due}</td>
      </tr>` : ''}
    </table>
    <a href="${url}" style="display:block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:600;font-size:14px;text-align:center">
      Pay ${amount}
    </a>
    <p style="margin:16px 0 0;color:#666;font-size:12px;line-height:1.6">
      Or copy this link into your browser:<br>
      <span style="color:#a3a3a3;word-break:break-all">${url}</span>
    </p>
    <p style="margin:14px 0 0;color:#666;font-size:12px">
      ManagerXP will never ask for your card details by email or phone. The only
      place to enter them is the payment page linked above.
    </p>`;

  const text = [
    invoice ? `Invoice ${invoice.invoice_no} from ManagerXP` : 'Payment request from ManagerXP',
    ``,
    `Amount: ${amount}`,
    due ? `Due by: ${due}` : '',
    ``,
    `Pay here: ${url}`,
    ``,
    `ManagerXP will never ask for your card details by email or phone.`
  ].filter(Boolean).join('\n');

  return { subject, html: shell(subject, body), text };
};

/*
 * Password reset OTP — for a café owner or a customer.
 *
 * A code, not a link. The people this goes to are often mid-shift at a
 * station or on a shared kiosk, where clicking through a link is more
 * friction than typing six digits into the app they already have open.
 */
export const passwordResetOtpEmail = ({ name, code, minutes, cafeName }) => {
  /* The code lives in the body only — a subject line is what shows on a lock
     screen or in a notification preview, which defeats the point of a code
     nobody but the recipient should see. The café name here instead, so a
     person juggling logins for more than one café knows which one this is
     for before they even open it. */
  const subject = `Reset your password — ${cafeName || 'ManagerXP'}`;
  const body = `
    <p style="margin:0 0 20px;color:#a3a3a3;font-size:14px;line-height:1.6">
      Hello${name ? ` ${name}` : ''},<br>
      Use this code to reset your password. It expires in ${minutes} minutes.
    </p>
    <div style="background:#0a0a0a;border:1px solid #262626;border-radius:10px;
                padding:20px;text-align:center;margin:0 0 20px">
      <span style="color:#fff;font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">
        ${code}
      </span>
    </div>
    <p style="margin:0;color:#666;font-size:12px;line-height:1.6">
      If you did not ask to reset your password, you can ignore this message —
      your password has not been changed. Never share this code with anyone,
      including someone claiming to be from ManagerXP.
    </p>`;

  const text = [
    `Your ManagerXP password reset code: ${code}`,
    ``,
    `This code expires in ${minutes} minutes.`,
    `If you did not ask to reset your password, you can ignore this message.`
  ].join('\n');

  return { subject, html: shell(subject, body), text };
};

/**
 * The code that confirms a new account's email address really belongs to
 * whoever just signed up.
 *
 * Same shape as the reset code on purpose: someone who has seen one recognises
 * the other, and a familiar-looking security email is one people read rather
 * than delete.
 */
export const emailVerificationOtpEmail = ({ name, code, minutes, cafeName }) => {
  // See passwordResetOtpEmail above — the code never rides in the subject.
  const subject = `Verify your email — ${cafeName || 'ManagerXP'}`;
  const body = `
    <p style="margin:0 0 20px;color:#a3a3a3;font-size:14px;line-height:1.6">
      Welcome${name ? ` ${name}` : ''},<br>
      Enter this code in ManagerXP to confirm this email address. It expires in ${minutes} minutes.
    </p>
    <div style="background:#0a0a0a;border:1px solid #262626;border-radius:10px;
                padding:20px;text-align:center;margin:0 0 20px">
      <span style="color:#fff;font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">
        ${code}
      </span>
    </div>
    <p style="margin:0;color:#666;font-size:12px;line-height:1.6">
      If you did not create a ManagerXP account, you can ignore this message and
      nothing further will happen. Never share this code with anyone, including
      someone claiming to be from ManagerXP.
    </p>`;

  const text = [
    `Your ManagerXP verification code: ${code}`,
    ``,
    `This code expires in ${minutes} minutes.`,
    `If you did not create a ManagerXP account, you can ignore this message.`
  ].join('\n');

  return { subject, html: shell(subject, body), text };
};

export const paymentReceiptEmail = ({ invoice, payment, organizationName }) => {
  const amount = inr(payment.amount, payment.currency);
  const subject = `Payment received — ${amount}${invoice ? ` for ${invoice.invoice_no}` : ''}`;
  const body = `
    <p style="margin:0 0 16px;color:#a3a3a3;font-size:14px;line-height:1.6">
      Thank you${organizationName ? `, ${organizationName}` : ''}. We have received your payment of
      <strong style="color:#fff">${amount}</strong>${invoice ? ` against invoice ${invoice.invoice_no}` : ''}.
    </p>
    ${invoice && Number(invoice.total) > Number(invoice.amount_paid) ? `
      <p style="margin:0;color:#fbbf24;font-size:13px">
        ${inr(Number(invoice.total) - Number(invoice.amount_paid), invoice.currency)} remains outstanding on this invoice.
      </p>` : `
      <p style="margin:0;color:#34d399;font-size:13px">This invoice is now settled in full.</p>`}`;
  return {
    subject,
    html: shell(subject, body),
    text: `Payment received: ${amount}${invoice ? ` for ${invoice.invoice_no}` : ''}.`
  };
};
