/* ==========================================================================
   CafeXP — Server log
   Live runtime output from the main process (the "log" IPC channel).
   Session-scoped: this is not an audit trail and is not persisted.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;
  var level = "all";
  var query = "";
  var follow = true;

  function passes(entry) {
    if (level !== "all" && entry.level !== level) return false;
    if (query && entry.text.toLowerCase().indexOf(query.toLowerCase()) === -1) return false;
    return true;
  }

  function lineNode(entry) {
    var line = UI.el("div", { class: "log-line", dataset: { level: entry.level } });
    line.innerHTML =
      '<span class="log-time">' + entry.time.toLocaleTimeString([], { hour12: false }) + "</span>" +
      "<span>" + UI.esc(entry.text) + "</span>";
    return line;
  }

  function renderAll() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#console");
    if (!host) return;
    UI.clear(host);

    var entries = Store.state.logs.filter(passes);
    if (!entries.length) {
      host.appendChild(UI.emptyState({
        icon: "logs",
        title: Store.state.logs.length ? "Nothing matches" : "Waiting for activity",
        text: Store.state.logs.length
          ? "No log lines match the current filter."
          : "Connection attempts, launches, scans and errors stream in here as they happen."
      }));
      return;
    }
    entries.forEach(function (e) { host.appendChild(lineNode(e)); });
    if (follow) host.scrollTop = host.scrollHeight;
  }

  function appendOne(entry) {
    if (!rootEl) return;
    var host = rootEl.querySelector("#console");
    if (!host) return;
    if (host.querySelector(".empty")) { renderAll(); return; }
    if (!passes(entry)) return;
    host.appendChild(lineNode(entry));
    if (follow) host.scrollTop = host.scrollHeight;
    updateCounts();
  }

  function updateCounts() {
    if (!rootEl) return;
    var counts = { all: 0, error: 0, warn: 0, ok: 0, info: 0 };
    Store.state.logs.forEach(function (e) { counts.all++; counts[e.level]++; });
    Array.prototype.forEach.call(rootEl.querySelectorAll("#logFilters .chip"), function (chip) {
      var c = chip.querySelector(".chip-count");
      if (c) c.textContent = counts[chip.dataset.level] || 0;
    });
  }

  global.CXPages.logs = {
    title: "Server log",
    subtitle: "Live runtime output",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Server log</div>' +
            '<div class="page-sub">Live output from this server session. Not persisted between restarts.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<label class="switch" data-tip="Scroll to the newest line automatically">' +
              '<input type="checkbox" id="followToggle" checked><span class="switch-track"></span>' +
              '<span style="font-size:12px;color:var(--text-2)">Follow</span>' +
            "</label>" +
            '<button class="btn btn-outline" id="btnCopyLogs">' + Icon("copy", 15) + '<span class="btn-label">Copy</span></button>' +
          "</div>" +
        "</div>" +

        '<div class="toolbar">' +
          '<div class="search">' + Icon("search", 15) +
            '<input class="input" id="logSearch" type="search" placeholder="Filter log lines…" autocomplete="off"></div>' +
          '<div class="row gap-2" id="logFilters">' +
            [["all", "All", "accent"], ["error", "Errors", "offline"], ["warn", "Warnings", "warning"], ["ok", "Success", "online"], ["info", "Info", "idle"]]
              .map(function (f) {
                return '<button class="chip" data-level="' + f[0] + '" data-status="' + f[2] + '"' +
                  (f[0] === "all" ? ' aria-pressed="true"' : "") + ">" + f[1] + '<span class="chip-count">0</span></button>';
              }).join("") +
          "</div>" +
        "</div>" +

        '<div class="card card-body-flush"><div class="console" id="console"></div></div>';

      root.appendChild(page);

      page.querySelector("#followToggle").addEventListener("change", function (e) { follow = e.target.checked; });

      page.querySelector("#btnCopyLogs").addEventListener("click", function () {
        var text = Store.state.logs.filter(passes)
          .map(function (e) { return "[" + e.time.toLocaleTimeString([], { hour12: false }) + "] " + e.text; })
          .join("\n");
        navigator.clipboard.writeText(text)
          .then(function () { UI.toast.ok("Log copied", Store.state.logs.filter(passes).length + " lines"); })
          .catch(function () { UI.toast.error("Could not copy to the clipboard"); });
      });

      var search = page.querySelector("#logSearch");
      search.addEventListener("input", function () { query = search.value; renderAll(); });

      Array.prototype.forEach.call(page.querySelectorAll("#logFilters .chip"), function (chip) {
        chip.addEventListener("click", function () {
          level = chip.dataset.level;
          Array.prototype.forEach.call(page.querySelectorAll("#logFilters .chip"), function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
          });
          renderAll();
        });
      });

      offs.push(Store.on("log", appendOne));

      renderAll();
      updateCounts();
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    }
  };
})(window);
