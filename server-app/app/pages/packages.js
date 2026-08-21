/* ==========================================================================
   CafeXP Admin — Packages & Memberships
   Two master screens sharing one module: prepaid bundles, and recurring tiers.
   Both sell to a customer, raise a bill and settle from the wallet.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  function coins(value) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return whole ? String(Math.round(n)) : n.toFixed(2); }
  }

  /** Units read as time for HOURS packages and as coins otherwise. */
  function unitLabel(type, units) {
    if (type === "HOURS") {
      var m = Number(units);
      if (m < 60) return m + " min";
      var h = Math.floor(m / 60), rem = Math.round(m % 60);
      return h + "h" + (rem ? " " + rem + "m" : "");
    }
    if (type === "SESSIONS") return coins(units) + " sessions";
    return coins(units) + " XP";
  }

  /* ==========================================================================
     SHARED — pick a customer
     ========================================================================== */
  function customerPicker(container, onPick) {
    var chosen = null;
    var timer = null;
    container.innerHTML =
      '<div class="search">' + Icon("search", 15) +
        '<input class="input" data-cust-search placeholder="Search name, mobile or email…" autocomplete="off" data-autofocus>' +
      "</div>" +
      '<div data-cust-results style="max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-md);margin-top:var(--s-3)"></div>';

    var input = container.querySelector("[data-cust-search]");
    var results = container.querySelector("[data-cust-results]");

    function search() {
      Store.getCustomers({ search: input.value.trim(), limit: 20 })
        .then(function (body) {
          UI.clear(results);
          var rows = body.data || [];
          if (!rows.length) {
            results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">No customers match.</div>';
            return;
          }
          rows.forEach(function (c) {
            var row = UI.el("button", {
              type: "button", class: "kv",
              style: { width: "100%", padding: "10px var(--s-4)", border: 0, background: "transparent", textAlign: "left" }
            });
            row.innerHTML =
              '<span class="row gap-3" style="min-width:0">' +
                '<span class="avatar" style="width:26px;height:26px;font-size:10px">' +
                  UI.esc(UI.initials(c.customer_name)) + "</span>" +
                "<span style='min-width:0'>" +
                  '<span style="display:block;font-size:13px;font-weight:600">' + UI.esc(c.customer_name) + "</span>" +
                  '<span class="faint" style="font-size:11px">' + UI.esc(c.phone_number || c.email || "") + "</span>" +
                "</span></span>" +
              '<span style="font-weight:700;white-space:nowrap">' +
                (c.wallet_balance === null ? "—" : coins(c.wallet_balance)) +
                '<span class="faint" style="font-size:10px;margin-left:3px">XP</span></span>';
            row.addEventListener("click", function () {
              chosen = c;
              input.value = c.customer_name;
              UI.clear(results);
              onPick(c);
            });
            results.appendChild(row);
          });
        })
        .catch(function (err) {
          results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">' +
            UI.esc(err.message) + "</div>";
        });
    }

    input.addEventListener("input", function () {
      chosen = null;
      onPick(null);
      clearTimeout(timer);
      timer = setTimeout(search, 250);
    });
    search();
    return { get: function () { return chosen; } };
  }

  /* ==========================================================================
     SELL DIALOG (shared by packages and memberships)
     ========================================================================== */
  function sellDialog(opts) {
    var chosen = null;

    var body = UI.el("div", { class: "col gap-5" });
    body.innerHTML =
      '<div class="card card-pad col gap-1" style="background:var(--bg-inset)">' +
        '<div class="kv"><span class="kv-key">' + UI.esc(opts.kindLabel) + '</span>' +
          '<span class="kv-val">' + UI.esc(opts.name) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Price</span><span class="kv-val" style="font-size:17px;font-weight:750">' +
          coins(opts.price) + " XP</span></div>" +
        (opts.detail ? '<div class="kv"><span class="kv-key">' + UI.esc(opts.detail.label) +
          '</span><span class="kv-val">' + UI.esc(opts.detail.value) + "</span></div>" : "") +
      "</div>" +
      '<div class="field"><label class="field-label field-req">Customer</label>' +
        '<div data-picker></div></div>' +
      '<div class="field"><label class="field-label field-req" for="sellMethod">Payment</label>' +
        '<select class="select" id="sellMethod">' +
          '<option value="wallet">XP Coin wallet</option>' +
          '<option value="cash">Cash</option>' +
          '<option value="card">Card</option>' +
          '<option value="upi">UPI</option>' +
        "</select></div>" +
      '<div class="notice" data-status="idle" id="sellPreview"></div>';

    var dialog = UI.modal({
      title: opts.title,
      description: opts.name,
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Sell", variant: "primary", icon: "check",
          onClick: function (ctx) {
            if (!chosen) {
              Motion.shake(ctx.node);
              UI.toast.warn("Choose a customer first");
              return false;
            }
            return opts.sell(chosen, ctx.body.querySelector("#sellMethod").value)
              .then(function (r) {
                UI.toast.ok(r.message, "Bill " + (r.bill ? r.bill.bill_number : ""));
                if (opts.onSold) opts.onSold(r);
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Sale failed", err.message);
                return false;
              });
          }
        }
      ]
    });

    var preview = body.querySelector("#sellPreview");
    var methodSelect = body.querySelector("#sellMethod");

    function refresh() {
      if (!chosen) {
        preview.setAttribute("data-status", "idle");
        preview.innerHTML = Icon("info", 16) + "<div>Search for the customer buying this.</div>";
        return;
      }
      var balance = Number(chosen.wallet_balance || 0);
      if (methodSelect.value !== "wallet") {
        preview.setAttribute("data-status", "accent");
        preview.innerHTML = Icon("check", 16) +
          "<div>Collect <strong>" + coins(opts.price) + " XP</strong> worth from " +
          UI.esc(chosen.customer_name) + " at the counter.</div>";
        return;
      }
      if (balance < opts.price) {
        preview.setAttribute("data-status", "offline");
        preview.innerHTML = Icon("alert", 16) +
          "<div>" + UI.esc(chosen.customer_name) + " has <strong>" + coins(balance) +
          " XP</strong> — short of " + coins(opts.price) + " XP. Top up first, or take another method.</div>";
        return;
      }
      preview.setAttribute("data-status", "online");
      preview.innerHTML = Icon("check", 16) +
        "<div>Wallet drops to <strong>" + coins(balance - opts.price) + " XP</strong>.</div>";
    }

    customerPicker(body.querySelector("[data-picker]"), function (c) { chosen = c; refresh(); });
    methodSelect.addEventListener("change", refresh);
    refresh();
    return dialog;
  }

  /* ==========================================================================
     PACKAGES PAGE
     ========================================================================== */
  var pkgRoot = null, pkgRows = [], pkgLoading = false, pkgError = null;

  function loadPackages() {
    pkgLoading = true; pkgError = null; renderPackages();
    return Store.listPackages({ limit: 200 })
      .then(function (b) { pkgRows = b.data || []; pkgLoading = false; renderPackages(); })
      .catch(function (e) { pkgLoading = false; pkgError = e.message; pkgRows = []; renderPackages(); });
  }

  function packageForm(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="pkName">Package name</label>' +
        '<input class="input" id="pkName" placeholder="Gold 10 Hours" value="' +
          UI.esc(existing ? existing.package_name : "") + '" data-autofocus></div>' +
      '<div class="field"><label class="field-label" for="pkDesc">Description</label>' +
        '<input class="input" id="pkDesc" placeholder="What the customer gets" value="' +
          UI.esc(existing ? (existing.description || "") : "") + '"></div>' +
      '<div class="field"><label class="field-label field-req" for="pkType">Type</label>' +
        '<select class="select" id="pkType">' +
          ["HOURS", "CREDIT", "SESSIONS"].map(function (t) {
            return '<option value="' + t + '"' + (existing && existing.package_type === t ? " selected" : "") + ">" +
              (t === "HOURS" ? "Playing time (minutes)" : t === "CREDIT" ? "XP Coins" : "Session count") + "</option>";
          }).join("") +
        "</select></div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="pkUnits">Units</label>' +
          '<input class="input" id="pkUnits" type="number" min="1" step="1" value="' +
            UI.esc(existing ? existing.units : "") + '"></div>' +
        '<div class="field"><label class="field-label" for="pkBonus">Bonus units</label>' +
          '<input class="input" id="pkBonus" type="number" min="0" step="1" value="' +
            UI.esc(existing ? existing.bonus_units : "0") + '"></div>' +
      "</div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="pkPrice">Price (XP)</label>' +
          '<input class="input" id="pkPrice" type="number" min="0" step="0.01" value="' +
            UI.esc(existing ? existing.price : "") + '"></div>' +
        '<div class="field"><label class="field-label" for="pkValidity">Valid for (days)</label>' +
          '<input class="input" id="pkValidity" type="number" min="1" step="1" placeholder="Blank = no expiry" value="' +
            UI.esc(existing && existing.validity_days ? existing.validity_days : "") + '"></div>' +
      "</div>" +
      '<div class="notice" data-status="accent" id="pkPreview"></div>' +
      '<label class="switch"><input type="checkbox" id="pkStatus"' +
        (!existing || existing.status === "ACTIVE" ? " checked" : "") + '>' +
        '<span class="switch-track"></span><span style="font-size:13px">On sale</span></label>';

    var dialog = UI.modal({
      title: isEdit ? "Edit package" : "Add package",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Create package", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var payload = {
              package_name: ctx.body.querySelector("#pkName").value.trim(),
              description: ctx.body.querySelector("#pkDesc").value.trim() || null,
              package_type: ctx.body.querySelector("#pkType").value,
              units: Number(ctx.body.querySelector("#pkUnits").value),
              bonus_units: Number(ctx.body.querySelector("#pkBonus").value) || 0,
              price: Number(ctx.body.querySelector("#pkPrice").value),
              validity_days: ctx.body.querySelector("#pkValidity").value || null,
              status: ctx.body.querySelector("#pkStatus").checked ? "ACTIVE" : "INACTIVE"
            };
            if (!payload.package_name || !payload.units || payload.units <= 0) {
              Motion.shake(ctx.node);
              UI.toast.warn("A name and a positive unit count are required");
              return false;
            }
            var call = isEdit ? Store.updatePackage(existing.package_id, payload)
                              : Store.createPackage(payload);
            return call
              .then(function (r) { UI.toast.ok(isEdit ? "Package updated" : "Package created", r.data.package_name); return loadPackages(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not save", err.message); return false; });
          }
        }
      ]
    });

    function refresh() {
      var type = body.querySelector("#pkType").value;
      var units = Number(body.querySelector("#pkUnits").value) || 0;
      var bonus = Number(body.querySelector("#pkBonus").value) || 0;
      var price = Number(body.querySelector("#pkPrice").value) || 0;
      var preview = body.querySelector("#pkPreview");
      if (!units) {
        preview.setAttribute("data-status", "idle");
        preview.innerHTML = Icon("info", 16) + "<div>Enter the units this package grants.</div>";
        return;
      }
      var total = units + bonus;
      preview.setAttribute("data-status", "accent");
      preview.innerHTML = Icon("check", 16) +
        "<div>Customer receives <strong>" + unitLabel(type, total) + "</strong>" +
        (bonus ? " (" + unitLabel(type, units) + " + " + unitLabel(type, bonus) + " free)" : "") +
        (price ? " for <strong>" + coins(price) + " XP</strong>" : " free") + ".</div>";
    }
    ["#pkType", "#pkUnits", "#pkBonus", "#pkPrice"].forEach(function (sel) {
      body.querySelector(sel).addEventListener("input", refresh);
      body.querySelector(sel).addEventListener("change", refresh);
    });
    refresh();
    return dialog;
  }

  function renderPackages() {
    if (!pkgRoot) return;
    var host = pkgRoot.querySelector("#pkTable");
    if (!host) return;
    UI.clear(host);

    if (pkgLoading && !pkgRows.length) { host.appendChild(UI.skeletonRows(5)); return; }
    if (pkgError) { host.appendChild(UI.errorState(pkgError, loadPackages)); return; }
    if (!pkgRows.length) {
      host.appendChild(UI.emptyState({
        icon: "packages", title: "No packages yet",
        text: "Create prepaid bundles of playing time or coins for customers to buy.",
        actions: [{ label: "Add package", icon: "plus", variant: "primary", onClick: function () { packageForm(null); } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML = "<thead><tr><th>Package</th><th>Type</th><th class='td-num'>Grants</th>" +
      "<th class='td-num'>Price</th><th>Validity</th><th class='td-num'>Sold</th><th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    pkgRows.forEach(function (row) {
      var active = row.status === "ACTIVE";
      var tr = UI.el("tr", { dataset: { status: active ? "online" : "idle" } });
      tr.innerHTML =
        "<td><strong>" + UI.esc(row.package_name) + "</strong>" +
          (row.description ? '<div class="faint" style="font-size:11px">' + UI.esc(row.description) + "</div>" : "") + "</td>" +
        '<td><span class="badge badge-plain">' + UI.esc(row.package_type) + "</span></td>" +
        '<td class="td-num">' + UI.esc(unitLabel(row.package_type, row.total_units)) +
          (row.bonus_units ? '<div class="faint" style="font-size:10px">incl. ' +
            UI.esc(unitLabel(row.package_type, row.bonus_units)) + " free</div>" : "") + "</td>" +
        '<td class="td-num" style="font-weight:700">' + coins(row.price) + " XP</td>" +
        "<td>" + (row.validity_days ? row.validity_days + " days" : '<span class="faint">No expiry</span>') + "</td>" +
        '<td class="td-num">' + (row.sold_count || 0) + "</td>" +
        '<td><span class="badge">' + (active ? "On sale" : "Off sale") + "</span></td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");

      if (active) {
        var sellBtn = UI.el("button", {
          class: "btn btn-primary btn-sm", html: Icon("plus", 13) + '<span class="btn-label">Sell</span>'
        });
        sellBtn.addEventListener("click", function () {
          sellDialog({
            title: "Sell package",
            kindLabel: "Package",
            name: row.package_name,
            price: row.price,
            detail: { label: "Grants", value: unitLabel(row.package_type, row.total_units) },
            sell: function (customer, method) {
              return Store.purchasePackage(row.package_id, {
                customer_id: customer.customer_id, payment_method: method
              });
            },
            onSold: loadPackages
          });
        });
        actions.appendChild(sellBtn);
      }

      var editBtn = UI.el("button", { class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit" });
      editBtn.addEventListener("click", function () { packageForm(row); });

      var toggleBtn = UI.el("button", {
        class: "btn btn-sm btn-icon " + (active ? "btn-warn" : "btn-ok"),
        html: Icon(active ? "pause" : "check", 13),
        "data-tip": active ? "Take off sale" : "Put on sale"
      });
      toggleBtn.addEventListener("click", function () {
        Store.setPackageStatus(row.package_id, active ? "INACTIVE" : "ACTIVE")
          .then(function (r) { UI.toast.ok(r.message); return loadPackages(); })
          .catch(function (e) { UI.toast.error("Could not update", e.message); });
      });

      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  global.CXPages.packages = {
    title: "Packages",
    subtitle: "Prepaid bundles of time and coins",
    mount: function (root) {
      pkgRoot = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Packages</div>' +
          '<div class="page-sub">Bundles customers buy up front and draw down as they play.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="pkRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
          '<button class="btn btn-primary" id="pkAdd">' + Icon("plus", 15) + '<span class="btn-label">Add package</span></button>' +
        "</div></div>" +
        '<div class="card card-body-flush" id="pkTable"></div>';
      root.appendChild(page);

      page.querySelector("#pkAdd").addEventListener("click", function () { packageForm(null); });
      var rb = page.querySelector("#pkRefresh");
      rb.addEventListener("click", function () { UI.withBusy(rb, function () { return loadPackages(); }); });

      loadPackages();
    },
    unmount: function () { pkgRoot = null; }
  };

  /* ==========================================================================
     MEMBERSHIPS PAGE
     ========================================================================== */
  var memRoot = null, plans = [], members = [], memLoading = false, memError = null, memTab = "plans";

  function loadMemberships() {
    memLoading = true; memError = null; renderMemberships();
    return Promise.all([Store.listPlans({}), Store.listMemberships({ status: "ACTIVE" })])
      .then(function (res) {
        plans = res[0].data || [];
        members = res[1].data || [];
        memLoading = false;
        renderMemberships();
      })
      .catch(function (e) { memLoading = false; memError = e.message; renderMemberships(); });
  }

  function planForm(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="mpName">Plan name</label>' +
          '<input class="input" id="mpName" placeholder="Gold" value="' +
            UI.esc(existing ? existing.plan_name : "") + '" data-autofocus></div>' +
        '<div class="field"><label class="field-label" for="mpTier">Tier</label>' +
          '<input class="input" id="mpTier" placeholder="GOLD" value="' +
            UI.esc(existing ? existing.tier : "") + '"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="mpDesc">Description</label>' +
        '<input class="input" id="mpDesc" value="' + UI.esc(existing ? (existing.description || "") : "") + '"></div>' +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="mpPrice">Price (XP)</label>' +
          '<input class="input" id="mpPrice" type="number" min="0" step="0.01" value="' +
            UI.esc(existing ? existing.price : "") + '"></div>' +
        '<div class="field"><label class="field-label field-req" for="mpDuration">Duration (days)</label>' +
          '<input class="input" id="mpDuration" type="number" min="1" step="1" value="' +
            UI.esc(existing ? existing.duration_days : "30") + '"></div>' +
      "</div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="mpDiscount">Discount (%)</label>' +
          '<input class="input" id="mpDiscount" type="number" min="0" max="100" step="0.5" value="' +
            UI.esc(existing ? existing.discount_percent : "0") + '"></div>' +
        '<div class="field"><label class="field-label" for="mpBonus">Joining bonus (XP)</label>' +
          '<input class="input" id="mpBonus" type="number" min="0" step="1" value="' +
            UI.esc(existing ? existing.bonus_credit : "0") + '"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="mpPerks">Perks — one per line</label>' +
        '<textarea class="textarea" id="mpPerks" placeholder="10% off gaming&#10;Priority booking">' +
          UI.esc(existing && existing.perks ? existing.perks.join("\n") : "") + "</textarea></div>" +
      '<label class="switch"><input type="checkbox" id="mpStatus"' +
        (!existing || existing.status === "ACTIVE" ? " checked" : "") + '>' +
        '<span class="switch-track"></span><span style="font-size:13px">On sale</span></label>';

    return UI.modal({
      title: isEdit ? "Edit plan" : "Add membership plan",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Create plan", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var payload = {
              plan_name: ctx.body.querySelector("#mpName").value.trim(),
              tier: ctx.body.querySelector("#mpTier").value.trim() || "STANDARD",
              description: ctx.body.querySelector("#mpDesc").value.trim() || null,
              price: Number(ctx.body.querySelector("#mpPrice").value),
              duration_days: parseInt(ctx.body.querySelector("#mpDuration").value, 10),
              discount_percent: Number(ctx.body.querySelector("#mpDiscount").value) || 0,
              bonus_credit: Number(ctx.body.querySelector("#mpBonus").value) || 0,
              perks: ctx.body.querySelector("#mpPerks").value,
              status: ctx.body.querySelector("#mpStatus").checked ? "ACTIVE" : "INACTIVE"
            };
            if (!payload.plan_name || !payload.duration_days) {
              Motion.shake(ctx.node);
              UI.toast.warn("A name and duration are required");
              return false;
            }
            var call = isEdit ? Store.updatePlan(existing.plan_id, payload) : Store.createPlan(payload);
            return call
              .then(function (r) { UI.toast.ok(isEdit ? "Plan updated" : "Plan created", r.data.plan_name); return loadMemberships(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not save", err.message); return false; });
          }
        }
      ]
    });
  }

  function renderMemberships() {
    if (!memRoot) return;
    var host = memRoot.querySelector("#memBody");
    if (!host) return;
    UI.clear(host);

    if (memLoading && !plans.length) { host.appendChild(UI.skeletonRows(5)); return; }
    if (memError) { host.appendChild(UI.errorState(memError, loadMemberships)); return; }

    if (memTab === "plans") {
      if (!plans.length) {
        host.appendChild(UI.emptyState({
          icon: "membership", title: "No plans yet",
          text: "Create membership tiers with a standing discount and joining bonus.",
          actions: [{ label: "Add plan", icon: "plus", variant: "primary", onClick: function () { planForm(null); } }]
        }));
        return;
      }

      var grid = UI.el("div", { class: "grid grid-3", style: { padding: "var(--s-5)" } });
      plans.forEach(function (plan) {
        var active = plan.status === "ACTIVE";
        var card = UI.el("div", { class: "card card-pad col gap-3", dataset: { status: active ? "accent" : "idle" } });
        card.innerHTML =
          '<div class="row-between" style="align-items:flex-start">' +
            "<div><div class='eyebrow'>" + UI.esc(plan.tier) + "</div>" +
              '<div style="font-size:19px;font-weight:750;margin-top:2px">' + UI.esc(plan.plan_name) + "</div></div>" +
            '<span class="badge">' + (active ? "On sale" : "Off sale") + "</span>" +
          "</div>" +
          '<div style="font-size:28px;font-weight:800;letter-spacing:-.02em">' + coins(plan.price) +
            ' <span style="font-size:13px;color:var(--text-3)">XP / ' + plan.duration_days + " days</span></div>" +
          '<div class="col gap-1" style="margin-top:var(--s-2)">' +
            (plan.discount_percent ? '<div class="kv"><span class="kv-key">Discount</span><span class="kv-val">' +
              plan.discount_percent + "%</span></div>" : "") +
            (plan.bonus_credit ? '<div class="kv"><span class="kv-key">Joining bonus</span><span class="kv-val">' +
              coins(plan.bonus_credit) + " XP</span></div>" : "") +
            '<div class="kv"><span class="kv-key">Members</span><span class="kv-val">' + (plan.member_count || 0) + "</span></div>" +
          "</div>" +
          (plan.perks && plan.perks.length
            ? '<ul style="margin-top:var(--s-2);display:flex;flex-direction:column;gap:4px">' +
              plan.perks.map(function (p) {
                return '<li style="font-size:12px;color:var(--text-2);display:flex;gap:6px">' +
                  Icon("check", 13) + "<span>" + UI.esc(p) + "</span></li>";
              }).join("") + "</ul>"
            : "");

        var actions = UI.el("div", { class: "row gap-2", style: { marginTop: "auto", paddingTop: "var(--s-4)" } });
        if (active) {
          var sellBtn = UI.el("button", {
            class: "btn btn-primary btn-sm grow", html: Icon("plus", 13) + '<span class="btn-label">Sell</span>'
          });
          sellBtn.addEventListener("click", function () {
            sellDialog({
              title: "Sell membership",
              kindLabel: "Plan",
              name: plan.plan_name,
              price: plan.price,
              detail: { label: "Runs for", value: plan.duration_days + " days" },
              sell: function (customer, method) {
                return Store.subscribeCustomer(plan.plan_id, {
                  customer_id: customer.customer_id, payment_method: method
                });
              },
              onSold: loadMemberships
            });
          });
          actions.appendChild(sellBtn);
        }
        var editBtn = UI.el("button", {
          class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
        });
        editBtn.addEventListener("click", function () { planForm(plan); });
        var toggleBtn = UI.el("button", {
          class: "btn btn-sm btn-icon " + (active ? "btn-warn" : "btn-ok"),
          html: Icon(active ? "pause" : "check", 13),
          "data-tip": active ? "Take off sale" : "Put on sale"
        });
        toggleBtn.addEventListener("click", function () {
          Store.setPlanStatus(plan.plan_id, active ? "INACTIVE" : "ACTIVE")
            .then(function (r) { UI.toast.ok(r.message); return loadMemberships(); })
            .catch(function (e) { UI.toast.error("Could not update", e.message); });
        });
        actions.appendChild(editBtn);
        actions.appendChild(toggleBtn);
        card.appendChild(actions);
        grid.appendChild(card);
      });
      host.appendChild(grid);
      Motion.stagger(grid.children, { step: 0.04, y: 12 });
      return;
    }

    /* members tab */
    if (!members.length) {
      host.appendChild(UI.emptyState({
        icon: "customers", title: "No active members",
        text: "Sell a plan from the Plans tab to sign someone up."
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML = "<thead><tr><th>Customer</th><th>Plan</th><th>Started</th><th>Expires</th>" +
      "<th class='td-num'>Days left</th><th class='td-num'>Paid</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");
    members.forEach(function (m) {
      var tr = UI.el("tr", { dataset: { status: m.days_remaining <= 7 ? "warning" : "online" } });
      tr.innerHTML =
        "<td><strong>" + UI.esc(m.customer_name) + "</strong></td>" +
        '<td><span class="badge badge-plain">' + UI.esc(m.tier) + "</span> " + UI.esc(m.plan_name) + "</td>" +
        "<td>" + UI.esc(UI.fmtDate(m.started_at)) + "</td>" +
        "<td>" + UI.esc(UI.fmtDate(m.expires_at)) + "</td>" +
        '<td class="td-num" style="font-weight:700">' + m.days_remaining + "</td>" +
        '<td class="td-num">' + coins(m.price_paid) + " XP</td>" +
        '<td class="td-actions"></td>';
      var cancelBtn = UI.el("button", {
        class: "btn btn-danger btn-sm", html: Icon("close", 13) + '<span class="btn-label">Cancel</span>'
      });
      cancelBtn.addEventListener("click", function () {
        UI.confirm({
          title: "Cancel " + m.customer_name + "'s membership?",
          message: "The membership ends immediately. No refund is issued automatically.",
          confirmLabel: "Cancel membership", variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.cancelMembership(m.customer_membership_id)
            .then(function () { UI.toast.ok("Membership cancelled"); return loadMemberships(); })
            .catch(function (e) { UI.toast.error("Could not cancel", e.message); });
        });
      });
      tr.querySelector(".td-actions").appendChild(cancelBtn);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  global.CXPages.memberships = {
    title: "Memberships",
    subtitle: "Plans and active members",
    mount: function (root) {
      memRoot = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Memberships</div>' +
          '<div class="page-sub">Recurring tiers with a standing discount and joining bonus.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="memRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
          '<button class="btn btn-primary" id="memAdd">' + Icon("plus", 15) + '<span class="btn-label">Add plan</span></button>' +
        "</div></div>" +
        '<div class="tabs" id="memTabs" style="margin-bottom:var(--s-5)">' +
          '<button data-tab="plans" aria-selected="true">Plans</button>' +
          '<button data-tab="members" aria-selected="false">Active members</button>' +
        "</div>" +
        '<div class="card card-body-flush" id="memBody"></div>';
      root.appendChild(page);

      page.querySelector("#memAdd").addEventListener("click", function () { planForm(null); });
      var rb = page.querySelector("#memRefresh");
      rb.addEventListener("click", function () { UI.withBusy(rb, function () { return loadMemberships(); }); });

      UI.$$("#memTabs button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          memTab = btn.dataset.tab;
          UI.$$("#memTabs button", page).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          renderMemberships();
        });
      });

      loadMemberships();
    },
    unmount: function () { memRoot = null; }
  };
})(window);
