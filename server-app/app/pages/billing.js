/* ==========================================================================
   CafeXP Admin — Billing
   Open and settled bills, with a detail drawer for adding items, applying a
   discount and taking payment.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var rows = [];
  var summary = { billed: 0, collected: 0, outstanding: 0 };
  var loading = false;
  var loadError = null;
  var filter = "open";
  var query = "";
  var searchTimer = null;

  var FILTERS = [
    { id: "open", label: "Open", status: "OPEN,PARTIAL" },
    { id: "paid", label: "Settled", status: "PAID" },
    { id: "all",  label: "All",    status: "" }
  ];

  var METHODS = [
    { value: "wallet", label: "XP Coin wallet" },
    { value: "cash",   label: "Cash" },
    { value: "card",   label: "Card" },
    { value: "upi",    label: "UPI" },
    { value: "other",  label: "Other" }
  ];

  function coins(value) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return whole ? String(Math.round(n)) : n.toFixed(2); }
  }

  var STATUS_TONE = { OPEN: "warning", PARTIAL: "gaming", PAID: "online", VOID: "idle" };

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    var f = FILTERS.filter(function (x) { return x.id === filter; })[0];
    loading = true;
    loadError = null;
    render();
    return Store.listBills({ status: f.status, search: query, limit: 100 })
      .then(function (body) {
        rows = body.data || [];
        summary = body.summary || summary;
        loading = false;
        render();
      })
      .catch(function (err) { loading = false; loadError = err.message; rows = []; render(); });
  }

  /* ==========================================================================
     PAYMENT
     ========================================================================== */
  function paymentDialog(bill, onDone) {
    var due = bill.balance_due;
    var walletBalance = bill.wallet_balance;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="card card-pad col gap-1" style="background:var(--bg-inset)">' +
        '<div class="kv"><span class="kv-key">Bill</span><span class="kv-val mono">' + UI.esc(bill.bill_number) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Customer</span><span class="kv-val">' +
          UI.esc(bill.customer_name || "Guest") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Total</span><span class="kv-val">' + coins(bill.total) + " XP</span></div>" +
        '<div class="kv"><span class="kv-key">Already paid</span><span class="kv-val">' + coins(bill.paid_amount) + " XP</span></div>" +
        '<div class="kv"><span class="kv-key">Outstanding</span><span class="kv-val" style="font-size:18px;font-weight:750">' +
          coins(due) + " XP</span></div>" +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label field-req" for="payMethod">Method</label>' +
        '<select class="select" id="payMethod">' +
          METHODS.map(function (m) {
            // A guest has no wallet to charge.
            var disabled = m.value === "wallet" && !bill.customer_id;
            return '<option value="' + m.value + '"' + (disabled ? " disabled" : "") + ">" +
              m.label + (disabled ? " — no wallet" : "") + "</option>";
          }).join("") +
        "</select>" +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label field-req" for="payAmount">Amount</label>' +
        '<input class="input" id="payAmount" type="number" min="0.01" step="0.01" value="' + due + '">' +
        '<div class="field-hint">Leave as-is to settle the bill in full.</div>' +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label" for="payRef">Reference</label>' +
        '<input class="input" id="payRef" placeholder="Transaction id, receipt number…">' +
      "</div>" +

      '<div class="notice" data-status="accent" id="payPreview"></div>';

    var dialog = UI.modal({
      title: "Take payment",
      description: bill.bill_number + " · " + (bill.customer_name || "Guest"),
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Record payment", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var method = ctx.body.querySelector("#payMethod").value;
            var amount = Number(ctx.body.querySelector("#payAmount").value);
            if (!amount || amount <= 0) {
              Motion.shake(ctx.body.querySelector("#payAmount"));
              UI.toast.warn("Enter an amount greater than zero");
              return false;
            }
            if (amount > due + 0.005) {
              Motion.shake(ctx.body.querySelector("#payAmount"));
              UI.toast.warn("That is more than the outstanding amount");
              return false;
            }
            return Store.payBill(bill.bill_id, {
              method: method,
              amount: amount,
              reference: ctx.body.querySelector("#payRef").value.trim() || null
            })
              .then(function (r) {
                UI.toast.ok(r.message, coins(amount) + " XP by " + method);
                if (onDone) onDone(r.data);
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) {
                UI.toast.error("Payment failed", err.message);
                return false;
              });
          }
        }
      ]
    });

    var methodSelect = body.querySelector("#payMethod");
    var amountInput = body.querySelector("#payAmount");
    var preview = body.querySelector("#payPreview");

    function refresh() {
      var method = methodSelect.value;
      var amount = Number(amountInput.value) || 0;

      if (method === "wallet") {
        if (walletBalance === null) {
          preview.setAttribute("data-status", "warning");
          preview.innerHTML = Icon("alert", 16) + "<div>This customer has no wallet yet.</div>";
          return;
        }
        if (walletBalance < amount) {
          preview.setAttribute("data-status", "offline");
          preview.innerHTML = Icon("alert", 16) +
            "<div>Wallet holds <strong>" + coins(walletBalance) + " XP</strong> — not enough for " +
            coins(amount) + " XP. Take the difference another way.</div>";
          return;
        }
        preview.setAttribute("data-status", "online");
        preview.innerHTML = Icon("check", 16) +
          "<div>Wallet drops to <strong>" + coins(walletBalance - amount) + " XP</strong>.</div>";
        return;
      }

      var remaining = due - amount;
      preview.setAttribute("data-status", remaining > 0.005 ? "warning" : "accent");
      preview.innerHTML = Icon(remaining > 0.005 ? "info" : "check", 16) +
        "<div>" + (remaining > 0.005
          ? "Leaves <strong>" + coins(remaining) + " XP</strong> outstanding."
          : "Settles the bill in full.") + "</div>";
    }

    methodSelect.addEventListener("change", refresh);
    amountInput.addEventListener("input", refresh);
    refresh();
    return dialog;
  }

  /* ==========================================================================
     BILL DRAWER
     ========================================================================== */
  function openBill(billId) {
    var panel = UI.drawer({ wide: true, head: "", body: "" });
    var bill = null;

    function paint() {
      if (!bill) return;
      var open = bill.status === "OPEN" || bill.status === "PARTIAL";

      panel.head.innerHTML =
        '<div class="row-between gap-3">' +
          "<div style='min-width:0'>" +
            '<div class="row gap-3" style="align-items:center">' +
              '<span class="page-title" style="font-size:21px" class="mono">' + UI.esc(bill.bill_number) + "</span>" +
              '<span class="badge badge-lg" data-status="' + (STATUS_TONE[bill.status] || "idle") + '">' +
                UI.esc(bill.status) + "</span>" +
            "</div>" +
            '<div class="faint" style="font-size:12px;margin-top:4px">' +
              UI.esc(bill.customer_name || "Guest") +
              (bill.pc_name ? " · " + UI.esc(bill.pc_name) : "") + "</div>" +
          "</div>" +
          '<button class="modal-close" id="billClose" aria-label="Close">' + Icon("close", 15) + "</button>" +
        "</div>";
      panel.head.querySelector("#billClose").addEventListener("click", function () { panel.close(); });

      UI.clear(panel.body);
      var wrap = UI.el("div", { class: "col gap-5" });

      /* items */
      var itemsCard = UI.el("div", { class: "card" });
      itemsCard.innerHTML = '<div class="card-head"><h3>Items</h3>' +
        (open ? '<button class="btn btn-outline btn-sm" id="btnAddItem">' + Icon("plus", 13) +
          '<span class="btn-label">Add item</span></button>' : "") + "</div>";
      var itemsBody = UI.el("div", { class: "card-body-flush" });

      bill.items.forEach(function (item) {
        var row = UI.el("div", {
          class: "kv",
          style: { padding: "12px var(--s-5)", borderBottom: "1px solid var(--line-faint)" }
        });
        row.innerHTML =
          '<span style="min-width:0">' +
            '<span style="font-size:13px;font-weight:600;display:block">' + UI.esc(item.description) + "</span>" +
            '<span class="faint" style="font-size:11px">' + UI.esc(item.item_type) +
              (item.quantity !== 1 ? " · " + item.quantity + " × " + coins(item.unit_price) : "") + "</span>" +
          "</span>" +
          '<span class="row gap-3" style="white-space:nowrap">' +
            '<span style="font-weight:700;font-variant-numeric:tabular-nums">' + coins(item.amount) + " XP</span>" +
          "</span>";

        if (open) {
          var del = UI.el("button", {
            class: "btn btn-ghost btn-sm btn-icon", html: Icon("trash", 12), "data-tip": "Remove"
          });
          del.addEventListener("click", function () {
            Store.removeBillItem(bill.bill_id, item.bill_item_id)
              .then(function (r) { bill = r.data; paint(); return load(); })
              .catch(function (err) { UI.toast.error("Could not remove", err.message); });
          });
          row.querySelector("span.row").appendChild(del);
        }
        itemsBody.appendChild(row);
      });
      itemsCard.appendChild(itemsBody);

      /* totals */
      var totals = UI.el("div", { class: "card-foot col", style: { gap: "6px" } });
      totals.innerHTML =
        '<div class="kv"><span class="kv-key">Subtotal</span><span class="kv-val">' + coins(bill.subtotal) + " XP</span></div>" +
        (bill.discount ? '<div class="kv"><span class="kv-key">Discount' +
          (bill.discount_reason ? " — " + UI.esc(bill.discount_reason) : "") +
          '</span><span class="kv-val" style="color:var(--warn)">− ' + coins(bill.discount) + " XP</span></div>" : "") +
        (bill.tax ? '<div class="kv"><span class="kv-key">Tax</span><span class="kv-val">' + coins(bill.tax) + " XP</span></div>" : "") +
        '<div class="kv"><span class="kv-key" style="font-weight:700">Total</span>' +
          '<span class="kv-val" style="font-size:19px;font-weight:800">' + coins(bill.total) + " XP</span></div>" +
        '<div class="kv"><span class="kv-key">Paid</span><span class="kv-val">' + coins(bill.paid_amount) + " XP</span></div>" +
        /* Refunded and Net are shown only once money has actually come back,
           so an ordinary bill is not cluttered with two zero rows. */
        (bill.refunded > 0
          ? '<div class="kv"><span class="kv-key">Refunded</span>' +
            '<span class="kv-val" data-status="warning">-' + coins(bill.refunded) + " XP</span></div>" +
            '<div class="kv"><span class="kv-key">Net received</span>' +
            '<span class="kv-val"><strong>' + coins(bill.net_paid) + " XP</strong></span></div>"
          : "") +
        (bill.balance_due > 0
          ? '<div class="kv"><span class="kv-key" style="color:var(--warn)">Outstanding</span>' +
            '<span class="kv-val" style="color:var(--warn);font-weight:750">' + coins(bill.balance_due) + " XP</span></div>"
          : "");
      itemsCard.appendChild(totals);
      wrap.appendChild(itemsCard);

      /* payments */
      if (bill.payments.length) {
        var payCard = UI.el("div", { class: "card" });
        payCard.innerHTML = '<div class="card-head"><h3>Payments</h3></div>';
        var payBody = UI.el("div", { class: "card-body col" });
        bill.payments.forEach(function (p) {
          // A refund is a negative tender in the same ledger. Left as a bare
          // minus figure it reads like a data error, so it is labelled.
          var isRefund = p.amount < 0;
          var row = UI.el("div", { class: "kv", dataset: { status: isRefund ? "warning" : "online" } });
          row.innerHTML =
            '<span><span style="font-size:13px;font-weight:600;text-transform:capitalize">' +
              (isRefund ? "Refund &middot; " : "") + UI.esc(p.method) + "</span>" +
              '<span class="faint" style="display:block;font-size:11px">' +
                UI.esc([new Date(p.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                        p.note, p.reference, p.received_by].filter(Boolean).join(" · ")) + "</span></span>" +
            '<span style="font-weight:700;font-variant-numeric:tabular-nums;color:' +
              (isRefund ? "var(--warn)" : "inherit") + '">' + coins(p.amount) + " XP</span>";
          payBody.appendChild(row);
        });
        payCard.appendChild(payBody);
        wrap.appendChild(payCard);
      }

      /* actions */
      var actions = UI.el("div", { class: "card card-pad row gap-2 wrap" });

      /* Only when money is genuinely still owed. balance_due is total minus
         GROSS paid, so a refunded bill reads 0 here and the till stops
         offering to take payment it has already taken. */
      if (open && bill.balance_due > 0.005) {
        var payBtn = UI.el("button", {
          class: "btn btn-primary grow",
          html: Icon("billing", 15) + '<span class="btn-label">Take payment</span>'
        });
        payBtn.addEventListener("click", function () {
          paymentDialog(bill, function (updated) { bill = updated; paint(); });
        });

        var discountBtn = UI.el("button", {
          class: "btn btn-outline grow",
          html: Icon("edit", 15) + '<span class="btn-label">Discount</span>'
        });
        discountBtn.addEventListener("click", function () { discountDialog(bill, function (u) { bill = u; paint(); }); });

        var codeBtn = UI.el("button", {
          class: "btn btn-outline grow",
          html: Icon("sparkle", 15) + '<span class="btn-label">' +
            (bill.discount_code_id ? "Change code" : "Apply code") + "</span>"
        });
        codeBtn.addEventListener("click", function () { codeDialog(bill, function (u) { bill = u; paint(); }); });

        actions.appendChild(payBtn);
        actions.appendChild(discountBtn);
        actions.appendChild(codeBtn);
      }

      // A settled bill is not finished business: it can still be refunded,
      // reprinted, or claimed by the walk-in who has just registered.
      if (bill.paid_amount > 0 && bill.status !== "VOID") {
        var allBack = bill.fully_refunded === true;
        var refundBtn = UI.el("button", {
          class: "btn btn-warn grow",
          disabled: allBack,
          html: Icon("refresh", 15) + '<span class="btn-label">' +
            (allBack ? "Fully refunded" : "Refund") + "</span>"
        });
        refundBtn.addEventListener("click", function () {
          refundDialog(bill, function (u) { bill = u; paint(); });
        });
        actions.appendChild(refundBtn);
      }

      // Rendered after the actions so a refunded bill shows what went back,
      // right where someone is deciding whether to refund again.
      if (bill.refunded > 0) refundHistory(bill, wrap);

      if (bill.status !== "VOID") {
        var receiptBtn = UI.el("button", {
          class: "btn btn-outline grow",
          html: Icon("download", 15) + '<span class="btn-label">Receipt</span>'
        });
        receiptBtn.addEventListener("click", function () {
          loadBillingIdentity().then(function () { receiptDialog(bill); });
        });
        actions.appendChild(receiptBtn);
      }

      if (bill.is_guest && bill.status !== "VOID") {
        var claimBtn = UI.el("button", {
          class: "btn btn-outline grow",
          html: Icon("customers", 15) + '<span class="btn-label">Move to a customer</span>',
          "data-tip": "For a walk-in who has since registered"
        });
        claimBtn.addEventListener("click", function () {
          claimDialog(bill, function (u) { bill = u; paint(); });
        });
        actions.appendChild(claimBtn);
      }

      if (open) {
        if (bill.paid_amount === 0) {
          var voidBtn = UI.el("button", {
            class: "btn btn-danger grow",
            html: Icon("trash", 15) + '<span class="btn-label">Void</span>'
          });
          voidBtn.addEventListener("click", function () {
            UI.confirm({
              title: "Void " + bill.bill_number + "?",
              message: "The bill is kept for the record but marked void.",
              confirmLabel: "Void bill", variant: "danger"
            }).then(function (ok) {
              if (!ok) return;
              Store.voidBill(bill.bill_id, "Voided by staff")
                .then(function () { UI.toast.ok("Bill voided"); panel.close(); return load(); })
                .catch(function (err) { UI.toast.error("Could not void", err.message); });
            });
          });
          actions.appendChild(voidBtn);
        }
      }

      if (actions.children.length) wrap.appendChild(actions);

      panel.body.appendChild(wrap);

      var addBtn = itemsCard.querySelector("#btnAddItem");
      if (addBtn) addBtn.addEventListener("click", function () {
        addItemDialog(bill, function (u) { bill = u; paint(); });
      });

      Motion.stagger(wrap.children, { step: 0.04, y: 10 });
    }

    Store.getBill(billId)
      .then(function (b) { bill = b; paint(); })
      .catch(function (err) {
        panel.body.appendChild(UI.errorState(err.message));
      });

    return panel;
  }

  /* ==========================================================================
     REFUND
     A settled bill used to be a dead end: void refuses a bill with payments,
     and there was nothing to refund with. The server requires a reason, so
     this dialog does too rather than letting the request fail.
     ========================================================================== */
  function refundDialog(bill, onDone) {
    // Default to the tender that was actually used — refunding cash against a
    // card payment is the classic till mistake.
    var used = {};
    (bill.payments || []).forEach(function (p) {
      if (p.amount > 0) used[p.method] = (used[p.method] || 0) + p.amount;
    });
    var likely = Object.keys(used).sort(function (a, b) { return used[b] - used[a]; })[0] || "cash";
    var method = likely;

    /* Selected lines, keyed by bill_item_id -> quantity. Empty means the
       cashier is refunding a stated amount instead, which is still allowed for
       goodwill and part-session refunds. */
    var picked = {};
    var refundable = null;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div id="rfSummary"></div>' +
      '<div class="field"><label class="field-label">What is coming back?</label>' +
        '<div id="rfItems"><div class="row gap-3"><span class="spinner"></span>' +
        '<span class="faint">Checking what can still be refunded…</span></div></div></div>' +
      '<div class="field"><label class="field-label">Refund to</label>' +
        '<div class="row gap-2 wrap" id="rfMethods">' +
          ["cash", "card", "upi", "wallet", "other"].map(function (m) {
            return '<button type="button" class="chip" data-m="' + m + '"' +
              (m === likely ? ' aria-pressed="true"' : "") + ">" + m +
              (used[m] ? " &middot; " + coins(used[m]) : "") + "</button>";
          }).join("") +
        "</div>" +
        '<div class="field-hint" id="rfHint"></div></div>' +
      '<div class="field"><label class="field-label" for="rfAmount">Amount</label>' +
        '<input class="input" id="rfAmount" type="number" min="0.01" step="1" value="0">' +
        '<div class="field-hint" id="rfAmountHint">Set automatically from the lines you tick.</div></div>' +
      '<div class="field"><label class="field-label field-req" for="rfReason">Reason</label>' +
        '<input class="input" id="rfReason" placeholder="Session cut short, wrong item…" data-autofocus>' +
        '<div class="field-hint">Recorded against your name in the audit trail.</div></div>';

    /* ---- what the server says is still refundable ----
       Asked rather than computed here: the till must not decide how much of a
       line has already gone back, or two cashiers could each refund the same
       item from two stale screens. */
    function paintItems() {
      var host = body.querySelector("#rfItems");
      var summary = body.querySelector("#rfSummary");
      if (!refundable) return;

      summary.innerHTML =
        '<div class="notice" data-status="' + (refundable.remaining_refundable > 0 ? "info" : "warning") + '">' +
          Icon("info", 16) +
          "<div>" + UI.esc(bill.bill_number) + " &mdash; charged <strong>" +
          coins(refundable.original_total) + "</strong>, paid <strong>" +
          coins(refundable.paid) + "</strong>" +
          (refundable.refunded > 0
            ? ", already refunded <strong>" + coins(refundable.refunded) + "</strong>"
            : "") +
          ". <strong>" + coins(refundable.remaining_refundable) + "</strong> can still be returned." +
          "</div></div>";

      UI.clear(host);
      var any = false;

      refundable.items.forEach(function (it) {
        if (it.refundable_qty <= 0) {
          var done = UI.el("label", { class: "rf-line is-done" });
          done.innerHTML =
            '<span class="rf-line-name">' + UI.esc(it.description) + "</span>" +
            '<span class="rf-line-note faint">all ' + it.quantity + " already refunded</span>";
          host.appendChild(done);
          return;
        }
        any = true;

        var row = UI.el("label", { class: "rf-line" });
        row.innerHTML =
          '<input type="checkbox" class="check" data-item="' + it.bill_item_id + '">' +
          '<span class="rf-line-name">' + UI.esc(it.description) +
            (it.refunded_qty > 0
              ? ' <span class="faint">(' + it.refunded_qty + " of " + it.quantity + " already back)</span>"
              : "") +
          "</span>" +
          '<input class="input rf-qty" type="number" min="1" step="1" ' +
            'max="' + it.refundable_qty + '" value="' + it.refundable_qty + '" ' +
            'data-qty="' + it.bill_item_id + '" disabled>' +
          '<span class="rf-line-price">' + coins(it.unit_price) + " ea</span>";
        host.appendChild(row);

        var box = row.querySelector("input[type=checkbox]");
        var qty = row.querySelector(".rf-qty");

        box.addEventListener("change", function () {
          qty.disabled = !box.checked;
          if (box.checked) picked[it.bill_item_id] = Number(qty.value) || it.refundable_qty;
          else delete picked[it.bill_item_id];
          syncAmount();
        });
        qty.addEventListener("input", function () {
          var v = Number(qty.value);
          // Clamp here as well as on the server, so the running total the
          // cashier reads is never one the server would refuse.
          if (v > it.refundable_qty) { qty.value = it.refundable_qty; v = it.refundable_qty; }
          if (box.checked) picked[it.bill_item_id] = v;
          syncAmount();
        });
      });

      if (!any) {
        host.appendChild(UI.el("div", {
          class: "faint",
          text: "Every line has been refunded in full. You can still refund a stated amount."
        }));
      }
    }

    function syncAmount() {
      var input = body.querySelector("#rfAmount");
      var hint = body.querySelector("#rfAmountHint");
      var ids = Object.keys(picked);

      if (!ids.length) {
        hint.textContent = refundable
          ? "Tick lines above, or enter an amount up to " + coins(refundable.remaining_refundable) + "."
          : "Set automatically from the lines you tick.";
        input.readOnly = false;
        return;
      }

      var total = 0;
      ids.forEach(function (id) {
        var it = refundable.items.filter(function (x) { return String(x.bill_item_id) === String(id); })[0];
        if (it) total += picked[id] * it.unit_price;
      });
      input.value = Number(total.toFixed(2));
      // Derived from the selection, so typing over it would be a lie: the
      // server recomputes from the lines regardless.
      input.readOnly = true;
      hint.textContent = ids.length + " line" + (ids.length === 1 ? "" : "s") +
        " selected \u2014 the amount follows the lines.";
    }

    Store.getRefundable(bill.bill_id)
      .then(function (data) { refundable = data; paintItems(); syncAmount(); })
      .catch(function (err) {
        body.querySelector("#rfItems").innerHTML =
          '<div class="faint">Could not load lines: ' + UI.esc(err.message) +
          ". You can still refund a stated amount.</div>";
      });

    function syncHint() {
      var hint = body.querySelector("#rfHint");
      if (method === "wallet") {
        hint.textContent = bill.is_guest
          ? "A guest bill has no wallet — choose cash, card or UPI."
          : "Credited straight back to the customer's XP Coin wallet.";
      } else {
        hint.textContent = "Handed back at the counter; nothing moves in the wallet.";
      }
    }

    UI.$$("#rfMethods .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () {
        method = chip.dataset.m;
        UI.$$("#rfMethods .chip", body).forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === chip));
        });
        syncHint();
      });
    });
    syncHint();

    /* One key per opened dialog. A double-click on Refund, or a retry after a
       dropped response, reuses it — the server returns the refund that already
       happened rather than making a second one. */
    var idempotencyKey = "rf-" + bill.bill_id + "-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 8);

    return UI.modal({
      title: "Refund " + bill.bill_number,
      description: "Returns money against the original bill. The bill itself is not changed.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Refund", variant: "danger", icon: "refresh",
          onClick: function (ctx) {
            var amount = Number(ctx.body.querySelector("#rfAmount").value);
            var reason = ctx.body.querySelector("#rfReason").value.trim();
            var ids = Object.keys(picked);

            if (!ids.length && (!Number.isFinite(amount) || amount <= 0)) {
              Motion.shake(ctx.body.querySelector("#rfAmount"));
              UI.toast.warn("Tick the lines coming back, or enter an amount");
              return false;
            }
            /* Checked against what the server said is still refundable, not
               against paid_amount — a bill that has been part-refunded already
               has less available than it was paid. */
            var ceiling = refundable ? refundable.remaining_refundable : bill.paid_amount;
            if (!ids.length && amount > ceiling + 0.005) {
              Motion.shake(ctx.body.querySelector("#rfAmount"));
              UI.toast.warn("Only " + coins(ceiling) + " XP can still be refunded");
              return false;
            }
            if (!reason) {
              Motion.shake(ctx.body.querySelector("#rfReason"));
              UI.toast.warn("A reason is required to refund");
              return false;
            }

            var payload = {
              method: method,
              refund_method: method,
              reason: reason,
              idempotency_key: idempotencyKey
            };
            if (ids.length) {
              // Quantities only. The server prices them from the bill's own
              // stored line prices, so a stale screen cannot refund yesterday's
              // item at today's price.
              payload.items = ids.map(function (id) {
                return { bill_item_id: Number(id), quantity: picked[id] };
              });
            } else {
              payload.amount = amount;
            }

            /* A last look before money leaves, naming the amount and the
               method — the two things a mis-click gets wrong. */
            return UI.confirm({
              title: "Refund " + coins(ids.length
                ? Number(ctx.body.querySelector("#rfAmount").value) : amount) + " XP?",
              message: "Returning to " + method + " against " + bill.bill_number + ". " +
                (ids.length
                  ? ids.length + " line" + (ids.length === 1 ? "" : "s") + " will be marked as returned. "
                  : "") +
                "The original bill keeps its total; this is recorded as a refund against it.",
              confirmLabel: "Confirm refund",
              variant: "danger"
            }).then(function (go) {
              if (!go) return false;
              return Store.refundBill(bill.bill_id, payload)
                .then(function (r) {
                  UI.toast.ok(r.message || "Refunded", bill.bill_number);
                  if (onDone) onDone(r.data);
                  return load();
                })
                .then(function () { return true; })
                .catch(function (err) {
                  UI.toast.err("Could not refund", err.message);
                  return false;
                });
            });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     REFUND HISTORY

     Shown on the bill itself. A refunded bill that looks identical to an
     unrefunded one is how the same money gets returned twice.
     ========================================================================== */
  function refundHistory(bill, host) {
    Store.listBillRefunds(bill.bill_id)
      .then(function (rows) {
        if (!rows.length) return;

        var card = UI.el("section", { class: "card card-pad col gap-3" });
        card.innerHTML =
          '<div class="card-head"><h3 class="card-title">Refund history</h3>' +
          '<span class="badge" data-status="warning">' + coins(bill.refunded || 0) +
          " XP returned</span></div>";

        rows.forEach(function (rf) {
          var row = UI.el("div", { class: "rf-hist" });
          row.innerHTML =
            '<div class="rf-hist-head">' +
              '<span class="mono">' + UI.esc(rf.refund_no) + "</span>" +
              '<strong>' + coins(rf.refund_amount) + " XP</strong>" +
              '<span class="tag" data-tone="muted">' + UI.esc(rf.refund_method) + "</span>" +
              '<span class="badge" data-status="' +
                (rf.refund_status === "COMPLETED" ? "online" : "idle") + '">' +
                UI.esc(rf.refund_status.toLowerCase()) + "</span>" +
            "</div>" +
            '<div class="rf-hist-meta faint">' +
              UI.esc(rf.refund_reason || "No reason recorded") +
              " &middot; " + UI.esc(rf.processed_by || "unknown") +
              " &middot; " + UI.esc(UI.relTime(rf.refund_date)) +
            "</div>" +
            (rf.items && rf.items.length
              ? '<ul class="rf-hist-items">' + rf.items.map(function (i) {
                  return "<li>" + UI.esc(i.description || "Line " + i.bill_item_id) +
                    " &times; " + i.quantity + " &mdash; " + coins(i.refund_amount) + " XP</li>";
                }).join("") + "</ul>"
              : '<div class="rf-hist-items faint">Amount refund &mdash; no lines recorded</div>');
          card.appendChild(row);
        });

        host.appendChild(card);
      })
      .catch(function () { /* history is context, not a blocker */ });
  }

  /* ==========================================================================
     DISCOUNT CODE
     ========================================================================== */
  function codeDialog(bill, onDone) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="field"><label class="field-label" for="bcCode">Code</label>' +
        '<input class="input mono" id="bcCode" placeholder="WELCOME20" ' +
          'style="text-transform:uppercase" data-autofocus>' +
        '<div class="field-hint">One code per bill — applying another replaces it.</div></div>' +
      '<div id="bcResult"></div>' +
      (bill.discount_code_id
        ? '<button type="button" class="btn btn-ghost btn-sm" id="bcRemove">Remove the current code</button>'
        : "");

    var dialog = UI.modal({
      title: "Discount code",
      description: bill.bill_number + " · " + coins(bill.subtotal) + " XP before discount",
      body: body,
      actions: [
        { label: "Close", variant: "ghost" },
        {
          label: "Apply", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var code = ctx.body.querySelector("#bcCode").value.trim().toUpperCase();
            if (!code) { Motion.shake(ctx.body.querySelector("#bcCode")); return false; }
            return Store.applyBillCode(bill.bill_id, code).then(function (r) {
              if (!r.success) {
                // A refused code is a normal counter event, so show the
                // server's sentence in place rather than as an error banner.
                var host = ctx.body.querySelector("#bcResult");
                host.innerHTML = '<div class="notice" data-status="warning">' + Icon("alert", 15) +
                  '<div style="font-size:12px">' + UI.esc(r.message) + "</div></div>";
                return false;
              }
              UI.toast.ok(r.message, bill.bill_number);
              if (onDone) onDone(r.data);
              return load().then(function () { return true; });
            }).catch(function (err) {
              UI.toast.error("Could not apply", err.message);
              return false;
            });
          }
        }
      ]
    });

    var removeBtn = body.querySelector("#bcRemove");
    if (removeBtn) removeBtn.addEventListener("click", function () {
      Store.removeBillCode(bill.bill_id)
        .then(function (r) {
          UI.toast.ok("Discount removed");
          if (onDone) onDone(r.data);
          dialog.close();
          return load();
        })
        .catch(function (err) { UI.toast.error("Could not remove", err.message); });
    });

    return dialog;
  }

  /* ==========================================================================
     CLAIM A GUEST BILL
     ========================================================================== */
  function claimDialog(bill, onDone) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="notice" data-status="info">' + Icon("info", 16) +
        "<div>This bill is under <strong>" + UI.esc(bill.guest_name || "a guest") +
        "</strong>. Moving it onto a registered customer puts it in their history " +
        "and lets it be refunded to their wallet.</div></div>" +
      '<div class="search">' + Icon("search", 15) +
        '<input class="input" id="bcmSearch" placeholder="Name, mobile or email…" data-autofocus></div>' +
      '<div id="bcmResults" style="max-height:260px;overflow:auto;' +
        'border:1px solid var(--line);border-radius:var(--r-md)"></div>';

    var dialog = UI.modal({
      title: "Move to a customer",
      description: bill.bill_number,
      body: body,
      actions: [{ label: "Cancel", variant: "ghost" }]
    });

    var input = body.querySelector("#bcmSearch");
    var results = body.querySelector("#bcmResults");
    var timer = null;

    function search() {
      Store.getCustomers({ search: input.value.trim(), limit: 25 }).then(function (r) {
        UI.clear(results);
        var rows = r.data || [];
        if (!rows.length) {
          results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">No customers match.</div>';
          return;
        }
        rows.forEach(function (c) {
          var row = UI.el("button", {
            type: "button", class: "kv",
            style: { width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }
          });
          row.innerHTML =
            "<span style='font-size:13px;font-weight:600'>" + UI.esc(c.customer_name) + "</span>" +
            '<span class="faint" style="font-size:11px">' + UI.esc(c.phone_number || c.email || "") + "</span>";
          row.addEventListener("click", function () {
            Store.claimBill(bill.bill_id, c.customer_id)
              .then(function (res) {
                UI.toast.ok(res.message);
                if (onDone) onDone(res.data);
                dialog.close();
                return load();
              })
              .catch(function (err) { UI.toast.error("Could not move", err.message); });
          });
          results.appendChild(row);
        });
      });
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(search, 220);
    });
    search();
    return dialog;
  }

  /* ==========================================================================
     RECEIPT
     ========================================================================== */
  /* The café's own trading identity for the receipt head.
     Cached for the life of the page: it changes about once a year, and asking
     the server on every receipt would add a round trip to printing. */
  var billingIdentity = null;

  function loadBillingIdentity() {
    if (billingIdentity) return Promise.resolve(billingIdentity);
    return Store.getSettings("billing")
      .then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) { map[r.setting_key] = r.setting_value; });
        billingIdentity = map;
        return map;
      })
      .catch(function () { return (billingIdentity = {}); });
  }

  function receiptDialog(bill) {
    var refunds = (bill.payments || []).filter(function (p) { return p.amount < 0; });
    var tenders = (bill.payments || []).filter(function (p) { return p.amount > 0; });
    var id = billingIdentity || {};

    /* The trading name the café set, not the label ManagerXP typed when the
       subscription was created. Those are different things: one is who signed
       up, the other is what a customer should see on their receipt. */
    var brand = (id["billing.business_name"] || "").trim() ||
                (Store.state.user && Store.state.user.cafe_name) || "CafeXP";

    /* Which blocks the café chose to print, from the Receipt Template page.
       Defaults to everything, so a café that has never opened the editor gets
       a complete receipt rather than a bare one. */
    var shown = String(id["billing.receipt_show"] ||
      "logo,address,phone,tax_number,cashier,customer,footer").split(",");
    var show = function (b) { return shown.indexOf(b) !== -1; };
    var taxLabel = (id["billing.tax_label"] || "GST").trim() || "GST";
    var taxPercent = Number(id["billing.tax_percent"] || 0) || 0;
    var taxInclusive = String(id["billing.tax_inclusive"]) === "true";

    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="receipt">' +
        '<div class="receipt-head">' +
          (show("logo") && id["billing.logo"]
            ? '<img class="receipt-logo" src="' + UI.esc(id["billing.logo"]) + '" alt="">' : "") +
          '<div class="receipt-brand">' + UI.esc(brand) + "</div>" +
          (id["billing.receipt_header_note"]
            ? '<div class="receipt-meta">' + UI.esc(id["billing.receipt_header_note"]) + "</div>" : "") +
          (show("address") && id["billing.address"]
            ? '<div class="receipt-meta">' + UI.esc(id["billing.address"]) + "</div>" : "") +
          (show("phone") && (id["billing.phone"] || id["billing.email"])
            ? '<div class="receipt-meta">' +
              UI.esc([id["billing.phone"], id["billing.email"]].filter(Boolean).join(" \u00b7 ")) +
              "</div>" : "") +
          (show("tax_number") && id["billing.tax_number"]
            ? '<div class="receipt-meta">' + UI.esc(taxLabel) + "IN " +
              UI.esc(id["billing.tax_number"]) + "</div>" : "") +
          '<div class="receipt-num">' + UI.esc(bill.bill_number) + "</div>" +
          '<div class="receipt-meta">' + new Date(bill.created_at).toLocaleString() + "</div>" +
          (show("customer")
            ? '<div class="receipt-meta">' + UI.esc(bill.customer_name || bill.guest_name || "Guest") +
              (bill.contact_phone ? " &middot; " + UI.esc(bill.contact_phone) : "") + "</div>"
            : "") +
          (show("cashier") && bill.created_by
            ? '<div class="receipt-meta">Served by ' + UI.esc(bill.created_by) + "</div>" : "") +
        "</div>" +
        '<div class="receipt-lines">' +
          bill.items.map(function (i) {
            return '<div class="receipt-line"><span>' + UI.esc(i.description) +
              (i.quantity > 1 ? " &times;" + i.quantity : "") + "</span><span>" + coins(i.amount) + "</span></div>";
          }).join("") +
        "</div>" +
        '<div class="receipt-lines">' +
          '<div class="receipt-line"><span>Subtotal</span><span>' + coins(bill.subtotal) + "</span></div>" +
          (bill.discount > 0
            ? '<div class="receipt-line"><span>' + UI.esc(bill.discount_reason || "Discount") +
              "</span><span>&minus;" + coins(bill.discount) + "</span></div>"
            : "") +
          /* Named as the café calls it, with the rate — "Tax 100.88" tells a
             customer nothing they can check, "GST 18%" does. */
          (bill.tax > 0
            ? '<div class="receipt-line"><span>' + UI.esc(taxLabel) +
              (taxPercent > 0 ? " " + taxPercent + "%" : "") +
              (taxInclusive ? " (included)" : "") +
              "</span><span>" + coins(bill.tax) + "</span></div>"
            : "") +
        "</div>" +
        '<div class="receipt-total"><span>Total</span><span>' + coins(bill.total) + " XP</span></div>" +
        '<div class="receipt-lines">' +
          tenders.map(function (p) {
            return '<div class="receipt-line"><span>' + UI.esc(p.method) +
              (p.reference ? " &middot; " + UI.esc(p.reference) : "") + "</span><span>" + coins(p.amount) + "</span></div>";
          }).join("") +
        "</div>" +
        (refunds.length
          ? '<div class="receipt-lines">' + refunds.map(function (p) {
              return '<div class="receipt-line"><span>Refund &middot; ' + UI.esc(p.method) +
                "</span><span>" + coins(p.amount) + "</span></div>";
            }).join("") + "</div>"
          : "") +
        '<div class="receipt-foot">' +
          (bill.balance_due > 0
            ? coins(bill.balance_due) + " XP outstanding"
            : UI.esc(id["billing.receipt_footer"] || "Thank you — see you next time")) +
        "</div>" +
      "</div>";

    return UI.modal({
      title: "Receipt",
      description: bill.bill_number,
      body: body,
      actions: [
        { label: "Close", variant: "ghost" },
        {
          label: "Print", variant: "primary", icon: "download",
          onClick: function () {
            document.body.classList.add("printing-receipt");
            global.print();
            setTimeout(function () { document.body.classList.remove("printing-receipt"); }, 500);
            return false;
          }
        }
      ]
    });
  }

  /* ==========================================================================
     NEW BILL — customer or walk-in guest
     ========================================================================== */
  function newBillDialog() {
    var mode = "guest";
    var chosen = null;
    var timer = null;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="segmented" id="nbMode" style="width:100%">' +
        '<button type="button" data-mode="guest" aria-selected="true" style="flex:1">Walk-in guest</button>' +
        '<button type="button" data-mode="customer" aria-selected="false" style="flex:1">Registered customer</button>' +
      "</div>" +
      '<div id="nbGuest" class="field">' +
        '<label class="field-label field-req" for="nbName">Guest name</label>' +
        '<input class="input" id="nbName" placeholder="Walk-in" data-autofocus>' +
        '<div class="field-hint">Enough to find them again at the counter.</div></div>' +
      '<div id="nbCustomer" class="col gap-2 hidden">' +
        '<div class="search">' + Icon("search", 15) +
          '<input class="input" id="nbSearch" placeholder="Name, mobile or email…"></div>' +
        '<div id="nbResults" style="max-height:190px;overflow:auto;' +
          'border:1px solid var(--line);border-radius:var(--r-md)"></div></div>' +
      '<div class="field"><label class="field-label field-req" for="nbDesc">First line</label>' +
        '<input class="input" id="nbDesc" placeholder="Gaming time, drinks…"></div>' +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="nbQty">Quantity</label>' +
          '<input class="input" id="nbQty" type="number" min="1" step="1" value="1"></div>' +
        '<div class="field"><label class="field-label field-req" for="nbPrice">Unit price</label>' +
          '<input class="input" id="nbPrice" type="number" min="0" step="1" value="0"></div>' +
      "</div>";

    var guestPane = body.querySelector("#nbGuest");
    var custPane = body.querySelector("#nbCustomer");

    UI.$$("#nbMode button", body).forEach(function (btn) {
      btn.addEventListener("click", function () {
        mode = btn.dataset.mode;
        UI.$$("#nbMode button", body).forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        guestPane.classList.toggle("hidden", mode !== "guest");
        custPane.classList.toggle("hidden", mode !== "customer");
      });
    });

    var search = body.querySelector("#nbSearch");
    var results = body.querySelector("#nbResults");
    function runSearch() {
      Store.getCustomers({ search: search.value.trim(), limit: 20 }).then(function (r) {
        UI.clear(results);
        (r.data || []).forEach(function (c) {
          var row = UI.el("button", {
            type: "button", class: "kv",
            style: { width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }
          });
          row.innerHTML = "<span style='font-size:13px;font-weight:600'>" + UI.esc(c.customer_name) +
            '</span><span class="faint" style="font-size:11px">' + UI.esc(c.phone_number || "") + "</span>";
          row.addEventListener("click", function () {
            chosen = c;
            search.value = c.customer_name;
            UI.clear(results);
          });
          results.appendChild(row);
        });
      });
    }
    search.addEventListener("input", function () {
      chosen = null;
      clearTimeout(timer);
      timer = setTimeout(runSearch, 220);
    });

    return UI.modal({
      title: "New bill",
      description: "Raise a bill by hand — for a walk-in, or anything the till did not cover.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Create bill", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var desc = ctx.body.querySelector("#nbDesc").value.trim();
            var price = Number(ctx.body.querySelector("#nbPrice").value);
            var qty = Math.max(1, parseInt(ctx.body.querySelector("#nbQty").value, 10) || 1);

            var payload = { items: [] };
            if (mode === "guest") {
              var name = ctx.body.querySelector("#nbName").value.trim();
              if (!name) {
                Motion.shake(ctx.body.querySelector("#nbName"));
                UI.toast.warn("Give the guest a name");
                return false;
              }
              payload.guest_name = name;
            } else {
              if (!chosen) {
                Motion.shake(ctx.body.querySelector("#nbSearch"));
                UI.toast.warn("Choose a customer");
                return false;
              }
              payload.customer_id = chosen.customer_id;
            }

            if (!desc) { Motion.shake(ctx.body.querySelector("#nbDesc")); return false; }
            if (!Number.isFinite(price) || price < 0) {
              Motion.shake(ctx.body.querySelector("#nbPrice"));
              return false;
            }

            payload.items.push({
              item_type: "other", description: desc, quantity: qty, unit_price: price
            });

            return Store.createBill(payload)
              .then(function (r) {
                UI.toast.ok("Bill " + r.data.bill_number + " created");
                return load().then(function () {
                  openBill(r.data.bill_id);
                  return true;
                });
              })
              .catch(function (err) { UI.toast.error("Could not create", err.message); return false; });
          }
        }
      ]
    });
  }

  function addItemDialog(bill, onDone) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="itemDesc">Description</label>' +
        '<input class="input" id="itemDesc" placeholder="Chicken Burger" data-autofocus></div>' +
      '<div class="field"><label class="field-label" for="itemType">Type</label>' +
        '<select class="select" id="itemType">' +
          '<option value="fnb">Food &amp; drink</option>' +
          '<option value="shop">Shop</option>' +
          '<option value="gaming">Gaming</option>' +
          '<option value="other">Other</option>' +
        "</select></div>" +
      /* The gaming rate card, from the Gaming Price Master. Only shown for a
         gaming line, because that is the only type it prices. Choosing a rate
         fills the description and the price rather than replacing them, so a
         one-off charge can still be typed over the top. */
      '<div class="field hidden" id="itemRateField">' +
        '<label class="field-label" for="itemRate">Gaming price</label>' +
        '<select class="select" id="itemRate"><option value="">Loading rates…</option></select>' +
        '<div class="field-hint" id="itemRateHint">From the Gaming Price Master.</div></div>' +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="itemQty">Quantity</label>' +
          '<input class="input" id="itemQty" type="number" min="1" step="1" value="1"></div>' +
        '<div class="field"><label class="field-label field-req" for="itemPrice">Unit price</label>' +
          '<input class="input" id="itemPrice" type="number" min="0" step="0.01" placeholder="149"></div>' +
      "</div>";

    /* ---- gaming rates ---------------------------------------------------- */
    var rateField = body.querySelector("#itemRateField");
    var rateSel = body.querySelector("#itemRate");
    var rateHint = body.querySelector("#itemRateHint");
    var rates = [];
    var ratesLoaded = false;

    function syncRateVisibility() {
      var gaming = body.querySelector("#itemType").value === "gaming";
      rateField.classList.toggle("hidden", !gaming);
      if (gaming && !ratesLoaded) loadRates();
    }

    function loadRates() {
      ratesLoaded = true;
      global.CXRates.list()
        .then(function (list) {
          rates = list;
          if (!rates.length) {
            rateSel.innerHTML = '<option value="">No gaming prices set</option>';
            rateSel.disabled = true;
            rateHint.textContent = "Add prices under Catalogue → Gaming Prices to pick them here.";
            return;
          }
          rateSel.disabled = false;
          rateSel.innerHTML = '<option value="">Type it in manually…</option>' +
            rates.map(function (r) {
              return '<option value="' + r.price_id + '">' +
                UI.esc(global.CXRates.label(r)) + " — " +
                UI.esc(global.CXRates.money(r.price, r.currency)) + "</option>";
            }).join("");
        })
        .catch(function (err) {
          /* A rate card that will not load must not block adding a line — the
             customer is at the counter. Say so and leave the manual fields. */
          rateSel.innerHTML = '<option value="">Could not load rates</option>';
          rateSel.disabled = true;
          rateHint.textContent = err.message + " — enter the price manually.";
        });
    }

    rateSel.addEventListener("change", function () {
      var picked = rates.filter(function (r) {
        return String(r.price_id) === rateSel.value;
      })[0];
      if (!picked) return;
      body.querySelector("#itemDesc").value = global.CXRates.billDescription(picked);
      body.querySelector("#itemPrice").value = picked.price;
    });
    body.querySelector("#itemType").addEventListener("change", syncRateVisibility);
    syncRateVisibility();

    return UI.modal({
      title: "Add item",
      description: bill.bill_number,
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var desc = ctx.body.querySelector("#itemDesc").value.trim();
            var qty = Number(ctx.body.querySelector("#itemQty").value);
            var price = Number(ctx.body.querySelector("#itemPrice").value);
            if (!desc || !qty || qty <= 0 || !Number.isFinite(price) || price < 0) {
              Motion.shake(ctx.node);
              UI.toast.warn("Fill in the description, quantity and price");
              return false;
            }
            return Store.addBillItem(bill.bill_id, {
              description: desc,
              item_type: ctx.body.querySelector("#itemType").value,
              quantity: qty,
              unit_price: price
            })
              .then(function (r) { UI.toast.ok("Item added", desc); if (onDone) onDone(r.data); return load(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not add item", err.message); return false; });
          }
        }
      ]
    });
  }

  function discountDialog(bill, onDone) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label" for="discAmount">Discount (XP)</label>' +
        '<input class="input" id="discAmount" type="number" min="0" step="0.01" value="' + bill.discount + '" data-autofocus>' +
        '<div class="field-hint">Subtotal is ' + coins(bill.subtotal) + ' XP.</div></div>' +
      '<div class="field"><label class="field-label" for="discReason">Reason</label>' +
        '<input class="input" id="discReason" placeholder="Regular customer" value="' +
          UI.esc(bill.discount_reason || "") + '"></div>';

    return UI.modal({
      title: "Apply discount",
      description: bill.bill_number,
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Apply", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var amount = Number(ctx.body.querySelector("#discAmount").value);
            if (!Number.isFinite(amount) || amount < 0) {
              Motion.shake(ctx.node);
              return false;
            }
            return Store.adjustBill(bill.bill_id, {
              discount: amount,
              reason: ctx.body.querySelector("#discReason").value.trim() || null
            })
              .then(function (r) { UI.toast.ok("Discount applied"); if (onDone) onDone(r.data); return load(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not apply", err.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     TABLE
     ========================================================================== */
  function render() {
    if (!rootEl) return;

    var s = rootEl.querySelector("#billSummary");
    if (s) {
      s.querySelector("[data-sum=billed]").textContent = coins(summary.billed);
      s.querySelector("[data-sum=collected]").textContent = coins(summary.collected);
      s.querySelector("[data-sum=outstanding]").textContent = coins(summary.outstanding);
    }

    var host = rootEl.querySelector("#billTable");
    if (!host) return;
    UI.clear(host);

    if (loading && !rows.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (loadError) { host.appendChild(UI.errorState(loadError, load)); return; }

    if (!rows.length) {
      host.appendChild(UI.emptyState({
        icon: "billing",
        title: filter === "open" ? "Nothing outstanding" : "No bills",
        text: filter === "open"
          ? "Every bill is settled. Bills are raised automatically when a charged session ends."
          : "Bills appear here once sessions are charged."
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Bill</th><th>Customer</th><th>Station</th><th>Raised</th>" +
      "<th class='td-num'>Total</th><th class='td-num'>Due</th><th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    rows.forEach(function (bill) {
      var tr = UI.el("tr", { dataset: { status: STATUS_TONE[bill.status] || "idle" }, style: { cursor: "pointer" } });
      tr.innerHTML =
        '<td class="mono"><strong>' + UI.esc(bill.bill_number) + "</strong></td>" +
        "<td>" + UI.esc(bill.customer_name || "Guest") +
          (bill.is_guest ? ' <span class="badge badge-plain">Guest</span>' : "") + "</td>" +
        '<td class="mono faint">' + UI.esc(bill.pc_name || "—") + "</td>" +
        "<td>" + UI.esc(new Date(bill.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</td>" +
        '<td class="td-num" style="font-weight:700">' + coins(bill.total) + " XP</td>" +
        '<td class="td-num">' + (bill.balance_due > 0
          ? '<span style="color:var(--warn);font-weight:700">' + coins(bill.balance_due) + " XP</span>"
          : '<span class="faint">—</span>') + "</td>" +
        '<td><span class="badge">' + UI.esc(bill.status) + "</span></td>" +
        '<td class="td-actions"></td>';

      if (bill.balance_due > 0 && bill.status !== "VOID") {
        var payBtn = UI.el("button", {
          class: "btn btn-primary btn-sm",
          html: Icon("billing", 13) + '<span class="btn-label">Take payment</span>'
        });
        payBtn.addEventListener("click", function (e) { e.stopPropagation(); paymentDialog(bill); });
        tr.querySelector(".td-actions").appendChild(payBtn);
      }

      tr.addEventListener("click", function () { openBill(bill.bill_id); });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  /* A sub-view of the billing desk; see the note in counter.js. */
  global.CXPages._bills = {
    title: "Billing",
    subtitle: "Bills, payments and outstanding amounts",

    mount: function (root, ctx) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =

        '<div class="grid grid-kpi" id="billSummary" style="margin-bottom:var(--s-5)">' +
          '<div class="stat stat-accent" data-status="accent">' +
            '<div class="stat-label">' + Icon("billing", 13) + "Billed</div>" +
            '<div class="stat-value" data-sum="billed">0</div>' +
            '<div class="stat-foot">XP across these bills</div></div>' +
          '<div class="stat stat-accent" data-status="online">' +
            '<div class="stat-label">' + Icon("check", 13) + "Collected</div>" +
            '<div class="stat-value" data-sum="collected">0</div>' +
            '<div class="stat-foot">XP taken in payment</div></div>' +
          '<div class="stat stat-accent" data-status="warning">' +
            '<div class="stat-label">' + Icon("alert", 13) + "Outstanding</div>" +
            '<div class="stat-value" data-sum="outstanding">0</div>' +
            '<div class="stat-foot">XP still owed</div></div>' +
        "</div>" +

        '<div class="toolbar">' +
          '<div class="search" style="width:300px">' + Icon("search", 15) +
            '<input class="input" id="billSearch" type="search" placeholder="Search bill number or customer…" autocomplete="off">' +
          "</div>" +
          '<div class="row gap-2" id="billFilters">' +
            FILTERS.map(function (f) {
              return '<button class="chip" data-filter="' + f.id + '"' +
                (f.id === filter ? ' aria-pressed="true" data-status="accent"' : "") + ">" + f.label + "</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="billTable"></div>';
      root.appendChild(page);

      var actions = ctx && ctx.actions;
      if (actions) {
        var refreshBtn = UI.el("button", {
          class: "btn btn-outline", type: "button",
          html: Icon("refresh", 15) + '<span class="btn-label">Refresh</span>'
        });
        refreshBtn.addEventListener("click", function () {
          UI.withBusy(refreshBtn, function () { return load(); });
        });
        actions.appendChild(refreshBtn);

        actions.appendChild(UI.el("button", {
          class: "btn btn-primary", type: "button",
          html: Icon("plus", 15) + '<span class="btn-label">New bill</span>',
          onClick: newBillDialog
        }));
      }

      var search = page.querySelector("#billSearch");
      search.value = query;
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { query = search.value.trim(); load(); }, 250);
      });

      UI.$$("#billFilters .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          filter = chip.dataset.filter;
          UI.$$("#billFilters .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
            if (c === chip) c.setAttribute("data-status", "accent");
            else c.removeAttribute("data-status");
          });
          load();
        });
      });

      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
    }
  };
})(window);
