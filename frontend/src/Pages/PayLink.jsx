import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/*
 * The public pay page.
 *
 * Reached by a café owner from a link in an email, with no account and no
 * session. The token in the URL is the only credential, and it buys exactly
 * one thing: paying this bill.
 *
 * Two properties matter more than anything visual here:
 *
 *   · The amount is displayed, never collected. It comes from the server and
 *     is posted back nowhere — editing this page's DOM changes what the payer
 *     sees, not what they are charged.
 *   · Success is decided by the server verifying the provider's signature.
 *     Whatever the gateway's script hands back is forwarded as evidence, not
 *     as a verdict.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL;

const money = (amount, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(Number(amount || 0));

/** Load a provider's checkout script once, on demand. */
const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not reach the payment provider'));
    document.body.appendChild(el);
  });

const Shell = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center bg-black px-4 py-10">
    <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-7 text-center">
      {children}
    </div>
  </div>
);

const PayLink = () => {
  const { token } = useParams();
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);   // { tone, text }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/platform/pay/${token}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'This link could not be opened');
      setLink(body.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const complete = useCallback(async (payload) => {
    setStatus({ tone: 'busy', text: 'Confirming your payment…' });
    try {
      const res = await fetch(`${API_BASE_URL}/api/platform/pay/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload })
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setStatus({ tone: 'bad', text: body.message || 'We could not confirm this payment.' });
        return;
      }
      setLink((l) => ({ ...l, status: 'paid' }));
      setStatus({
        tone: 'good',
        text: body.data?.valid_until
          ? `Payment received. Your subscription now runs to ${new Date(body.data.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`
          : 'Payment received. Thank you.'
      });
    } catch {
      // The money may well have left their account; never imply otherwise.
      setStatus({
        tone: 'warn',
        text: 'Payment taken, but we could not confirm it here. It will be applied shortly — please do not pay again.'
      });
    }
  }, [token]);

  const pay = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/platform/pay/${token}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not start the payment');

      const d = body.data;

      if (d.provider === 'razorpay') {
        await loadScript('https://checkout.razorpay.com/v1/checkout.js');
        const rzp = new window.Razorpay({
          key: d.key_id,
          order_id: d.order_id,
          amount: Math.round(Number(d.amount) * 100),
          currency: d.currency,
          name: 'ManagerXP',
          description: d.description || 'Subscription',
          prefill: {
            name: d.customer?.name || '',
            email: d.customer?.email || '',
            contact: d.customer?.phone || ''
          },
          theme: { color: '#ef4444' },
          handler: (response) => complete(response),
          modal: { ondismiss: () => setStatus({ tone: 'warn', text: 'Payment cancelled.' }) }
        });
        rzp.open();
      } else if (d.provider === 'cashfree') {
        await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
        const cf = window.Cashfree({ mode: link.mode === 'live' ? 'production' : 'sandbox' });
        const result = await cf.checkout({ paymentSessionId: d.session_id, redirectTarget: '_modal' });
        if (result?.error) {
          setStatus({ tone: 'warn', text: result.error.message || 'Payment cancelled.' });
        } else {
          // Cashfree returns no signature; the server asks Cashfree directly.
          complete({});
        }
      } else if (d.provider === 'payu' && d.form) {
        // PayU is a signed form post, built and signed server-side.
        const f = document.createElement('form');
        f.method = 'POST';
        f.action = d.form.action;
        Object.entries(d.form).forEach(([k, v]) => {
          if (k === 'action') return;
          const i = document.createElement('input');
          i.type = 'hidden';
          i.name = k;
          i.value = v;
          f.appendChild(i);
        });
        document.body.appendChild(f);
        f.submit();
      } else {
        throw new Error('This payment method is not supported here.');
      }
    } catch (e) {
      setStatus({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-red-500" />
        <p className="mt-4 text-sm text-neutral-400">Loading…</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-red-500/15 text-2xl">⚠</div>
        <h1 className="mt-4 text-lg font-semibold text-white">Link unavailable</h1>
        <p className="mt-2 text-sm text-neutral-400">{error}</p>
        <p className="mt-4 text-xs text-neutral-600">Contact ManagerXP for a new link.</p>
      </Shell>
    );
  }

  const paid = link.status === 'paid';

  return (
    <Shell>
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-red-500 font-black text-white">
        XP
      </div>

      {paid ? (
        <>
          <div className="mx-auto mt-5 grid h-14 w-14 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 text-2xl text-emerald-300">
            ✓
          </div>
          <h1 className="mt-4 text-lg font-semibold text-white">Paid</h1>
          <p className="mt-1 text-3xl font-bold tracking-tight text-white">
            {money(link.amount, link.currency)}
          </p>
          {status?.text && <p className="mt-3 text-sm text-emerald-300">{status.text}</p>}
          {!status && link.paid_at && (
            <p className="mt-3 text-sm text-neutral-400">
              Received {new Date(link.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </p>
          )}
        </>
      ) : (
        <>
          <h1 className="mt-5 text-lg font-semibold text-white">
            {link.customer_name ? `Hello ${link.customer_name},` : 'Payment request'}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {link.description || 'ManagerXP subscription'}
          </p>

          <p className="mt-6 text-4xl font-bold tracking-tight text-white">
            {money(link.amount, link.currency)}
          </p>
          {link.grants_days && (
            <p className="mt-1 text-xs uppercase tracking-wider text-neutral-500">
              {link.grants_days} days of service
            </p>
          )}
          {link.billed_to && (
            <p className="mt-3 text-sm text-neutral-500">for {link.billed_to}</p>
          )}

          {link.payable ? (
            <>
              <button
                type="button"
                onClick={pay}
                disabled={busy}
                className="mt-7 w-full rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-50"
              >
                {busy ? 'Opening…' : `Pay ${money(link.amount, link.currency)}`}
              </button>
              {link.mode === 'test' && (
                <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-300">
                  Test mode — no real money moves
                </p>
              )}
            </>
          ) : (
            /* No gateway configured. Say so plainly rather than showing a
               button that cannot possibly work. */
            <p className="mt-7 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
              Online payment is not available at the moment. Please contact ManagerXP to settle this
              another way.
            </p>
          )}

          {status?.text && (
            <p className={`mt-4 text-sm ${
              status.tone === 'good' ? 'text-emerald-300'
                : status.tone === 'bad' ? 'text-red-300'
                : status.tone === 'warn' ? 'text-amber-300'
                : 'text-neutral-400'
            }`}>
              {status.text}
            </p>
          )}

          {link.expires_at && (
            <p className="mt-6 text-xs text-neutral-600">
              This link expires on{' '}
              {new Date(link.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </p>
          )}
        </>
      )}
    </Shell>
  );
};

export default PayLink;
