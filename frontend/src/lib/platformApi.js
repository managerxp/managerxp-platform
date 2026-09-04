/*
 * Client for the ManagerXP platform console.
 *
 * The older admin pages call the API bare, with no Authorization header —
 * which works only because the endpoints they hit were never guarded. Every
 * platform endpoint is, and rightly: it crosses tenant boundaries and exposes
 * every customer's billing. So this helper exists to make sending the token
 * the default rather than something each page has to remember.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL;

const token = () => localStorage.getItem('mxp_token') || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}/api/platform${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(options.headers || {})
    }
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const platformApi = {
  overview: () => request('/overview').then((b) => b.data),

  cafes: (search) =>
    request(`/cafes${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((b) => b.data),
  setCafeStatus: (cafeId, isActive, reason) =>
    request(`/cafes/${cafeId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive, reason })
    }),

  subscriptions: () => request('/subscriptions').then((b) => b.data),
  createSubscription: (payload) =>
    request('/subscriptions', { method: 'POST', body: JSON.stringify(payload) }),
  updateSubscription: (id, payload) =>
    request(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  payments: () => request('/payments').then((b) => b.data),
  recordPayment: (payload) =>
    request('/payments', { method: 'POST', body: JSON.stringify(payload) }),

  paymentLinks: (status) =>
    request(`/payment-links${status ? `?status=${status}` : ''}`).then((b) => b.data),
  createPaymentLink: (payload) =>
    request('/payment-links', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  cancelPaymentLink: (id) => request(`/payment-links/${id}/cancel`, { method: 'POST' }),

  createCafe: (payload) =>
    request('/cafes', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),

  users: (search) =>
    request(`/users${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((b) => b.data),
  createUser: (payload) =>
    request('/users', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  resetUserPassword: (id) =>
    request(`/users/${id}/reset-password`, { method: 'POST' }).then((b) => b.data),

  licenses: () => request('/licenses').then((b) => b.data),
  createLicense: (payload) =>
    request('/licenses', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  revokeLicense: (id, reason) =>
    request(`/licenses/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unbindLicense: (id) => request(`/licenses/${id}/unbind`, { method: 'POST' }),
  licenseActivations: (id) => request(`/licenses/${id}/activations`).then((b) => b.data),

  plans: () => request('/plans').then((b) => b.data),
  updatePlanPricing: (id, payload) =>
    request(`/plans/${id}/pricing`, { method: 'PATCH', body: JSON.stringify(payload) })
};

/** Money, formatted the way the whole console should agree on. */
export const formatMoney = (amount, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(Number(amount || 0));

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default platformApi;
