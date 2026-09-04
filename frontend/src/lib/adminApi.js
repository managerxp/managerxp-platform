/*
 * Client for the ManagerXP admin API.
 *
 * Deliberately separate from `platformApi.js`, which talks to the older
 * `/api/platform` endpoints using a café owner's token. This one carries a
 * ManagerXP administrator token — a different principal, a different audience
 * claim, a different storage key. Sharing a client between them would sooner
 * or later send one principal's token to the other's endpoint.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL;

const TOKEN_KEY = 'mxp_admin_token';
const ADMIN_KEY = 'mxp_admin_user';

export const adminAuth = {
  token: () => localStorage.getItem(TOKEN_KEY) || '',
  setToken: (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),

  /* The signed-in administrator, cached so the shell can render its sidebar on
     the first paint instead of after a round trip. The server re-reads
     permissions on every request regardless, so a stale copy here can only
     ever offer something the API then refuses — never grant it. */
  admin: () => {
    try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); } catch { return null; }
  },
  setAdmin: (a) => (a ? localStorage.setItem(ADMIN_KEY, JSON.stringify(a)) : localStorage.removeItem(ADMIN_KEY)),

  signOut: () => {
    [TOKEN_KEY, ADMIN_KEY].forEach((k) => localStorage.removeItem(k));
  },
  isSignedIn: () => !!localStorage.getItem(TOKEN_KEY),

  /** What the sidebar uses to decide whether to offer a section. */
  can: (key) => {
    const a = adminAuth.admin();
    if (!a) return false;
    if (a.is_superuser) return true;
    return (a.permissions || []).includes(key);
  }
};

