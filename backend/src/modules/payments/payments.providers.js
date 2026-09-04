/*
 * Payment provider adapters.
 *
 * Every provider here does the same three things — create an order, verify the
 * customer's return, verify the webhook — and every one of them does it
 * differently enough that a shared abstraction has to be written carefully
 * rather than assumed. The signature formulas below are each provider's own;
 * they are the whole security boundary, so they are spelled out rather than
 * hidden behind a helper.
 *
 * What is deliberately NOT here: any notion of "trust the client". A provider
 * adapter never reads an amount from a request body. The amount comes from the
 * `topup_orders` row the server wrote before the customer left for the
 * gateway, and the adapter's job is to confirm the provider agrees with it.
 */
import crypto from 'crypto';
import { safeEqual } from './payments.crypto.js';

const hmacHex = (secret, payload, algo = 'sha256') =>
  crypto.createHmac(algo, String(secret)).update(String(payload)).digest('hex');

const sha512Hex = (payload) =>
  crypto.createHash('sha512').update(String(payload)).digest('hex');

/** Providers quote minor units (paise/cents); we store major units. */
const toMinor = (amount) => Math.round(Number(amount) * 100);

/* ==========================================================================
   RAZORPAY
   ========================================================================== */
const razorpay = {
  id: 'razorpay',
  label: 'Razorpay',
  /* What the operator must paste in, and what each field is called in the
     provider's own dashboard — so the admin UI can label them correctly. */
  fields: {
    key_id: { label: 'Key ID', hint: 'Starts with rzp_test_ or rzp_live_', required: true },
    key_secret: { label: 'Key Secret', hint: 'Razorpay Dashboard → Settings → API Keys', required: true, secret: true },
    webhook_secret: { label: 'Webhook Secret', hint: 'Set when you create the webhook', required: false, secret: true }
  },
  currencies: ['INR'],
  docs: 'https://dashboard.razorpay.com/app/website-app-settings/api-keys',

  /** Live check that the credentials work, without moving any money. */
  async createOrder({ keyId, keySecret, amount, currency, receipt, notes }) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
      },
      body: JSON.stringify({
        amount: toMinor(amount),
        currency: currency || 'INR',
        receipt: String(receipt).slice(0, 40),
        notes: notes || {}
      })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error?.description || `Razorpay rejected the order (${res.status})`);
    }
    return { orderId: body.id, raw: { amount: body.amount, currency: body.currency } };
  },

  /* Razorpay signs `order_id|payment_id` with the API secret. */
  verifyReturn({ keySecret, order, payload }) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = payload || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return { ok: false, reason: 'Incomplete payment response' };
    }
    // The order id must be the one WE created, not one the caller supplied.
    if (razorpay_order_id !== order.provider_order_id) {
      return { ok: false, reason: 'Payment does not belong to this order' };
    }
    const expected = hmacHex(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (!safeEqual(expected, razorpay_signature)) {
      return { ok: false, reason: 'Signature check failed' };
    }
    return { ok: true, paymentId: razorpay_payment_id };
  },

  /* The webhook is signed over the exact raw body. Parsing and re-serialising
     the JSON changes the bytes and breaks the signature, which is why the
     route mounts a raw body parser. */
  verifyWebhook({ webhookSecret, rawBody, headers }) {
    const signature = headers['x-razorpay-signature'];
    if (!signature) return { ok: false, reason: 'Missing signature header' };
    const expected = hmacHex(webhookSecret, rawBody);
    if (!safeEqual(expected, signature)) return { ok: false, reason: 'Signature check failed' };

    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { return { ok: false, reason: 'Malformed body' }; }

    const entity = event?.payload?.payment?.entity || {};
    return {
      ok: true,
      event: event.event,
      captured: event.event === 'payment.captured' || entity.status === 'captured',
      failed: event.event === 'payment.failed',
      orderId: entity.order_id || null,
      paymentId: entity.id || null,
      amount: entity.amount != null ? Number(entity.amount) / 100 : null
    };
  },

  /* Only the publishable half ever reaches the station. */
  publicConfig: (row) => ({ key_id: row.key_id })
};

