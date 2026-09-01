/* ==========================================================================
   CafeXP Admin — Notifications
   One page for everything waiting on staff: cash-coin requests, freshly
   placed F&B orders, and new bookings. The topbar bell and its toasts land
   here rather than jumping into Billing/F&B/Reservations' own tabs, so
   there's a single place to see what needs attention regardless of which
   feature it came from.
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

  var ORDER_FLOW = ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];

  var RES_STATUS_TONE = { CONFIRMED: "accent" };
  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }

  var rootEl, bodyEl;
  var loading = true, error = null;
  var requests = [], orders = [], reservations = [];

  function load() {
    loading = true; error = null; render();
    return Promise.all([
      Store.pendingTopups().catch(function () { return []; }),
      Store.listOrders({ status: "PLACED" }).then(function (r) { return r.data || []; }).catch(function () { return []; }),
      Store.listReservations({ status: "CONFIRMED", from: new Date().toISOString() })
        .then(function (r) { return r.data || []; }).catch(function () { return []; })
    ]).then(function (r) {
      requests = r[0] || [];
      orders = r[1] || [];
      reservations = r[2] || [];
      loading = false;
      render();
    });
  }

  function approveRequest(request, btn) {
    UI.confirm({
      title: "Add " + Number(request.coins).toFixed(2) + " coins?",
      message: "Confirm you have taken ₹" + Number(request.amount).toFixed(2) + " in cash from " +
        (request.customer_name || "this customer") + ". The coins are added immediately and " +
        "the movement is recorded against your name.",
      confirmLabel: "Cash received — add coins",
      variant: "primary"
    }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      Store.approveTopup(request.topup_id)
        .then(function (r) { UI.toast.ok("Coins added", r.message); load(); })
        .catch(function (err) { btn.disabled = false; UI.toast.error("Could not approve", err.message); });
    });
  }

  function rejectRequest(request) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<p class="faint">The customer is told the request was declined. No coins are added ' +
        "and no money is recorded as taken.</p>" +
      '<div class="field"><label class="field-label">Reason (the customer does not see this)</label>' +
        '<input class="input" id="notifRjReason" placeholder="Cash not received" autocomplete="off"></div>';

    UI.modal({
      title: "Decline this request?",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Decline", variant: "danger", icon: "close",
          onClick: function (ctx) {
            var reason = ctx.body.querySelector("#notifRjReason").value.trim();
            return Store.rejectTopup(request.topup_id, reason || null)
              .then(function () { UI.toast.ok("Declined", "The request was closed without adding coins."); load(); })
              .catch(function (err) { UI.toast.error("Could not decline", err.message); return false; });
          }
        }
      ]
    });
  }

  function requestCard(request) {
    var card = UI.el("article", { class: "req-card" });
    var waited = UI.relTime(request.created_at);

    card.innerHTML =
      '<div class="req-head">' +
        '<span class="req-avatar">' + UI.esc(UI.initials(request.customer_name || "?")) + "</span>" +
        '<div class="req-who">' +
          '<div class="req-name">' + UI.esc(request.customer_name || "Customer " + request.customer_id) + "</div>" +
          '<div class="req-meta faint">asked ' + UI.esc(waited) +
            (request.current_balance != null ? " · holds " + Number(request.current_balance).toFixed(2) + " XP" : "") +
          "</div>" +
        "</div>" +
        '<div class="req-amount">' +
          '<div class="req-cash">₹' + Number(request.amount).toFixed(2) + "</div>" +
          '<div class="req-coins faint">' + Number(request.coins).toFixed(2) + " XP</div>" +
        "</div>" +
      "</div>" +
      (request.customer_note
        ? '<div class="req-note">' + Icon("info", 13) + UI.esc(request.customer_note) + "</div>"
        : "");

    var actions = UI.el("div", { class: "req-actions row gap-2" });
    var yes = UI.el("button", {
      class: "btn btn-primary grow", type: "button",
      html: Icon("check", 15) + '<span class="btn-label">Cash received</span>'
    });
    yes.addEventListener("click", function () { approveRequest(request, yes); });
    var no = UI.el("button", {
      class: "btn btn-ghost btn-danger-ghost", type: "button",
      html: Icon("close", 15) + '<span class="btn-label">Decline</span>',
      onClick: function () { rejectRequest(request); }
    });
    actions.appendChild(yes);
    actions.appendChild(no);
    card.appendChild(actions);
    return card;
  }

  function orderCard(order) {
    var card = UI.el("div", { class: "card card-pad col gap-3", dataset: { status: "warning" } });
    card.innerHTML =
      '<div class="row-between" style="align-items:flex-start">' +
        "<div><div class='row gap-3' style='align-items:center'>" +
          '<span class="mono" style="font-size:15px;font-weight:700">' + UI.esc(order.order_number) + "</span>" +
          '<span class="badge badge-lg">' + UI.esc(order.status) + "</span>" +
          (order.payment_status === "PAID"
            ? '<span class="badge" data-status="online">Paid</span>'
            : '<span class="badge" data-status="warning">Unpaid</span>') +
        "</div>" +
        '<div class="faint" style="font-size:12px;margin-top:4px">' +
          UI.esc(order.customer_name || "Guest") +
          (order.pc_name ? " · " + UI.esc(order.pc_name) : "") +
          " · " + UI.esc(new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) +
        "</div></div>" +
        '<div style="text-align:right"><div style="font-size:19px;font-weight:800">' +
          coins(order.total) + " XP</div></div>" +
      "</div>" +
      '<div class="col gap-1" style="padding-top:var(--s-3);border-top:1px solid var(--line-faint)">' +
        (order.items || []).map(function (i) {
          return '<div class="kv" style="padding:4px 0"><span class="kv-key">' +
            i.quantity + " × " + UI.esc(i.product_name) + "</span>" +
            '<span class="kv-val">' + coins(i.amount) + " XP</span></div>";
        }).join("") +
        (order.note ? '<div class="notice" data-status="warning" style="margin-top:var(--s-3)">' +
          Icon("info", 16) + "<div>" + UI.esc(order.note) + "</div></div>" : "") +
      "</div>";

    var actions = UI.el("div", { class: "row gap-2 wrap", style: { marginTop: "var(--s-2)" } });
    var next = ORDER_FLOW[ORDER_FLOW.indexOf(order.status) + 1];
    if (next) {
      var advance = UI.el("button", {
        class: "btn btn-primary grow",
        html: Icon("chevronR", 15) + '<span class="btn-label">Mark ' + next.toLowerCase() + "</span>"
      });
      advance.addEventListener("click", function () {
        Store.setOrderStatus(order.order_id, next)
          .then(function (r) { UI.toast.ok(r.message, order.order_number); load(); })
          .catch(function (e) { UI.toast.error("Could not update", e.message); });
      });
      actions.appendChild(advance);
    }
    var cancel = UI.el("button", { class: "btn btn-danger", html: Icon("close", 15) + '<span class="btn-label">Cancel</span>' });
    cancel.addEventListener("click", function () {
      UI.confirm({
        title: "Cancel " + order.order_number + "?",
        message: "The stock goes back on the shelf. Any payment already taken is not refunded automatically.",
        confirmLabel: "Cancel order", variant: "danger"
      }).then(function (ok) {
        if (!ok) return;
        Store.setOrderStatus(order.order_id, "CANCELLED")
          .then(function (r) { UI.toast.ok(r.message); load(); })
          .catch(function (e) { UI.toast.error("Could not cancel", e.message); });
      });
    });
    actions.appendChild(cancel);
    card.appendChild(actions);
    return card;
  }

  function reservationCard(r) {
    var card = UI.el("div", { class: "card card-pad col gap-3", dataset: { status: RES_STATUS_TONE[r.status] || "accent" } });
    card.innerHTML =
      '<div class="row-between" style="align-items:flex-start">' +
        "<div><div class='row gap-3' style='align-items:center'>" +
          '<span style="font-size:15px;font-weight:700">' + UI.esc(r.pc_name || (r.category ? "Any " + r.category : "Station")) + "</span>" +
          '<span class="badge badge-lg">' + UI.esc(fmtWhen(r.start_time)) + "</span>" +
        "</div>" +
        '<div class="faint" style="font-size:12px;margin-top:4px">' +
          UI.esc(r.customer_name || "Guest") +
          (r.guest_phone ? " · " + UI.esc(r.guest_phone) : "") +
        "</div></div>" +
      "</div>" +
      (r.notes ? '<div class="notice" data-status="idle">' + Icon("info", 16) + "<div>" + UI.esc(r.notes) + "</div></div>" : "");

    var actions = UI.el("div", { class: "row gap-2 wrap", style: { marginTop: "var(--s-2)" } });
    var checkIn = UI.el("button", {
      class: "btn btn-primary grow", html: Icon("check", 15) + '<span class="btn-label">Check in</span>'
    });
    checkIn.addEventListener("click", function () {
      Store.checkInReservation(r.reservation_id)
        .then(function (res) { UI.toast.ok(res.message || "Checked in"); load(); })
        .catch(function (e) { UI.toast.error("Could not check in", e.message); });
    });
    var noShow = UI.el("button", { class: "btn btn-ghost", text: "No-show" });
    noShow.addEventListener("click", function () {
      UI.confirm({
        title: "Mark as a no-show?",
        message: (r.customer_name || "This guest") + " did not show up for their booking.",
        confirmLabel: "Mark no-show", variant: "danger"
      }).then(function (ok) {
        if (!ok) return;
        Store.markReservationNoShow(r.reservation_id)
          .then(function (res) { UI.toast.ok(res.message || "Marked as a no-show"); load(); })
          .catch(function (e) { UI.toast.error("Could not update", e.message); });
      });
    });
    var cancel = UI.el("button", { class: "btn btn-danger", html: Icon("close", 15) + '<span class="btn-label">Cancel</span>' });
    cancel.addEventListener("click", function () {
      UI.confirm({
        title: "Cancel this booking?",
        message: "The station is freed for that time.",
        confirmLabel: "Cancel booking", variant: "danger"
      }).then(function (ok) {
        if (!ok) return;
        Store.cancelReservation(r.reservation_id)
          .then(function () { UI.toast.ok("Booking cancelled"); load(); })
          .catch(function (e) { UI.toast.error("Could not cancel", e.message); });
      });
    });
    actions.appendChild(checkIn); actions.appendChild(noShow); actions.appendChild(cancel);
    card.appendChild(actions);
    return card;
  }

  function section(title, count, node) {
    var sec = UI.el("div", { class: "col gap-3" });
    sec.innerHTML = '<div class="section-title" style="display:flex;align-items:center;gap:8px">' +
      "<span>" + UI.esc(title) + "</span>" +
      (count ? '<span class="badge badge-lg" data-status="accent">' + count + "</span>" : "") +
      "</div>";
    sec.appendChild(node);
    return sec;
  }

  function render() {
    if (!bodyEl) return;
    UI.clear(bodyEl);

    if (loading) { bodyEl.appendChild(UI.skeletonCards(3)); return; }

    if (!requests.length && !orders.length && !reservations.length) {
      bodyEl.appendChild(UI.emptyState({
        icon: "check",
        status: "online",
        title: "All caught up",
        text: "Coin requests, new orders and new bookings will show up here as they come in."
      }));
      return;
    }

    var wrap = UI.el("div", { class: "col gap-6" });

    if (requests.length) {
      var reqGrid = UI.el("div", { class: "req-grid" });
      requests.forEach(function (r) { reqGrid.appendChild(requestCard(r)); });
      wrap.appendChild(section("Coin requests", requests.length, reqGrid));
    }

    if (orders.length) {
      var orderList = UI.el("div", { class: "col gap-3" });
      orders.forEach(function (o) { orderList.appendChild(orderCard(o)); });
      wrap.appendChild(section("New orders", orders.length, orderList));
    }

    if (reservations.length) {
      var resList = UI.el("div", { class: "col gap-3" });
      reservations.forEach(function (r) { resList.appendChild(reservationCard(r)); });
      wrap.appendChild(section("Upcoming bookings", reservations.length, resList));
    }

    bodyEl.appendChild(wrap);
    Motion.stagger(wrap.children, { step: 0.05, y: 12, maxDelay: 0.3 });
  }

  global.CXPages.notifications = {
    title: "Notifications",
    subtitle: "Everything waiting on staff, in one place",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Notifications</div>' +
            '<div class="page-sub">Coin requests, new orders and new bookings, together</div>' +
          "</div>" +
        "</div>" +
        '<div id="notifBody"></div>';
      root.appendChild(page);
      bodyEl = page.querySelector("#notifBody");
      load();
    },

    unmount: function () {
      rootEl = null; bodyEl = null;
    }
  };
})(window);
