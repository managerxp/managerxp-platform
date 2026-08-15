/* ==========================================================================
   CafeXP — Devices
   The diagnostic view of the station fleet: reachability, failure counts and
   the last connection error, as reported by the main process.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;

  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#deviceTable");
    if (!host) return;
    UI.clear(host);

    if (!Store.state.pcs.length) {
      host.appendChild(UI.emptyState({
        icon: "devices",
        title: "No stations registered",
        text: "Devices appear here once stations are added to the registry.",
        actions: [{ label: "Go to Floor", icon: "floor", variant: "primary", onClick: function () { global.CXRouter.go("floor"); } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr>" +
        "<th>Station</th><th>Address</th><th>MAC</th><th>Status</th>" +
        "<th>Running</th><th>Failures</th><th>Last error</th><th></th>" +
      "</tr></thead>";
    var tbody = UI.el("tbody");

    Store.state.pcs.forEach(function (pc) {
      var status = Store.pcStatus(pc);
      var cs = Store.state.connectionStatus[pc.name] || {};
      var run = Store.state.running[pc.name];

      var tr = UI.el("tr", { dataset: { status: status } });
      tr.innerHTML =
        '<td><div class="row gap-2"><span class="dot' + (status === "online" || status === "gaming" ? " dot-live" : "") + '"></span>' +
          '<strong>' + UI.esc(pc.name) + "</strong></div></td>" +
        '<td class="mono faint" style="font-size:12px">' + UI.esc(pc.ip_address || "—") + ":" + UI.esc(pc.port || "—") + "</td>" +
        '<td class="mono faint" style="font-size:11px">' + UI.esc(pc.mac_address || "—") + "</td>" +
        '<td><span class="badge">' + UI.esc({ online: "Online", gaming: "In use", offline: "Offline", inactive: "Deactivated" }[status] || status) + "</span></td>" +
        "<td>" + (run ? UI.esc(run.appName) + ' <span class="faint mono">' + UI.hms(run.remaining) + "</span>" : '<span class="faint">—</span>') + "</td>" +
        '<td class="td-num">' + (cs.failures ? '<span style="color:var(--danger)">' + UI.esc(cs.failures) + "</span>" : '<span class="faint">0</span>') + "</td>" +
        '<td class="truncate" style="max-width:260px;font-size:12px;color:var(--text-3)" title="' + UI.esc(cs.error || "") + '">' +
          UI.esc(cs.error || "—") + "</td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");
      var retry = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon", html: Icon("link", 13), "data-tip": "Reconnect"
      });
      retry.addEventListener("click", function (e) {
        e.stopPropagation();
        UI.withBusy(retry, function () {
          return Store.clearFailures(pc.name)
            .then(function () { return Store.connectToPC(pc.ip_address, pc.port, pc.name); })
            .then(function (r) {
              if (r && r.success) UI.toast.ok("Connecting to " + pc.name);
              else UI.toast.error("Connection failed", (r && r.error) || "");
            })
            .catch(function (err) { UI.toast.error("Connection failed", err.message); });
        });
      });
      var openBtn = UI.el("button", {
        class: "btn btn-ghost btn-sm btn-icon", html: Icon("panel", 13), "data-tip": "Open control panel"
      });
      openBtn.addEventListener("click", function (e) { e.stopPropagation(); global.CXStationPanel.open(pc.name); });
      actions.appendChild(retry);
      actions.appendChild(openBtn);

      tr.addEventListener("click", function () { global.CXStationPanel.open(pc.name); });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  global.CXPages.devices = {
    title: "Devices",
    subtitle: "Fleet connectivity and diagnostics",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Devices</div>' +
            '<div class="page-sub">Connection health for every registered station.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="btnStatusReport">' + Icon("info", 15) + '<span class="btn-label">Status report</span></button>' +
            '<button class="btn btn-primary" id="btnReconnectAll">' + Icon("refresh", 15) + '<span class="btn-label">Reconnect all</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="notice" data-status="info" style="margin-bottom:var(--s-4)">' + Icon("info", 16) +
          "<div>Stations report reachability and heartbeats only. Hardware metrics — CPU, GPU, memory, temperature — are not collected by the client yet; see <strong>Telemetry</strong> for what that needs.</div></div>" +
        '<div class="card card-body-flush" id="deviceTable"></div>';
      root.appendChild(page);

      var reconnectBtn = page.querySelector("#btnReconnectAll");
      reconnectBtn.addEventListener("click", function () {
        UI.withBusy(reconnectBtn, function () {
          return Store.reconnectAll().then(function (r) {
            if (r && r.success) UI.toast.ok("Reconnecting", r.reconnected + " station(s) queued");
            else UI.toast.error("Reconnect failed", (r && r.error) || "");
          }).catch(function (e) { UI.toast.error("Reconnect failed", e.message); });
        });
      });

      page.querySelector("#btnStatusReport").addEventListener("click", function () {
        Store.getConnectionStatus().then(function (result) {
          if (!result || !result.success) {
            UI.toast.error("Could not read status", (result && result.error) || "");
            return;
          }
          var rows = Object.keys(result.data || {}).map(function (k) { return result.data[k]; });
          var body = UI.el("div", { class: "table-wrap" });
          body.innerHTML = rows.length
            ? '<table class="tbl"><thead><tr><th>Station</th><th>Address</th><th>State</th><th class="td-num">Failures</th></tr></thead><tbody>' +
              rows.map(function (r) {
                return "<tr><td><strong>" + UI.esc(r.name) + "</strong></td>" +
                  '<td class="mono faint" style="font-size:12px">' + UI.esc(r.ip) + ":" + UI.esc(r.port) + "</td>" +
                  '<td><span class="badge" data-status="' + (r.connected ? "online" : "offline") + '">' +
                    (r.connected ? "Connected" : "Disconnected") + "</span></td>" +
                  '<td class="td-num">' + UI.esc(r.failures || 0) + "</td></tr>";
              }).join("") + "</tbody></table>"
            : '<div class="faint">No connection records yet.</div>';
          UI.modal({ title: "Connection status", size: "lg", body: body, actions: [{ label: "Close", variant: "ghost" }] });
        }).catch(function (e) { UI.toast.error("Could not read status", e.message); });
      });

      offs.push(Store.on("pcs", render));
      offs.push(Store.on("connected", render));
      offs.push(Store.on("connection-status", render));
      offs.push(Store.on("running", render));

      render();
      if (!Store.state.pcs.length && Store.state.user) Store.loadPCs().catch(function () {});
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    }
  };
})(window);
