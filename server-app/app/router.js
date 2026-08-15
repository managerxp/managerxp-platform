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
     explains exactly what is missing rather than showing invented data. */
  var NAV = [
    {
      group: "Operations",
      items: [
        { id: "dashboard", label: "Dashboard", icon: "dashboard" },
        { id: "floor",     label: "Floor",     icon: "floor" },
        { id: "sessions",  label: "Sessions",  icon: "sessions", planned: true },
        { id: "customers", label: "Customers", icon: "customers", planned: true },
        { id: "billing",   label: "Billing",   icon: "billing", planned: true }
      ]
    },
    {
      group: "Catalogue",
      items: [
        { id: "games",       label: "Games",       icon: "games" },
        { id: "fnb",         label: "F&B",         icon: "fnb", planned: true },
        { id: "inventory",   label: "Inventory",   icon: "inventory", planned: true },
        { id: "packages",    label: "Packages",    icon: "packages", planned: true },
        { id: "memberships", label: "Memberships", icon: "membership", planned: true },
        { id: "reservations",label: "Reservations",icon: "reservations", planned: true }
      ]
    },
    {
      group: "Infrastructure",
      items: [
        { id: "devices",   label: "Devices",   icon: "devices" },
        { id: "discovery", label: "Discovery", icon: "radar" },
        { id: "telemetry", label: "Telemetry", icon: "telemetry", planned: true },
        { id: "logs",      label: "Server Log", icon: "logs" }
      ]
    },
    {
      group: "Business",
      items: [
        { id: "reports",  label: "Reports",  icon: "reports", planned: true },
        { id: "staff",    label: "Staff",    icon: "staff", planned: true },
        { id: "audit",    label: "Audit Log", icon: "audit", planned: true },
        { id: "plan",     label: "Subscription", icon: "plan" },
        { id: "settings", label: "Settings", icon: "settings" }
      ]
    }
  ];

  var flat = {};
  NAV.forEach(function (g) { g.items.forEach(function (it) { flat[it.id] = it; }); });

  var current = null;
  var host = null;
  var navButtons = {};
  var navToken = 0;      // guards against a slow exit animation mounting a stale view

  /* ==========================================================================
     SIDEBAR
     ========================================================================== */
  function renderSidebar(mountEl) {
    var nav = UI.el("nav", { class: "nav" });

    NAV.forEach(function (group) {
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

    mountEl.appendChild(nav);
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
      Promise.resolve(Motion.exit(outgoing, { y: -6, duration: 0.12 })).then(swap);
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
    toggleSidebar: toggleSidebar
  };
})(window);
