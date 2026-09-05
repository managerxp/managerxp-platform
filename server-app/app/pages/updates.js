/* ==========================================================================
   CafeXP — Software updates

   What ManagerXP has published, and which systems — this console and every
   connected station — are behind it. A station behind the latest client
   build can be pushed one manually here ("Update now"), the same real
   mechanism app/main.js's automatic 30-minute sweep already uses — this
   just does not wait for the timer. Either way it only QUEUES the update;
   see update-schedule.js for the policy deciding *when* it is actually safe
   to apply (never while a session is running).

   Grouped with Settings, Receipt Template and Subscription rather than
   folded into the Settings page's own tabs — the same reason those three
   are separate nav entries and not tabs of one another: each is its own
   concern with its own gate (or lack of one), and merging them would mean
   whichever page hosts the rest quietly setting the terms for it.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon;
  global.CXPages = global.CXPages || {};

  var pageRoot = null;
  var offs = [];
  var updConsole = null;   // last /api/updates/mine?component=server answer
  var updClient = null;    // last /api/updates/mine?component=client answer
  var updLoading = false;

  function localVersionSort(v) {
    var parts = String(v || "0.0.0").replace(/^v/i, "").split(".");
    var major = parseInt(parts[0], 10) || 0;
    var minor = parseInt(parts[1], 10) || 0;
    var patch = parseInt(String(parts[2] || "0").split("-")[0], 10) || 0;
    return major * 1000000 + minor * 1000 + patch;
  }

  function loadUpdateInfo(force) {
    if (updLoading) return Promise.resolve();
    if (!force && (updConsole || updClient)) return Promise.resolve();
    updLoading = true;

    var getVersion = (global.api && global.api.getAppVersion)
      ? global.api.getAppVersion() : Promise.resolve("0.0.0");

    return getVersion.then(function (v) {
      return Promise.all([
        Store.checkUpdate("server", v || "0.0.0").catch(function (e) { return { entitled: false, reason: "error", detail: e.message }; }),
        // '0.0.0' always reads as behind, which is the point — this call exists
        // only to learn latest_version, compared per-station below.
        Store.checkUpdate("client", "0.0.0").catch(function (e) { return { entitled: false, reason: "error", detail: e.message }; })
      ]);
    }).then(function (res) {
      updConsole = res[0];
      updClient = res[1];
    }).finally(function () { updLoading = false; });
  }

  function reasonText(data) {
    if (!data) return "Unknown";
    if (data.reason === "no_organization") return "This installation is not linked to a business yet.";
    if (data.reason === "subscription_lapsed") return "Renew the subscription to receive updates.";
    if (data.reason === "no_release") return "No release has been published yet.";
    if (data.reason === "error") return data.detail || "Could not reach ManagerXP.";
    return data.detail || "Unavailable.";
  }

  function paintConsole() {
    if (!pageRoot) return;
    var host = pageRoot.querySelector("#updConsoleBody");
    if (!host) return;
    if (!updConsole) {
      host.innerHTML = '<div class="faint" style="font-size:13px">Checking…</div>';
      return;
    }
    if (!updConsole.entitled || updConsole.reason === "no_release") {
      host.innerHTML = '<div class="kv"><span class="kv-key">Status</span><span class="kv-val faint">' +
        UI.esc(reasonText(updConsole)) + "</span></div>";
      return;
    }
    var rows =
      '<div class="kv"><span class="kv-key">Current version</span><span class="kv-val mono">' +
        UI.esc(updConsole.current_version) + "</span></div>" +
      '<div class="kv"><span class="kv-key">Latest published</span><span class="kv-val mono">' +
        UI.esc(updConsole.latest_version) +
        (updConsole.is_mandatory ? ' <span class="badge" data-status="warning">Mandatory</span>' : "") +
        "</span></div>" +
      '<div class="kv"><span class="kv-key">Status</span><span class="kv-val">' +
        (updConsole.update_available
          ? '<span class="badge" data-status="warning">Update available</span>'
          : '<span class="badge" data-status="online">Up to date</span>') +
        "</span></div>";
    if (updConsole.update_available && updConsole.release_notes) {
      rows += '<div class="kv" style="align-items:flex-start"><span class="kv-key">Release notes</span>' +
        '<span class="kv-val faint" style="font-size:12px;white-space:pre-wrap">' + UI.esc(updConsole.release_notes) + "</span></div>";
    }
    host.innerHTML = rows;
  }

  function paintStations() {
    if (!pageRoot) return;
    var host = pageRoot.querySelector("#updStationsBody");
    if (!host) return;
    UI.clear(host);

    if (!Store.state.pcs.length) {
      host.appendChild(UI.emptyState({ icon: "devices", title: "No stations registered" }));
      return;
    }

    var latest = updClient && updClient.entitled && updClient.reason !== "no_release" ? updClient.latest_version : null;

    var wrap = UI.el("div", { class: "table-wrap" });
    var table = UI.el("table", { class: "tbl" });
    table.innerHTML = "<thead><tr><th>Station</th><th>Client version</th><th>Last reported</th><th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    Store.state.pcs.forEach(function (pc) {
      var version = pc.client_version || null;
      var behind = !!(version && latest && localVersionSort(version) < localVersionSort(latest));
      var status = "—";
      if (!version) {
        status = '<span class="badge badge-plain">Not reported yet</span>';
      } else if (!latest) {
        status = '<span class="badge badge-plain">Unknown</span>';
      } else if (behind) {
        status = '<span class="badge" data-status="warning">Update available</span>';
      } else {
        status = '<span class="badge" data-status="online">Up to date</span>';
      }

      var tr = UI.el("tr");
      tr.innerHTML =
        "<td><strong>" + UI.esc(pc.name) + "</strong></td>" +
        '<td class="mono faint" style="font-size:12px">' + UI.esc(version || "—") + "</td>" +
        '<td class="faint" style="font-size:12px">' +
          (pc.client_version_seen_at ? UI.esc(new Date(pc.client_version_seen_at).toLocaleString()) : "—") + "</td>" +
        "<td>" + status + "</td>" +
        '<td class="td-actions"></td>';

      // Only offered when there is somewhere for it to go and someone
      // connected to hand it to — a button that queues an update nobody can
      // receive is worse than no button.
      if (behind && Store.isConnected(pc.name)) {
        var btn = UI.el("button", {
          class: "btn btn-outline btn-sm",
          html: Icon("download", 13) + '<span class="btn-label">Update now</span>'
        });
        btn.title = "Queue this station's update — it installs the moment the station is next free, same as the automatic check";
        btn.addEventListener("click", function () {
          UI.withBusy(btn, function () {
            return Store.pushUpdateNow(pc.name).then(function (data) {
              UI.toast.ok("Update queued", pc.name + " will update to " + data.latest_version + " once it is free");
            }).catch(function (e) {
              UI.toast.error("Could not queue the update", e.message);
            });
          });
        });
        tr.querySelector(".td-actions").appendChild(btn);
      }
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function refresh(force) {
    return loadUpdateInfo(force).then(function () {
      paintConsole();
      paintStations();
    });
  }

  global.CXPages.updates = {
    title: "Updates",
    subtitle: "This console and every connected station, against what ManagerXP has published",

    mount: function (root) {
      pageRoot = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Updates</div>' +
          '<div class="page-sub">What ManagerXP has published, and whether this café is on it.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="updRecheck">' + Icon("refresh", 15) +
          '<span class="btn-label">Check again</span></button>' +
        "</div></div>" +
        '<div class="col gap-4">' +
          '<div class="card"><div class="card-head"><h2>This console</h2></div>' +
            '<div class="card-body col" id="updConsoleBody"></div></div>' +
          '<div class="card"><div class="card-head"><h2>Connected systems</h2>' +
            '<span class="badge badge-plain" id="updStationCount">0 stations</span></div>' +
            '<div class="card-body-flush" id="updStationsBody"></div></div>' +
          '<div class="card"><div class="card-head"><h2>When an update applies</h2></div>' +
            '<div class="card-body col gap-3" id="updPolicyBody"></div></div>' +
        "</div>";
      root.appendChild(page);

      var desc = global.CXUpdateSchedule ? global.CXUpdateSchedule.describe({}) : null;
      page.querySelector("#updPolicyBody").innerHTML =
        '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div><strong>Stations</strong> — " + UI.esc(desc ? desc.client : "Applied when a station is free.") + "</div></div>" +
        '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div><strong>This console</strong> — " + UI.esc(desc ? desc.server : "Applied at a scheduled time.") + "</div></div>" +
        '<div class="faint" style="font-size:12px;line-height:1.6">A session in progress always blocks an update on that station, ' +
          "and one running anywhere on the floor blocks the console — this page will not offer to apply anything while that is true." +
        "</div>";

      var recheck = page.querySelector("#updRecheck");
      recheck.addEventListener("click", function () {
        UI.withBusy(recheck, function () {
          return refresh(true).then(function () {
            var available = (updConsole && updConsole.update_available) || (updClient && updClient.update_available);
            UI.toast[available ? "info" : "ok"](available ? "An update is available" : "Everything is up to date");
          });
        });
      });

      function paintStationCount() {
        var el = page.querySelector("#updStationCount");
        if (!el) return;
        var n = Store.state.pcs.length;
        el.textContent = n + " station" + (n === 1 ? "" : "s");
      }

      offs.push(Store.on("pcs", function () { paintStationCount(); paintStations(); }));
      paintStationCount();
      paintConsole();
      paintStations();
      refresh(false);
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      pageRoot = null;
    }
  };
})(window);
