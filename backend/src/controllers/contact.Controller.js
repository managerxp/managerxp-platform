import { sendMail, contactFormEmail, demoRequestEmail } from '../modules/mail/mailer.js';

/*
 * The marketing site's Contact and Book a Demo forms. Both are public — no
 * account, no café context — and both just forward what was typed to
 * ManagerXP's own inbox, the same address the Contact page prints next to
 * "Response time: ~24h". sendMail() never throws and always records to
 * email_outbox, so a form submission here can only fail on a missing/bad
 * field, never on the mail server being unreachable.
 */
const INBOX = 'managerxp2026@gmail.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * sendMail()'s own failure message is written for its other callers
 * ("...the link is on screen, copy it to the customer") — right for a
 * payment link, meaningless here. Both routes below show this instead
 * whenever result.sent is false, regardless of the underlying reason.
 */
const NOT_SENT_MESSAGE =
  `Message sending is not connected yet. Email us directly at ${INBOX} and we will pick it up from there.`;

export const submitContactForm = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }

    const { subject: mailSubject, html, text } = contactFormEmail({ name, email, subject, message });
    const result = await sendMail({
      to: INBOX, toName: 'ManagerXP', subject: mailSubject, html, text, kind: 'contact_form'
    });

    if (!result.sent) {
      return res.status(503).json({ success: false, message: NOT_SENT_MESSAGE });
    }
    res.json({ success: true, message: 'Message sent.' });
  } catch (error) {
    console.error('Contact form submission failed:', error);
    res.status(500).json({ success: false, message: 'Could not send your message. Please try again.' });
  }
};

export const submitDemoRequest = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const organization = String(req.body?.organization || '').trim();
    const email = String(req.body?.email || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const software = String(req.body?.software || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!name || !organization || !email || !phone || !software || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }

    const { subject: mailSubject, html, text } =
      demoRequestEmail({ name, organization, email, phone, software, subject, message });
    const result = await sendMail({
      to: INBOX, toName: 'ManagerXP', subject: mailSubject, html, text, kind: 'demo_request'
    });

    if (!result.sent) {
      return res.status(503).json({ success: false, message: NOT_SENT_MESSAGE });
    }
    res.json({ success: true, message: 'Demo request sent.' });
  } catch (error) {
    console.error('Demo request submission failed:', error);
    res.status(500).json({ success: false, message: 'Could not send your request. Please try again.' });
  }
};
