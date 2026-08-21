/* ==========================================================================
   CafeXP Client — Add coins

   The customer's own route to a bigger balance. Three things this file
   deliberately does not do:

     · it does not know a gateway secret — it asks the server for a checkout
       link and opens it;
     · it does not decide that a payment succeeded — the server verifies a
       signature and says so;
     · it does not add coins to the displayed balance — it reloads the wallet,
       so the number on screen is always the one the server holds.

   A customer who closes the payment window mid-flow is the normal case, not
   the edge case: the wallet is re-checked on close, and the provider's webhook
   credits them regardless.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Icon = global.CXIcon, Motion = global.CXMotion;
  var api = global.api || {};

  var options = null;      // cached per visit
  var listening = false;

  /** Wire the main-process callbacks once, whoever opens the dialog first. */
  function listen() {
    if (listening) return;
    listening = true;

    if (api.onTopupResult) {
      api.onTopupResult(function (detail) {
        if (!detail) return;
        if (detail.status === "credited") {
          UI.toast.ok("Coins added",
            Number(detail.coins).toFixed(2) + " XP is now in your wallet.");
          global.CXWallet.load();
        } else if (detail.status === "pending") {
          UI.toast.warn("Payment taken",
            "Your coins will appear in a moment.");
          // The webhook lands shortly after; look again rather than leave a
          // stale balance on screen.
          setTimeout(function () { global.CXWallet.load(); }, 4000);
        } else if (detail.status === "failed") {
          UI.toast.err("Payment not completed", detail.message || "No coins were added.");
        }
      });
    }

    if (api.onCheckoutClosed) {
      api.onCheckoutClosed(function () {
        // Closed without a verdict: the payment may still have gone through.
        global.CXWallet.load();
      });
    }
  }

  /* ==========================================================================
     DIALOG
     ========================================================================== */
  function open() {
    listen();

    var body = UI.el("div", { class: "topup" });
    body.innerHTML = '<div class="topup-loading row gap-3">' +
      '<span class="spinner"></span><span>Checking what this café accepts…</span></div>';

    var modal = UI.modal({
      title: "Add XP Coins",
      description: "Top up your wallet and keep playing.",
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });

    global.CXWallet.topupOptions()
      .then(function (opts) { options = opts; paint(body, modal); })
      .catch(function (err) {
        UI.clear(body);
        body.appendChild(UI.emptyState({
          icon: "alert",
          title: "Top-up unavailable",
          text: err.message || "Ask a member of staff to add coins at the counter."
        }));
      });
  }

  /* ==========================================================================
     WAITING ON THE COUNTER

     A cash request sits in limbo between the customer asking and staff
     approving. Showing that state — rather than a closed dialog and an
     unchanged balance — is the difference between "it's being dealt with" and
     "it didn't work, try again", and the second reading is what produces
     duplicate requests.
     ========================================================================== */
  function paintPending(body, request) {
    UI.clear(body);

    var panel = UI.el("div", { class: "topup-pending" });
    panel.innerHTML =
      '<div class="topup-pending-mark">' + Icon("clock", 22) + "</div>" +
      '<div class="topup-pending-title">Waiting at the counter</div>' +
      '<div class="topup-pending-amount">₹' + Number(request.amount).toFixed(2) + "</div>" +
      '<div class="topup-pending-coins">' + Number(request.coins).toFixed(2) + " XP once approved</div>" +
      '<p class="topup-pending-copy">Hand the cash to a member of staff. Your balance updates ' +
        "as soon as they confirm it — you can close this window.</p>";
    body.appendChild(panel);

    /* Poll for the approval so the balance moves on its own. Staff approval
       happens on another machine, so there is nothing to push it here. */
    var tries = 0;
    var timer = setInterval(function () {
      if (!body.isConnected || ++tries > 60) { clearInterval(timer); return; }
      global.CXWallet.topupOptions()
        .then(function (opts) {
          if (opts && !opts.pending_cash_request) {
            clearInterval(timer);
            global.CXWallet.load();
            panel.innerHTML =
              '<div class="topup-pending-mark is-done">' + Icon("check", 22) + "</div>" +
              '<div class="topup-pending-title">Coins added</div>' +
              '<div class="topup-pending-amount">' + Number(request.coins).toFixed(2) + " XP</div>" +
              '<p class="topup-pending-copy">Your wallet has been updated.</p>';
          }
        })
        .catch(function () { /* a missed poll is not worth surfacing */ });
    }, 5000);

    Motion.enter(panel, { y: 10 });
  }

  function paint(body, modal) {
    UI.clear(body);

    // A request already waiting: show it instead of inviting a second one.
    if (options && options.pending_cash_request) {
      paintPending(body, options.pending_cash_request);
      return;
    }

    if (!options || !options.enabled) {
      body.appendChild(UI.emptyState({
        icon: "info",
        title: "Not available here",
        // The server says why; repeating its reason beats a generic apology.
        text: (options && options.reason) ||
          "Ask a member of staff to add coins at the counter."
      }));
      return;
    }

    var amount = options.presets && options.presets.length ? options.presets[0] : options.min_amount;
    var provider = options.methods[0].provider;

    /* ---- amount ---- */
    var amountBlock = UI.el("div", { class: "topup-block" });
    amountBlock.innerHTML =
      '<div class="topup-label">How much?</div>' +
      '<div class="topup-presets" id="tuPresets"></div>' +
      '<div class="topup-custom">' +
        '<span class="topup-currency">₹</span>' +
        '<input class="input topup-input" id="tuAmount" type="number" inputmode="decimal" ' +
          'min="' + options.min_amount + '" max="' + options.max_amount + '" step="1">' +
      "</div>" +
      '<div class="field-hint">Between ₹' + options.min_amount + " and ₹" + options.max_amount + "</div>";
    body.appendChild(amountBlock);

    var input = amountBlock.querySelector("#tuAmount");
    var presetHost = amountBlock.querySelector("#tuPresets");

    /* ---- what you get ---- */
    var receipt = UI.el("div", { class: "topup-receipt" });
    body.appendChild(receipt);

    function paintReceipt() {
      var value = Number(input.value);
      var valid = Number.isFinite(value) && value >= options.min_amount && value <= options.max_amount;
      var coins = valid ? value * options.coin_rate : 0;

      receipt.innerHTML =
        '<div class="topup-receipt-row">' +
          "<span>You pay</span><strong>₹" + (valid ? value.toFixed(2) : "—") + "</strong>" +
        "</div>" +
        '<div class="topup-receipt-row is-total">' +
          "<span>You get</span><strong>" + (valid ? coins.toFixed(2) : "—") + " XP</strong>" +
        "</div>" +
        // Only shown when it is not 1:1, so the common case stays quiet.
        (options.coin_rate !== 1
          ? '<div class="topup-rate faint">' + options.coin_rate + " coins per ₹1</div>"
          : "");

      payBtn.disabled = !valid;
      if (payBtn.querySelector(".btn-label")) {
        payBtn.querySelector(".btn-label").textContent = payLabel();
      }
      note.textContent = chosen && chosen.kind === "cash"
        ? "No card needed. A member of staff confirms the cash at the counter."
        : "Payment opens in a secure window. CafeXP never sees your card details.";
      return valid;
    }

    (options.presets || []).forEach(function (value) {
      var chip = UI.el("button", {
        class: "topup-preset", type: "button", text: "₹" + value
      });
      chip.addEventListener("click", function () {
        amount = value;
        input.value = value;
        paintPresets();
        paintReceipt();
      });
      presetHost.appendChild(chip);
    });

    function paintPresets() {
      presetHost.querySelectorAll(".topup-preset").forEach(function (chip, i) {
        var on = Number(options.presets[i]) === Number(input.value);
        chip.classList.toggle("is-active", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    /* ---- method ----
       Always rendered as a list, even with a single option. Cash and card
       behave differently enough — one credits in seconds, the other waits for
       a person — that the customer needs to see which they picked, not infer
       it from a sentence. */
    var chosen = options.methods[0];

    var methodBlock = UI.el("div", { class: "topup-block" });
    methodBlock.innerHTML = '<div class="topup-label">Pay with</div>' +
      '<div class="topup-methods" id="tuMethods"></div>';
    body.appendChild(methodBlock);

    var methodHost = methodBlock.querySelector("#tuMethods");
    options.methods.forEach(function (m) {
      var btn = UI.el("button", {
        class: "topup-method", type: "button", dataset: { kind: m.kind || "gateway" }
      });
      btn.innerHTML =
        '<span class="topup-method-mark">' + Icon(m.kind === "cash" ? "billing" : "billing", 15) + "</span>" +
        '<span class="topup-method-copy">' +
          '<span class="topup-method-name">' + UI.esc(m.label) + "</span>" +
          '<span class="topup-method-sub">' +
            (m.kind === "cash" ? "Approved by staff" : "Card, UPI or netbanking") +
          "</span>" +
        "</span>" +
        (m.mode === "test" ? '<span class="topup-test">test</span>' : "");

      btn.addEventListener("click", function () {
        chosen = m;
        provider = m.provider;
        methodHost.querySelectorAll(".topup-method").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        paintMethodNote();
        paintReceipt();
      });
      methodHost.appendChild(btn);
    });
    methodHost.firstChild.classList.add("is-active");
    methodHost.firstChild.setAttribute("aria-pressed", "true");

    /* What actually happens after the button is pressed, in the customer's
       terms. The two paths differ and saying so up front avoids a customer
       standing at a station wondering why their coins have not arrived. */
    var methodNote = UI.el("div", { class: "topup-method-note" });
    body.appendChild(methodNote);

    function paintMethodNote() {
      if (chosen.kind === "cash") {
        methodNote.dataset.kind = "cash";
        methodNote.innerHTML = Icon("info", 14) +
          "<span>Hand the cash to a member of staff. Your coins arrive once they " +
          "approve it — usually straight away.</span>";
      } else {
        methodNote.dataset.kind = "gateway";
        methodNote.innerHTML = Icon("check", 14) +
          "<span>Coins are added the moment the payment clears." +
          (chosen.mode === "test" ? " This gateway is in test mode, so no real money moves." : "") +
          "</span>";
      }
    }
    paintMethodNote();

    /* ---- pay ---- */
    var payBtn = UI.el("button", {
      class: "btn btn-primary btn-lg topup-pay", type: "button",
      html: Icon("billing", 17) + '<span class="btn-label">Continue to payment</span>'
    });
    body.appendChild(payBtn);

    var note = UI.el("div", { class: "topup-note faint" });
    body.appendChild(note);

    function payLabel() {
      return chosen.kind === "cash" ? "Request coins at the counter" : "Continue to payment";
    }

    input.value = amount;
    paintPresets();
    paintReceipt();

    input.addEventListener("input", function () { paintPresets(); paintReceipt(); });

    payBtn.addEventListener("click", function () {
      if (!paintReceipt()) { Motion.shake(input); return; }

      var amountValue = Number(input.value);
      var label = payBtn.querySelector(".btn-label");
      payBtn.disabled = true;

      var reset = function () {
        payBtn.disabled = false;
        label.textContent = payLabel();
      };

      /* ---- cash: a request, not a payment ---- */
      if (chosen.kind === "cash") {
        label.textContent = "Sending…";
        global.CXWallet.requestCashTopup(amountValue)
          .then(function (request) {
            // Replace the form with the waiting state rather than closing:
            // the customer needs to know the request exists and is not lost.
            paintPending(body, request);
            UI.toast.ok("Request sent",
              "Hand ₹" + Number(request.amount).toFixed(2) + " to a member of staff " +
              "and " + Number(request.coins).toFixed(2) + " coins will be added.");
          })
          .catch(function (err) {
            reset();
            UI.toast.err("Could not send the request", err.message);
          });
        return;
      }

      /* ---- gateway: hand off to the provider ---- */
      label.textContent = "Opening payment…";
      global.CXWallet.startTopup(provider, amountValue)
        .then(function (data) {
          if (!api.openCheckout) {
            throw new Error("This station cannot open the payment window.");
          }
          return api.openCheckout(data.checkout_url);
        })
        .then(function (result) {
          if (result && result.ok === false) throw new Error(result.message);
          if (modal && modal.close) modal.close();
        })
        .catch(function (err) {
          reset();
          UI.toast.err("Could not start the payment", err.message);
        });
    });

    Motion.stagger(body.children, { step: 0.04, y: 10 });
  }

  global.CXTopup = { open: open };
})(window);
