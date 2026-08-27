/* ==========================================================================
   CafeXP Admin — Counter
   The cashier's till. One screen from "who is paying" to "settled", because
   at a counter with someone waiting, every extra click is a queue.

   Deliberately keyboard-first: the search box takes focus on open, Enter
   settles, and the number pad works without the mouse.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var products = [];
  var categories = [];
  var activeCategory = "";

  /* The till sells three different things and they are priced in three
     different masters. Rather than three screens, one grid with a source
     switch above it: the cashier's job is the same either way — tap the thing
     the customer asked for. */
  var SOURCES = [
    { id: "products", label: "Products", icon: "fnb" },
    { id: "gaming",   label: "Gaming",   icon: "sessions" },
    { id: "packages", label: "Packages", icon: "packages" }
  ];
  var activeSource = "products";
  var rates = [];              // Gaming Price Master
  var rateCategories = [];     // PC / PS5 / Pool / Darts
  var packages = [];           // Package Master
  var extrasLoaded = false;    // rates and packages are fetched once, on demand

  var UNCATEGORISED = "— uncategorised —";

  /* Set by openForSession() just before the router switches to the till, and
     consumed once on mount. A variable rather than a route parameter because
     the till is a sub-view of the billing desk and has no URL of its own. */
  var pendingAttach = null;
  var productQuery = "";

  /* The bill being built. Nothing is written to the backend until Start bill,
     so an abandoned counter session leaves no orphan bill behind. */
  var draft = null;
  var bill = null;          // once created, the server's copy
  var codeState = null;     // { code, discount } or { error }
  var searchTimer = null;

  var METHODS = [
    { id: "cash", label: "Cash", icon: "billing" },
    { id: "card", label: "Card", icon: "billing" },
    { id: "upi", label: "UPI", icon: "billing" },
    { id: "wallet", label: "XP Coin", icon: "sparkle" }
  ];

  function money(value) {
    var n = Number(value || 0);
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: Math.round(n * 100) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return n.toFixed(2); }
  }

  function newDraft() {
    return {
      customer: null, guestName: "", sessionId: null, lines: [], note: "",
      /* The attached customer's standing gaming discount, if they have one.
         Fetched when a customer is attached and cleared with them. This is
         display only — the server resolves its own copy of this when the
         bill is actually created and is the only figure that is ever
         charged, but the ticket has to agree with it or the payment
         collected here will not match what the bill turns out to cost. */
      membership: { percent: 0, label: null }
    };
  }

  /* What a gaming line actually costs this customer — the same arithmetic
     billing.Controller.js applies when the bill is created, so what the
     cashier collects and what the server charges are the same number. */
  function lineUnitPrice(line) {
    var pct = draft.membership.percent;
    if (line.item_type !== "gaming" || !pct) return Number(line.unit_price);
    return Number((Number(line.unit_price) * (1 - pct / 100)).toFixed(2));
  }

  function subtotal() {
    return draft.lines.reduce(function (sum, l) {
      return sum + Number(l.quantity) * lineUnitPrice(l);
    }, 0);
  }

  /* Pulls the attached customer's live membership so the ticket can show
     their real gaming price rather than the listed one. Resets silently for a
     guest or an unattached ticket — most tickets have no customer yet, and
     that must not read as an error. */
  function refreshMembership() {
    if (!draft.customer || !draft.customer.customer_id) {
      draft.membership = { percent: 0, label: null };
      renderTicket();
      return;
    }
    Store.customerMembership(draft.customer.customer_id)
      .then(function (data) {
        var current = data && data.current;
        draft.membership = current && current.discount_percent > 0
          ? { percent: Number(current.discount_percent), label: current.plan_name }
          : { percent: 0, label: null };
        renderTicket();
      })
      .catch(function () {
        // A wallet/membership lookup failing must not block a sale — the
        // server still applies the real discount when the bill is created.
        draft.membership = { percent: 0, label: null };
        renderTicket();
      });
  }

  function discountAmount() {
    return codeState && codeState.discount ? Number(codeState.discount) : 0;
  }

  function total() { return Math.max(0, subtotal() - discountAmount()); }

  /* ==========================================================================
     LINES
     ========================================================================== */
  /* ==========================================================================
     STOCK ON THE TICKET

     A tile said "6 left" and still took a seventh click, because nothing
     compared the running ticket against the shelf — the tile only went dead at
     zero. So six items could be sold seven times and the bill settled.

     The ticket is a draft: the stock is not taken until settle, which means
     the count on the product is still the FULL amount while the cashier is
     building the ticket. What is already on the ticket therefore has to be
     subtracted here, or the check passes every time.
     ========================================================================== */

  /** How many of a product this ticket already holds. */
  function onTicket(productId) {
    var total = 0;
    draft.lines.forEach(function (l) {
      if (l.reference_id && String(l.reference_id) === String(productId)) {
        total += Number(l.quantity) || 0;
      }
    });
    return total;
  }

  /** The product row behind a line, or null for a custom/gaming line. */
  function productFor(referenceId) {
    if (!referenceId) return null;
    return products.filter(function (p) {
      return String(p.product_id) === String(referenceId);
    })[0] || null;
  }

  /**
   * Whether `wanted` of this product can still go on the ticket.
   * Untracked products and non-product lines are always allowed.
   */
  function stockAllows(referenceId, wanted) {
    var product = productFor(referenceId);
    if (!product || product.track_stock !== true) return { ok: true };

    var available = Number(product.stock_quantity) || 0;
    if (wanted > available) {
      return {
        ok: false,
        available: available,
        // Names the product and the real number — "not enough stock" leaves a
        // cashier with a queue guessing how many they may actually sell.
        message: available <= 0
          ? product.product_name + " is out of stock"
          : "Only " + available + " " + product.product_name + " left"
      };
    }
    return { ok: true, available: available };
  }

  function addLine(line) {
    // Same product twice is a quantity bump, not a second row — a receipt with
    // "Coke x1" three times is a receipt nobody can check.
    var existing = draft.lines.filter(function (l) {
      return l.item_type === line.item_type &&
        l.reference_id === line.reference_id &&
        Number(l.unit_price) === Number(line.unit_price);
    })[0];

    // Checked against what the ticket would hold AFTER this line, not before.
    var check = stockAllows(line.reference_id, onTicket(line.reference_id) + Number(line.quantity));
    if (!check.ok) {
      UI.toast.warn(check.message, "Adjust the count or restock first.");
      return false;
    }

    if (existing && line.reference_id) existing.quantity += line.quantity;
    else draft.lines.push(line);

    // The code's value depends on the subtotal, so it has to be rechecked.
    revalidateCode();
    renderTicket();
    return true;
  }

  function removeLine(index) {
    draft.lines.splice(index, 1);
    revalidateCode();
    renderTicket();
  }

  function setQuantity(index, quantity) {
    if (quantity <= 0) { removeLine(index); return; }

    var line = draft.lines[index];
    /* The other way quantity grows — the + stepper on the ticket. It has to
       enforce the same rule, or the tile blocks the seventh click and the
       stepper waves it through. */
    var others = onTicket(line.reference_id) - Number(line.quantity);
    var check = stockAllows(line.reference_id, others + quantity);
    if (!check.ok) {
      UI.toast.warn(check.message, "That is everything on the shelf.");
      return;
    }

    line.quantity = quantity;
    revalidateCode();
    renderTicket();
  }

  /* ==========================================================================
     DISCOUNT CODE
     ========================================================================== */
  function revalidateCode() {
    if (!codeState || !codeState.code) return;
    var typed = codeState.code.code;
    Store.validateDiscount(typed, draft.customer ? draft.customer.customer_id : null, subtotal())
      .then(function (r) {
        codeState = r && r.valid
          ? { code: r.data.code, discount: r.data.discount }
          : { error: (r && r.message) || "That code no longer applies" };
        renderTicket();
      });
  }

  function applyCode(typed) {
    if (!typed) { codeState = null; renderTicket(); return Promise.resolve(); }
    return Store.validateDiscount(typed, draft.customer ? draft.customer.customer_id : null, subtotal())
      .then(function (r) {
        if (r && r.valid) {
          codeState = { code: r.data.code, discount: r.data.discount };
          UI.toast.ok(r.data.code.code + " applied", money(r.data.discount) + " XP off");
        } else {
          // The refusal sentence is the useful part — show it in place, so the
          // cashier can read it out rather than guess.
          codeState = { error: (r && r.message) || "That code cannot be used" };
        }
        renderTicket();
      });
  }

  /* ==========================================================================
     SETTLE
     ========================================================================== */
  function settleDialog() {
    if (!draft.lines.length) { UI.toast.warn("Nothing on the bill yet"); return; }
    if (!draft.customer && !draft.guestName.trim()) {
      UI.toast.warn("Choose a customer, or give the guest a name");
      return;
    }

    var due = total();
    var tenders = [];

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="notice" data-status="accent">' + Icon("billing", 16) +
        "<div><strong>" + money(due) + " XP</strong> to collect from " +
        UI.esc(draft.customer ? draft.customer.customer_name : draft.guestName) + "</div></div>" +
      '<div class="field"><label class="field-label">Take payment as</label>' +
        '<div class="row gap-2 wrap" id="ctMethods">' +
          METHODS.map(function (m) {
            return '<button type="button" class="chip" data-method="' + m.id + '"' +
              (m.id === "cash" ? ' aria-pressed="true"' : "") + ">" + m.label + "</button>";
          }).join("") +
        "</div></div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="ctAmount">Amount</label>' +
          '<input class="input" id="ctAmount" type="number" min="0" step="0.01" value="' + due + '" data-autofocus></div>' +
        '<div class="field"><label class="field-label" for="ctRef">Reference</label>' +
          '<input class="input" id="ctRef" placeholder="UPI id, last 4 digits…"></div>' +
      "</div>" +
      '<button type="button" class="btn btn-outline btn-block" id="ctAddTender">' +
        Icon("plus", 15) + '<span class="btn-label">Add this tender</span></button>' +
      '<div id="ctTenders" class="col gap-2"></div>' +
      '<div class="kv" style="font-size:15px"><span class="kv-key">Remaining</span>' +
        '<span class="kv-val num" id="ctRemaining">' + money(due) + " XP</span></div>";

    var method = "cash";
    var amountInput = body.querySelector("#ctAmount");

    UI.$$("#ctMethods .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () {
        method = chip.dataset.method;
        UI.$$("#ctMethods .chip", body).forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === chip));
        });
        // Wallet can only cover what the customer actually holds.
        if (method === "wallet" && draft.customer && draft.customer.wallet_balance !== null) {
          var cap = Math.min(remaining(), Number(draft.customer.wallet_balance));
          amountInput.value = cap;
          if (cap <= 0) UI.toast.warn("This wallet is empty");
        }
      });
    });

    function remaining() {
      var taken = tenders.reduce(function (s, t) { return s + t.amount; }, 0);
      return Math.max(0, Number((due - taken).toFixed(2)));
    }

    function paintTenders() {
      var host = body.querySelector("#ctTenders");
      UI.clear(host);
      tenders.forEach(function (t, i) {
        var row = UI.el("div", { class: "kv row-between" });
        row.innerHTML = '<span class="row gap-2"><span class="badge">' + UI.esc(t.method) +
          "</span><span>" + money(t.amount) + " XP</span>" +
          (t.reference ? '<span class="faint mono" style="font-size:10px">' + UI.esc(t.reference) + "</span>" : "") +
          "</span>";
        var del = UI.el("button", {
          class: "btn btn-ghost btn-sm btn-icon", html: Icon("close", 12), "data-tip": "Remove"
        });
        del.addEventListener("click", function () {
          tenders.splice(i, 1);
          paintTenders();
        });
        row.appendChild(del);
        host.appendChild(row);
      });
      body.querySelector("#ctRemaining").textContent = money(remaining()) + " XP";
      amountInput.value = remaining();
    }

    body.querySelector("#ctAddTender").addEventListener("click", function () {
      var amount = Number(amountInput.value);
      if (!Number.isFinite(amount) || amount <= 0) {
        Motion.shake(amountInput);
        return;
      }
      if (amount > remaining() + 0.005) {
        Motion.shake(amountInput);
        UI.toast.warn("That is more than the remaining " + money(remaining()) + " XP");
        return;
      }
      tenders.push({
        method: method,
        amount: Number(amount.toFixed(2)),
        reference: body.querySelector("#ctRef").value.trim() || null
      });
      body.querySelector("#ctRef").value = "";
      paintTenders();
    });

    paintTenders();

    return UI.modal({
      title: "Take payment",
      description: "Split across as many tenders as the customer needs.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Settle bill", variant: "primary", icon: "check",
          onClick: function () {
            if (!tenders.length) {
              UI.toast.warn("Add at least one tender");
              return false;
            }
            if (remaining() > 0.005) {
              UI.toast.warn(money(remaining()) + " XP still outstanding",
                "Add another tender, or take the rest as a part payment from the Billing page.");
              return false;
            }
            return finalise(tenders).then(function (ok) { return ok; });
          }
        }
      ]
    });
  }

  /*
   * Create the bill — or join the one already open for this session — and
   * apply the discount code. Shared by "take payment" and "save for later":
   * the only difference between the two is whether a payment follows
   * immediately, and putting both through one path is what guarantees they
   * agree on what the bill actually is.
   *
   * A ticket opened from a running session (Floor's "Add food & drink") is
   * the case this exists for: the server now folds a second trip to the till
   * for the same session onto its one open bill instead of refusing it, so
   * ordering a snack, then another, then ending the session, is one growing
   * bill throughout — not several that collide.
   */
  function raiseBill() {
    var payload = {
      customer_id: draft.customer ? draft.customer.customer_id : null,
      guest_name: draft.customer ? null : draft.guestName.trim(),
      session_id: draft.sessionId,
      notes: draft.note || null,
      items: draft.lines.map(function (l) {
        return {
          item_type: l.item_type,
          reference_id: l.reference_id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price
        };
      })
    };

    return Store.createBill(payload).then(function (r) {
      var raised = r.data;
      if (!codeState || !codeState.code) return raised;
      return Store.applyBillCode(raised.bill_id, codeState.code.code).then(function (applied) {
        // The code was checked a moment ago, but state can move — if the
        // server refuses now, raise the bill without it rather than fail
        // the sale over a discount.
        if (applied.success) return applied.data;
        UI.toast.warn("Code not applied", applied.message);
        return raised;
      });
    });
  }

  /** Create the bill, apply the code, take the tenders — pay now. */
  function finalise(tenders) {
    return raiseBill()
      .then(function (raised) {
        bill = raised;
        // Sequential, not parallel: each payment recalculates the bill, and
        // concurrent writes would race on the same row.
        return tenders.reduce(function (chain, t) {
          return chain.then(function () {
            return Store.payBill(bill.bill_id, t).then(function (r) { bill = r.data; });
          });
        }, Promise.resolve());
      })
      .then(function () {
        UI.toast.ok("Bill " + bill.bill_number + " settled", money(bill.total) + " XP");
        receiptDialog(bill);
        draft = newDraft();
        codeState = null;
        bill = null;
        renderTicket();
        return true;
      })
      .catch(function (err) {
        UI.toast.error("Could not settle", err.message);
        return false;
      });
  }

  /*
   * Raise the bill and stop there — no tenders, no payment dialog.
   *
   * For a customer who is still playing, or still deciding: the food they
   * ordered lands on their bill as owed, and it stays open until someone
   * settles it — from here later, or from the Bills tab. Nothing about
   * ordering a Coke should require the till to know how they intend to pay.
   */
  function saveForLater() {
    if (!draft.customer && !draft.guestName.trim()) {
      UI.toast.warn("Choose a customer, or give the guest a name");
      return Promise.resolve(false);
    }
    return raiseBill()
      .then(function (raised) {
        UI.toast.ok(
          "Added to bill " + raised.bill_number,
          (raised.customer_name || "Guest") + " owes " + money(raised.balance_due) +
            " XP — settle it any time from Bills."
        );
        draft = newDraft();
        codeState = null;
        renderTicket();
        return true;
      })
      .catch(function (err) {
        UI.toast.error("Could not save", err.message);
        return false;
      });
  }

  /* ==========================================================================
     RECEIPT
     ========================================================================== */
  /*
   * Whether the ManagerXP mark prints on this café's receipts.
   *
   * Read once when the till opens and held for the life of the page — it
   * changes about as often as the café's address, and a settled sale should
   * not wait on a settings round trip before showing the receipt. Absent or
   * unreadable means it prints: the mark is the default, and a failed lookup
   * must not silently remove it.
   */
  var poweredByPref = null;

  function poweredByOn() { return poweredByPref !== "false"; }

  function loadPoweredByPref() {
    return Store.getSettings("billing")
      .then(function (rows) {
        (rows || []).forEach(function (r) {
          if (r.setting_key === "billing.receipt_powered_by") poweredByPref = String(r.setting_value);
        });
      })
      .catch(function () { /* leave it on */ });
  }

  function receiptDialog(settled) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="receipt" id="ctReceipt">' +
        '<div class="receipt-head">' +
          '<div class="receipt-brand">CafeXP</div>' +
          '<div class="receipt-num">' + UI.esc(settled.bill_number) + "</div>" +
          '<div class="receipt-meta">' + new Date(settled.created_at).toLocaleString() + "</div>" +
          '<div class="receipt-meta">' +
            UI.esc(settled.customer_name || settled.guest_name || "Guest") + "</div>" +
        "</div>" +
        '<div class="receipt-lines">' +
          settled.items.map(function (i) {
            return '<div class="receipt-line"><span>' + UI.esc(i.description) +
              (i.quantity > 1 ? " ×" + i.quantity : "") + "</span><span>" + money(i.amount) + "</span></div>";
          }).join("") +
        "</div>" +
        '<div class="receipt-lines">' +
          '<div class="receipt-line"><span>Subtotal</span><span>' + money(settled.subtotal) + "</span></div>" +
          (settled.discount > 0
            ? '<div class="receipt-line"><span>' + UI.esc(settled.discount_reason || "Discount") +
              "</span><span>−" + money(settled.discount) + "</span></div>"
            : "") +
          (settled.tax > 0
            ? '<div class="receipt-line"><span>Tax</span><span>' + money(settled.tax) + "</span></div>"
            : "") +
        "</div>" +
        '<div class="receipt-total"><span>Total</span><span>' + money(settled.total) + " XP</span></div>" +
        '<div class="receipt-lines">' +
          settled.payments.map(function (p) {
            return '<div class="receipt-line"><span>' + UI.esc(p.method) +
              (p.reference ? " · " + UI.esc(p.reference) : "") + "</span><span>" + money(p.amount) + "</span></div>";
          }).join("") +
        "</div>" +
        '<div class="receipt-foot">Thank you — see you next time</div>' +
        // Same rule as the Billing page's receipt: printed unless the café
        // has explicitly removed it.
        (poweredByOn()
          ? '<div class="receipt-powered">Powered by ManagerXP</div>' : "") +
      "</div>";

    return UI.modal({
      title: "Settled",
      description: settled.bill_number,
      body: body,
      actions: [
        { label: "Done", variant: "ghost" },
        {
          label: "Print", variant: "primary", icon: "download",
          onClick: function () {
            // Print the receipt alone rather than the whole console.
            document.body.classList.add("printing-receipt");
            global.print();
            setTimeout(function () {
              document.body.classList.remove("printing-receipt");
            }, 500);
            return false;
          }
        }
      ]
    });
  }

  /* ==========================================================================
     RENDER — TICKET (right)
     ========================================================================== */
  function renderTicket() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#ctTicket");
    if (!host) return;
    UI.clear(host);

    /* ---- who ---- */
    var who = UI.el("div", { class: "card card-pad col gap-3" });
    who.innerHTML = '<div class="eyebrow">Customer</div>';

    if (draft.customer) {
      var picked = UI.el("div", { class: "kv row-between" });
      picked.innerHTML =
        '<span class="row gap-3" style="min-width:0">' +
          '<span class="avatar" style="width:30px;height:30px;font-size:11px">' +
            UI.esc(UI.initials(draft.customer.customer_name)) + "</span>" +
          "<span style='min-width:0'>" +
            '<span style="display:block;font-weight:650;font-size:13px">' +
              UI.esc(draft.customer.customer_name) + "</span>" +
            '<span class="faint" style="font-size:11px">' +
              (draft.customer.wallet_balance === null
                ? "No wallet"
                : money(draft.customer.wallet_balance) + " XP in wallet") + "</span>" +
          "</span>" +
        "</span>";
      var clear = UI.el("button", {
        class: "btn btn-ghost btn-sm btn-icon", html: Icon("close", 13), "data-tip": "Clear"
      });
      clear.addEventListener("click", function () {
        draft.customer = null;
        revalidateCode();
        refreshMembership();
      });
      picked.appendChild(clear);
      who.appendChild(picked);
    } else {
      var pick = UI.el("div", { class: "col gap-2" });
      var findBtn = UI.el("button", {
        class: "btn btn-outline btn-block",
        html: Icon("search", 15) + '<span class="btn-label">Find a customer</span>'
      });
      findBtn.addEventListener("click", customerPicker);

      var guest = UI.el("input", {
        class: "input", placeholder: "…or a guest name", value: draft.guestName
      });
      guest.addEventListener("input", function () { draft.guestName = guest.value; });

      pick.appendChild(findBtn);
      pick.appendChild(guest);
      who.appendChild(pick);
    }
    host.appendChild(who);

    /* ---- lines ---- */
    var ticket = UI.el("div", { class: "card col", style: { flex: "1", minHeight: "0" } });
    ticket.innerHTML = '<div class="card-head"><h3>Ticket</h3>' +
      '<span class="badge">' + draft.lines.length + " line" +
      (draft.lines.length === 1 ? "" : "s") + "</span></div>";

    var lines = UI.el("div", {
      class: "card-body col gap-2",
      style: { overflow: "auto", flex: "1", minHeight: "0" }
    });

    if (!draft.lines.length) {
      lines.appendChild(UI.el("div", {
        class: "faint",
        style: { fontSize: "12px", textAlign: "center", padding: "var(--s-6) 0" },
        text: "Tap a product, or add gaming time."
      }));
    }

    draft.lines.forEach(function (line, i) {
      var effective = lineUnitPrice(line);
      var discounted = effective < Number(line.unit_price) - 0.001;

      var row = UI.el("div", { class: "kv row-between" });
      row.innerHTML =
        "<span style='min-width:0'>" +
          '<span style="display:block;font-size:13px;font-weight:600">' + UI.esc(line.description) + "</span>" +
          '<span class="faint" style="font-size:10px">' +
            (discounted
              /* Struck through, not silently swapped — a cashier who watches
                 the listed price disappear without a mark left up would have
                 no way to tell this was a discount and not a mistake. */
              ? '<s>' + money(line.unit_price) + '</s> ' + money(effective) + " each · " +
                UI.esc(draft.membership.label) + " -" + draft.membership.percent + "%"
              : money(line.unit_price) + " each") +
          "</span>" +
        "</span>";

      var controls = UI.el("span", { class: "row gap-2" });
      var minus = UI.el("button", { class: "btn btn-outline btn-sm btn-icon", text: "−" });
      var qty = UI.el("span", {
        style: { minWidth: "22px", textAlign: "center", fontWeight: "700", fontVariantNumeric: "tabular-nums" },
        text: String(line.quantity)
      });
      var plus = UI.el("button", { class: "btn btn-outline btn-sm btn-icon", text: "+" });
      var amount = UI.el("span", {
        style: { minWidth: "64px", textAlign: "right", fontWeight: "700", fontVariantNumeric: "tabular-nums" },
        text: money(line.quantity * effective)
      });
      var del = UI.el("button", {
        class: "btn btn-ghost btn-sm btn-icon", html: Icon("trash", 12), "data-tip": "Remove"
      });

      minus.addEventListener("click", function () { setQuantity(i, line.quantity - 1); });
      plus.addEventListener("click", function () { setQuantity(i, line.quantity + 1); });
      del.addEventListener("click", function () { removeLine(i); });

      controls.appendChild(minus);
      controls.appendChild(qty);
      controls.appendChild(plus);
      controls.appendChild(amount);
      controls.appendChild(del);
      row.appendChild(controls);
      lines.appendChild(row);
    });

    ticket.appendChild(lines);
    host.appendChild(ticket);

    /* ---- code + totals ---- */
    var foot = UI.el("div", { class: "card card-pad col gap-3" });

    var codeRow = UI.el("div", { class: "col gap-2" });
    codeRow.innerHTML =
      '<div class="row gap-2">' +
        '<input class="input mono grow" id="ctCode" placeholder="Discount code" ' +
          'value="' + UI.esc(codeState && codeState.code ? codeState.code.code : "") + '" ' +
          'style="text-transform:uppercase">' +
        '<button class="btn btn-outline" id="ctApplyCode">Apply</button>' +
      "</div>" +
      (codeState && codeState.error
        ? '<div class="notice" data-status="warning" style="padding:8px 10px">' + Icon("alert", 14) +
          '<div style="font-size:11px">' + UI.esc(codeState.error) + "</div></div>"
        : "") +
      (codeState && codeState.code
        ? '<div class="notice" data-status="online" style="padding:8px 10px">' + Icon("check", 14) +
          '<div style="font-size:11px"><strong>' + UI.esc(codeState.code.code) + "</strong> — " +
          UI.esc(codeState.code.description || "applied") + "</div></div>"
        : "");
    foot.appendChild(codeRow);

    var totals = UI.el("div", { class: "col" });
    totals.innerHTML =
      '<div class="kv"><span class="kv-key">Subtotal</span>' +
        '<span class="kv-val num">' + money(subtotal()) + "</span></div>" +
      (discountAmount() > 0
        ? '<div class="kv"><span class="kv-key">Discount</span>' +
          '<span class="kv-val num" style="color:var(--ok)">−' + money(discountAmount()) + "</span></div>"
        : "") +
      '<div class="kv" style="font-size:17px;font-weight:750">' +
        '<span class="kv-key" style="font-size:13px">Total</span>' +
        '<span class="kv-val num">' + money(total()) + " XP</span></div>";
    foot.appendChild(totals);

    var settle = UI.el("button", {
      class: "btn btn-primary btn-lg btn-block",
      html: Icon("check", 17) + '<span class="btn-label">Take payment</span>',
      disabled: !draft.lines.length
    });
    settle.addEventListener("click", settleDialog);
    foot.appendChild(settle);

    var saveLater = UI.el("button", {
      class: "btn btn-ghost btn-lg btn-block",
      html: Icon("clock", 17) + '<span class="btn-label">Save to bill — pay later</span>',
      disabled: !draft.lines.length
    });
    saveLater.addEventListener("click", function () {
      saveLater.disabled = true;
      saveForLater().finally(function () { saveLater.disabled = !draft.lines.length; });
    });
    foot.appendChild(saveLater);

    var clearBtn = UI.el("button", {
      class: "btn btn-ghost btn-sm btn-block",
      html: '<span class="btn-label">Clear ticket</span>',
      disabled: !draft.lines.length && !draft.customer
    });
    clearBtn.addEventListener("click", function () {
      UI.confirm({
        title: "Clear this ticket?",
        message: "Nothing has been billed yet, so nothing is recorded either way.",
        confirmLabel: "Clear", variant: "danger"
      }).then(function (ok) {
        if (!ok) return;
        draft = newDraft();
        codeState = null;
        renderTicket();
      });
    });
    foot.appendChild(clearBtn);
    host.appendChild(foot);

    var codeInput = codeRow.querySelector("#ctCode");
    var apply = function () { applyCode(codeInput.value.trim().toUpperCase()); };
    codeRow.querySelector("#ctApplyCode").addEventListener("click", apply);
    codeInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); apply(); }
    });

    /* The tiles show what is left AFTER this ticket, so they are stale the
       moment it changes. Repainted here rather than at each call site, so a
       future mutator cannot forget to. renderCatalogue never calls back into
       this function, so there is no loop. */
    renderCatalogue();
  }

  /* ==========================================================================
     CUSTOMER PICKER
     ========================================================================== */
  function customerPicker() {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="search">' + Icon("search", 15) +
        '<input class="input" id="ctCustSearch" placeholder="Name, mobile or email…" data-autofocus></div>' +
      '<div id="ctCustResults" style="max-height:280px;overflow:auto;' +
        'border:1px solid var(--line);border-radius:var(--r-md)"></div>';

    var dialog = UI.modal({
      title: "Find a customer",
      body: body,
      actions: [{ label: "Cancel", variant: "ghost" }]
    });

    var input = body.querySelector("#ctCustSearch");
    var results = body.querySelector("#ctCustResults");
    var timer = null;

    function search() {
      Store.getCustomers({ search: input.value.trim(), limit: 25 })
        .then(function (r) {
          UI.clear(results);
          var rows = r.data || [];
          if (!rows.length) {
            results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">' +
              "No customers match.</div>";
            return;
          }
          rows.forEach(function (c) {
            var row = UI.el("button", {
              type: "button", class: "kv",
              style: { width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }
            });
            row.innerHTML =
              '<span class="row gap-3" style="min-width:0">' +
                '<span class="avatar" style="width:26px;height:26px;font-size:10px">' +
                  UI.esc(UI.initials(c.customer_name)) + "</span>" +
                "<span style='min-width:0'>" +
                  '<span style="display:block;font-size:13px;font-weight:600">' +
                    UI.esc(c.customer_name) + "</span>" +
                  '<span class="faint" style="font-size:11px">' +
                    UI.esc(c.phone_number || c.email || "") + "</span>" +
                "</span></span>" +
              '<span class="num" style="font-weight:700">' +
                (c.wallet_balance === null ? "—" : money(c.wallet_balance)) + "</span>";
            row.addEventListener("click", function () {
              draft.customer = c;
              draft.guestName = "";
              dialog.close();
              revalidateCode();
              refreshMembership();
            });
            results.appendChild(row);
          });
        })
        .catch(function (e) {
          results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">' +
            UI.esc(e.message) + "</div>";
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
     GAMING TIME
     ========================================================================== */
  function gamingDialog() {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="ctgHours">Hours</label>' +
          '<input class="input" id="ctgHours" type="number" min="0.25" step="0.25" value="1" data-autofocus></div>' +
        '<div class="field"><label class="field-label" for="ctgRate">Rate per hour</label>' +
          '<input class="input" id="ctgRate" type="number" min="0" step="1" value="60"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="ctgLabel">Show on the bill as</label>' +
        '<input class="input" id="ctgLabel" value="Gaming time"></div>';

    return UI.modal({
      title: "Add gaming time",
      description: "For time taken at the counter rather than through a session.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add to ticket", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var hours = Number(ctx.body.querySelector("#ctgHours").value);
            var rate = Number(ctx.body.querySelector("#ctgRate").value);
            if (!Number.isFinite(hours) || hours <= 0) {
              Motion.shake(ctx.body.querySelector("#ctgHours"));
              return false;
            }
            addLine({
              item_type: "gaming",
              reference_id: null,
              description: (ctx.body.querySelector("#ctgLabel").value.trim() || "Gaming time") +
                " — " + hours + "h",
              quantity: 1,
              unit_price: Number((hours * rate).toFixed(2))
            });
            return true;
          }
        }
      ]
    });
  }

  /** A one-off line for anything the catalogue does not carry. */
  function customLineDialog() {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="ctxDesc">Description</label>' +
        '<input class="input" id="ctxDesc" placeholder="Headset deposit" data-autofocus></div>' +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="ctxQty">Quantity</label>' +
          '<input class="input" id="ctxQty" type="number" min="1" step="1" value="1"></div>' +
        '<div class="field"><label class="field-label field-req" for="ctxPrice">Unit price</label>' +
          '<input class="input" id="ctxPrice" type="number" min="0" step="0.01" value="0"></div>' +
      "</div>";

    return UI.modal({
      title: "Custom line",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add to ticket", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var desc = ctx.body.querySelector("#ctxDesc").value.trim();
            var price = Number(ctx.body.querySelector("#ctxPrice").value);
            if (!desc) { Motion.shake(ctx.body.querySelector("#ctxDesc")); return false; }
            if (!Number.isFinite(price) || price < 0) {
              Motion.shake(ctx.body.querySelector("#ctxPrice"));
              return false;
            }
            addLine({
              item_type: "other",
              reference_id: null,
              description: desc,
              quantity: Math.max(1, parseInt(ctx.body.querySelector("#ctxQty").value, 10) || 1),
              unit_price: Number(price.toFixed(2))
            });
            return true;
          }
        }
      ]
    });
  }

  /* ==========================================================================
     RENDER — CATALOGUE (left)
     ========================================================================== */
  /** One tile, whatever it is selling. */
  function tile(opts) {
    var node = UI.el("button", {
      type: "button",
      class: "ct-tile",
      disabled: !!opts.disabled,
      dataset: { status: opts.disabled ? "offline" : "accent" }
    });
    node.innerHTML =
      '<div class="ct-tile-name">' + UI.esc(opts.name) + "</div>" +
      '<div class="ct-tile-price">' + opts.price + "</div>" +
      (opts.flag ? '<div class="ct-tile-flag">' + opts.flag + "</div>" : "");
    if (!opts.disabled) {
      node.addEventListener("click", function () { opts.onPick(); Motion.pulse(node); });
    }
    return node;
  }

  function renderGaming(host, q) {
    var visible = rates.filter(function (r) {
      var cat = r.category || UNCATEGORISED;
      if (activeCategory && cat !== activeCategory) return false;
      if (!q) return true;
      return (r.software_name + " " + r.session_name).toLowerCase().indexOf(q) !== -1;
    });

    if (!visible.length) {
      host.className = "";
      host.appendChild(UI.emptyState({
        icon: "sessions",
        title: rates.length ? "Nothing matches" : "No gaming prices yet",
        text: rates.length
          ? "No rate matches the current filter."
          : "Set prices under Catalogue → Gaming Prices, then they appear here to tap.",
        actions: [{ label: "Gaming time", icon: "plus", variant: "primary", onClick: gamingDialog }]
      }));
      return;
    }

    host.className = "grid ct-products";
    visible.forEach(function (r) {
      host.appendChild(tile({
        name: r.software_name,
        price: global.CXRates.money(r.price, r.currency),
        flag: r.session_name + " · " + global.CXRates.durationText(r),
        onPick: function () {
          addLine({
            item_type: "gaming",
            reference_id: null,
            description: global.CXRates.billDescription(r),
            quantity: 1,
            unit_price: Number(r.price)
          });
        }
      }));
    });
  }

  function renderPackages(host, q) {
    var visible = packages.filter(function (p) {
      if (!q) return true;
      return (p.package_name || "").toLowerCase().indexOf(q) !== -1;
    });

    if (!visible.length) {
      host.className = "";
      host.appendChild(UI.emptyState({
        icon: "packages",
        title: packages.length ? "Nothing matches" : "No packages on sale",
        text: packages.length
          ? "No package matches the current filter."
          : "Create packages under Catalogue → Packages and switch them on sale."
      }));
      return;
    }

    host.className = "grid ct-products";
    visible.forEach(function (p) {
      var total = Number(p.units || 0) + Number(p.bonus_units || 0);
      host.appendChild(tile({
        name: p.package_name,
        price: money(p.price),
        flag: unitFlag(p.package_type, total) +
          (Number(p.bonus_units) > 0 ? " · incl. " + p.bonus_units + " free" : ""),
        onPick: function () {
          addLine({
            item_type: "other",
            reference_id: p.package_id,
            description: p.package_name,
            quantity: 1,
            unit_price: Number(p.price)
          });
        }
      }));
    });
  }

  /* Package units are counted in whatever the package is measured in, and
     saying "600 units" to a cashier means nothing. */
  function unitFlag(type, units) {
    if (type === "HOURS") {
      if (units % 60 === 0) return (units / 60) + (units === 60 ? " hour" : " hours");
      return units + " min";
    }
    if (type === "SESSIONS") return units + (units === 1 ? " session" : " sessions");
    return units + " XP coins";
  }

  function renderCatalogue() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#ctProducts");
    if (!host) return;
    UI.clear(host);

    var q = productQuery.trim().toLowerCase();

    if (activeSource === "gaming") return renderGaming(host, q);
    if (activeSource === "packages") return renderPackages(host, q);

    var visible = products.filter(function (p) {
      if (activeCategory && String(p.category_id) !== String(activeCategory)) return false;
      if (!q) return true;
      return (p.product_name || "").toLowerCase().indexOf(q) !== -1;
    });

    if (!visible.length) {
      host.className = "";
      host.appendChild(UI.emptyState({
        icon: "fnb",
        title: products.length ? "Nothing matches" : "No products yet",
        text: products.length
          ? "No product matches the current filter."
          : "Add food and drink under F&B, or use a custom line for one-offs.",
        actions: [{ label: "Custom line", icon: "plus", variant: "primary", onClick: customLineDialog }]
      }));
      return;
    }

    host.className = "grid ct-products";
    visible.forEach(function (p) {
      /* "Left" means left to sell, so it counts what this ticket already
         holds. Showing the raw shelf count while the ticket holds four of them
         is how a cashier ends up believing they can add a seventh. */
      var claimed = onTicket(p.product_id);
      var remaining = p.track_stock ? Number(p.stock_quantity) - claimed : null;
      var out = p.track_stock && Number(p.stock_quantity) <= 0;
      var spent = p.track_stock && !out && remaining <= 0;

      var tile = UI.el("button", {
        type: "button",
        class: "ct-tile",
        disabled: out || spent || p.is_available === false,
        dataset: { status: out || spent ? "offline" : "accent" }
      });
      tile.innerHTML =
        '<div class="ct-tile-name">' + UI.esc(p.product_name) + "</div>" +
        '<div class="ct-tile-price">' + money(p.price) + "</div>" +
        (out ? '<div class="ct-tile-flag">Out of stock</div>'
             : spent ? '<div class="ct-tile-flag">All ' + p.stock_quantity + " on the ticket</div>"
             : (p.track_stock
                ? '<div class="ct-tile-flag">' + remaining + " left" +
                  (claimed > 0 ? " \u00b7 " + claimed + " on ticket" : "") + "</div>"
                : ""));
      tile.addEventListener("click", function () {
        addLine({
          item_type: "fnb",
          reference_id: p.product_id,
          description: p.product_name,
          quantity: 1,
          unit_price: Number(p.price)
        });
        Motion.pulse(tile);
      });
      host.appendChild(tile);
    });
  }

  function renderSources() {
    var host = rootEl.querySelector("#ctSources");
    if (!host) return;
    UI.clear(host);

    SOURCES.forEach(function (s) {
      var btn = UI.el("button", {
        class: "chip", type: "button",
        html: Icon(s.icon, 14) + "<span>" + s.label + "</span>"
      });
      btn.setAttribute("aria-pressed", String(activeSource === s.id));
      btn.addEventListener("click", function () {
        if (activeSource === s.id) return;
        activeSource = s.id;
        /* A category from the previous source means nothing in this one —
           "Drinks" is not a kind of gaming. */
        activeCategory = "";
        loadExtras().then(function () {
          renderSources();
          renderCategories();
          renderCatalogue();
        });
      });
      host.appendChild(btn);
    });

    var search = rootEl.querySelector("#ctSearch");
    if (search) {
      search.placeholder = activeSource === "gaming" ? "Search gaming rates…"
        : activeSource === "packages" ? "Search packages…"
        : "Search products…";
    }
  }

  function renderCategories() {
    var host = rootEl.querySelector("#ctCategories");
    if (!host) return;
    UI.clear(host);

    /* Packages are a short flat list; chips would be furniture. */
    if (activeSource === "packages") {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");

    var chips = activeSource === "gaming"
      ? rateCategories.map(function (c) { return { key: c, label: c }; })
      : categories.map(function (c) {
          return { key: String(c.category_id), label: c.category_name };
        });

    /* One category is no choice at all — everything is already in it. The
       gaming row stays regardless, because it also carries "Edit tabs", and
       one wrong tab is exactly when somebody needs to reach it. */
    var showFilters = chips.length >= 2;
    if (!showFilters && activeSource !== "gaming") { host.classList.add("hidden"); return; }

    if (showFilters) {
      var all = UI.el("button", { class: "chip", type: "button", text: "All" });
      all.setAttribute("aria-pressed", String(!activeCategory));
      all.addEventListener("click", function () {
        activeCategory = ""; renderCategories(); renderCatalogue();
      });
      host.appendChild(all);
    }

    (showFilters ? chips : []).forEach(function (c) {
      var chip = UI.el("button", { class: "chip", type: "button", text: c.label });
      chip.setAttribute("aria-pressed", String(activeCategory === c.key));
      chip.addEventListener("click", function () {
        activeCategory = c.key;
        renderCategories();
        renderCatalogue();
      });
      host.appendChild(chip);
    });

    /* Gaming tabs are editable from here. Which tab a game sits under is how
       this till is laid out, and the person who knows it is wrong is the one
       standing at it — not somebody in another application. */
    if (activeSource === "gaming") {
      var edit = UI.el("button", {
        class: "chip", type: "button",
        html: Icon("edit", 13) + "<span>Edit tabs</span>"
      });
      edit.addEventListener("click", categoryDialog);
      host.appendChild(edit);
    }
  }

  /*
   * Rename the tabs by refiling the games behind them.
   *
   * There is no category record to rename: a category exists exactly as long
   * as a game says it belongs to one. So this edits the games, and the tabs
   * follow. Typing the same new name on several rows merges them; clearing a
   * row drops that game to the uncategorised tab.
   */
  function categoryDialog() {
    /* One row per game, not per rate — a game has one category however many
       durations are priced against it. */
    var seen = {};
    var items = [];
    rates.forEach(function (r) {
      if (seen[r.software_id]) return;
      seen[r.software_id] = true;
      items.push({ id: r.software_id, name: r.software_name, category: r.category || "" });
    });
    items.sort(function (a, b) { return a.name.localeCompare(b.name); });

    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="notice" data-status="idle">' + Icon("info", 16) +
        "<div>Give games the same category to put them on the same tab. " +
        "Leave one blank and it moves to " + UI.esc(UNCATEGORISED) + ".</div></div>" +
      '<datalist id="ctCatList">' +
        rateCategories.filter(function (c) { return c !== UNCATEGORISED; })
          .map(function (c) { return '<option value="' + UI.esc(c) + '"></option>'; })
          .join("") +
      "</datalist>";

    items.forEach(function (it) {
      var row = UI.el("div", { class: "field" });
      row.innerHTML =
        '<label class="field-label" for="cc' + it.id + '">' + UI.esc(it.name) + "</label>" +
        '<input class="input" id="cc' + it.id + '" list="ctCatList" maxlength="60" ' +
          'value="' + UI.esc(it.category) + '" placeholder="uncategorised">';
      body.appendChild(row);
    });

    return UI.modal({
      title: "Edit gaming tabs",
      description: "The tabs come from the games themselves.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save", variant: "primary", icon: "check",
          onClick: function (ctx) {
            /* Only what actually changed goes to the server. Rewriting every
               row on every save would bump timestamps on games nobody
               touched. */
            var changed = items.filter(function (it) {
              var el = ctx.body.querySelector("#cc" + it.id);
              return el && el.value.trim() !== it.category;
            });
            if (!changed.length) return true;

            return Promise.all(changed.map(function (it) {
              return Store.setSoftwareCategory(
                it.id, ctx.body.querySelector("#cc" + it.id).value.trim()
              );
            }))
              .then(function () {
                UI.toast.ok("Tabs updated",
                  changed.length === 1 ? changed[0].name
                    : changed.length + " games refiled");
                /* Forces the rate card and its tabs to be rebuilt. */
                extrasLoaded = false;
                activeCategory = "";
                return loadExtras();
              })
              .then(function () {
                renderCategories();
                renderCatalogue();
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not save", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* Rates and packages are fetched the first time one of those tabs is opened
     rather than on mount: the till is opened all day to sell a coffee, and
     three requests where one would do is three chances to be slow at the
     counter. */
  function loadExtras() {
    if (extrasLoaded || activeSource === "products") return Promise.resolve();
    extrasLoaded = true;
    return Promise.all([
      global.CXRates.list().catch(function () { return []; }),
      Store.listPackages({ status: "ACTIVE", limit: 200 }).catch(function () { return { data: [] }; })
    ]).then(function (res) {
      rates = res[0];
      packages = res[1].data || [];

      /* Built from the rates actually on offer rather than from the category
         endpoint, so a category whose games are all unpriced does not appear
         as a chip that filters to an empty grid. */
      var seen = {};
      rates.forEach(function (r) { seen[r.category || UNCATEGORISED] = true; });
      rateCategories = Object.keys(seen).sort(function (a, b) {
        if (a === UNCATEGORISED) return 1;      // uncategorised sorts last
        if (b === UNCATEGORISED) return -1;
        return a.localeCompare(b);
      });
    });
  }

  function load() {
    return Promise.all([
      Store.listProducts({ limit: 200 }).catch(function () { return { data: [] }; }),
      Store.listProductCategories().catch(function () { return { data: [] }; })
    ]).then(function (res) {
      products = (res[0].data || []).filter(function (p) { return p.status !== 'ARCHIVED'; });
      categories = res[1].data || [];
      renderSources();
      renderCategories();
      renderCatalogue();
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  /*
   * Registered as a sub-view rather than a page of its own: the till and the
   * bill list are two halves of one job, and a cashier moving between them
   * should not be navigating. app/pages/billing-desk.js hosts both.
   *
   * Its own page-head is gone; the host renders one, and the two actions that
   * belonged to it are handed up through ctx.actions.
   */
  /**
   * Open the till with a running session's customer already on the ticket.
   * Called from the floor and the session list — "they want a burger".
   */
  global.CXOpenTillForSession = function (session) {
    pendingAttach = session;
    global.CXRouter.go("billing");
  };

  global.CXPages._till = {
    title: "Counter",
    subtitle: "Take payment at the till",

    mount: function (root, ctx) {
      rootEl = root;
      draft = newDraft();
      codeState = null;
      bill = null;

      /* Opened from a running session — food and drink for someone already
         playing. The customer and the session come with it, so the ticket
         settles as one bill with their gaming time rather than as a separate
         sale nobody can connect to them afterwards. */
      if (pendingAttach) {
        var s = pendingAttach;
        pendingAttach = null;
        draft.sessionId = s.session_id;
        if (s.customer_id) {
          draft.customer = { customer_id: s.customer_id, customer_name: s.customer_name };
        } else {
          draft.guestName = s.guest_name || s.customer_name || "";
        }
        UI.toast.info("Adding to " + s.pc_name,
          (s.customer_name || "Guest") + "'s ticket — settles with their session.");
        refreshMembership();
      }

      // Fetched now so it is already known by the time a sale is settled.
      loadPoweredByPref();

      var page = UI.el("div", { class: "page ct-page" });
      page.innerHTML =
        '<div class="ct-layout">' +
          '<div class="col gap-4" style="min-width:0">' +
            '<div class="toolbar" style="margin:0">' +
              '<div class="search grow">' + Icon("search", 15) +
                '<input class="input" id="ctSearch" type="search" placeholder="Search products…" autocomplete="off"></div>' +
            "</div>" +
            '<div class="row gap-2 wrap" id="ctSources"></div>' +
            '<div class="row gap-2 wrap" id="ctCategories"></div>' +
            '<div id="ctProducts" class="grid ct-products"></div>' +
          "</div>" +
          '<aside class="ct-ticket col gap-4" id="ctTicket"></aside>' +
        "</div>";
      root.appendChild(page);

      /* The host's action bar, if there is one. Falls back to nothing rather
         than breaking when mounted standalone. */
      var actions = ctx && ctx.actions;
      if (actions) {
        actions.appendChild(UI.el("button", {
          class: "btn btn-outline", type: "button",
          html: Icon("sessions", 15) + '<span class="btn-label">Gaming time</span>',
          onClick: gamingDialog
        }));
        actions.appendChild(UI.el("button", {
          class: "btn btn-outline", type: "button",
          html: Icon("plus", 15) + '<span class="btn-label">Custom line</span>',
          onClick: customLineDialog
        }));
      }

      var search = page.querySelector("#ctSearch");
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          productQuery = search.value;
          renderCatalogue();
        }, 160);
      });

      renderTicket();
      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
      draft = null;
    }
  };
})(window);
