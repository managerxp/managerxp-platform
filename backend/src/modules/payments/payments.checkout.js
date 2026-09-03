/*
 * The hosted checkout page.
 *
 * The station's renderer runs over file:// with contextIsolation on and no
 * node integration — a provider's checkout SDK cannot load there, and giving
 * that renderer network privileges to make it work would be trading the whole
 * security model for a convenience. So the payment happens in its own window
 * pointed here, at an ordinary http origin where a third-party script is a
 * normal thing to load and is confined to a page that holds nothing else.
 *
 * The page receives only publishable values: the provider's public key, the
 * order id, the amount, and the customer's display name. No token, no secret,
 * no wallet balance, no session.
 */

/** Escape for HTML text and quoted attributes alike. */
const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape for embedding inside a <script> string literal. */
const js = (value) => JSON.stringify(String(value ?? ''));

const SHELL = (title, body, extraHead = '') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${extraHead}
<style>
  :root {
    --bg:#0b0b0f; --card:#14141b; --line:#26262f; --text:#f2f2f5;
    --muted:#9a9aa8; --accent:#ff1744; --ok:#22c55e; --warn:#f59e0b;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; min-height:100vh; display:grid; place-items:center;
    background:var(--bg); color:var(--text);
    font-family:Inter,'Segoe UI',system-ui,sans-serif;
    padding:24px;
  }
  .card {
    width:100%; max-width:420px; background:var(--card);
    border:1px solid var(--line); border-radius:16px; padding:28px;
    text-align:center;
  }
  .mark { width:44px;height:44px;margin:0 auto 16px;border-radius:12px;
    background:var(--accent);display:grid;place-items:center;font-weight:900; }
  h1 { font-size:19px; margin:0 0 6px; }
  p { color:var(--muted); font-size:14px; line-height:1.55; margin:0 0 18px; }
  .amount { font-size:34px; font-weight:800; letter-spacing:-.02em; margin:14px 0 4px; }
  .sub { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; font-weight:700; }
  button {
    width:100%; padding:13px; border-radius:10px; border:0; cursor:pointer;
    background:var(--accent); color:#fff; font-size:15px; font-weight:700;
    font-family:inherit; margin-top:20px;
  }
  button:disabled { opacity:.55; cursor:default; }
  .status { margin-top:16px; font-size:14px; }
  .status[data-tone="ok"]   { color:var(--ok); }
  .status[data-tone="err"]  { color:var(--accent); }
  .status[data-tone="warn"] { color:var(--warn); }
  .spinner {
    width:18px;height:18px;border:2px solid var(--line);border-top-color:var(--accent);
    border-radius:50%;display:inline-block;vertical-align:-4px;margin-right:8px;
    animation:spin .7s linear infinite;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  .test-badge {
    display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:800;
    background:rgba(245,158,11,.14);color:var(--warn);border:1px solid rgba(245,158,11,.35);
    text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;
  }
</style>
</head><body><div class="card">${body}</div></body></html>`;

/** A terminal page: nothing to do but read it and close the window. */
export const renderMessage = ({ title, message, tone = 'err' }) => SHELL(title, `
  <div class="mark">XP</div>
  <h1>${esc(title)}</h1>
  <p class="status" data-tone="${esc(tone)}">${esc(message)}</p>
`);

/**
 * The live checkout.
 *
 * `complete` is posted the provider's raw response. The server re-derives the
 * signature from it — this page's opinion about whether the payment succeeded
 * is not consulted, and a tampered response simply fails verification there.
 */
export const renderCheckout = ({ order, gateway, customer, completeUrl }) => {
  const isTest = order.mode === 'test';
  const testBadge = isTest ? '<div class="test-badge">Test mode · no real money</div>' : '';

  const common = `
    ${testBadge}
    <div class="mark">XP</div>
    <h1>Add XP Coins</h1>
    <p>Paying through ${esc(gateway.label)}</p>
    <div class="amount">₹${esc(Number(order.amount).toFixed(2))}</div>
    <div class="sub">${esc(Number(order.coins).toFixed(2))} coins</div>
  `;

  const finishScript = `
    const completeUrl = ${js(completeUrl)};
    const statusEl = () => document.getElementById('status');

    function say(text, tone) {
      const el = statusEl();
      el.dataset.tone = tone || '';
      el.innerHTML = tone === 'pending' ? '<span class="spinner"></span>' + text : text;
    }

    async function finish(payload) {
      say('Confirming your payment…', 'pending');
      try {
        const res = await fetch(completeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload })
        });
        const body = await res.json();
        if (!res.ok || !body.success) {
          say(body.message || 'We could not confirm this payment.', 'err');
          notify({ status: 'failed', message: body.message });
          return;
        }
        say('Added ' + body.data.coins + ' coins to your wallet.', 'ok');
        notify({ status: 'credited', coins: body.data.coins, balance: body.data.balance });
        setTimeout(() => window.close(), 1600);
      } catch (err) {
        // The webhook is the backstop: the payment is real, so the coins will
        // land even though this window could not confirm it.
        say('Payment taken. Your coins will appear shortly.', 'warn');
        notify({ status: 'pending' });
      }
    }

    function notify(detail) {
      // The station window listens for this to refresh the balance.
      try { window.opener && window.opener.postMessage({ cafexpTopup: detail }, '*'); } catch (e) {}
      try { console.log('CAFEXP_TOPUP:' + JSON.stringify(detail)); } catch (e) {}
    }
  `;

  if (order.provider === 'razorpay') {
    return SHELL('Add XP Coins', `
      ${common}
      <button id="pay">Pay ₹${esc(Number(order.amount).toFixed(2))}</button>
      <div class="status" id="status"></div>
      <script>
        ${finishScript}
        const options = {
          key: ${js(gateway.key_id)},
          order_id: ${js(order.provider_order_id)},
          amount: ${Math.round(Number(order.amount) * 100)},
          currency: ${js(order.currency || 'INR')},
          name: 'CafeXP',
          description: 'Wallet top-up',
          prefill: { name: ${js(customer.name)}, email: ${js(customer.email)}, contact: ${js(customer.phone)} },
          theme: { color: '#ff1744' },
          handler: function (response) { finish(response); },
          modal: { ondismiss: function () { say('Payment cancelled.', 'warn'); } }
        };
        document.getElementById('pay').addEventListener('click', function () {
          this.disabled = true;
          new Razorpay(options).open();
          setTimeout(() => { this.disabled = false; }, 1200);
        });
      </script>
    `, '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>');
  }

  if (order.provider === 'cashfree') {
    return SHELL('Add XP Coins', `
      ${common}
      <button id="pay">Pay ₹${esc(Number(order.amount).toFixed(2))}</button>
      <div class="status" id="status"></div>
      <script>
        ${finishScript}
        const cashfree = Cashfree({ mode: ${js(order.mode === 'live' ? 'production' : 'sandbox')} });
        document.getElementById('pay').addEventListener('click', function () {
          this.disabled = true;
          cashfree.checkout({
            paymentSessionId: ${js(order.session_id || '')},
            redirectTarget: '_modal'
          }).then(function (result) {
            if (result.error) { say(result.error.message || 'Payment cancelled.', 'warn'); this.disabled = false; return; }
            // Cashfree hands back no signature; the server asks Cashfree itself.
            finish({});
          }.bind(this));
        });
      </script>
    `, '<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>');
  }

  if (order.provider === 'payu') {
    // PayU is a signed form post, not an SDK. The form was built and signed
    // server-side; this page only submits it.
    const form = order.form || {};
    const hidden = Object.keys(form)
      .filter((k) => k !== 'action')
      .map((k) => `<input type="hidden" name="${esc(k)}" value="${esc(form[k])}">`)
      .join('');

    return SHELL('Add XP Coins', `
      ${common}
      <form method="post" action="${esc(form.action || '')}" id="payuForm">
        ${hidden}
        <button type="submit">Pay ₹${esc(Number(order.amount).toFixed(2))}</button>
      </form>
      <div class="status" id="status"></div>
    `);
  }

  return renderMessage({
    title: 'Not available',
    message: 'This payment method is not supported on this station.'
  });
};
