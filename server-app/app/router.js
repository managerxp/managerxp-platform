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

     `feature` names the entitlement that grants the section — what the
     café's ManagerXP subscription includes. `permission` names what the
     signed-in staff member's ROLE grants — set by the café owner in Staff →
     Roles, using the exact same permission keys that page already lets them
     toggle. The two are independent axes and both must pass: a café can be
     entitled to Billing and still keep it out of a cashier's sidebar, and a
     role can be trusted with Billing on a café that has not bought it —
     either gate alone hiding the entry is enough.

     There is deliberately no `if (plan === 'basic')` or `if (role ===
     'cashier')` anywhere in this application, and there must never be one —
     a new module should become visible by being switched on in ManagerXP or
     granted in Roles, with no build.

     An entry with no `feature` is exempt from the subscription check —
     Settings, Subscription and Updates must survive a lapsed plan, since
     they are how a café reads why and fixes it. An entry with no
     `permission` is exempt from the role check instead — Dashboard and
     Notifications are what every signed-in person needs regardless of what
     they are trusted to change. Most entries carry both. */
  var NAV = [
    {
      group: "Operations",
      items: [
        { id: "dashboard", label: "Dashboard", icon: "dashboard", feature: "DASHBOARD" },
        { id: "notifications", label: "Notifications", icon: "bell" },
        { id: "floor",     label: "Floor",     icon: "floor",     feature: "FLOOR",             permission: "floor.view" },
        { id: "sessions",  label: "Sessions",  icon: "sessions",  feature: "SESSION_MANAGEMENT", permission: "sessions.view" },
        { id: "customers", label: "Customers", icon: "customers", feature: "CUSTOMERS",          permission: "customers.view" },
        { id: "billing",   label: "Billing",   icon: "billing",   feature: "BILLING",            permission: "billing.counter" }
      ]
    },
    {
      group: "Catalogue",
      items: [
        { id: "games",       label: "Games",       icon: "games",     feature: "SESSION_MANAGEMENT", permission: "sessions.view" },
        { id: "game-library", label: "Game Library", icon: "games",   feature: "SESSION_MANAGEMENT", permission: "sessions.view" },
        { id: "credentials", label: "Game Credentials", icon: "settings", feature: "SESSION_MANAGEMENT", permission: "games.credentials" },
        { id: "fnb",         label: "F&B",         icon: "fnb",       feature: "FNB",       permission: "products.view" },
        { id: "inventory",   label: "Inventory",   icon: "inventory", feature: "INVENTORY", permission: "inventory.adjust" },
        { id: "session-master", label: "Session Master", icon: "clock",   feature: "SESSION_MANAGEMENT", permission: "sessions.manage" },
        { id: "gaming-prices", label: "Gaming Prices", icon: "billing", feature: "SESSION_MANAGEMENT", permission: "pricing.manage" },
        { id: "pricing-windows", label: "Peak & Happy Hours", icon: "clock", feature: "SESSION_MANAGEMENT", permission: "pricing.manage" },
        { id: "packages",    label: "Packages",    icon: "packages",   feature: "PRODUCTS",    permission: "packages.manage" },
        { id: "memberships", label: "Memberships", icon: "membership", feature: "MEMBERSHIP",  permission: "packages.manage" },
        { id: "discounts",   label: "Discount Codes", icon: "sparkle", feature: "BILLING",      permission: "discounts.manage" },
        { id: "reservations",label: "Reservations",icon: "reservations", feature: "RESERVATIONS", permission: "sessions.view" }
      ]
    },
    {
      group: "Infrastructure",
      items: [
        { id: "devices",   label: "Devices",   icon: "devices",   feature: "PC_CONTROL", permission: "station.power" },
        { id: "discovery", label: "Discovery", icon: "radar",                            permission: "floor.discovery" },
        { id: "telemetry", label: "Telemetry", icon: "telemetry", feature: "PC_CONTROL", permission: "telemetry.view" },
        { id: "logs",      label: "Server Log", icon: "logs",                            permission: "system.logs" }
      ]
    },
    {
      group: "Business",
      items: [
        { id: "ai",       label: "CafeXP AI", icon: "sparkle",  feature: "AI",      permission: "ai.ask" },
        { id: "reports",  label: "Reports",  icon: "reports",   feature: "REPORTS", permission: "reports.view" },
        { id: "payments", label: "Payments", icon: "billing",   feature: "BILLING", permission: ["payments.gateway.view", "payments.topup.view"] },
        { id: "expenses", label: "Expenses", icon: "billing",                       permission: "expenses.view" },
        { id: "staff",    label: "Staff",    icon: "staff",     feature: "STAFF",   permission: "staff.view" },
        { id: "audit",    label: "Audit Log", icon: "audit",                        permission: "audit.view" }
      ]
    },
    {
      /* Configuration, gathered in one place. Receipt Template moved out of
         Operations and Subscription out of Business: neither is something a
         member of staff does during a shift, and hunting for the receipt
         layout among the day's tills is how it stays unconfigured. Updates
         belongs here for the same reason — it is about this installation,
         not a task done mid-shift.

         They stay separate nav entries rather than becoming tabs inside the
         Settings page, because Receipt Template is gated on BILLING while
         Settings and Updates are deliberately ungated — the sidebar is where
         entitlements are applied, so folding one into the other would
         quietly drop its gate and show the page to a café that has not paid
         for it. */
      group: "Settings",
      items: [
        { id: "settings", label: "Settings", icon: "settings",                    permission: "settings.view" },
        { id: "receipt-template", label: "Receipt Template", icon: "edit", feature: "BILLING", permission: "settings.manage" },
        { id: "plan",     label: "Subscription", icon: "plan",                    permission: "settings.view" },
        { id: "updates",  label: "Updates", icon: "refresh",                      permission: "settings.view" }
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

  /* Store.can() itself already resolves to true for an owner token and for
     "not yet known" (permissions load a moment after the sidebar first
     paints, same reasoning as entitlements above) — this is just the nav
     item's opt-out for the entries every signed-in person needs regardless
     of role. An array means "any one of these" — Payments covers gateway
     config and top-up review, two different keys the owner may grant
     independently, and either is reason enough to show the door to it. */
  function permissionAllowed(item) {
    if (!item.permission) return true;
    if (!Store || !Store.can) return true;
    var keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some(function (key) { return Store.can(key); });
  }

  /* Nav *visibility* is a role question now, not a subscription one — see
     go() for where a feature the plan doesn't include actually takes effect.
     A café should be able to see Reservations exists and what it costs to
     add, the same way a locked door still has a sign on it; a cashier a
     role never trusted with Staff should not see there is a door at all. */
  function visibleNav() {
    return NAV.map(function (group) {
      return {
        group: group.group,
        items: group.items.filter(permissionAllowed)
      };
    }).filter(function (group) { return group.items.length > 0; });
  }

  var current = null;
  var currentLocked = false;   // true when `current` shows the upsell, not the real page
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

  /** Force the page on screen to be re-evaluated against the current
      answers — used when a lock state might have flipped under it, since
      go()'s own guard otherwise ignores a repeat navigation to the same id. */
  function refreshCurrentPage() {
    if (!current) return;
    var id = current;
    current = null;
    go(id);
  }

  /* Permission loss still evicts — a role that no longer trusts someone with
     Staff means the page is not merely locked-with-a-price-tag, it should
     not be reachable at all, so this moves them off it rather than showing
     an upsell for something not for sale to their role in the first place. */
  function leaveHiddenPage(reasonSuffix) {
    if (!current || !flat[current] || permissionAllowed(flat[current])) return;
    var fallback = visibleNav()[0] && visibleNav()[0].items[0];
    if (!fallback) return;
    UI.toast.warn(flat[current].label + " " + reasonSuffix);
    current = null;                 // force the swap; go() ignores a repeat
    go(fallback.id);
  }

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
    var wasAllowed = current && flat[current] ? featureAllowed(flat[current]) : null;

    if (!payload || payload.resolved === false || !payload.features) {
      entitlements = null;
    } else {
      entitlements = payload.features;
    }
    renderSidebar();

    /* Nav visibility no longer depends on this, so a routine 15-minute
       recheck that changes nothing about the plan must not disturb whoever
       is mid-task on the page they're already looking at — only flip the
       view if that page's own lock state actually changed. */
    if (current && flat[current] && featureAllowed(flat[current]) !== wasAllowed) {
      refreshCurrentPage();
    }
  }

  /** Re-render around whatever Store.can() answers now. Fires once
      permissions first resolve after sign-in, and again on Store's periodic
      re-check below — a café owner editing a role in Staff → Roles reaches
      whoever is already signed in with it within that interval, not only on
      their next login. */
  function applyPermissions() {
    renderSidebar();
    leaveHiddenPage("is not part of your role any more");
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

  /* ==========================================================================
     UPSELL — the screen a feature-gated page shows instead of itself.

     Every add-on ManagerXP sells is fetched once and cached (see
     Store.listAddonCatalog), so this can name a price rather than just
     saying a feature is missing. If the catalogue has not landed yet when a
     locked page is first opened, it fetches once and repaints in place —
     the alternative, blocking navigation on that request, would make an
     ordinary click feel like it hung.
     ========================================================================== */
  var addonCatalog = null;

  function refreshAddonCatalog() {
    if (!Store || !Store.listAddonCatalog) return Promise.resolve(null);
    return Store.listAddonCatalog().then(function (list) {
      addonCatalog = list;
      return list;
    }).catch(function () { return null; });
  }

  /** The first published add-on that would switch this feature on, if any. */
  function addonForFeature(featureKey) {
    if (!addonCatalog) return null;
    for (var i = 0; i < addonCatalog.length; i++) {
      var grants = addonCatalog[i].features || [];
      for (var j = 0; j < grants.length; j++) {
        if (grants[j].feature_key === featureKey) return addonCatalog[i];
      }
    }
    return null;
  }

  function formatPrice(addon) {
    var n = Number(addon.price) || 0;
    var whole = Math.round(n * 100) % 100 === 0;
    return (whole ? String(Math.round(n)) : n.toFixed(2)) + " " + (addon.currency || "INR");
  }

  function renderLockedFeature(container, item) {
    var addon = addonForFeature(item.feature);
    container.innerHTML =
      '<div class="page">' +
        '<div class="page-head"><div>' +
          '<div class="page-title">' + UI.esc(item.label) + "</div>" +
          '<div class="page-sub">Not included in your current plan</div>' +
        "</div></div>" +
        '<div class="card card-pad" style="max-width:560px">' +
          '<div class="notice" data-status="warning">' + Icon("alert", 18) +
            "<div>" + UI.esc(item.label) + " is not part of your café's current CafeXP subscription.</div></div>" +
          (addon
            ? '<div class="col" style="margin-top:var(--s-4)">' +
                '<div class="kv"><span class="kv-key">Available as</span><span class="kv-val">' + UI.esc(addon.name) + "</span></div>" +
                '<div class="kv"><span class="kv-key">Price</span><span class="kv-val">' + UI.esc(formatPrice(addon)) +
                  ' <span class="faint">/ ' + UI.esc(addon.billing_period || "monthly") + "</span></span></div>" +
                (addon.description
                  ? '<div class="faint" style="font-size:13px;margin-top:var(--s-2)">' + UI.esc(addon.description) + "</div>"
                  : "") +
              "</div>"
            : "") +
          '<div class="faint" style="margin-top:var(--s-4);font-size:13px;line-height:1.6">' +
            "Contact ManagerXP to add this to your plan." +
          "</div>" +
        "</div>" +
      "</div>";
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

    var item = flat[id];
    // A feature the plan doesn't include shows the upsell instead of the
    // real page — never mounted, so nothing on it fetches data or runs.
    var locked = !!item && !featureAllowed(item);

    var previous = current;
    var previousLocked = currentLocked;
    current = id;
    currentLocked = locked;
    var token = ++navToken;

    Object.keys(navButtons).forEach(function (key) {
      if (key === id) navButtons[key].setAttribute("aria-current", "page");
      else navButtons[key].removeAttribute("aria-current");
    });

    var titleEl = document.getElementById("topbarTitle");
    var crumbEl = document.getElementById("topbarCrumb");
    if (titleEl) titleEl.textContent = (item && item.label) || page.title || (item ? item.label : id);
    if (crumbEl) crumbEl.textContent = locked ? "" : (page.subtitle || "");

    var tools = document.getElementById("topbarPageTools");
    if (tools) UI.clear(tools);

    // Tear down the previous page so intervals/subscriptions don't leak —
    // only if it was ever actually mounted; a locked page never was.
    if (previous && !previousLocked && global.CXPages[previous] && global.CXPages[previous].unmount) {
      try { global.CXPages[previous].unmount(); } catch (e) { console.error(e); }
    }

    var outgoing = host.firstElementChild;
    var incoming = UI.el("div", { class: "page-view" });

    function swap() {
      if (token !== navToken) return;      // a newer navigation already won
      UI.clear(host);
      host.appendChild(incoming);
      if (locked) {
        renderLockedFeature(incoming, item);
        if (!addonCatalog) {
          refreshAddonCatalog().then(function () {
            // Only repaint if this is still the page on screen.
            if (token === navToken) renderLockedFeature(incoming, item);
          });
        }
      } else {
        try {
          page.mount(incoming, { tools: tools });
        } catch (e) {
          console.error("[router] mount failed for " + id, e);
          UI.clear(incoming);
          incoming.appendChild(UI.errorState("This page failed to render: " + e.message));
        }
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
    refreshAddonCatalog();   // best-effort; a locked page fetches again if this missed

    /* Permissions load asynchronously too (see Store.init's onUserUpdated
       handler) and the sidebar must narrow the moment they land, not stay on
       "show everything" for the rest of the session. Re-checked on the same
       schedule as entitlements so a role edited in Staff → Roles reaches
       whoever is already signed in with it. */
    if (Store && Store.on) Store.on("permissions", applyPermissions);
    if (Store && Store.loadPermissions) setInterval(Store.loadPermissions, 15 * 60 * 1000);

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
