/* ==========================================================================
   CafeXP — Settings
   Organised into the sections from the admin spec. Only settings that map to
   something real are editable; the rest state plainly where they will live.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;
  var tab = "business";

  var TABS = [
    { id: "business", label: "Business" },
    { id: "stations", label: "Stations" },
    { id: "gaming",   label: "Gaming" },
    { id: "system",   label: "System" }
  ];

  /* ==========================================================================
     BUSINESS
     ========================================================================== */
  function businessPane() {
    var user = Store.state.user || {};
    var pane = UI.el("div", { class: "grid grid-split" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Cafe</h2>' +
        '<span class="badge badge-plain">Read only</span></div>' +
      '<div class="card-body col">' +
        '<div class="kv"><span class="kv-key">Account name</span><span class="kv-val">' + UI.esc(user.name || "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Email</span><span class="kv-val">' + UI.esc(user.email || "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Cafe ID</span><span class="kv-val mono">' + UI.esc(user.cafe_id != null ? user.cafe_id : "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Branch</span><span class="kv-val mono">1</span></div>' +
      "</div>" +
      '<div class="card-foot faint" style="font-size:12px">' +
        "Cafe details are managed in the CafeXP web account, not in this desktop console." +
      "</div>";

    var missing = UI.el("div", { class: "card" });
    missing.innerHTML =
      '<div class="card-head"><h2>Invoicing &amp; tax</h2>' +
        '<span class="badge" data-status="warning">Not built yet</span></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">Invoice numbering, tax rates and receipt footers belong here. They need the billing system, which does not exist yet.</div>' +
        '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div>See the <strong>Billing</strong> section for what is required.</div></div>" +
      "</div>";

    pane.appendChild(card);
    pane.appendChild(missing);
    return pane;
  }

  /* ==========================================================================
     STATIONS
     ========================================================================== */
  function stationsPane() {
    var pane = UI.el("div", { class: "col gap-4" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Station registry</h2>' +
        '<button class="btn btn-primary btn-sm" id="setAddStation">' + Icon("plus", 14) +
        '<span class="btn-label">Add station</span></button></div>';

    var body = UI.el("div", { class: "card-body-flush" });
    if (!Store.state.pcs.length) {
      body.appendChild(UI.emptyState({
        icon: "floor", title: "No stations registered",
        text: "Add a station manually or register one from Discovery."
      }));
    } else {
      var wrap = UI.el("div", { class: "table-wrap" });
      var table = UI.el("table", { class: "tbl" });
      table.innerHTML = "<thead><tr><th>Name</th><th>IP address</th><th>Port</th><th>State</th><th></th></tr></thead>";
      var tbody = UI.el("tbody");

      Store.state.pcs.forEach(function (pc) {
        var tr = UI.el("tr");
        tr.innerHTML =
          "<td><strong>" + UI.esc(pc.name) + "</strong></td>" +
          '<td class="mono faint" style="font-size:12px">' + UI.esc(pc.ip_address || "—") + "</td>" +
          '<td class="mono faint" style="font-size:12px">' + UI.esc(pc.port || "—") + "</td>" +
          '<td><span class="badge" data-status="' + (pc.is_active === false ? "idle" : "online") + '">' +
            (pc.is_active === false ? "Inactive" : "Active") + "</span></td>" +
          '<td class="td-actions"></td>';

        var edit = UI.el("button", { class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit station" });
        edit.addEventListener("click", function () {
          global.CXStationPanel.editStation(pc, function () { render(); });
        });
        tr.querySelector(".td-actions").appendChild(edit);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
    }
    card.appendChild(body);
    pane.appendChild(card);

    var zones = UI.el("div", { class: "card" });
    zones.innerHTML =
      '<div class="card-head"><h2>Zones</h2><span class="badge" data-status="warning">Not built yet</span></div>' +
      '<div class="card-body faint" style="font-size:13px;line-height:1.6">' +
        "Main floor, VIP and other groupings need a zone column on the stations table. Every station currently belongs to one flat floor." +
      "</div>";
    pane.appendChild(zones);

    setTimeout(function () {
      var addBtn = pane.querySelector("#setAddStation");
      if (addBtn) addBtn.addEventListener("click", function () { global.CXPages.floor.addStationDialog(); });
    }, 0);

    return pane;
  }

  /* ==========================================================================
     GAMING
     ========================================================================== */
  function gamingPane() {
    var pane = UI.el("div", { class: "grid grid-split" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Software catalogue</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">' +
          "Applications are configured per station: which executables exist and where they live on that machine." +
        "</div>" +
        '<div class="col" id="swSummary"></div>' +
      "</div>" +
      '<div class="card-foot"><button class="btn btn-outline btn-sm" id="goGames">' + Icon("games", 14) +
        '<span class="btn-label">Open games &amp; software</span></button></div>';

    var launcher = UI.el("div", { class: "card" });
    launcher.innerHTML =
      '<div class="card-head"><h2>Launcher</h2><span class="badge badge-plain">Client-side</span></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">' +
          "Launching is handled by the client agent on each station over the existing WebSocket connection. The admin sends the executable path and a duration; the client starts the process and closes it when time runs out." +
        "</div>" +
        '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div>Kiosk lock, unlock and remote restart are not implemented in the client yet, so those controls are not offered here.</div></div>" +
      "</div>";

    pane.appendChild(card);
    pane.appendChild(launcher);

    setTimeout(function () {
      var goBtn = pane.querySelector("#goGames");
      if (goBtn) goBtn.addEventListener("click", function () { global.CXRouter.go("games"); });

      var summary = pane.querySelector("#swSummary");
      if (!summary) return;
      summary.innerHTML = '<div class="kv"><span class="kv-key">Stations</span><span class="kv-val num">' +
        Store.state.pcs.length + "</span></div>";
      Store.getSoftwareMaster()
        .then(function (list) {
          summary.innerHTML += '<div class="kv"><span class="kv-key">Catalogue entries</span><span class="kv-val num">' +
            list.length + "</span></div>";
        })
        .catch(function () {
          summary.innerHTML += '<div class="kv"><span class="kv-key">Catalogue</span><span class="kv-val faint">Unavailable</span></div>';
        });
    }, 0);

    return pane;
  }

  /* ==========================================================================
     SYSTEM
     ========================================================================== */
  function systemPane() {
    var pane = UI.el("div", { class: "grid grid-split" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Connection</h2></div>' +
      '<div class="card-body col">' +
        '<div class="kv"><span class="kv-key">Backend API</span><span class="kv-val mono selectable" style="font-size:12px">' + UI.esc(Store.API_BASE) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Signed in</span><span class="kv-val">' + (Store.state.user ? "Yes" : "No") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Stations connected</span><span class="kv-val num">' + Store.counts().online + "</span></div>" +
        '<div class="kv"><span class="kv-key">Log lines this session</span><span class="kv-val num">' + Store.state.logs.length + "</span></div>" +
      "</div>";

    var prefs = UI.el("div", { class: "card" });
    prefs.innerHTML =
      '<div class="card-head"><h2>Console</h2></div>' +
      '<div class="card-body col gap-4">' +
        '<label class="switch row-between" style="width:100%">' +
          "<span><span style='font-size:13px;font-weight:550'>Start with the sidebar collapsed</span>" +
          "<span class='faint' style='display:block;font-size:11px'>Also toggled with Ctrl+B</span></span>" +
          '<span class="row gap-2"><input type="checkbox" id="prefCollapsed"><span class="switch-track"></span></span>' +
        "</label>" +
        '<div class="kv"><span class="kv-key">Motion</span><span class="kv-val">' +
          (Motion.enabled ? "Enabled" : "Reduced (system setting)") + "</span></div>" +
      "</div>" +
      '<div class="card-foot"><button class="btn btn-danger btn-sm" id="btnSignOut">' + Icon("logout", 14) +
        '<span class="btn-label">Sign out</span></button></div>';

    pane.appendChild(card);
    pane.appendChild(prefs);

    setTimeout(function () {
      var toggle = pane.querySelector("#prefCollapsed");
      if (toggle) {
        toggle.checked = localStorage.getItem("cx.sidebar.collapsed") === "1";
        toggle.addEventListener("change", function () {
          var isCollapsed = document.getElementById("app").classList.contains("sidebar-collapsed");
          if (toggle.checked !== isCollapsed) global.CXRouter.toggleSidebar();
          else localStorage.setItem("cx.sidebar.collapsed", toggle.checked ? "1" : "0");
        });
      }
      var out = pane.querySelector("#btnSignOut");
      if (out) out.addEventListener("click", function () {
        UI.confirm({
          title: "Sign out?",
          message: "You will need to sign in again to manage this cafe.",
          confirmLabel: "Sign out", variant: "danger"
        }).then(function (ok) { if (ok) Store.logout(); });
      });
    }, 0);

    return pane;
  }

  var PANES = { business: businessPane, stations: stationsPane, gaming: gamingPane, system: systemPane };

  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#settingsPane");
    if (!host) return;
    UI.clear(host);
    var pane = PANES[tab]();
    host.appendChild(pane);
    Motion.enter(pane, { y: 8 });
  }

  global.CXPages.settings = {
    title: "Settings",
    subtitle: "Console and cafe configuration",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Settings</div>' +
            '<div class="page-sub">Configuration for this cafe and this console.</div>' +
          "</div>" +
        "</div>" +
        '<div class="tabs" id="settingsTabs" style="margin-bottom:var(--s-5)">' +
          TABS.map(function (t) {
            return '<button data-tab="' + t.id + '" aria-selected="' + (t.id === tab) + '">' + UI.esc(t.label) + "</button>";
          }).join("") +
        "</div>" +
        '<div id="settingsPane"></div>';
      root.appendChild(page);

      Array.prototype.forEach.call(page.querySelectorAll("#settingsTabs button"), function (btn) {
        btn.addEventListener("click", function () {
          tab = btn.dataset.tab;
          Array.prototype.forEach.call(page.querySelectorAll("#settingsTabs button"), function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          render();
        });
      });

      offs.push(Store.on("pcs", render));
      offs.push(Store.on("user", render));
      render();
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    }
  };
})(window);
