/* ==========================================================================
   CafeXP — Subscription
   The cafe's own CafeXP licence (GET /api/subscriptions/cafe/:id).
   Not to be confused with customer memberships, which do not exist yet.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;

  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#planBody");
    if (!host) return;
    UI.clear(host);

    if (Store.state.loading.subscription) {
      host.appendChild(UI.skeletonRows(6));
      return;
    }

    var sub = Store.state.subscription;
    if (!sub) {
      host.appendChild(UI.emptyState({
        icon: "plan",
        status: Store.state.error.subscription ? "error" : "idle",
        title: Store.state.error.subscription ? "Could not load your plan" : "No active subscription",
        text: Store.state.error.subscription
          ? Store.state.error.subscription
          : "This cafe has no subscription record. Contact CafeXP to activate a plan.",
        actions: [{ label: "Retry", icon: "refresh", variant: "outline", onClick: function () { Store.loadSubscription().catch(function () {}); } }]
      }));
      return;
    }

    var start = new Date(sub.start_date);
    var end = new Date(sub.end_date);
    var now = new Date();
    var active = sub.is_active && now <= end;
    var daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
    var totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
    var elapsedPct = Math.min(100, Math.max(0, Math.round(((totalDays - daysLeft) / totalDays) * 100)));
    var used = Store.counts().total;
    var seatPct = sub.max_pcs ? Math.min(100, Math.round((used / sub.max_pcs) * 100)) : 0;
    var user = Store.state.user || {};

    var grid = UI.el("div", { class: "grid grid-split" });

    var main = UI.el("div", { class: "col gap-4" });

    var overview = UI.el("div", { class: "card" });
    overview.innerHTML =
      '<div class="card-head"><h2>' + UI.esc(sub.name || "Plan") + "</h2>" +
        '<span class="badge badge-lg" data-status="' + (active ? "online" : "offline") + '">' +
          '<span class="dot"></span>' + (active ? "Active" : "Inactive") + "</span></div>" +
      '<div class="card-body col gap-5">' +
        '<div class="row gap-6 wrap">' +
          '<div class="plan-ring" data-status="' + (seatPct >= 100 ? "offline" : seatPct >= 85 ? "warning" : "online") + '" style="--pct:' + seatPct + '">' +
            '<div class="plan-ring-copy"><div class="plan-ring-val">' + used + "</div>" +
            '<div class="plan-ring-lbl">of ' + UI.esc(sub.max_pcs != null ? sub.max_pcs : "—") + "</div></div>" +
          "</div>" +
          '<div class="grow col gap-4" style="min-width:220px">' +
            '<div><div class="eyebrow">Station seats</div>' +
              '<div class="stat-value" style="font-size:26px">' + used +
              ' <small>of ' + UI.esc(sub.max_pcs != null ? sub.max_pcs : "—") + " used</small></div></div>" +
            '<div class="meter meter-lg"><div class="meter-fill" data-meter="seats" data-status="' +
              (seatPct >= 100 ? "offline" : seatPct >= 85 ? "warning" : "online") + '"></div></div>' +
            (sub.max_pcs != null && used >= sub.max_pcs
              ? '<div class="notice" data-status="warning">' + Icon("alert", 16) +
                "<div>You have reached your seat limit. Additional stations need a larger plan.</div></div>"
              : "") +
          "</div>" +
        "</div>" +
        '<div><div class="eyebrow" style="margin-bottom:8px">Term</div>' +
          '<div class="meter meter-lg"><div class="meter-fill" data-meter="term" data-status="' +
            (daysLeft > 14 ? "online" : daysLeft > 0 ? "warning" : "offline") + '"></div></div>' +
          '<div class="row-between" style="margin-top:8px;font-size:12px;color:var(--text-2)">' +
            "<span>" + UI.esc(UI.fmtDate(sub.start_date)) + "</span>" +
            '<span class="num" style="color:' + (daysLeft > 14 ? "var(--ok)" : daysLeft > 0 ? "var(--warn)" : "var(--danger)") + '">' +
              daysLeft + " days remaining</span>" +
            "<span>" + UI.esc(UI.fmtDate(sub.end_date)) + "</span>" +
          "</div>" +
        "</div>" +
      "</div>";
    main.appendChild(overview);

    var side = UI.el("div", { class: "col gap-4" });
    var details = UI.el("div", { class: "card" });
    details.innerHTML =
      '<div class="card-head"><h2>Details</h2></div>' +
      '<div class="card-body col">' +
        '<div class="kv"><span class="kv-key">Cafe</span><span class="kv-val">' + UI.esc(user.name || "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Cafe ID</span><span class="kv-val mono">' + UI.esc(user.cafe_id != null ? user.cafe_id : "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Plan type</span><span class="kv-val">' +
          (sub.is_single_pc_price ? "Single-PC pricing" : "Multi-PC pricing") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Free trial</span><span class="kv-val">' + (sub.is_freetrial ? "Yes" : "No") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Started</span><span class="kv-val">' + UI.esc(UI.fmtDate(sub.start_date)) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Expires</span><span class="kv-val">' + UI.esc(UI.fmtDate(sub.end_date)) + "</span></div>" +
      "</div>";
    side.appendChild(details);

    var note = UI.el("div", { class: "card card-pad" });
    note.innerHTML =
      '<div class="notice" data-status="info">' + Icon("info", 16) +
      "<div>This is your cafe's licence to run CafeXP. Customer-facing memberships and loyalty plans are a separate feature that is not built yet.</div></div>";
    side.appendChild(note);

    grid.appendChild(main);
    grid.appendChild(side);
    host.appendChild(grid);

    // Meters animate from zero on paint.
    requestAnimationFrame(function () {
      Motion.meterTo(host.querySelector('[data-meter="seats"]'), seatPct);
      Motion.meterTo(host.querySelector('[data-meter="term"]'), 100 - elapsedPct);
    });
  }

  global.CXPages.plan = {
    title: "Subscription",
    subtitle: "Your CafeXP licence",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Subscription</div>' +
            '<div class="page-sub">Seats, term and status for this cafe.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="planRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
          "</div>" +
        "</div>" +
        '<div id="planBody"></div>';
      root.appendChild(page);

      var btn = page.querySelector("#planRefresh");
      btn.addEventListener("click", function () {
        UI.withBusy(btn, function () {
          return Store.loadSubscription()
            .then(function () { UI.toast.ok("Subscription refreshed"); })
            .catch(function (e) { UI.toast.error("Could not refresh", e.message); });
        });
      });

      offs.push(Store.on("subscription", render));
      offs.push(Store.on("subscription:loading", render));
      offs.push(Store.on("pcs", render));

      render();
      if (!Store.state.subscription && Store.state.user) Store.loadSubscription().catch(function () {});
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    }
  };
})(window);