/* ==========================================================================
   CASHFREE
   ========================================================================== */
const cashfree = {
  id: 'cashfree',
  label: 'Cashfree',
  fields: {
    key_id: { label: 'App ID', hint: 'Cashfree Dashboard → Developers → API Keys', required: true },
    key_secret: { label: 'Secret Key', hint: 'Paired with the App ID', required: true, secret: true },
    webhook_secret: { label: 'Webhook Secret', hint: 'Optional but strongly recommended', required: false, secret: true }
  },
  currencies: ['INR'],
  docs: 'https://merchant.cashfree.com/merchants/developers',

  async createOrder({ keyId, keySecret, amount, currency, receipt, mode, customer }) {
    const base = mode === 'live' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const res = await fetch(`${base}/pg/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': keyId,
        'x-client-secret': keySecret
      },
      body: JSON.stringify({
        order_id: String(receipt).slice(0, 45),
        order_amount: Number(Number(amount).toFixed(2)),
        order_currency: currency || 'INR',
        customer_details: {
          customer_id: String(customer?.id || 'guest'),
          customer_name: customer?.name || 'CafeXP customer',
          customer_email: customer?.email || 'noreply@cafexp.local',
          customer_phone: customer?.phone || '9999999999'
        }
      })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `Cashfree rejected the order (${res.status})`);
    return {
      orderId: body.order_id,
      // Cashfree's checkout needs a per-order session token, not just the key.
      sessionId: body.payment_session_id,
      raw: { amount: body.order_amount, currency: body.order_currency }
    };
  },

  /* Cashfree gives the browser no signature to pass back — the return is only
     a hint that the customer came back. The authoritative answer is fetched
     from Cashfree directly, server to server, so a forged return proves
     nothing. */
  async verifyReturn({ keyId, keySecret, order, mode }) {
    const base = mode === 'live' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const res = await fetch(`${base}/pg/orders/${encodeURIComponent(order.provider_order_id)}`, {
      headers: {
        'x-api-version': '2023-08-01',
        'x-client-id': keyId,
        'x-client-secret': keySecret
      }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: 'Could not confirm the payment with Cashfree' };
    if (body.order_status !== 'PAID') {
      return { ok: false, reason: `Payment is ${String(body.order_status || 'incomplete').toLowerCase()}` };
    }
    // Cashfree keys the payment by the order; the cf_order_id is the stable id.
    return { ok: true, paymentId: String(body.cf_order_id || order.provider_order_id), amount: Number(body.order_amount) };
  },

  verifyWebhook({ webhookSecret, rawBody, headers }) {
    const signature = headers['x-webhook-signature'];
    const timestamp = headers['x-webhook-timestamp'];
    if (!signature || !timestamp) return { ok: false, reason: 'Missing signature headers' };

    // Cashfree signs timestamp + raw body, base64 rather than hex.
    const expected = crypto.createHmac('sha256', String(webhookSecret))
      .update(String(timestamp) + rawBody.toString('utf8')).digest('base64');
    if (!safeEqual(expected, signature)) return { ok: false, reason: 'Signature check failed' };

    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { return { ok: false, reason: 'Malformed body' }; }

    const data = event?.data || {};
    const status = data?.payment?.payment_status;
    return {
      ok: true,
      event: event.type,
      captured: status === 'SUCCESS',
      failed: status === 'FAILED' || status === 'USER_DROPPED',
      orderId: data?.order?.order_id || null,
      paymentId: data?.payment?.cf_payment_id ? String(data.payment.cf_payment_id) : null,
      amount: data?.payment?.payment_amount != null ? Number(data.payment.payment_amount) : null
    };
  },

  publicConfig: (row) => ({ key_id: row.key_id })
};

/* ==========================================================================
   PAYU
   ========================================================================== */
const payu = {
  id: 'payu',
  label: 'PayU',
  fields: {
    key_id: { label: 'Merchant Key', hint: 'PayU Dashboard → Profile → Merchant Key', required: true },
    key_secret: { label: 'Merchant Salt', hint: 'Paired with the Merchant Key', required: true, secret: true },
    webhook_secret: { label: 'Webhook Salt', hint: 'Leave blank to reuse the Merchant Salt', required: false, secret: true }
  },
  currencies: ['INR'],
  docs: 'https://onboarding.payu.in/app/account/dashboard',

  /* PayU has no server-side order creation call: the "order" is a signed form
     the browser posts. So this builds and signs that form instead of calling
     out, and the id we generate is the id PayU will echo back. */
  createOrder({ keyId, keySecret, amount, receipt, mode, customer, returnUrl }) {
    const txnid = String(receipt).slice(0, 30);
    const value = Number(amount).toFixed(2);
    const productinfo = 'CafeXP wallet top-up';
    const firstname = (customer?.name || 'Customer').split(' ')[0];
    const email = customer?.email || 'noreply@cafexp.local';

    // PayU's request hash, in its exact documented field order. The five
    // trailing pipes are the unused udf1-udf5 slots and are not optional.
    const hashString =
      `${keyId}|${txnid}|${value}|${productinfo}|${firstname}|${email}|||||||||||${keySecret}`;

    return Promise.resolve({
      orderId: txnid,
      form: {
        action: mode === 'live' ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment',
        key: keyId,
        txnid,
        amount: value,
        productinfo,
        firstname,
        email,
        phone: customer?.phone || '',
        surl: returnUrl,
        furl: returnUrl,
        hash: sha512Hex(hashString)
      },
      raw: { amount: value, currency: 'INR' }
    });
  },

  /* The response hash is the request hash reversed, with the status spliced
     in — verifying it proves PayU produced this response. */
  verifyReturn({ keySecret, order, payload }) {
    const p = payload || {};
    if (!p.txnid || !p.status || !p.hash) return { ok: false, reason: 'Incomplete payment response' };
    if (p.txnid !== order.provider_order_id) {
      return { ok: false, reason: 'Payment does not belong to this order' };
    }

    const hashString =
      `${keySecret}|${p.status}|||||||||||${p.email || ''}|${p.firstname || ''}|` +
      `${p.productinfo || ''}|${p.amount}|${p.txnid}|${p.key || ''}`;

    if (!safeEqual(sha512Hex(hashString), String(p.hash).toLowerCase())) {
      return { ok: false, reason: 'Signature check failed' };
    }
    if (String(p.status).toLowerCase() !== 'success') {
      return { ok: false, reason: `Payment ${String(p.status).toLowerCase()}` };
    }
    return { ok: true, paymentId: String(p.mihpayid || p.txnid), amount: Number(p.amount) };
  },

  verifyWebhook({ webhookSecret, keySecret, rawBody }) {
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { return { ok: false, reason: 'Malformed body' }; }

    const salt = webhookSecret || keySecret;
    const hashString =
      `${salt}|${event.status}|||||||||||${event.email || ''}|${event.firstname || ''}|` +
      `${event.productinfo || ''}|${event.amount}|${event.txnid}|${event.key || ''}`;

    if (!safeEqual(sha512Hex(hashString), String(event.hash || '').toLowerCase())) {
      return { ok: false, reason: 'Signature check failed' };
    }
    const success = String(event.status).toLowerCase() === 'success';
    return {
      ok: true,
      event: event.status,
      captured: success,
      failed: !success,
      orderId: event.txnid || null,
      paymentId: event.mihpayid ? String(event.mihpayid) : null,
      amount: event.amount != null ? Number(event.amount) : null
    };
  },

  publicConfig: (row) => ({ key_id: row.key_id })
};

/* ==========================================================================
   REGISTRY
   ========================================================================== */
const REGISTRY = { razorpay, cashfree, payu };

export const getProvider = (id) => REGISTRY[String(id || '').toLowerCase()] || null;

export const listProviders = () =>
  Object.values(REGISTRY).map((p) => ({
    id: p.id,
    label: p.label,
    fields: p.fields,
    currencies: p.currencies,
    docs: p.docs
  }));

export const PROVIDER_IDS = Object.keys(REGISTRY);
