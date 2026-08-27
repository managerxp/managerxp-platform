/* ==========================================================================
   CafeXP Admin — Customers
   Staff directory over /api/customers, with the XP Coin wallet attached:
   balance, ledger, and adding or deducting coins for a specific customer.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var query = "";
  var customers = [];
  var loading = false;
  var loadError = null;
  var searchTimer = null;
  var typeFilter = "all";

  var PRESETS = [100, 250, 500, 1000, 2000];
  var METHODS = ["cash", "card", "upi", "other"];

  /* All data comes back from one search; the filter just decides which rows
     of it are shown, so switching tabs never needs a round trip. */
  var TYPE_FILTERS = [
    { id: "all", label: "All" },
    { id: "normal", label: "Normal" },
    { id: "regular", label: "Regular" }
  ];

  function visibleCustomers() {
    if (typeFilter === "regular") return customers.filter(function (c) { return c.is_regular; });
    if (typeFilter === "normal") return customers.filter(function (c) { return !c.is_regular; });
    return customers;
  }

  /** XP Coin amounts: whole numbers unless there are real part-coins. */
  function coins(value) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) {
      return whole ? String(Math.round(n)) : n.toFixed(2);
    }
  }

  var CATEGORY_LABEL = {
    topup: "Coins added", food: "Food & drink", gaming: "Gaming time",
    shop: "Shop purchase", refund: "Refund", bonus: "Bonus",
    purchase: "Purchase", other: "Adjustment"
  };

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true;
    loadError = null;
    render();

    return Store.getCustomers({ search: query, limit: 200 })
      .then(function (body) {
        customers = body.data || [];
        loading = false;
        render();
      })
      .catch(function (err) {
        loading = false;
        customers = [];
        loadError = err.message;
        render();
      });
  }

  /* ==========================================================================
     MOVE COINS
     ========================================================================== */
  /**
   * dialog for credit ("add") and debit ("deduct"). Both post to the existing
   * wallet endpoints; the server enforces staff-only and rejects overdrafts.
   */
  function moveCoinsDialog(customer, direction, onDone) {
    var isCredit = direction === "credit";
    var balance = Number(customer.wallet_balance || 0);

    var body = UI.el("div", { class: "col gap-5" });
    body.innerHTML =
      '<div class="card card-pad row gap-4" style="background:var(--bg-inset);align-items:center">' +
        global.CXCoin(46, { detail: "plain" }) +
        '<div class="grow">' +
          '<div class="eyebrow">' + UI.esc(customer.customer_name) + "</div>" +
          '<div style="font-size:22px;font-weight:750;letter-spacing:-.02em;margin-top:2px">' +
            coins(balance) + ' <small style="font-size:12px;color:var(--text-3)">XP available</small></div>' +
        "</div>" +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label">Amount</label>' +
        '<div class="row gap-2 wrap" id="presetRow">' +
          PRESETS.map(function (v) {
            return '<button type="button" class="chip" data-amount="' + v + '">' + coins(v) + "</button>";
          }).join("") +
        "</div>" +
      "</div>" +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field">' +
          '<label class="field-label field-req" for="coinAmount">XP Coins</label>' +
          '<input class="input" id="coinAmount" type="number" min="1" step="1" placeholder="500" data-autofocus>' +
        "</div>" +
        '<div class="field">' +
          '<label class="field-label" for="coinMethod">' + (isCredit ? "Paid by" : "Reason") + "</label>" +
          (isCredit
            ? '<select class="select" id="coinMethod">' +
                METHODS.map(function (m) { return '<option value="' + m + '">' + m.toUpperCase() + "</option>"; }).join("") +
              "</select>"
            : '<select class="select" id="coinMethod">' +
                '<option value="food">Food &amp; drink</option>' +
                '<option value="gaming">Gaming time</option>' +
                '<option value="shop">Shop purchase</option>' +
                '<option value="other">Adjustment</option>' +
              "</select>") +
        "</div>" +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label" for="coinNote">Note</label>' +
        '<input class="input" id="coinNote" placeholder="' +
          (isCredit ? "Counter top-up" : "What this is for") + '">' +
      "</div>" +

      '<div class="notice" data-status="' + (isCredit ? "online" : "warning") + '" id="coinPreview"></div>';

    var dialog = UI.modal({
      title: isCredit ? "Add XP Coins" : "Deduct XP Coins",
      description: isCredit
        ? "Credits this customer's wallet. Recorded against your staff account."
        : "Takes coins out of this customer's wallet.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isCredit ? "Add coins" : "Deduct coins",
          variant: isCredit ? "primary" : "danger",
          icon: isCredit ? "plus" : "trash",
          onClick: function (ctx) {
            var amount = Number(ctx.body.querySelector("#coinAmount").value);
            if (!amount || amount <= 0) {
              Motion.shake(ctx.body.querySelector("#coinAmount"));
              UI.toast.warn("Enter an amount greater than zero");
              return false;
            }
            if (!isCredit && amount > balance) {
              Motion.shake(ctx.node);
              UI.toast.warn("Not enough coins", "Balance is " + coins(balance) + " XP.");
              return false;
            }

            var selected = ctx.body.querySelector("#coinMethod").value;
            var payload = {
              amount: amount,
              note: ctx.body.querySelector("#coinNote").value.trim() || null
            };
            if (isCredit) { payload.method = selected; payload.category = "topup"; }
            else { payload.category = selected; }

            var call = isCredit
              ? Store.creditWallet(customer.customer_id, payload)
              : Store.debitWallet(customer.customer_id, payload);

            return call
              .then(function (result) {
                var next = result.data.wallet.balance;
                UI.toast.ok(
                  (isCredit ? "Added " : "Deducted ") + coins(amount) + " XP",
                  customer.customer_name + " now has " + coins(next) + " XP"
                );
                if (onDone) onDone(next);
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) {
                UI.toast.error(isCredit ? "Could not add coins" : "Could not deduct coins", err.message);
                return false;
              });
          }
        }
      ]
    });

    /* preset chips + running preview of the resulting balance */
    var input = body.querySelector("#coinAmount");
    var preview = body.querySelector("#coinPreview");
    var chips = UI.$$("#presetRow .chip", body);

    function refresh() {
      var amount = Number(input.value) || 0;
      var next = isCredit ? balance + amount : balance - amount;
      chips.forEach(function (c) {
        c.setAttribute("aria-pressed", String(Number(c.dataset.amount) === amount));
      });
      if (!amount) {
        preview.innerHTML = Icon("info", 16) + "<div>Choose or type an amount.</div>";
        return;
      }
      if (!isCredit && next < 0) {
        preview.setAttribute("data-status", "offline");
        preview.innerHTML = Icon("alert", 16) +
          "<div>That is more than the customer has. Balance is <strong>" + coins(balance) + " XP</strong>.</div>";
        return;
      }
      preview.setAttribute("data-status", isCredit ? "online" : "warning");
      preview.innerHTML = Icon(isCredit ? "check" : "alert", 16) +
        "<div>New balance will be <strong>" + coins(next) + " XP</strong>" +
        " (" + coins(balance) + (isCredit ? " + " : " − ") + coins(amount) + ").</div>";
    }

    chips.forEach(function (c) {
      c.addEventListener("click", function () { input.value = c.dataset.amount; refresh(); });
    });
    input.addEventListener("input", refresh);
    refresh();

    return dialog;
  }

  /* ==========================================================================
     EDIT TIER — promote an existing customer to a regular, or return them to
     normal. The create-customer dialog only sets this once, at registration;
     this is the same PATCH /tier call for a customer who already exists.
     ========================================================================== */
  function editTierDialog(customer, onDone) {
    var wasRegular = !!customer.is_regular;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label">Customer type</label>' +
        '<div class="row gap-2" id="etType">' +
          '<button type="button" class="chip" data-type="NORMAL" aria-pressed="' + String(!wasRegular) + '">Normal</button>' +
          '<button type="button" class="chip" data-type="REGULAR" aria-pressed="' + String(wasRegular) + '">Regular</button>' +
        "</div>" +
        '<div class="field-hint" id="etTypeHint">' +
          (wasRegular
            ? "A known customer. Gets a discount on the whole bill and can settle later."
            : "A walk-in. Pays at the counter, no standing discount.") +
        "</div>" +
      "</div>" +

      '<div class="' + (wasRegular ? "" : "hidden") + '" id="etRegularFields">' +
        '<div class="grid grid-2" style="gap:var(--s-3)">' +
          '<div class="field"><label class="field-label" for="etDiscount">Discount</label>' +
            '<div class="row gap-2" style="align-items:center">' +
              '<input class="input" id="etDiscount" type="number" min="0" max="100" step="1" ' +
                'value="' + (Number(customer.discount_percent) || 0) + '" style="max-width:110px">' +
              '<span class="field-hint">% off every line</span>' +
            "</div></div>" +
          '<div class="field"><label class="field-label" for="etCredit">Credit limit</label>' +
            '<input class="input" id="etCredit" type="number" min="0" step="10" ' +
              'value="' + (Number(customer.credit_limit) || 0) + '">' +
            '<div class="field-hint">Most they may owe at once. Zero means no tab.</div></div>' +
        "</div>" +
        '<div class="field"><label class="field-label" for="etNote">Note</label>' +
          '<input class="input" id="etNote" maxlength="255" placeholder="Why they are a regular — optional" ' +
            'value="' + UI.esc(customer.tier_note || "") + '"></div>' +
      "</div>";

    var type = wasRegular ? "REGULAR" : "NORMAL";
    var regularFields = body.querySelector("#etRegularFields");
    var typeHint = body.querySelector("#etTypeHint");
    UI.$$("#etType .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () {
        type = chip.dataset.type;
        UI.$$("#etType .chip", body).forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === chip));
        });
        regularFields.classList.toggle("hidden", type !== "REGULAR");
        typeHint.textContent = type === "REGULAR"
          ? "A known customer. Gets a discount on the whole bill and can settle later."
          : "A walk-in. Pays at the counter, no standing discount.";
      });
    });

    return UI.modal({
      title: "Customer type",
      description: wasRegular
        ? "Change " + customer.customer_name + "’s discount, credit limit, or move them back to normal."
        : "Move " + customer.customer_name + " to a regular, with a discount and an optional tab.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var payload = { customer_type: type };
            if (type === "REGULAR") {
              payload.discount_percent = Number(ctx.body.querySelector("#etDiscount").value || 0);
              payload.credit_limit = Number(ctx.body.querySelector("#etCredit").value || 0);
              payload.tier_note = ctx.body.querySelector("#etNote").value.trim() || null;
            }
            return Store.setCustomerTier(customer.customer_id, payload)
              .then(function (r) {
                UI.toast.ok(
                  type === "REGULAR" ? "Marked as a regular" : "Set back to normal",
                  type === "REGULAR"
                    ? r.data.discount_percent + "% off · " +
                      (r.data.credit_limit > 0 ? r.data.credit_limit + " credit" : "no tab")
                    : customer.customer_name + " now pays at the counter"
                );
                if (onDone) onDone();
                return true;
              })
              .catch(function (err) {
                // The backend refuses to drop a limit below what they already
                // owe (409) — surfaced verbatim, it already says how much.
                UI.toast.error("Could not change customer type", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     CUSTOMER DRAWER
     ========================================================================== */
  function openCustomer(customer) {
    var panel = UI.drawer({ wide: true, head: "", body: "" });
    var current = customer;

    function renderHead() {
      panel.head.innerHTML =
        '<div class="row-between gap-3">' +
          '<div class="row gap-4" style="min-width:0;align-items:center">' +
            '<span class="avatar" style="width:44px;height:44px;font-size:15px">' +
              UI.esc(UI.initials(current.customer_name)) + "</span>" +
            "<div style='min-width:0'>" +
              '<div class="page-title" style="font-size:21px">' + UI.esc(current.customer_name) + "</div>" +
              '<div class="faint" style="font-size:12px">' + UI.esc(current.email || "") + "</div>" +
            "</div>" +
          "</div>" +
          '<button class="modal-close" id="custClose" aria-label="Close">' + Icon("close", 15) + "</button>" +
        "</div>";
      panel.head.querySelector("#custClose").addEventListener("click", function () { panel.close(); });
    }

    function renderBody() {
      UI.clear(panel.body);
      var wrap = UI.el("div", { class: "col gap-5" });

      /* ---- wallet ---- */
      var wallet = UI.el("div", { class: "card" });
      var balance = Number(current.wallet_balance || 0);
      wallet.innerHTML =
        '<div class="card-body">' +
          '<div class="row gap-5" style="align-items:center">' +
            '<div class="grow">' +
              '<div class="eyebrow">XP Coin balance</div>' +
              '<div style="display:flex;align-items:flex-end;gap:10px;margin-top:8px">' +
                '<span style="font-size:40px;font-weight:820;letter-spacing:-.03em;font-variant-numeric:tabular-nums" ' +
                  'id="custBalance">' + coins(balance) + "</span>" +
                '<span style="font-size:14px;font-weight:750;letter-spacing:.08em;color:var(--accent-hot);padding-bottom:6px">XP</span>' +
              "</div>" +
            "</div>" +
            global.CXCoin(84, { detail: "full", spin: true }) +
          "</div>" +
        "</div>" +
        '<div class="card-foot row gap-2">' +
          '<button class="btn btn-primary btn-sm grow" id="btnAddCoins">' + Icon("plus", 14) +
            '<span class="btn-label">Add coins</span></button>' +
          '<button class="btn btn-danger btn-sm grow" id="btnDeductCoins">' + Icon("trash", 14) +
            '<span class="btn-label">Deduct</span></button>' +
        "</div>";
      wrap.appendChild(wallet);

      wallet.querySelector("#btnAddCoins").addEventListener("click", function () {
        moveCoinsDialog(current, "credit", refreshCustomer);
      });
      wallet.querySelector("#btnDeductCoins").addEventListener("click", function () {
        moveCoinsDialog(current, "debit", refreshCustomer);
      });

      /* ---- tier ---- */
      var tier = UI.el("div", { class: "card" });
      tier.innerHTML =
        '<div class="card-head row-between">' +
          "<h3>Customer type</h3>" +
          '<button class="btn btn-outline btn-sm" id="btnEditTier">' + Icon("edit", 13) +
            '<span class="btn-label">Edit</span></button>' +
        "</div>" +
        '<div class="card-body col">' +
          (current.is_regular
            ? '<div class="kv"><span class="kv-key">Status</span><span class="kv-val">' +
                '<span class="badge" data-status="accent">Regular</span></span></div>' +
              '<div class="kv"><span class="kv-key">Discount</span><span class="kv-val">' +
                (Number(current.discount_percent) || 0) + "% off every line</span></div>" +
              '<div class="kv"><span class="kv-key">Credit limit</span><span class="kv-val">' +
                (Number(current.credit_limit) > 0 ? coins(current.credit_limit) : "No tab") + "</span></div>" +
              (current.tier_note
                ? '<div class="kv"><span class="kv-key">Note</span><span class="kv-val">' +
                    UI.esc(current.tier_note) + "</span></div>"
                : "")
            : '<div class="kv"><span class="kv-key">Status</span><span class="kv-val">' +
                "Normal — pays at the counter, no standing discount</span></div>") +
        "</div>";
      wrap.appendChild(tier);

      tier.querySelector("#btnEditTier").addEventListener("click", function () {
        editTierDialog(current, refreshCustomer);
      });

      /* ---- profile ---- */
      var profile = UI.el("div", { class: "card" });
      var address = current.address;
      var addressText = !address ? "—"
        : typeof address === "string" ? address
        : address.value ? address.value
        : Object.keys(address).map(function (k) { return address[k]; }).filter(Boolean).join(", ");

      profile.innerHTML =
        '<div class="card-head"><h3>Profile</h3></div>' +
        '<div class="card-body col">' +
          '<div class="kv"><span class="kv-key">Mobile</span><span class="kv-val selectable">' +
            UI.esc(current.phone_number || "—") + "</span></div>" +
          '<div class="kv"><span class="kv-key">Email</span><span class="kv-val selectable">' +
            UI.esc(current.email || "—") + "</span></div>" +
          '<div class="kv"><span class="kv-key">Address</span><span class="kv-val">' +
            UI.esc(addressText) + "</span></div>" +
          '<div class="kv"><span class="kv-key">Customer ID</span><span class="kv-val mono">#' +
            UI.esc(current.customer_id) + "</span></div>" +
          '<div class="kv"><span class="kv-key">Joined</span><span class="kv-val">' +
            UI.esc(UI.fmtDate(current.created_at)) + "</span></div>" +
        "</div>";
      wrap.appendChild(profile);

      /* ---- ledger ---- */
      var ledger = UI.el("div", { class: "card" });
      ledger.innerHTML = '<div class="card-head"><h3>Wallet activity</h3></div>';
      var ledgerBody = UI.el("div", { class: "card-body-flush" });
      ledgerBody.appendChild(UI.skeletonRows(4));
      ledger.appendChild(ledgerBody);
      wrap.appendChild(ledger);

      Store.getCustomerWalletTransactions(current.customer_id, 25)
        .then(function (body) {
          UI.clear(ledgerBody);
          var rows = body.data || [];
          if (!rows.length) {
            ledgerBody.appendChild(UI.emptyState({
              icon: "billing",
              title: "No wallet activity",
              text: "Nothing has been added or spent yet."
            }));
            return;
          }
          var made = [];
          rows.forEach(function (tx) {
            var isCredit = tx.direction === "credit";
            var when = new Date(tx.created_at);
            var row = UI.el("div", {
              class: "kv",
              style: { padding: "12px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
              dataset: { status: isCredit ? "online" : "accent" }
            });
            row.innerHTML =
              '<span style="min-width:0">' +
                '<span style="font-size:13px;font-weight:600;display:block">' +
                  UI.esc(CATEGORY_LABEL[tx.category] || tx.category) + "</span>" +
                '<span class="faint" style="font-size:11px">' +
                  UI.esc([
                    isNaN(when) ? null : when.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                    tx.method, tx.note, tx.performed_by
                  ].filter(Boolean).join(" · ")) + "</span>" +
              "</span>" +
              '<span style="text-align:right;white-space:nowrap">' +
                '<span style="font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--st)">' +
                  (isCredit ? "+" : "−") + coins(tx.amount) + " XP</span>" +
                '<span class="faint" style="display:block;font-size:11px">' + coins(tx.balance_after) + " XP</span>" +
              "</span>";
            ledgerBody.appendChild(row);
            made.push(row);
          });
          Motion.stagger(made, { step: 0.018, y: 6 });
        })
        .catch(function (err) {
          UI.clear(ledgerBody);
          ledgerBody.appendChild(UI.errorState(err.message));
        });

      panel.body.appendChild(wrap);
      Motion.stagger(wrap.children, { step: 0.04, y: 12 });
    }

    /** Pull the customer back from the server after a balance change. */
    function refreshCustomer() {
      Store.getCustomer(current.customer_id)
        .then(function (fresh) {
          current = fresh;
          renderHead();
          renderBody();
        })
        .catch(function () { /* the toast already reported the failure */ });
    }

    renderHead();
    renderBody();
    return panel;
  }

  /* ==========================================================================
     TABLE
     ========================================================================== */
  /* ==========================================================================
     ADD CUSTOMER — staff registering a walk-in at the counter
     ========================================================================== */
  function addCustomerDialog(onAdded) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="ncName">Name</label>' +
          '<input class="input" id="ncName" placeholder="Rahul Menon" data-autofocus></div>' +
        '<div class="field"><label class="field-label field-req" for="ncPhone">Mobile</label>' +
          '<input class="input mono" id="ncPhone" inputmode="tel" placeholder="9876543210"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="ncEmail">Email</label>' +
        '<input class="input" id="ncEmail" type="email" placeholder="Optional">' +
        '<div class="field-hint">Leave blank and we key the account to their mobile number.</div></div>' +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="ncPassword">Password</label>' +
          '<input class="input" id="ncPassword" type="password" placeholder="Optional — 6+ characters">' +
          '<div class="field-hint">Only needed if they sign in on a station themselves.</div></div>' +
        '<div class="field"><label class="field-label" for="ncOpening">Opening XP Coins</label>' +
          '<input class="input" id="ncOpening" type="number" min="0" step="1" value="0">' +
          '<div class="field-hint">Credited to their new wallet and logged.</div></div>' +
      "</div>" +

      /*
       * Normal or regular.
       *
       * A regular is somebody the café knows: they get a standing discount on
       * the whole bill and may run a tab. Both are commercial decisions, so
       * the fields only appear once REGULAR is chosen rather than sitting
       * there inviting a number on an account that should not have one.
       */
      '<div class="field">' +
        '<label class="field-label">Customer type</label>' +
        '<div class="row gap-2" id="ncType">' +
          '<button type="button" class="chip" data-type="NORMAL" aria-pressed="true">Normal</button>' +
          '<button type="button" class="chip" data-type="REGULAR">Regular</button>' +
        "</div>" +
        '<div class="field-hint" id="ncTypeHint">A walk-in. Pays at the counter, no standing discount.</div>' +
      "</div>" +

      '<div class="hidden" id="ncRegularFields">' +
        '<div class="grid grid-2" style="gap:var(--s-3)">' +
          '<div class="field"><label class="field-label" for="ncDiscount">Discount</label>' +
            '<div class="row gap-2" style="align-items:center">' +
              '<input class="input" id="ncDiscount" type="number" min="0" max="100" step="1" value="0" style="max-width:110px">' +
              '<span class="field-hint">% off every line</span>' +
            "</div></div>" +
          '<div class="field"><label class="field-label" for="ncCredit">Credit limit</label>' +
            '<input class="input" id="ncCredit" type="number" min="0" step="10" value="0">' +
            '<div class="field-hint">Most they may owe at once. Zero means no tab.</div></div>' +
        "</div>" +
        '<div class="field"><label class="field-label" for="ncNote">Note</label>' +
          '<input class="input" id="ncNote" maxlength="255" placeholder="Why they are a regular — optional"></div>' +
      "</div>";

    var customerType = "NORMAL";
    var regularFields = body.querySelector("#ncRegularFields");
    var typeHint = body.querySelector("#ncTypeHint");
    UI.$$("#ncType .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () {
        customerType = chip.dataset.type;
        UI.$$("#ncType .chip", body).forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === chip));
        });
        regularFields.classList.toggle("hidden", customerType !== "REGULAR");
        typeHint.textContent = customerType === "REGULAR"
          ? "A known customer. Gets a discount on the whole bill and can settle later."
          : "A walk-in. Pays at the counter, no standing discount.";
      });
    });

    return UI.modal({
      title: "Add customer",
      description: "Registers a walk-in from the counter and opens their XP Coin wallet.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add customer", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#ncName").value.trim();
            var phone = ctx.body.querySelector("#ncPhone").value.trim();
            var password = ctx.body.querySelector("#ncPassword").value;

            if (!name) {
              Motion.shake(ctx.body.querySelector("#ncName"));
              UI.toast.warn("A name is required");
              return false;
            }
            if (phone.replace(/\D/g, "").length < 10) {
              Motion.shake(ctx.body.querySelector("#ncPhone"));
              UI.toast.warn("A 10-digit mobile number is required");
              return false;
            }
            if (password && password.length < 6) {
              Motion.shake(ctx.body.querySelector("#ncPassword"));
              UI.toast.warn("Password must be at least 6 characters");
              return false;
            }

            return Store.createCustomer({
              customer_name: name,
              phone_number: phone,
              email: ctx.body.querySelector("#ncEmail").value.trim() || null,
              password: password || null,
              opening_balance: Number(ctx.body.querySelector("#ncOpening").value || 0)
            })
              .then(function (r) {
                UI.toast.ok("Customer added", r.data.customer_name);
                // Say plainly that they cannot sign in yet, rather than let
                // staff discover it when the customer is at the station.
                if (r.note) UI.toast.warn("No sign-in yet", r.note);

                /* The tier is a second call on purpose: granting a discount
                   and a credit limit is audited separately from creating the
                   record, so it carries its own trail even when both happen
                   in one dialog. A failure here leaves a valid normal
                   customer rather than losing the whole registration. */
                if (customerType !== "REGULAR") {
                  if (onAdded) onAdded(r.data);
                  return true;
                }
                return Store.setCustomerTier(r.data.customer_id, {
                  customer_type: "REGULAR",
                  discount_percent: Number(ctx.body.querySelector("#ncDiscount").value || 0),
                  credit_limit: Number(ctx.body.querySelector("#ncCredit").value || 0),
                  tier_note: ctx.body.querySelector("#ncNote").value.trim() || null
                })
                  .then(function (t) {
                    UI.toast.ok("Marked as a regular",
                      t.data.discount_percent + "% off · " +
                      (t.data.credit_limit > 0 ? t.data.credit_limit + " credit" : "no tab"));
                    if (onAdded) onAdded(t.data);
                    return true;
                  })
                  .catch(function (e) {
                    UI.toast.warn("Added, but not as a regular", e.message);
                    if (onAdded) onAdded(r.data);
                    return true;
                  });
              })
              .catch(function (err) { UI.toast.error("Could not add", err.message); return false; });
          }
        }
      ]
    });
  }

  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#customerTable");
    if (!host) return;
    UI.clear(host);

    if (loading && !customers.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (loadError) { host.appendChild(UI.errorState(loadError, load)); return; }

    var shown = visibleCustomers();

    if (!customers.length) {
      host.appendChild(UI.emptyState({
        icon: "customers",
        title: query ? "No customers match" : "No customers yet",
        text: query
          ? "Nothing matches “" + query + "”."
          : "Register someone at the counter, or wait for them to sign up on a station.",
        actions: query
          ? [{ label: "Clear search", icon: "close", onClick: function () {
              query = "";
              rootEl.querySelector("#custSearch").value = "";
              load();
            } }]
          : [{ label: "Add customer", icon: "plus", variant: "primary", onClick: function () {
              addCustomerDialog(function () { load(); });
            } }]
      }));
      return;
    }

    if (!shown.length) {
      host.appendChild(UI.emptyState({
        icon: "customers",
        title: typeFilter === "regular" ? "No regulars yet" : "No normal customers",
        text: typeFilter === "regular"
          ? "Nobody has been marked as a regular. Open a customer and edit their type to promote one."
          : "Everyone who matches is currently a regular.",
        actions: [{ label: "Show all", icon: "close", onClick: function () {
          typeFilter = "all";
          render();
        } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Customer</th><th>Mobile</th><th>Email</th>" +
      '<th class="td-num">XP Coins</th><th>Joined</th><th></th></tr></thead>';
    var tbody = UI.el("tbody");

    shown.forEach(function (c) {
      var balance = c.wallet_balance;
      var tr = UI.el("tr", { style: { cursor: "pointer" } });
      tr.innerHTML =
        '<td><div class="row gap-3">' +
          '<span class="avatar" style="width:28px;height:28px;font-size:11px">' +
            UI.esc(UI.initials(c.customer_name)) + "</span>" +
          "<strong>" + UI.esc(c.customer_name) + "</strong>" +
          /* A regular is worth seeing at a glance — it changes what the till
             offers them and what they pay. The badge carries the discount so
             staff do not have to open the record to answer "how much off?". */
          (c.is_regular
            ? ' <span class="badge" data-status="accent">Regular' +
              (c.discount_percent > 0 ? " · " + c.discount_percent + "%" : "") + "</span>"
            : "") +
          "</div></td>" +
        '<td class="mono faint" style="font-size:12px">' + UI.esc(c.phone_number || "—") + "</td>" +
        '<td class="faint" style="font-size:12px">' + UI.esc(c.email || "—") + "</td>" +
        '<td class="td-num"><span style="font-weight:700;font-variant-numeric:tabular-nums;color:' +
          (balance ? "var(--text)" : "var(--text-3)") + '">' +
          (balance === null ? "—" : coins(balance)) + "</span>" +
          '<span class="faint" style="font-size:10px;margin-left:4px">XP</span></td>' +
        "<td>" + UI.esc(UI.fmtDate(c.created_at)) + "</td>" +
        '<td class="td-actions"></td>';

      var addBtn = UI.el("button", {
        class: "btn btn-primary btn-sm",
        html: Icon("plus", 13) + '<span class="btn-label">Add coins</span>'
      });
      addBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        moveCoinsDialog(c, "credit");
      });
      tr.querySelector(".td-actions").appendChild(addBtn);

      tr.addEventListener("click", function () { openCustomer(c); });
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
  global.CXPages.customers = {
    title: "Customers",
    subtitle: "Directory, wallets and history",

    // Shared so a session can be started for someone who is not registered yet.
    addCustomerDialog: addCustomerDialog,

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Customers</div>' +
            '<div class="page-sub">Everyone registered at this café, and their XP Coin wallets.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="custRefresh">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="custAdd">' + Icon("plus", 15) +
              '<span class="btn-label">Add customer</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:340px">' + Icon("search", 15) +
            '<input class="input" id="custSearch" type="search" placeholder="Search name, mobile or email…" autocomplete="off">' +
          "</div>" +
          '<div class="row gap-2" id="custTypeFilter">' +
            TYPE_FILTERS.map(function (f) {
              return '<button class="chip" data-filter="' + f.id + '"' +
                (f.id === typeFilter ? ' aria-pressed="true" data-status="accent"' : "") + ">" + f.label + "</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="customerTable"></div>';
      root.appendChild(page);

      var search = page.querySelector("#custSearch");
      search.value = query;
      search.addEventListener("input", function () {
        // Search runs server-side, so wait for a pause in typing.
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          query = search.value.trim();
          load();
        }, 260);
      });

      // The filter is client-side — everything matching the search is
      // already in `customers` — so switching tabs only re-renders.
      UI.$$("#custTypeFilter .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          typeFilter = chip.dataset.filter;
          UI.$$("#custTypeFilter .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
            if (c === chip) c.setAttribute("data-status", "accent");
            else c.removeAttribute("data-status");
          });
          render();
        });
      });

      var refreshBtn = page.querySelector("#custRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      page.querySelector("#custAdd").addEventListener("click", function () {
        addCustomerDialog(function (created) {
          // Straight into their drawer — the next thing staff do is usually
          // top the wallet up or start a session.
          load().then(function () { openCustomer(created); });
        });
      });

      render();
      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
    }
  };
})(window);
