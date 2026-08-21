/* ==========================================================================
   CafeXP Admin — Discount codes
   Codes the counter can accept. Each is open to anyone, restricted to a
   membership tier, or locked to named customers — and every redemption is
   recorded, so "who used this" always has an answer.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var codes = [];
  var loading = false;
  var loadError = null;
  var filter = "";
  var searchTimer = null;

  var AUDIENCE_LABEL = { public: "Anyone", tier: "Members", customers: "Named customers" };
  var STATUS_STATUS = { ACTIVE: "online", PAUSED: "warning", EXPIRED: "idle" };

  function money(value) {
    var n = Number(value || 0);
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: Math.round(n * 100) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return n.toFixed(2); }
  }

  /** "20% off, up to 100" / "50 off" — the value in one readable phrase. */
  function valueLabel(code) {
    if (code.discount_type === "percent") {
      return code.value + "% off" +
        (code.max_discount ? ", up to " + money(code.max_discount) : "");
    }
    return money(code.value) + " off";
  }

  function load() {
    loading = true;
    loadError = null;
    render();
    return Store.listDiscounts({ search: filter })
      .then(function (list) { codes = list; loading = false; render(); })
      .catch(function (err) { loading = false; loadError = err.message; render(); });
  }

  /* ==========================================================================
     FORM
     ========================================================================== */
  function codeForm() {
    var audience = "public";
    var chosen = [];   // named customers

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="dcCode">Code</label>' +
          '<input class="input mono" id="dcCode" placeholder="WELCOME20" ' +
            'style="text-transform:uppercase" data-autofocus>' +
          '<div class="field-hint">What the customer says at the counter.</div></div>' +
        '<div class="field"><label class="field-label" for="dcDesc">Description</label>' +
          '<input class="input" id="dcDesc" placeholder="20% off, first visit"></div>' +
      "</div>" +

      '<div class="field"><label class="field-label">Takes off</label>' +
        '<div class="segmented" id="dcType" style="width:100%">' +
          '<button type="button" data-type="percent" aria-selected="true" style="flex:1">A percentage</button>' +
          '<button type="button" data-type="amount" aria-selected="false" style="flex:1">A fixed amount</button>' +
        "</div></div>" +

      '<div class="grid grid-3" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="dcValue">Value</label>' +
          '<input class="input" id="dcValue" type="number" min="0.01" step="1" value="10"></div>' +
        '<div class="field"><label class="field-label" for="dcMax">Cap</label>' +
          '<input class="input" id="dcMax" type="number" min="0" step="1" placeholder="No cap">' +
          '<div class="field-hint">Most a percentage may take.</div></div>' +
        '<div class="field"><label class="field-label" for="dcMin">Minimum bill</label>' +
          '<input class="input" id="dcMin" type="number" min="0" step="1" value="0"></div>' +
      "</div>" +

      '<div class="field"><label class="field-label">Who can use it</label>' +
        '<div class="segmented" id="dcAudience" style="width:100%">' +
          '<button type="button" data-aud="public" aria-selected="true" style="flex:1">Anyone</button>' +
          '<button type="button" data-aud="tier" aria-selected="false" style="flex:1">A membership tier</button>' +
          '<button type="button" data-aud="customers" aria-selected="false" style="flex:1">Named customers</button>' +
        "</div></div>" +

      '<div class="field hidden" id="dcTierPane">' +
        '<label class="field-label field-req" for="dcTier">Tier</label>' +
        '<input class="input" id="dcTier" placeholder="GOLD" style="text-transform:uppercase">' +
        '<div class="field-hint">Matched against the tier on their live membership plan.</div></div>' +

      '<div class="field hidden" id="dcCustPane">' +
        '<label class="field-label field-req">Customers</label>' +
        '<button type="button" class="btn btn-outline btn-block" id="dcAddCust">Choose customers</button>' +
        '<div class="col gap-2" id="dcCustList" style="margin-top:var(--s-2)"></div></div>' +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="dcTotalLimit">Total redemptions</label>' +
          '<input class="input" id="dcTotalLimit" type="number" min="1" step="1" placeholder="Unlimited"></div>' +
        '<div class="field"><label class="field-label" for="dcPerLimit">Per customer</label>' +
          '<input class="input" id="dcPerLimit" type="number" min="1" step="1" value="1"></div>' +
      "</div>" +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="dcStarts">Starts</label>' +
          '<input class="input" id="dcStarts" type="date"></div>' +
        '<div class="field"><label class="field-label" for="dcExpires">Expires</label>' +
          '<input class="input" id="dcExpires" type="date"></div>' +
      "</div>";

    var type = "percent";
    UI.$$("#dcType button", body).forEach(function (btn) {
      btn.addEventListener("click", function () {
        type = btn.dataset.type;
        UI.$$("#dcType button", body).forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        // A cap only means anything for a percentage.
        body.querySelector("#dcMax").disabled = type === "amount";
      });
    });

    UI.$$("#dcAudience button", body).forEach(function (btn) {
      btn.addEventListener("click", function () {
        audience = btn.dataset.aud;
        UI.$$("#dcAudience button", body).forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        body.querySelector("#dcTierPane").classList.toggle("hidden", audience !== "tier");
        body.querySelector("#dcCustPane").classList.toggle("hidden", audience !== "customers");
      });
    });

    function paintChosen() {
      var host = body.querySelector("#dcCustList");
      UI.clear(host);
      chosen.forEach(function (c, i) {
        var row = UI.el("div", { class: "kv row-between" });
        row.innerHTML = "<span style='font-size:12px'>" + UI.esc(c.customer_name) +
          '<span class="faint" style="font-size:10px;margin-left:6px">' +
          UI.esc(c.phone_number || "") + "</span></span>";
        var del = UI.el("button", {
          class: "btn btn-ghost btn-sm btn-icon", html: Icon("close", 12)
        });
        del.addEventListener("click", function () { chosen.splice(i, 1); paintChosen(); });
        row.appendChild(del);
        host.appendChild(row);
      });
    }

    body.querySelector("#dcAddCust").addEventListener("click", function () {
      customerPicker(function (c) {
        if (!chosen.some(function (x) { return x.customer_id === c.customer_id; })) chosen.push(c);
        paintChosen();
      });
    });

    return UI.modal({
      title: "New discount code",
      description: "Codes are matched without case, so WELCOME20 and welcome20 are the same code.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Create code", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var code = ctx.body.querySelector("#dcCode").value.trim().toUpperCase();
            if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) {
              Motion.shake(ctx.body.querySelector("#dcCode"));
              UI.toast.warn("3–40 characters", "Letters, numbers, dashes or underscores.");
              return false;
            }
            var value = Number(ctx.body.querySelector("#dcValue").value);
            if (!Number.isFinite(value) || value <= 0) {
              Motion.shake(ctx.body.querySelector("#dcValue"));
              return false;
            }
            if (type === "percent" && value > 100) {
              Motion.shake(ctx.body.querySelector("#dcValue"));
              UI.toast.warn("A percentage cannot exceed 100");
              return false;
            }
            if (audience === "tier" && !ctx.body.querySelector("#dcTier").value.trim()) {
              Motion.shake(ctx.body.querySelector("#dcTier"));
              UI.toast.warn("Name the tier this code is for");
              return false;
            }
            if (audience === "customers" && !chosen.length) {
              UI.toast.warn("Choose at least one customer");
              return false;
            }

            var maxRaw = ctx.body.querySelector("#dcMax").value;
            var totalRaw = ctx.body.querySelector("#dcTotalLimit").value;

            return Store.createDiscount({
              code: code,
              description: ctx.body.querySelector("#dcDesc").value.trim() || null,
              discount_type: type,
              value: value,
              max_discount: type === "percent" && maxRaw ? Number(maxRaw) : null,
              min_bill_amount: Number(ctx.body.querySelector("#dcMin").value) || 0,
              audience: audience,
              tier: audience === "tier"
                ? ctx.body.querySelector("#dcTier").value.trim().toUpperCase() : null,
              customer_ids: chosen.map(function (c) { return c.customer_id; }),
              total_limit: totalRaw ? parseInt(totalRaw, 10) : null,
              per_customer_limit: parseInt(ctx.body.querySelector("#dcPerLimit").value, 10) || 1,
              starts_at: ctx.body.querySelector("#dcStarts").value || null,
              expires_at: ctx.body.querySelector("#dcExpires").value || null
            })
              .then(function (r) { UI.toast.ok(r.message); return load(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not create", err.message); return false; });
          }
        }
      ]
    });
  }

  function customerPicker(onPick) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="search">' + Icon("search", 15) +
        '<input class="input" id="dcpSearch" placeholder="Name, mobile or email…" data-autofocus></div>' +
      '<div id="dcpResults" style="max-height:260px;overflow:auto;' +
        'border:1px solid var(--line);border-radius:var(--r-md)"></div>';

    var dialog = UI.modal({
      title: "Choose customers",
      description: "Pick as many as you like — the dialog stays open.",
      body: body,
      actions: [{ label: "Done", variant: "primary" }]
    });

    var input = body.querySelector("#dcpSearch");
    var results = body.querySelector("#dcpResults");
    var timer = null;

    function search() {
      Store.getCustomers({ search: input.value.trim(), limit: 25 }).then(function (r) {
        UI.clear(results);
        (r.data || []).forEach(function (c) {
          var row = UI.el("button", {
            type: "button", class: "kv",
            style: { width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }
          });
          row.innerHTML = "<span style='font-size:13px;font-weight:600'>" +
            UI.esc(c.customer_name) + '</span><span class="faint" style="font-size:11px">' +
            UI.esc(c.phone_number || c.email || "") + "</span>";
          row.addEventListener("click", function () {
            onPick(c);
            UI.toast.ok("Added " + c.customer_name);
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
     REDEMPTIONS
     ========================================================================== */
  function redemptionsDialog(code) {
    var body = UI.el("div", { class: "col gap-3" });
    body.appendChild(UI.skeletonRows(4));

    var dialog = UI.modal({
      title: "Redemptions — " + code.code,
      description: code.redemptions + " use(s), " + money(code.redeemed_total) + " XP given away",
      size: "lg",
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });

    Store.discountRedemptions(code.code_id).then(function (rows) {
      UI.clear(body);
      if (!rows.length) {
        body.appendChild(UI.emptyState({
          icon: "billing",
          title: "Not used yet",
          text: "This code has never been redeemed."
        }));
        return;
      }
      var table = UI.el("table", { class: "tbl" });
      table.innerHTML = "<thead><tr><th>When</th><th>Customer</th><th>Bill</th>" +
        '<th class="td-num">Off</th><th>By</th></tr></thead>';
      var tbody = UI.el("tbody");
      rows.forEach(function (r) {
        var tr = UI.el("tr");
        tr.innerHTML =
          "<td>" + UI.esc(UI.relTime(r.created_at)) + "</td>" +
          "<td>" + UI.esc(r.customer_name || "Guest") + "</td>" +
          '<td class="mono" style="font-size:11px">' + UI.esc(r.bill_number || "—") + "</td>" +
          '<td class="td-num">' + money(r.amount) + "</td>" +
          '<td class="faint" style="font-size:11px">' + UI.esc(r.redeemed_by || "—") + "</td>";
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      var wrap = UI.el("div", { class: "table-wrap" });
      wrap.appendChild(table);
      body.appendChild(wrap);
    }).catch(function (e) {
      UI.clear(body);
      body.appendChild(UI.errorState(e.message));
    });

    return dialog;
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#dcBody");
    if (!host) return;
    UI.clear(host);

    if (loading && !codes.length) { host.appendChild(UI.skeletonRows(5)); return; }
    if (loadError) {
      host.appendChild(UI.errorState(
        loadError.indexOf("does not allow") !== -1
          ? "Your role does not allow you to manage discount codes."
          : loadError,
        load
      ));
      return;
    }

    if (!codes.length) {
      host.appendChild(UI.emptyState({
        icon: "billing",
        status: "accent",
        title: filter ? "No codes match" : "No discount codes yet",
        text: filter
          ? "Nothing matches that search."
          : "Create a code the counter can accept — open to anyone, limited to a " +
            "membership tier, or locked to specific customers.",
        actions: [{ label: "New code", icon: "plus", variant: "primary", onClick: codeForm }]
      }));
      return;
    }

    var grid = UI.el("div", { class: "grid grid-3", style: { padding: "var(--s-5)" } });

    codes.forEach(function (code) {
      var card = UI.el("div", {
        class: "card card-pad col gap-3",
        dataset: { status: STATUS_STATUS[code.status] || "idle" }
      });

      var used = code.total_limit
        ? code.redemptions + " of " + code.total_limit + " used"
        : code.redemptions + " use" + (code.redemptions === 1 ? "" : "s");

      card.innerHTML =
        '<div class="row-between" style="align-items:flex-start">' +
          "<div style='min-width:0'>" +
            '<div class="mono" style="font-size:17px;font-weight:800;letter-spacing:0.02em">' +
              UI.esc(code.code) + "</div>" +
            (code.description
              ? '<div class="faint" style="font-size:11px;margin-top:2px">' +
                UI.esc(code.description) + "</div>"
              : "") +
          "</div>" +
          '<span class="badge">' + UI.esc(code.status) + "</span>" +
        "</div>" +

        '<div style="font-size:20px;font-weight:750;color:var(--accent-hot)">' +
          UI.esc(valueLabel(code)) + "</div>" +

        '<div class="col gap-1">' +
          '<div class="kv"><span class="kv-key">Who</span><span class="kv-val">' +
            UI.esc(AUDIENCE_LABEL[code.audience]) +
            (code.audience === "tier" ? " · " + UI.esc(code.tier) : "") +
            (code.audience === "customers" && code.customers
              ? " · " + code.customers.length : "") + "</span></div>" +
          (code.min_bill_amount > 0
            ? '<div class="kv"><span class="kv-key">Minimum bill</span><span class="kv-val">' +
              money(code.min_bill_amount) + "</span></div>"
            : "") +
          '<div class="kv"><span class="kv-key">Used</span><span class="kv-val">' + used + "</span></div>" +
          (code.expires_at
            ? '<div class="kv"><span class="kv-key">Expires</span><span class="kv-val">' +
              UI.esc(UI.fmtDate(code.expires_at)) + "</span></div>"
            : "") +
        "</div>";

      var actions = UI.el("div", {
        class: "row gap-2", style: { marginTop: "auto", paddingTop: "var(--s-4)" }
      });

      var usesBtn = UI.el("button", {
        class: "btn btn-outline btn-sm grow",
        html: Icon("logs", 13) + '<span class="btn-label">Redemptions</span>'
      });
      usesBtn.addEventListener("click", function () { redemptionsDialog(code); });
      actions.appendChild(usesBtn);

      var next = code.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
      var toggle = UI.el("button", {
        class: "btn btn-sm btn-icon " + (code.status === "ACTIVE" ? "btn-warn" : "btn-ok"),
        html: Icon(code.status === "ACTIVE" ? "pause" : "play", 13),
        "data-tip": code.status === "ACTIVE" ? "Pause — the counter stops accepting it" : "Reactivate"
      });
      toggle.addEventListener("click", function () {
        Store.setDiscountStatus(code.code_id, next)
          .then(function (r) { UI.toast.ok(r.message); return load(); })
          .catch(function (e) { UI.toast.error("Could not update", e.message); });
      });
      actions.appendChild(toggle);

      var del = UI.el("button", {
        class: "btn btn-danger btn-sm btn-icon",
        html: Icon("trash", 13),
        "data-tip": code.redemptions ? "Used codes cannot be deleted" : "Delete"
      });
      del.addEventListener("click", function () {
        UI.confirm({
          title: "Delete " + code.code + "?",
          message: code.redemptions
            ? "This code has been used, so deleting it would break the bills it is on. " +
              "The server will refuse — pause or expire it instead."
            : "This code has never been used, so nothing depends on it.",
          confirmLabel: "Delete", variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.deleteDiscount(code.code_id)
            .then(function (r) { UI.toast.ok(r.message); return load(); })
            .catch(function (e) { UI.toast.error("Could not delete", e.message); });
        });
      });
      actions.appendChild(del);

      card.appendChild(actions);
      grid.appendChild(card);
    });

    host.appendChild(grid);
    Motion.stagger(grid.children, { step: 0.04, y: 12 });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.discounts = {
    title: "Discount Codes",
    subtitle: "Promotions and member perks",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Discount Codes</div>' +
          '<div class="page-sub">What the counter may take off a bill, and who is allowed to use it. ' +
            "Every redemption is recorded against the customer and the bill.</div>" +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="dcRefresh">' + Icon("refresh", 15) +
            '<span class="btn-label">Refresh</span></button>' +
          '<button class="btn btn-primary" id="dcNew">' + Icon("plus", 15) +
            '<span class="btn-label">New code</span></button>' +
        "</div></div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:300px">' + Icon("search", 15) +
            '<input class="input" id="dcSearch" type="search" placeholder="Search codes…" autocomplete="off"></div>' +
        "</div>" +
        '<div class="card card-body-flush" id="dcBody"></div>';
      root.appendChild(page);

      page.querySelector("#dcNew").addEventListener("click", codeForm);

      var refreshBtn = page.querySelector("#dcRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      var search = page.querySelector("#dcSearch");
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { filter = search.value.trim(); load(); }, 250);
      });

      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
    }
  };
})(window);
