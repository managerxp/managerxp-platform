/* ==========================================================================
   CafeXP Admin — Telemetry
   What each station's hardware is actually doing. Every figure here is a
   counter the station measured and pushed; anything it could not read shows
   as "—", never as zero.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var stations = [];
  var limits = {};
  var summary = {};
  var loading = false;
  var loadError = null;
  var pollTimer = null;
  var offTelemetry = null;

  var WINDOWS = [
    { minutes: 60, label: "1h" },
    { minutes: 360, label: "6h" },
    { minutes: 1440, label: "24h" },
    { minutes: 10080, label: "7d" }
  ];

  /* ==========================================================================
     FORMATTING
     ========================================================================== */
  function bytes(n) {
    if (n === null || n === undefined) return "—";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var value = Number(n), i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return value.toFixed(value >= 100 || i === 0 ? 0 : 1) + " " + units[i];
  }

  function percent(n) {
    return n === null || n === undefined ? "—" : Number(n).toFixed(0) + "%";
  }

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    var s = Number(seconds);
    var days = Math.floor(s / 86400);
    var hours = Math.floor((s % 86400) / 3600);
    var mins = Math.floor((s % 3600) / 60);
    if (days) return days + "d " + hours + "h";
    if (hours) return hours + "h " + mins + "m";
    return mins + "m";
  }

  /** Which colour a reading earns, against the café's own thresholds. */
  function levelFor(value, limit) {
    if (value === null || value === undefined) return "idle";
    if (limit === undefined || limit === null) return "online";
    var v = Number(value), l = Number(limit);
    if (v >= l + 8) return "offline";
    if (v >= l) return "warning";
    return "online";
  }

  /* ==========================================================================
     PIECES
     ========================================================================== */
  function meter(label, value, limit, detail) {
    var level = levelFor(value, limit);
    var wrap = UI.el("div", { class: "tm-meter", dataset: { status: level } });
    wrap.innerHTML =
      '<div class="tm-meter-head">' +
        "<span>" + UI.esc(label) + "</span>" +
        '<span class="tm-meter-value">' + percent(value) + "</span>" +
      "</div>" +
      '<div class="tm-track"><span class="tm-fill" style="width:' +
        (value === null || value === undefined ? 0 : Math.min(100, Number(value))) + '%"></span></div>' +
      (detail ? '<div class="tm-meter-detail">' + UI.esc(detail) + "</div>" : "");
    return wrap;
  }

  /**
   * A sparkline drawn from the history the backend returned. No points means
   * no line — an empty box is honest, a flat line at zero is not.
   */
  function sparkline(points, key, status) {
    var values = points
      .map(function (p) { return p[key]; })
      .filter(function (v) { return v !== null && v !== undefined; });

    if (values.length < 2) {
      return UI.el("div", {
        class: "tm-spark tm-spark-empty faint",
        text: "Not enough history yet"
      });
    }

    var w = 100, h = 28;
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var span = Math.max(max - min, 1);

    var d = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * w;
      var y = h - ((v - min) / span) * (h - 2) - 1;
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");

    var el = UI.el("div", { class: "tm-spark", dataset: { status: status || "online" } });
    el.innerHTML =
      '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="' + d + " L" + w + "," + h + " L0," + h + ' Z" class="tm-spark-fill"/>' +
        '<path d="' + d + '" class="tm-spark-line"/>' +
      "</svg>" +
      '<span class="tm-spark-range">' + Math.round(min) + "–" + Math.round(max) + "%</span>";
    return el;
  }

  /* ==========================================================================
     STATION DETAIL
     ========================================================================== */
  function openStation(station) {
    var minutes = 60;
    var panel = UI.drawer({ head: "", body: "" });

    function renderHead() {
      var state = station.reporting ? "online" : "idle";
      panel.head.innerHTML =
        '<div class="row-between gap-3">' +
          "<div style='min-width:0'>" +
            '<div class="row gap-3" style="align-items:center">' +
              '<span class="page-title" style="font-size:22px">' + UI.esc(station.pc_name) + "</span>" +
              '<span class="badge badge-lg" data-status="' + state + '">' +
                '<span class="dot' + (station.reporting ? " dot-live" : "") + '"></span>' +
                (station.reporting ? "Reporting" : "Not reporting") +
              "</span>" +
            "</div>" +
            '<div class="mono faint" style="font-size:12px;margin-top:4px">' +
              UI.esc(station.ip_address || "no address") +
              (station.zone_name ? " · " + UI.esc(station.zone_name) : "") +
            "</div>" +
          "</div>" +
          '<button class="modal-close" id="tmClose" aria-label="Close">' + Icon("close", 15) + "</button>" +
        "</div>";
      panel.head.querySelector("#tmClose").addEventListener("click", function () { panel.close(); });
    }

    function renderBody() {
      UI.clear(panel.body);
      var body = UI.el("div", { class: "col gap-5" });
      panel.body.appendChild(body);
      var sample = station.sample;

      if (!sample) {
        body.appendChild(UI.emptyState({
          icon: "telemetry",
          title: "This station has never reported",
          text: "Telemetry starts once the station's client app connects to this console. " +
                "Check that it is running and registered."
        }));
        return;
      }

      if (station.alerts.length) {
        station.alerts.forEach(function (alert) {
          var note = UI.el("div", {
            class: "notice",
            dataset: { status: alert.level === "critical" ? "offline" : "warning" }
          });
          note.innerHTML = Icon("alert", 16) + "<div>" + UI.esc(alert.message) + "</div>";
          body.appendChild(note);
        });
      }

      var meters = UI.el("div", { class: "col gap-3" });
      meters.appendChild(meter("CPU", sample.cpu_percent, limits.cpu,
        sample.cpu_model ? sample.cpu_model + " · " + (sample.cpu_cores || "?") + " threads" : null));
      meters.appendChild(meter("Memory", sample.mem_percent, limits.mem,
        sample.mem_total_bytes
          ? bytes(sample.mem_used_bytes) + " of " + bytes(sample.mem_total_bytes) + " used"
          : null));
      meters.appendChild(meter("Disk", sample.disk_percent, limits.disk,
        sample.disk_total_bytes
          ? bytes(sample.disk_free_bytes) + " free of " + bytes(sample.disk_total_bytes)
          : null));
      body.appendChild(meters);

      var facts = UI.el("div", { class: "card card-pad col" });
      [
        ["Graphics", sample.gpu_name || "Not reported"],
        ["Video memory", bytes(sample.gpu_vram_bytes)],
        ["Temperature", sample.temperature_c === null
          ? "Not available on this machine"
          : Number(sample.temperature_c).toFixed(1) + " °C"],
        ["Network latency", sample.latency_ms === null ? "—" : sample.latency_ms + " ms"],
        ["Uptime", duration(sample.uptime_seconds)],
        ["Operating system", (sample.platform || "?") + " " + (sample.os_release || "")],
        ["Running application", sample.running_app || "None launched from here"],
        ["Last sample", UI.relTime(sample.sampled_at)]
      ].forEach(function (pair) {
        var row = UI.el("div", { class: "kv" });
        row.innerHTML = '<span class="kv-key">' + UI.esc(pair[0]) + "</span>" +
          '<span class="kv-val">' + UI.esc(String(pair[1])) + "</span>";
        facts.appendChild(row);
      });
      body.appendChild(facts);

      /* ---- history ---- */
      var histCard = UI.el("div", { class: "card" });
      histCard.innerHTML =
        '<div class="card-head"><h3>History</h3>' +
          '<div class="segmented" id="tmWindow">' +
            WINDOWS.map(function (w) {
              return '<button type="button" data-min="' + w.minutes + '"' +
                (w.minutes === minutes ? ' aria-selected="true"' : "") + ">" + w.label + "</button>";
            }).join("") +
          "</div></div>" +
        '<div class="card-body col gap-4" id="tmHistory"></div>';
      body.appendChild(histCard);

      var histHost = histCard.querySelector("#tmHistory");

      function loadHistory() {
        UI.clear(histHost);
        histHost.appendChild(UI.skeletonRows(3));
        Store.telemetryHistory(station.pc_name, minutes, 120)
          .then(function (result) {
            UI.clear(histHost);
            var points = result.data || [];
            if (!points.length) {
              histHost.appendChild(UI.emptyState({
                icon: "telemetry",
                title: "No samples in this window",
                text: "Nothing was recorded for " + station.pc_name + " over this period."
              }));
              return;
            }
            [
              ["CPU", "cpu_percent", limits.cpu],
              ["Memory", "mem_percent", limits.mem],
              ["Disk", "disk_percent", limits.disk]
            ].forEach(function (series) {
              var block = UI.el("div", { class: "col gap-2" });
              block.innerHTML = '<div class="row-between"><span class="session-label">' +
                series[0] + '</span><span class="faint" style="font-size:11px">' +
                points.length + " points</span></div>";
              block.appendChild(sparkline(points, series[1],
                levelFor(points[points.length - 1][series[1]], series[2])));
              histHost.appendChild(block);
            });
          })
          .catch(function (err) {
            UI.clear(histHost);
            histHost.appendChild(UI.errorState(err.message, loadHistory));
          });
      }

      UI.$$("#tmWindow button", histCard).forEach(function (btn) {
        btn.addEventListener("click", function () {
          minutes = parseInt(btn.dataset.min, 10);
          UI.$$("#tmWindow button", histCard).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          loadHistory();
        });
      });

      var actions = UI.el("div", { class: "row gap-2" });
      var sampleNow = UI.el("button", {
        class: "btn btn-outline",
        html: Icon("refresh", 15) + '<span class="btn-label">Sample now</span>'
      });
      sampleNow.addEventListener("click", function () {
        UI.withBusy(sampleNow, function () {
          return Store.requestTelemetry(station.pc_name).then(function (r) {
            if (r && r.success) UI.toast.ok("Asked " + station.pc_name + " for a sample");
            else UI.toast.warn("Station is not connected", "Nothing to ask.");
          });
        });
      });

      var clearBtn = UI.el("button", {
        class: "btn btn-danger",
        html: Icon("trash", 15) + '<span class="btn-label">Clear history</span>'
      });
      clearBtn.addEventListener("click", function () {
        UI.confirm({
          title: "Clear telemetry for " + station.pc_name + "?",
          message: "Every stored sample for this station is deleted. Live readings continue.",
          confirmLabel: "Clear", variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.clearTelemetry(station.pc_name)
            .then(function (r) { UI.toast.ok(r.message); loadHistory(); return load(); })
            .catch(function (e) { UI.toast.error("Could not clear", e.message); });
        });
      });

      actions.appendChild(sampleNow);
      actions.appendChild(clearBtn);
      body.appendChild(actions);

      loadHistory();
    }

    renderHead();
    renderBody();
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true;
    loadError = null;
    render();

    return Store.telemetryLatest()
      .then(function (body) {
        stations = body.data || [];
        limits = body.thresholds || {};
        summary = body.summary || {};
        loading = false;
        render();
      })
      .catch(function (err) {
        loading = false;
        loadError = err.message;
        render();
      });
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#tmBody");
    if (!host) return;
    UI.clear(host);

    renderSummary();

    if (loading && !stations.length) { host.appendChild(UI.skeletonCards(6, "150px")); return; }
    if (loadError) {
      host.appendChild(UI.errorState(
        loadError === "Your role does not allow this (telemetry.view)"
          ? "Your role does not allow you to see station telemetry."
          : loadError,
        load
      ));
      return;
    }

    if (!stations.length) {
      host.appendChild(UI.emptyState({
        icon: "telemetry",
        status: "accent",
        title: "No stations registered",
        text: "Telemetry follows the floor — register a station and its client app starts reporting.",
        actions: [{ label: "Go to Floor", icon: "floor", variant: "primary",
          onClick: function () { global.CXRouter.go("floor"); } }]
      }));
      return;
    }

    var grid = UI.el("div", { class: "grid grid-stations" });

    stations.forEach(function (station) {
      var worst = station.alerts.reduce(function (acc, a) {
        return a.level === "critical" ? "offline" : (acc === "offline" ? acc : "warning");
      }, null);
      var status = !station.sample ? "idle" : (worst || (station.reporting ? "online" : "idle"));

      var card = UI.el("div", {
        class: "card card-pad col gap-3 tm-card",
        dataset: { status: status },
        style: { cursor: "pointer" }
      });

      card.innerHTML =
        '<div class="row-between" style="align-items:flex-start">' +
          '<div class="row gap-2" style="min-width:0">' +
            '<span class="dot' + (station.reporting ? " dot-live" : "") + '"></span>' +
            "<div style='min-width:0'>" +
              '<div style="font-size:15px;font-weight:700">' + UI.esc(station.pc_name) + "</div>" +
              '<div class="faint" style="font-size:10px">' +
                (station.zone_name ? UI.esc(station.zone_name) + " · " : "") +
                (station.sample ? UI.esc(UI.relTime(station.sample.sampled_at)) : "never reported") +
              "</div>" +
            "</div>" +
          "</div>" +
          (station.alerts.length
            ? '<span class="badge">' + station.alerts.length + " alert" +
              (station.alerts.length > 1 ? "s" : "") + "</span>"
            : "") +
        "</div>";

      if (!station.sample) {
        var none = UI.el("div", {
          class: "faint", style: { fontSize: "12px", padding: "var(--s-3) 0" },
          text: "No telemetry yet. The station's client app reports once it connects."
        });
        card.appendChild(none);
      } else {
        var meters = UI.el("div", { class: "col gap-2" });
        meters.appendChild(meter("CPU", station.sample.cpu_percent, limits.cpu));
        meters.appendChild(meter("Memory", station.sample.mem_percent, limits.mem));
        meters.appendChild(meter("Disk", station.sample.disk_percent, limits.disk));
        card.appendChild(meters);

        var foot = UI.el("div", { class: "row gap-4 faint", style: { fontSize: "10px" } });
        foot.innerHTML =
          "<span>" + UI.esc(station.sample.gpu_name || "GPU not reported") + "</span>" +
          "<span>" + (station.sample.latency_ms === null ? "—" : station.sample.latency_ms + " ms") + "</span>" +
          "<span>up " + duration(station.sample.uptime_seconds) + "</span>";
        card.appendChild(foot);
      }

      card.addEventListener("click", function () { openStation(station); });
      grid.appendChild(card);
    });

    host.appendChild(grid);
    Motion.stagger(grid.children, { step: 0.03, y: 10 });
  }

  function renderSummary() {
    var strip = rootEl.querySelector("#tmSummary");
    if (!strip) return;
    UI.clear(strip);

    [
      ["Stations", summary.stations || 0, "accent"],
      ["Reporting", summary.reporting || 0, "online"],
      ["Alerting", summary.alerting || 0, summary.alerting ? "warning" : "idle"],
      ["Never reported", summary.never_reported || 0, summary.never_reported ? "warning" : "idle"]
    ].forEach(function (kpi) {
      var card = UI.el("div", { class: "stat stat-accent", dataset: { status: kpi[2] } });
      card.innerHTML =
        '<div class="stat-label">' + kpi[0] + "</div>" +
        '<div class="stat-value">' + kpi[1] + "</div>";
      strip.appendChild(card);
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.telemetry = {
    title: "Telemetry",
    subtitle: "Hardware health per station",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Telemetry</div>' +
          '<div class="page-sub">What each station\'s hardware is doing. A counter a machine ' +
            "cannot read shows as “—”, never as zero.</div>" +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="tmRefresh">' + Icon("refresh", 15) +
            '<span class="btn-label">Refresh</span></button>' +
        "</div></div>" +
        '<div class="grid grid-kpi" id="tmSummary" style="margin-bottom:var(--s-5)"></div>' +
        '<div id="tmBody"></div>';
      root.appendChild(page);

      var refreshBtn = page.querySelector("#tmRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      load();

      // The backend is the source of truth for the wall, but a push from a
      // station arrives here first — reload on it so the page reacts at the
      // station's cadence rather than only on the poll.
      if (global.api && global.api.onTelemetry) {
        global.api.onTelemetry(function () {
          clearTimeout(offTelemetry);
          // Coalesce a burst of stations reporting at once into one reload.
          offTelemetry = setTimeout(load, 1200);
        });
      }

      pollTimer = setInterval(load, 30000);
    },

    unmount: function () {
      clearInterval(pollTimer);
      clearTimeout(offTelemetry);
      pollTimer = null;
      rootEl = null;
    }
  };
})(window);