async function request(path, options = {}) {
  const headers = {
    // A FormData body carries its own multipart boundary; forcing JSON on top
    // of it would leave the server unable to parse either.
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };
  if (adminAuth.token()) headers.Authorization = `Bearer ${adminAuth.token()}`;

  const res = await fetch(`${API_BASE_URL}/api/admin${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = body.data;
    /* A dead session should land on the sign-in page rather than showing an
       error nobody can act on. 403 is left alone — that is a real answer
       about permissions, not a broken session. */
    if (res.status === 401) adminAuth.signOut();
    throw err;
  }
  return body;
}

const qs = (params) => {
  const s = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  });
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const adminApi = {
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      .then((b) => b.data),
  me: () => request('/auth/me').then((b) => b.data),
  logout: () => request('/auth/logout', { method: 'POST' }).catch(() => ({})),
  forgotPassword: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  changePassword: (current_password, new_password) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),

  dashboard: () => request('/dashboard').then((b) => b.data),

  organizations: (params) => request(`/organizations${qs(params)}`).then((b) => b.data),
  organization: (id) => request(`/organizations/${id}`).then((b) => b.data),
  entitlements: (id, branchId) =>
    request(`/organizations/${id}/entitlements${qs({ branch_id: branchId })}`).then((b) => b.data),
  setOverride: (id, featureKey, payload) =>
    request(`/organizations/${id}/overrides/${featureKey}`, {
      method: 'PUT', body: JSON.stringify(payload)
    }).then((b) => b.data),
  setOrganizationStatus: (id, status, reason) =>
    request(`/organizations/${id}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }),

  /* The station types cafés actually run and price — the plan editor's cap
     list, so it offers real types rather than a guess baked into the page. */
  stationTypes: () => request('/station-types').then((b) => b.data),

  packages: () => request('/packages').then((b) => b.data),
  package: (id) => request(`/packages/${id}`).then((b) => b.data),
  createPackage: (payload) =>
    request('/packages', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  updatePackage: (id, payload) =>
    request(`/packages/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),
  setPackageFeatures: (id, features) =>
    request(`/packages/${id}/features`, { method: 'PUT', body: JSON.stringify({ features }) }),
  setPackagePrices: (id, prices) =>
    request(`/packages/${id}/prices`, { method: 'PUT', body: JSON.stringify({ prices }) }),

  features: () => request('/features').then((b) => b.data),
  createFeature: (payload) =>
    request('/features', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  updateFeature: (key, payload) =>
    request(`/features/${key}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),

  addons: () => request('/addons').then((b) => b.data),
  createAddon: (payload) =>
    request('/addons', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  updateAddon: (id, payload) =>
    request(`/addons/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),
  deleteAddon: (id) => request(`/addons/${id}`, { method: 'DELETE' }),

  branches: (params) => request(`/branches${qs(params)}`).then((b) => b.data),
  updateBranch: (id, payload) =>
    request(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),
  pcPool: (organizationId) => request(`/organizations/${organizationId}/pool`).then((b) => b.data),

  subscriptions: (params) => request(`/subscriptions${qs(params)}`).then((b) => b.data),
  subscription: (id) => request(`/subscriptions/${id}`).then((b) => b.data),
  updateSubscription: (id, payload) =>
    request(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),
  extendSubscription: (id, days) =>
    request(`/subscriptions/${id}/extend`, { method: 'POST', body: JSON.stringify({ days }) }),
  setSubscriptionStatus: (id, status, reason) =>
    request(`/subscriptions/${id}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }),
  addAddon: (id, addon_id, quantity) =>
    request(`/subscriptions/${id}/addons`, { method: 'POST', body: JSON.stringify({ addon_id, quantity }) }),
  removeAddon: (id, rowId) =>
    request(`/subscriptions/${id}/addons/${rowId}`, { method: 'DELETE' }),

  installations: (params) => request(`/installations${qs(params)}`).then((b) => b.data),
  setInstallationStatus: (id, status, reason) =>
    request(`/installations/${id}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }),
  forceReauth: (id) => request(`/installations/${id}/reauth`, { method: 'POST' }),

  devices: (params) => request(`/devices${qs(params)}`).then((b) => b.data),
  setDeviceStatus: (id, active, reason) =>
    request(`/devices/${id}/status`, { method: 'POST', body: JSON.stringify({ active, reason }) }),

  invoices: (params) => request(`/invoices${qs(params)}`).then((b) => b.data),
  invoice: (id) => request(`/invoices/${id}`).then((b) => b.data),
  createInvoice: (payload) =>
    request('/invoices', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  recordPayment: (invoiceId, payload) =>
    request(`/invoices/${invoiceId}/payments`, { method: 'POST', body: JSON.stringify(payload) }),
  voidInvoice: (id, reason) =>
    request(`/invoices/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),

  payments: (params) => request(`/payments${qs(params)}`).then((b) => b.data),
  refundPayment: (id, payload) =>
    request(`/payments/${id}/refund`, { method: 'POST', body: JSON.stringify(payload) }),

  runBilling: (payload) =>
    request('/billing/run', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),

  gateways: () => request('/gateways').then((b) => b.data),
  saveGateway: (provider, payload) =>
    request(`/gateways/${provider}`, { method: 'PUT', body: JSON.stringify(payload) }),
  verifyGateway: (provider) => request(`/gateways/${provider}/verify`, { method: 'POST' }),
  createPaymentLink: (invoiceId, payload) =>
    request(`/invoices/${invoiceId}/payment-link`, { method: 'POST', body: JSON.stringify(payload) }),
  emailOutbox: (params) => request(`/email-outbox${qs(params)}`).then((b) => b.data),

  paymentLinks: (params) => request(`/payment-links${qs(params)}`).then((b) => b.data),
  createPaymentLinkStandalone: (payload) =>
    request('/payment-links', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  sendPaymentLink: (id, payload) =>
    request(`/payment-links/${id}/send`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelPaymentLink: (id, reason) =>
    request(`/payment-links/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),

  adminUsers: () => request('/admin-users').then((b) => b.data),
  createAdminUser: (payload) =>
    request('/admin-users', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  updateAdminUser: (id, payload) =>
    request(`/admin-users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  resetAdminPassword: (id) =>
    request(`/admin-users/${id}/reset`, { method: 'POST' }).then((b) => ({ ...b.data, message: b.message })),
  adminLogins: (id) => request(`/admin-users/${id}/logins`).then((b) => b.data),

  roles: () => request('/roles').then((b) => b.data),
  createRole: (payload) =>
    request('/roles', { method: 'POST', body: JSON.stringify(payload) }),
  setRolePermissions: (id, permissions) =>
    request(`/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),

  settings: () => request('/settings').then((b) => b.data),
  saveSettings: (settings) =>
    request('/settings', { method: 'PUT', body: JSON.stringify({ settings }) }).then((b) => b.data),
  testEmail: (to) =>
    request('/settings/test-email', { method: 'POST', body: JSON.stringify({ to }) }),

  audit: (params) => request(`/audit${qs(params)}`).then((b) => b.data),

  /*
   * The master Game Catalog. Every café's "add a game" list reads this; a
   * café never writes to it — only ManagerXP staff with catalogue.manage do.
   *
   * A game and its launch configuration are two levels, not one row: the game
   * carries the name and artwork, and each platform it ships on (Steam, Epic,
   * EA…) gets its own nested config, because the same title on three stores is
   * three different App IDs. Every game response carries a `platforms` array.
   *
   * Logo/cover uploads go as multipart, so they skip the JSON `Content-Type`
   * the same way `replyTicket`'s file path does above.
   */
  gameCatalog: (params) => request(`/game-catalog${qs(params)}`).then((b) => b.data),
  catalogGame: (id) => request(`/game-catalog/${id}`).then((b) => b.data),
  createCatalogGame: (payload) =>
    request('/game-catalog', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  updateCatalogGame: (id, payload) =>
    request(`/game-catalog/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),
  deleteCatalogGame: (id) => request(`/game-catalog/${id}`, { method: 'DELETE' }),
  uploadCatalogLogo: (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request(`/game-catalog/${id}/logo`, { method: 'PATCH', body: fd }).then((b) => b.data);
  },
  uploadCatalogCover: (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request(`/game-catalog/${id}/cover`, { method: 'PATCH', body: fd }).then((b) => b.data);
  },

  createCatalogPlatform: (gameId, payload) =>
    request(`/game-catalog/${gameId}/platforms`, { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.data),
  updateCatalogPlatform: (gameId, platformId, payload) =>
    request(`/game-catalog/${gameId}/platforms/${platformId}`, { method: 'PATCH', body: JSON.stringify(payload) }).then((b) => b.data),
  deleteCatalogPlatform: (gameId, platformId) =>
    request(`/game-catalog/${gameId}/platforms/${platformId}`, { method: 'DELETE' }),

  /* Support desk. These see every café's tickets, and only these can read or
     write an internal note. */
  tickets: (params) => request(`/support/tickets${qs(params)}`).then((b) => b.data),
  ticket: (id) => request(`/support/tickets/${id}`).then((b) => b.data),
  replyTicket: (id, message, internal = false, files) => {
    if (!files || !files.length) {
      return request(`/support/tickets/${id}/reply`, {
        method: 'POST', body: JSON.stringify({ message, internal })
      }).then((b) => b.data);
    }
    const fd = new FormData();
    fd.append('message', message);
    fd.append('internal', String(internal));
    files.forEach((f) => fd.append('files', f));
    return request(`/support/tickets/${id}/reply`, { method: 'POST', body: fd }).then((b) => b.data);
  },
  updateTicket: (id, patch) =>
    request(`/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((b) => b.data),

  /* See portalApi.attachmentBlob — same reasoning: fetch with the header we
     already authenticate every other call with, never a token in a URL. */
  attachmentBlob: (id) =>
    fetch(`${API_BASE_URL}/api/admin/support/attachments/${id}`, {
      headers: { Authorization: `Bearer ${adminAuth.token()}` }
    }).then((res) => {
      if (!res.ok) throw new Error('Could not fetch that file');
      return res.blob();
    })
};

/*
 * The Software Master client that used to live here is gone along with its
 * admin page — the Game Catalog above is now the one place a title is
 * authored. The server still serves /api/software-master, because the café
 * console reads it; nothing in this console does.
 */

/** Absolute URL for an uploaded asset. Stored paths are server-relative. */
export const assetUrl = (p) =>
  !p ? null : (p.startsWith('http') ? p : `${API_BASE_URL}${p.startsWith('/') ? '' : '/'}${p}`);

/* ── formatting, shared so every page agrees ── */

export const money = (amount, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(Number(amount || 0));

export const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const dateTime = (value) =>
  value ? new Date(value).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }) : '—';

export const relativeTime = (value) => {
  if (!value) return 'never';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export default adminApi;
