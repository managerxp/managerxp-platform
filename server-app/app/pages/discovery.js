/* ==========================================================================
   CafeXP — Discovery
   Clients broadcasting on the LAN that are not in the station registry yet.
   Registration uses the existing /api/pcs/register-discovered route.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;

  /* ==========================================================================
     REGISTER DIALOG
     ========================================================================== */
  function registerDialog(dpc) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="card card-pad col gap-1" style="background:var(--bg-inset)">' +
        '<div class="kv"><span class="kv-key">IP address</span><span class="kv-val mono">' + UI.esc(dpc.ip) + "</span></div>" +
        '<div class="kv"><span class="kv-key">MAC address</span><span class="kv-val mono" style="font-size:11px">' + UI.esc(dpc.mac) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Hostname</span><span class="kv-val">' + UI.esc(dpc.hostname || "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Port</span><span class="kv-val mono">' + UI.esc(dpc.port || 9090) + "</span></div>" +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label field-req" for="regName">Station name</label>' +
        '<input class="input" id="regName" placeholder="PC-01" data-autofocus>' +
        '<div class="field-hint">This is the name staff will see on the floor.</div>' +
      "</div>";

    return UI.modal({
      title: "Register station",
      description: "Adds this client to your station registry.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Register", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#regName").value.trim();
            if (!name) {
              Motion.shake(ctx.body.querySelector("#regName"));
              UI.toast.warn("A station name is required");
              return false;
            }
            return Store.registerDiscoveredPC({
              cafe_id: (Store.state.user && Store.state.user.cafe_id) || 1,
              branch_id: 1,
              name: name,
              ip_address: dpc.ip,
              mac_address: dpc.mac,
              hostname: dpc.hostname,
              port: dpc.port
            })
              .then(function () {
                UI.toast.ok("Registered", name + " is now on the floor");
                // Drop it from the pending list, same as the old flow.
                Store.state.discovered = Store.state.discovered.filter(function (p) { return p.ip !== dpc.ip; });
                Store.emit("discovered", Store.state.discovered);
                return Store.loadPCs();
              })
              .then(function () { return true; })
              .catch(function (e) { UI.toast.error("Registration failed", e.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     LIST
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#discoveryList");
    if (!host) return;
    UI.clear(host);

    var list = Store.state.discovered;
    if (!list.length) {
      host.appendChild(UI.emptyState({
        icon: "radar",
        status: "online",
        title: "Every client is registered",
        text: "No unregistered CafeXP clients are broadcasting on the network. New machines appear here automatically as they come online.",
        actions: [{
          label: "Rescan network", icon: "refresh", variant: "outline",
          onClick: function () {
            Store.refreshPCList().then(function (r) {
              if (r && r.success) UI.toast.ok("Network rescanned", "Total stations: " + r.totalPCs);
              else UI.toast.error("Rescan failed", (r && r.error) || "");
            }).catch(function (e) { UI.toast.error("Rescan failed", e.message); });
          }
        }]
      }));
      return;
    }

    var grid = UI.el("div", { class: "grid grid-stations" });
    var made = [];
    list.forEach(function (dpc) {
      var card = UI.el("div", { class: "card card-pad col gap-3", dataset: { status: "maintenance" } });
      card.innerHTML =
        '<div class="row-between">' +
          '<div class="row gap-2"><span class="dot dot-live" data-status="maintenance"></span>' +
            '<strong style="font-size:14px">' + UI.esc(dpc.hostname || "Unknown host") + "</strong></div>" +
          '<span class="badge" data-status="maintenance">Unregistered</span>' +
        "</div>" +
        '<div class="col gap-1">' +
          '<div class="kv"><span class="kv-key">IP</span><span class="kv-val mono">' + UI.esc(dpc.ip) + "</span></div>" +
          '<div class="kv"><span class="kv-key">MAC</span><span class="kv-val mono" style="font-size:11px">' + UI.esc(dpc.mac) + "</span></div>" +
          '<div class="kv"><span class="kv-key">Port</span><span class="kv-val mono">' + UI.esc(dpc.port || 9090) + "</span></div>" +
        "</div>";

      var btn = UI.el("button", {
        class: "btn btn-primary btn-block",
        html: Icon("plus", 15) + '<span class="btn-label">Register station</span>'
      });
      btn.addEventListener("click", function () { registerDialog(dpc); });
      card.appendChild(btn);
      grid.appendChild(card);
      made.push(card);
    });
    host.appendChild(grid);
    Motion.stagger(made, { step: 0.03, y: 10 });
  }

  global.CXPages.discovery = {
    title: "Discovery",
    subtitle: "Clients waiting to be registered",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Discovery</div>' +
            '<div class="page-sub">CafeXP clients broadcasting on this network that are not registered yet.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="btnRescan">' + Icon("refresh", 15) + '<span class="btn-label">Rescan</span></button>' +
            '<button class="btn btn-primary" id="btnManualAdd">' + Icon("plus", 15) + '<span class="btn-label">Add manually</span></button>' +
          "</div>" +
        "</div>" +
        '<div id="discoveryList"></div>';
      root.appendChild(page);

      var rescanBtn = page.querySelector("#btnRescan");
      rescanBtn.addEventListener("click", function () {
        UI.withBusy(rescanBtn, function () {
          return Store.refreshPCList().then(function (r) {
            if (r && r.success) UI.toast.ok("Network rescanned", r.message || ("Total stations: " + r.totalPCs));
            else UI.toast.error("Rescan failed", (r && r.error) || "");
            return Store.loadPCs();
          }).catch(function (e) { UI.toast.error("Rescan failed", e.message); });
        });
      });

      page.querySelector("#btnManualAdd").addEventListener("click", function () {
        global.CXPages.floor.addStationDialog();
      });

      offs.push(Store.on("discovered", render));
      offs.push(Store.on("pcs", render));
      render();
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    },

    registerDialog: registerDialog
  };
})(window);
