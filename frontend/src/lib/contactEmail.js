/*
 * Contact and Book a Demo now submit through this backend's own SMTP
 * mailer (see backend/src/controllers/contact.Controller.js) instead of a
 * client-side third-party widget — no separate account or credentials to
 * configure, and it reuses the same mail transport that already sends
 * OTP and password-reset email.
 *
 * Reads straight off the DOM form via FormData, matching the uncontrolled
 * inputs both pages already had (they were originally built for
 * emailjs.sendForm(), which reads a form the same way) — neither page's
 * inputs needed to become controlled just to switch how the submit works.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL;

const post = async (path, body) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    // 503 means "mail isn't configured yet" (an operational state, not a
    // bug) — carried through so the two pages can show it as a notice
    // rather than an error.
    const error = new Error(data.message || 'Could not send your message. Please try again.');
    error.status = res.status;
    throw error;
  }
  return data;
};

export const sendContactForm = (formEl) => {
  const data = new FormData(formEl);
  return post('/api/public/contact', {
    name: data.get('user_name'),
    email: data.get('user_email'),
    subject: data.get('subject'),
    message: data.get('message')
  });
};

export const sendDemoRequest = (formEl) => {
  const data = new FormData(formEl);
  return post('/api/public/contact/demo', {
    name: data.get('user_name'),
    organization: data.get('organization_name'),
    email: data.get('user_email'),
    phone: data.get('phone_number'),
    software: data.get('software_type'),
    subject: data.get('subject'),
    message: data.get('message')
  });
};
