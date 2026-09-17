/* ==========================================================================
   Receipt HTML — the one place a bill becomes the printed page.

   billing.js (session bills) and counter.js (counter/POS sales) both print
   rows from the same `bills` table, through the same Receipt Template
   settings (app/pages/receipt-template.js) — they used to build this HTML
   independently, and only the billing.js copy actually read every setting.
   One function now, called from both, so there is exactly one place that
   can drift from what the settings page promises.
   ========================================================================== */
(function (global) {
  "use strict";

  function money(n) { return Number(n || 0).toFixed(2); }

  var WIDTH_CLASS = { "58mm": "rt-58mm", "80mm": "rt-80mm", "a4": "rt-a4" };
  /* Same token the settings-page preview already uses (receipt-template.js) —
     reused here rather than invented fresh, and now styled for the real
     `.receipt` element too (see pages.css), not just its preview. */
  function widthClass(identity) {
    var key = (identity && identity["billing.receipt_width"]) || "80mm";
    return WIDTH_CLASS[key] || "rt-80mm";
  }

  /**
   * buildHtml(bill, identity)
   *   bill      a shaped row from the backend's `bills` table — the same
   *             shape whether it came back from createBill, payBill, or the
   *             Billing page's list (a session bill and a counter sale are
   *             both just `bills` rows; nothing here is billing.js-specific)
   *   identity  the café's `billing.*` settings, flattened to { key: value }
   *             (Store.getSettings("billing")) — caching that fetch is the
   *             caller's job, not this one's
   */
  function buildHtml(bill, identity) {
    var UI = global.CXUI;
    var id = identity || {};
    var refunds = (bill.payments || []).filter(function (p) { return p.amount < 0; });
    var tenders = (bill.payments || []).filter(function (p) { return p.amount > 0; });

    var brand = (id["billing.business_name"] || "").trim() ||
                (global.CXStore && global.CXStore.state.user && global.CXStore.state.user.cafe_name) || "CafeXP";

    var shown = String(id["billing.receipt_show"] ||
      "logo,address,phone,tax_number,cashier,customer,footer").split(",");
    var show = function (b) { return shown.indexOf(b) !== -1; };
    var taxLabel = (id["billing.tax_label"] || "GST").trim() || "GST";
    var taxPercent = Number(id["billing.tax_percent"] || 0) || 0;
    var taxInclusive = String(id["billing.tax_inclusive"]) === "true";

    return '<div class="receipt ' + widthClass(id) + '">' +
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
              UI.esc([id["billing.phone"], id["billing.email"]].filter(Boolean).join(" · ")) +
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
          (bill.items || []).map(function (i) {
            return '<div class="receipt-line"><span>' + UI.esc(i.description) +
              (i.quantity > 1 ? " &times;" + i.quantity : "") + "</span><span>" + money(i.amount) + "</span></div>";
          }).join("") +
        "</div>" +
        '<div class="receipt-lines">' +
          '<div class="receipt-line"><span>Subtotal</span><span>' + money(bill.subtotal) + "</span></div>" +
          (bill.discount > 0
            ? '<div class="receipt-line"><span>' + UI.esc(bill.discount_reason || "Discount") +
              "</span><span>&minus;" + money(bill.discount) + "</span></div>"
            : "") +
          (bill.tax > 0
            ? '<div class="receipt-line"><span>' + UI.esc(taxLabel) +
              (taxPercent > 0 ? " " + taxPercent + "%" : "") +
              (taxInclusive ? " (included)" : "") +
              "</span><span>" + money(bill.tax) + "</span></div>"
            : "") +
        "</div>" +
        '<div class="receipt-total"><span>Total</span><span>' + money(bill.total) + " XP</span></div>" +
        '<div class="receipt-lines">' +
          tenders.map(function (p) {
            return '<div class="receipt-line"><span>' + UI.esc(p.method) +
              (p.reference ? " &middot; " + UI.esc(p.reference) : "") + "</span><span>" + money(p.amount) + "</span></div>";
          }).join("") +
        "</div>" +
        (refunds.length
          ? '<div class="receipt-lines">' + refunds.map(function (p) {
              return '<div class="receipt-line"><span>Refund &middot; ' + UI.esc(p.method) +
                "</span><span>" + money(p.amount) + "</span></div>";
            }).join("") + "</div>"
          : "") +
        '<div class="receipt-foot">' +
          (bill.balance_due > 0
            ? money(bill.balance_due) + " XP outstanding"
            : UI.esc(id["billing.receipt_footer"] || "Thank you — see you next time")) +
        "</div>" +
        /* Absent only when the café has explicitly removed it on the Receipt
           Template page — a café that has never opened that editor still
           gets the mark, which is why the test is against "false" rather
           than for "true". */
        (String(id["billing.receipt_powered_by"]) !== "false"
          ? '<div class="receipt-powered">Powered by ManagerXP</div>' : "") +
      "</div>";
  }

  global.CXReceipt = { buildHtml: buildHtml, widthClass: widthClass, money: money };
})(window);
