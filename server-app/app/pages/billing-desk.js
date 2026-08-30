/* ==========================================================================
   Billing desk — one surface for everything that happens at the till.

   Taking payment and looking up a bill were two nav entries, which meant a
   cashier settling a walk-in and then answering "did table four pay?" had to
   leave the till, losing the ticket they were part-way through building. They
   are the same job at the same counter, so they are now the same page: the
   till keeps its state while you look something up.

   Three tabs:
     Till          — build a ticket and settle it        (app/pages/counter.js)
     Bills         — the ledger, refunds, receipts       (app/pages/billing.js)
     Coin requests — cash top-ups waiting for approval   (here)

   The sub-views are mounted and unmounted as you switch, so a page's polling
   and listeners do not keep running behind a tab nobody is looking at. The
   till is the exception — see keepAlive below.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var bodyEl = null;
  var actionsEl = null;
  var current = null;        // id of the mounted sub-view
  var pendingTimer = null;
  var pendingCount = 0;
  // Which sub-tab to open on the next mount — the notification bell sets
  // this before navigating here, then it resets to the normal default.
  var initialTab = "till";

  var TABS = [
    { id: "till",     label: "Till",          icon: "billing",  view: "_till",
      sub: "Build a ticket, apply a code, take payment. Nothing is billed until you settle." },
    { id: "bills",    label: "Bills",         icon: "reports",  view: "_bills",
      sub: "Raised automatically when a charged session ends, or by hand for a walk-in." },
    { id: "requests", label: "Coin requests", icon: "customers", view: null,
      sub: "Customers who asked to buy coins with cash. Approving one adds the coins." }
  ];

  function tabFor(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i];
    return TABS[0];
  }

  /* ==========================================================================
     COIN REQUESTS

     A customer taps "cash at the counter" on their station; it lands here.
     The approval is the payment confirmation — there is no gateway to ask, so
     a person confirms the notes arrived and that is what moves the balance.
     ========================================================================== */
  var requests = [];
  var requestsLoading = true;
  var requestsError = null;

  function loadRequests(silent) {
    if (!silent) { requestsLoading = true; renderRequests(); }
    return Store.pendingTopups()
      .then(function (list) {
        requests = list || [];
        pendingCount = requests.length;
        requestsLoading = false;
        requestsError = null;
        paintBadge();
        if (current === "requests") renderRequests();
      })
      .catch(function (err) {
        requestsLoading = false;
        requestsError = err.message;
        if (current === "requests") renderRequests();
      });
  }

  /** The count rides on the tab and the sidebar, so it is seen without looking. */
  function paintBadge() {
    var chip = rootEl && rootEl.querySelector('[data-tab="requests"] .desk-tab-count');
    if (chip) {
      chip.textContent = pendingCount || "";
      chip.classList.toggle("hidden", !pendingCount);
    }
    if (global.CXRouter && global.CXRouter.setBadge) {
      global.CXRouter.setBadge("billing", pendingCount || 0, "accent");
    }
  }

  function approve(request, btn) {
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
        .then(function (r) {
          UI.toast.ok("Coins added", r.message);
          loadRequests(true);
        })
        .catch(function (err) {
          btn.disabled = false;
          UI.toast.err("Could not approve", err.message);
        });
    });
  }

  function reject(request) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<p class="faint">The customer is told the request was declined. No coins are added ' +
        "and no money is recorded as taken.</p>" +
      '<div class="field"><label class="field-label">Reason (the customer does not see this)</label>' +
        '<input class="input" id="rjReason" placeholder="Cash not received" autocomplete="off"></div>';

    UI.modal({
      title: "Decline this request?",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Decline", variant: "danger", icon: "close",
          onClick: function (ctx) {
            var reason = ctx.body.querySelector("#rjReason").value.trim();
            return Store.rejectTopup(request.topup_id, reason || null)
              .then(function () {
                UI.toast.ok("Declined", "The request was closed without adding coins.");
                loadRequests(true);
              })
              .catch(function (err) { UI.toast.err("Could not decline", err.message); return false; });
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
        '<span class="req-avatar">' +
          UI.esc(UI.initials(request.customer_name || "?")) + "</span>" +
        '<div class="req-who">' +
          '<div class="req-name">' + UI.esc(request.customer_name || "Customer " + request.customer_id) + "</div>" +
          '<div class="req-meta faint">asked ' + UI.esc(waited) +
            (request.current_balance != null
              ? " · holds " + Number(request.current_balance).toFixed(2) + " XP"
              : "") +
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
    yes.addEventListener("click", function () { approve(request, yes); });

    var no = UI.el("button", {
      class: "btn btn-ghost btn-danger-ghost", type: "button",
      html: Icon("close", 15) + '<span class="btn-label">Decline</span>',
      onClick: function () { reject(request); }
    });

    actions.appendChild(yes);
    actions.appendChild(no);
    card.appendChild(actions);
    return card;
  }

  function renderRequests() {
    if (!bodyEl || current !== "requests") return;
    UI.clear(bodyEl);

    if (requestsLoading) { bodyEl.appendChild(UI.skeletonCards(2)); return; }

    if (requestsError) {
      bodyEl.appendChild(UI.errorState(
        requestsError.indexOf("does not allow") !== -1
          ? "Your role does not allow you to approve coin requests."
          : requestsError
      ));
      return;
    }

    if (!requests.length) {
      bodyEl.appendChild(UI.emptyState({
        icon: "check",
        status: "online",
        title: "Nothing waiting",
        text: "When a customer chooses to pay cash for coins on their station, the request " +
          "appears here for you to confirm."
      }));
      return;
    }

    var lede = UI.el("p", { class: "page-lede" });
    lede.textContent = "Take the cash, then confirm. The coins are added the moment you do, " +
      "and the movement is recorded against your name.";
    bodyEl.appendChild(lede);

    var grid = UI.el("div", { class: "req-grid" });
    requests.forEach(function (r) { grid.appendChild(requestCard(r)); });
    bodyEl.appendChild(grid);
    Motion.stagger(grid.children, { step: 0.04, y: 12, maxDelay: 0.3 });
  }

  /* ==========================================================================
     TAB SWITCHING
     ========================================================================== */
  function show(id) {
    if (current === id) return;

    var previous = current && tabFor(current);
    if (previous && previous.view && global.CXPages[previous.view]) {
      var view = global.CXPages[previous.view];
      if (view.unmount) { try { view.unmount(); } catch (e) { console.error(e); } }
    }

    current = id;
    var tab = tabFor(id);

    rootEl.querySelectorAll("[data-tab]").forEach(function (b) {
      var on = b.dataset.tab === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });

    var sub = rootEl.querySelector("#deskSub");
    if (sub) sub.textContent = tab.sub;

    UI.clear(bodyEl);
    UI.clear(actionsEl);

    if (tab.view && global.CXPages[tab.view]) {
      try {
        global.CXPages[tab.view].mount(bodyEl, { actions: actionsEl });
      } catch (e) {
        console.error("[billing-desk] " + tab.view + " failed to mount", e);
        bodyEl.appendChild(UI.errorState("This tab failed to render: " + e.message));
      }
    } else {
      renderRequests();
    }

    Motion.enter(bodyEl, { y: 8, duration: 0.2 });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.billing = {
    title: "Billing",
    subtitle: "The counter, end to end",

    mount: function (root) {
      rootEl = root;
      current = null;
      requests = [];
      requestsLoading = true;

      var page = UI.el("div", { class: "page desk-page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Billing</div>' +
            '<div class="page-sub" id="deskSub"></div>' +
          "</div>" +
          '<div class="page-actions" id="deskActions"></div>' +
        "</div>" +

        '<div class="desk-tabs" role="tablist">' +
          TABS.map(function (t) {
            return '<button class="desk-tab" data-tab="' + t.id + '" role="tab">' +
              '<span class="desk-tab-icon">' + Icon(t.icon, 15) + "</span>" +
              "<span>" + UI.esc(t.label) + "</span>" +
              '<span class="desk-tab-count hidden"></span>' +
            "</button>";
          }).join("") +
        "</div>" +

        '<div id="deskBody"></div>';
      root.appendChild(page);

      bodyEl = page.querySelector("#deskBody");
      actionsEl = page.querySelector("#deskActions");

      page.querySelectorAll("[data-tab]").forEach(function (b) {
        b.addEventListener("click", function () { show(b.dataset.tab); });
      });

      show(initialTab);
      initialTab = "till";

      /* The queue is polled regardless of which tab is open: a cashier working
         the till needs to see a request arrive without going to look for it. */
      loadRequests(true);
      pendingTimer = setInterval(function () { loadRequests(true); }, 15000);
    },

    /* Jump straight to Coin requests — from the notification bell, from
       anywhere. Already on this page: just switch tabs, since the router's
       own go() no-ops when asked to navigate to where you already are.
       Elsewhere: set what the next mount should open on and navigate. */
    openRequests: function () {
      if (global.CXRouter && global.CXRouter.current && global.CXRouter.current() === "billing") {
        show("requests");
      } else {
        initialTab = "requests";
        if (global.CXRouter) global.CXRouter.go("billing");
      }
    },

    unmount: function () {
      clearInterval(pendingTimer);
      pendingTimer = null;

      var tab = current && tabFor(current);
      if (tab && tab.view && global.CXPages[tab.view] && global.CXPages[tab.view].unmount) {
        try { global.CXPages[tab.view].unmount(); } catch (e) { console.error(e); }
      }

      rootEl = null;
      bodyEl = null;
      actionsEl = null;
      current = null;
    }
  };
})(window);
