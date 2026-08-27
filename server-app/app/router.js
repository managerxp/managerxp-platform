/* ==========================================================================
   CafeXP — Navigation & router
   Owns the sidebar, the topbar title, and the animated view swap.
   Pages register themselves on CXPages[<id>] = { title, subtitle, mount(el) }.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Motion = global.CXMotion, Icon = global.CXIcon, Store = global.CXStore;

  /* Navigation model.
     `planned: true` marks a section with no backend behind it yet — the page
     explains exactly what is missing rather than showing invented data.

     `feature` names the entitlement that grants the section. ManagerXP decides
     what a café's package includes; this file only knows which nav entry maps
     to which feature key. There is deliberately no `if (plan === 'basic')`
     anywhere in this application, and there must never be one — a new module
     should become visible by being switched on in ManagerXP, with no build.

     An entry with no `feature` is structural and always shown. Discovery,
     Server Log and Settings are how a café is set up and how it is repaired
     when something is wrong; hiding them behind a subscription state would
     mean the only screens that could explain a problem disappear exactly when
     the problem starts. */
  var NAV = [
    {
      group: "Operations",
      items: [
        { id: "dashboard", label: "Dashboard", icon: "dashboard", feature: "DASHBOARD" },
        { id: "floor",     label: "Floor",     icon: "floor",     feature: "FLOOR" },
        { id: "sessions",  label: "Sessions",  icon: "sessions",  feature: "SESSION_MANAGEMENT" },
        { id: "customers", label: "Customers", icon: "customers", feature: "CUSTOMERS" },
        { id: "billing",   label: "Billing",   icon: "billing",   feature: "BILLING" }
      ]
    },
    {
      group: "Catalogue",
      items: [
        { id: "games",       label: "Games",       icon: "games",     feature: "SESSION_MANAGEMENT" },
        { id: "game-library", label: "Game Library", icon: "games",   feature: "SESSION_MANAGEMENT" },
        { id: "fnb",         label: "F&B",         icon: "fnb",       feature: "FNB" },
        { id: "inventory",   label: "Inventory",   icon: "inventory", feature: "INVENTORY" },
        { id: "session-master", label: "Session Master", icon: "clock",   feature: "SESSION_MANAGEMENT" },
        { id: "gaming-prices", label: "Gaming Prices", icon: "billing", feature: "SESSION_MANAGEMENT" },
        { id: "pricing-windows", label: "Peak & Happy Hours", icon: "clock", feature: "SESSION_MANAGEMENT" },
        { id: "packages",    label: "Packages",    icon: "packages",   feature: "PRODUCTS" },
        { id: "memberships", label: "Memberships", icon: "membership", feature: "MEMBERSHIP" },
        { id: "discounts",   label: "Discount Codes", icon: "sparkle", feature: "BILLING" },
        { id: "reservations",label: "Reservations",icon: "reservations", planned: true }
      ]
    },
    {
      group: "Infrastructure",
      items: [
        { id: "devices",   label: "Devices",   icon: "devices",   feature: "PC_CONTROL" },
        { id: "discovery", label: "Discovery", icon: "radar" },
        { id: "telemetry", label: "Telemetry", icon: "telemetry", feature: "PC_CONTROL" },
        { id: "logs",      label: "Server Log", icon: "logs" }
      ]
    },
    {
      group: "Business",
      items: [
        { id: "ai",       label: "CafeXP AI", icon: "sparkle",  feature: "AI" },
        { id: "reports",  label: "Reports",  icon: "reports",   feature: "REPORTS" },
        { id: "payments", label: "Payments", icon: "billing",   feature: "BILLING" },
        { id: "staff",    label: "Staff",    icon: "staff",     feature: "STAFF" },
        { id: "audit",    label: "Audit Log", icon: "audit" }
      ]
    },
    {
      /* Configuration, gathered in one place. Receipt Template moved out of
         Operations and Subscription out of Business: neither is something a
         member of staff does during a shift, and hunting for the receipt
         layout among the day's tills is how it stays unconfigured.

         They stay separate nav entries rather than becoming tabs inside the
         Settings page, because Receipt Template is gated on BILLING while
         Settings is deliberately ungated — the sidebar is where entitlements
         are applied, so folding one into the other would quietly drop its
         gate and show the page to a café that has not paid for it. */
      group: "Settings",
      items: [
        { id: "settings", label: "Settings", icon: "settings" },
        { id: "receipt-template", label: "Receipt Template", icon: "edit", feature: "BILLING" },
        { id: "plan",     label: "Subscription", icon: "plan" }
      ]
    }
  ];

  var flat = {};
  NAV.forEach(function (g) { g.items.forEach(function (it) { flat[it.id] = it; }); });

  /* Effective entitlements, as last fetched.
     `null` means "not yet known", which is deliberately different from "known
     to grant nothing": until the backend answers, everything is shown. A café
     whose network hiccups at start-up must not open to an empty sidebar. */
  var entitlements = null;

  function featureAllowed(item) {
    if (!item.feature) return true;            // structural, always present
    if (!entitlements) return true;            // not known yet — show it
    var f = entitlements[item.feature];
    return !f || f.enabled !== false;
  }

  function visibleNav() {
    return NAV.map(function (group) {
      return {
        group: group.group,
        items: group.items.filter(featureAllowed)
      };
    }).filter(function (group) { return group.items.length > 0; });
  }

  var current = null;
  var host = null;
  var navButtons = {};
  var navToken = 0;      // guards against a slow exit animation mounting a stale view

  /* ==========================================================================
     SIDEBAR
     ========================================================================== */
  var sidebarHost = null;

  function renderSidebar(mountEl) {
    sidebarHost = mountEl || sidebarHost;
    if (!sidebarHost) return;
    UI.clear(sidebarHost);
    navButtons = {};

    var nav = UI.el("nav", { class: "nav" });

    visibleNav().forEach(function (group) {
      var g = UI.el("div", { class: "nav-group" }, [
        UI.el("div", { class: "nav-group-label", text: group.group })
      ]);
      group.items.forEach(function (item) {
        var btn = UI.el("button", {
          class: "nav-item" + (item.planned ? " is-planned" : ""),
          type: "button",
          "data-nav": item.id,
          "data-tip": item.planned ? item.label + " — design ready, backend not built yet" : item.label,
          html:
            '<span class="nav-icon">' + Icon(item.icon, 17) + "</span>" +
            '<span class="nav-label">' + UI.esc(item.label) + "</span>" +
            (item.planned ? '<span class="nav-soon">soon</span>' : '<span class="nav-badge nav-badge-muted hidden" data-badge="' + item.id + '"></span>'),
          onClick: function () { go(item.id); }
        });
        navButtons[item.id] = btn;
        g.appendChild(btn);
      });
      nav.appendChild(g);
    });

    sidebarHost.appendChild(nav);

    // Re-mark the open page after a rebuild, or the highlight is lost.
    if (current && navButtons[current]) {
      navButtons[current].setAttribute("aria-current", "page");
    }
  }

  /* ==========================================================================
     ENTITLEMENTS

     Applied here rather than baked into the build. ManagerXP switches a
     feature on or off for a café; the next refresh moves the sidebar. There
     is one CafeXP application, not one per package.
     ========================================================================== */

  /**
   * Take a fresh entitlement set and rebuild the sidebar around it.
   *
   * If the café the console is signed into cannot be resolved to an
   * organization — an install predating the tenancy migration — the backend
   * says so rather than guessing, and nothing is hidden. Removing half a
   * working café's navigation on the strength of an answer nobody gave would
   * be the worst possible failure mode.
   */
  function applyEntitlements(payload) {
    if (!payload || payload.resolved === false || !payload.features) {
      entitlements = null;
      renderSidebar();
      return;
    }

    entitlements = payload.features;
    renderSidebar();

    /* If the open page has just been switched off, move rather than leaving
       staff looking at a screen they are no longer entitled to. */
    if (current && flat[current] && !featureAllowed(flat[current])) {
      var fallback = visibleNav()[0] && visibleNav()[0].items[0];
      if (fallback) {
        UI.toast.warn(
          flat[current].label + " is not included in this subscription any more"
        );
        current = null;                 // force the swap; go() ignores a repeat
        go(fallback.id);
      }
    }
  }

  /** Ask the backend what this café is entitled to, and apply the answer. */
  function refreshEntitlements() {
    if (!Store || !Store.getEntitlements) return Promise.resolve(null);
    return Store.getEntitlements()
      .then(function (payload) { applyEntitlements(payload); return payload; })
      .catch(function (err) {
        /* A failed check must never lock a café out of its own console. The
           last known answer stands; if there was none, everything shows. */
        console.warn("[entitlements] check failed, keeping current navigation:", err && err.message);
        return null;
      });
  }

  /** Show a count pill on a nav entry (e.g. discovered PCs waiting). */
  function setBadge(id, value, tone) {
    var badge = document.querySelector('[data-badge="' + id + '"]');
    if (!badge) return;
    if (!value) { badge.classList.add("hidden"); return; }
    badge.classList.remove("hidden");
    badge.className = "nav-badge" + (tone === "accent" ? "" : " nav-badge-muted");
    if (badge.textContent !== String(value)) {
      badge.textContent = value;
      Motion.animate(badge, { transform: ["scale(.6)", "scale(1)"] }, { duration: 0.24, easing: Motion.EASE.out });
    }
  }

  /* ==========================================================================
     VIEW SWAP
     ========================================================================== */
  function go(id) {
    var page = global.CXPages && global.CXPages[id];
    if (!page) { UI.toast.warn("Unknown page", id); return; }
    if (current === id) return;

    var previous = current;
    current = id;
    var token = ++navToken;

    Object.keys(navButtons).forEach(function (key) {
      if (key === id) navButtons[key].setAttribute("aria-current", "page");
      else navButtons[key].removeAttribute("aria-current");
    });

    var titleEl = document.getElementById("topbarTitle");
    var crumbEl = document.getElementById("topbarCrumb");
    if (titleEl) titleEl.textContent = page.title || flat[id].label;
    if (crumbEl) crumbEl.textContent = page.subtitle || "";

    var tools = document.getElementById("topbarPageTools");
    if (tools) UI.clear(tools);

    // Tear down the previous page so intervals/subscriptions don't leak.
    if (previous && global.CXPages[previous] && global.CXPages[previous].unmount) {
      try { global.CXPages[previous].unmount(); } catch (e) { console.error(e); }
    }

    var outgoing = host.firstElementChild;
    var incoming = UI.el("div", { class: "page-view" });

    function swap() {
      if (token !== navToken) return;      // a newer navigation already won
      UI.clear(host);
      host.appendChild(incoming);
      try {
        page.mount(incoming, { tools: tools });
      } catch (e) {
        console.error("[router] mount failed for " + id, e);
        UI.clear(incoming);
        incoming.appendChild(UI.errorState("This page failed to render: " + e.message));
      }
      Motion.enter(incoming, { y: 10, duration: 0.24 });
      var scroller = document.getElementById("pageScroll");
      if (scroller) scroller.scrollTop = 0;
    }

    if (outgoing && Motion.enabled) {
      // A stalled animation must never strand staff on a blank page: whichever
      // settles first — the exit or a short deadline — triggers the swap, and
      // the token guard stops it running twice.
      Promise.race([
        Promise.resolve(Motion.exit(outgoing, { y: -6, duration: 0.12 })),
        new Promise(function (resolve) { setTimeout(resolve, 240); })
      ]).then(swap);
    } else {
      swap();
    }
  }

  function currentPage() { return current; }

  /* ==========================================================================
     SIDEBAR COLLAPSE
     ========================================================================== */
  function toggleSidebar() {
    var app = document.getElementById("app");
    var collapsed = app.classList.toggle("sidebar-collapsed");
    localStorage.setItem("cx.sidebar.collapsed", collapsed ? "1" : "0");
    var btn = document.getElementById("sidebarToggle");
    if (btn) {
      btn.innerHTML = Icon(collapsed ? "chevronR" : "chevronL", 16);
      btn.setAttribute("data-tip", collapsed ? "Expand sidebar  (Ctrl+B)" : "Collapse sidebar  (Ctrl+B)");
    }
  }

  function restoreSidebar() {
    if (localStorage.getItem("cx.sidebar.collapsed") === "1") {
      document.getElementById("app").classList.add("sidebar-collapsed");
      var btn = document.getElementById("sidebarToggle");
      if (btn) btn.innerHTML = Icon("chevronR", 16);
    }
  }

  /* ==========================================================================
     INIT
     ========================================================================== */
  function init(opts) {
    host = opts.host;
    renderSidebar(opts.sidebarNav);
    restoreSidebar();

    /* Fetch entitlements after the first paint, not before it. The sidebar
       renders immediately from the full list and narrows a moment later if
       the subscription says so — the alternative is a console that shows
       nothing until the network answers, which is worse on every connection
       and unusable on a bad one.

       Re-checked periodically so a change made in ManagerXP reaches the café
       without anyone restarting the application. */
    refreshEntitlements();
    setInterval(refreshEntitlements, 15 * 60 * 1000);

    // Keyboard: Ctrl+B collapse, Ctrl+1..4 jump to the main operational pages.
    var quick = ["dashboard", "floor", "games", "devices"];
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); return; }
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= quick.length) { e.preventDefault(); go(quick[n - 1]); }
    });

    go(opts.start || "dashboard");
  }

  global.CXRouter = {
    NAV: NAV,
    init: init,
    go: go,
    current: currentPage,
    setBadge: setBadge,
    toggleSidebar: toggleSidebar,
    // Exposed so the Subscription page can show what is entitled, and force a
    // re-check after an admin change without waiting for the next interval.
    refreshEntitlements: refreshEntitlements,
    entitlements: function () { return entitlements; }
  };
})(window);
