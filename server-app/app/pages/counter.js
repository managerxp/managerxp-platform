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
    return { customer: null, guestName: "", sessionId: null, lines: [], note: "" };
  }

  function subtotal() {
    return draft.lines.reduce(function (sum, l) {
      return sum + Number(l.quantity) * Number(l.unit_price);
    }, 0);
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

  /**
   * Create the bill, apply the code, take the tenders. The bill is only
   * written at this point, so an abandoned ticket never leaves a stray record.
   */
  function finalise(tenders) {
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

    return Store.createBill(payload)
      .then(function (r) {
        bill = r.data;
        if (!codeState || !codeState.code) return null;
        return Store.applyBillCode(bill.bill_id, codeState.code.code).then(function (applied) {
          // The code was checked a moment ago, but state can move — if the
          // server refuses now, settle without it rather than fail the sale.
          if (applied.success) bill = applied.data;
          else UI.toast.warn("Code not applied", applied.message);
          return null;
        });
      })
      .then(function () {
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

  /* ==========================================================================
     RECEIPT
     ========================================================================== */
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
        renderTicket();
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
      var row = UI.el("div", { class: "kv row-between" });
      row.innerHTML =
        "<span style='min-width:0'>" +
          '<span style="display:block;font-size:13px;font-weight:600">' + UI.esc(line.description) + "</span>" +
          '<span class="faint" style="font-size:10px">' + money(line.unit_price) + " each</span>" +
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
        text: money(line.quantity * line.unit_price)
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
              renderTicket();
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
  function renderCatalogue() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#ctProducts");
    if (!host) return;
    UI.clear(host);

    var q = productQuery.trim().toLowerCase();
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

  function renderCategories() {
    var host = rootEl.querySelector("#ctCategories");
    if (!host) return;
    UI.clear(host);

    var all = UI.el("button", { class: "chip", text: "All" });
    all.setAttribute("aria-pressed", String(!activeCategory));
    all.addEventListener("click", function () { activeCategory = ""; renderCategories(); renderCatalogue(); });
    host.appendChild(all);

    categories.forEach(function (c) {
      var chip = UI.el("button", { class: "chip", text: c.category_name });
      chip.setAttribute("aria-pressed", String(String(activeCategory) === String(c.category_id)));
      chip.addEventListener("click", function () {
        activeCategory = c.category_id;
        renderCategories();
        renderCatalogue();
      });
      host.appendChild(chip);
    });
  }

  function load() {
    return Promise.all([
      Store.listProducts({ limit: 200 }).catch(function () { return { data: [] }; }),
      Store.listProductCategories().catch(function () { return { data: [] }; })
    ]).then(function (res) {
      products = (res[0].data || []).filter(function (p) { return p.status !== 'ARCHIVED'; });
      categories = res[1].data || [];
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
  global.CXPages._till = {
    title: "Counter",
    subtitle: "Take payment at the till",

    mount: function (root, ctx) {
      rootEl = root;
      draft = newDraft();
      codeState = null;
      bill = null;

      var page = UI.el("div", { class: "page ct-page" });
      page.innerHTML =
        '<div class="ct-layout">' +
          '<div class="col gap-4" style="min-width:0">' +
            '<div class="toolbar" style="margin:0">' +
              '<div class="search grow">' + Icon("search", 15) +
                '<input class="input" id="ctSearch" type="search" placeholder="Search products…" autocomplete="off"></div>' +
            "</div>" +
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
