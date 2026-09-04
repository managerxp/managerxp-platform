/* ==========================================================================
   CafeXP — Games & software
   Per-station software catalogue. Same endpoints as the old configuration
   modal: /api/pc-software (list/add/delete), /api/software-master (catalogue),
   and the fetch-pc-software IPC scan of a live client.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;
  var selectedPC = null;      // pc name
  var software = [];          // rows for the selected PC
  var loading = false;
  var scanned = [];           // live scan results from the client
  var masterList = [];

  function pc() { return selectedPC ? Store.getPC(selectedPC) : null; }

  /*
   * Only stations that run the client agent belong on this screen.
   *
   * Configuring software means storing an executable path and later telling
   * an agent to launch it. A pool table, a dartboard, a PS5 or a VR rig has
   * neither — the café sells time on them and the counter runs the timer, but
   * there is nothing to install a path against and nothing to launch it with.
   * Listing them here offered an operator a job that could never be completed.
   *
   * Keyed on having a network address, the same fact the connection layer
   * uses, rather than on category — "Pool" is a label somebody typed and
   * could be anything, while a missing address is what actually decides
   * whether an agent can ever be spoken to.
   */
  function configurableStations() {
    return (Store.state.pcs || []).filter(function (p) { return Store.isNetworked(p); });
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function loadSoftware() {
    var target = pc();
    if (!target) { software = []; renderDetail(); return Promise.resolve(); }
    loading = true;
    renderDetail();
    return Store.getPcSoftware(target.pc_id)
      .then(function (rows) { software = rows; loading = false; renderDetail(); })
      .catch(function (e) {
        loading = false;
        software = [];
        renderDetail(e.message);
      });
  }

  function selectPC(name) {
    /* Refuse a station that cannot hold software, wherever the name came
       from — a click, a deep link from the station panel, or a selection made
       before the station's address was removed. */
    var candidate = name ? Store.getPC(name) : null;
    selectedPC = candidate && Store.isNetworked(candidate) ? name : null;
    scanned = [];
    renderList();
    loadSoftware();
  }

  /* ==========================================================================
     STATION LIST (left column)
     ========================================================================== */
  function renderList() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#gamePcList");
    if (!host) return;
    UI.clear(host);

    var stations = configurableStations();

    if (!Store.state.pcs.length) {
      host.appendChild(UI.emptyState({
        icon: "floor", title: "No stations", text: "Register a station first.",
        actions: [{ label: "Go to Floor", onClick: function () { global.CXRouter.go("floor"); } }]
      }));
      return;
    }

    /* Stations exist, but none of them are PCs. Worth saying plainly rather
       than showing an empty list that looks like a loading failure. */
    if (!stations.length) {
      host.appendChild(UI.emptyState({
        icon: "games",
        title: "No PCs to configure",
        text: "Software is configured on PCs running the CafeXP client. Pool tables, " +
              "consoles and VR rigs are sold by the hour and need no software set up.",
        actions: [{ label: "Go to Floor", onClick: function () { global.CXRouter.go("floor"); } }]
      }));
      return;
    }

    stations.forEach(function (p) {
      var status = Store.pcStatus(p);
      var row = UI.el("button", {
        class: "floor-row",
        dataset: { status: status },
        style: { textAlign: "left", border: 0, background: selectedPC === p.name ? "var(--accent-soft)" : "transparent", width: "100%" }
      });
      row.innerHTML =
        '<div class="floor-row-name"><span class="dot' + (status === "online" || status === "gaming" ? " dot-live" : "") + '"></span>' +
          '<span class="truncate">' + UI.esc(p.name) + "</span></div>" +
        '<div class="floor-row-state mono" style="font-size:11px">' + UI.esc(p.ip_address || "") + "</div>" +
        "<div></div>" +
        '<span class="badge">' + UI.esc({ online: "Ready", gaming: "In use", offline: "Offline", inactive: "Off" }[status] || status) + "</span>";
      row.addEventListener("click", function () { selectPC(p.name); });
      host.appendChild(row);
    });
  }

  /* ==========================================================================
     SOFTWARE DETAIL (right column)
     ========================================================================== */
  function renderDetail(errorMessage) {
    if (!rootEl) return;
    var host = rootEl.querySelector("#gameDetail");
    if (!host) return;
    UI.clear(host);

    var target = pc();
    if (!target) {
      host.appendChild(UI.emptyState({
        icon: "games",
        title: "Select a station",
        text: "Choose a station on the left to manage the applications it can launch."
      }));
      return;
    }

    var connected = Store.isConnected(target.name);

    var head = UI.el("div", { class: "card-head" });
    head.innerHTML =
      "<div><h2>" + UI.esc(target.name) + "</h2>" +
        '<div class="faint mono" style="font-size:11px;margin-top:2px">' + UI.esc(target.ip_address || "") + ":" + UI.esc(target.port || "") + "</div></div>" +
      '<div class="row gap-2">' +
        '<span class="badge" data-status="' + (connected ? "online" : "offline") + '">' + (connected ? "Connected" : "Offline") + "</span>" +
        '<button class="btn btn-outline btn-sm" id="btnScan"' + (connected ? "" : ' disabled data-tip="The station must be connected to scan it"') + ">" +
          Icon("radar", 14) + '<span class="btn-label">Scan station</span></button>' +
        '<button class="btn btn-primary btn-sm" id="btnAddSw">' + Icon("plus", 14) + '<span class="btn-label">Add software</span></button>' +
      "</div>";
    host.appendChild(head);

    var body = UI.el("div", { class: "card-body col gap-3" });
    host.appendChild(body);

    if (loading) { body.appendChild(UI.skeletonRows(4)); return; }
    if (errorMessage) { body.appendChild(UI.errorState(errorMessage, loadSoftware)); return; }

    if (!software.length) {
      body.appendChild(UI.emptyState({
        icon: "games",
        title: "No software configured",
        text: "Add the applications staff can launch on " + target.name + ". Scanning the station finds what is already installed.",
        actions: [
          { label: "Add software", icon: "plus", variant: "primary", onClick: openAddForm },
          connected ? { label: "Scan station", icon: "radar", onClick: scanStation } : null
        ].filter(Boolean)
      }));
      return;
    }

    var rows = [];
    software.forEach(function (s) {
      var row = UI.el("div", { class: "sw-row" });
      row.innerHTML =
        '<div class="sw-icon">' + (s.software_icon
          ? '<img src="' + UI.esc(s.software_icon.indexOf("/") === 0 ? Store.API_BASE + s.software_icon : s.software_icon) + '" alt="">'
          : UI.esc((s.software_name || "?").charAt(0).toUpperCase())) + "</div>" +
        '<div class="grow" style="min-width:0">' +
          '<div class="sw-name">' + UI.esc(s.software_name) + "</div>" +
          '<div class="sw-path" title="' + UI.esc(s.software_path || "") + '">' + UI.esc(s.software_path || "No path") + "</div>" +
        "</div>" +
        '<span class="badge" data-status="' + (s.is_active === false ? "idle" : "online") + '">' +
          (s.is_active === false ? "Inactive" : "Available") + "</span>";

      var launchBtn = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon",
        html: Icon("play", 13),
        "data-tip": connected ? "Launch on " + target.name : "Station is offline",
        disabled: !connected || !s.software_path || !!Store.state.running[target.name]
      });
      launchBtn.addEventListener("click", function () {
        global.CXStationPanel.launchDialog(target.name, {
          name: s.software_name, launch: s.software_path, icon: s.software_icon
        });
      });

      var delBtn = UI.el("button", {
        class: "btn btn-danger btn-sm btn-icon",
        html: Icon("trash", 13),
        "data-tip": "Remove from this station"
      });
      delBtn.addEventListener("click", function () {
        UI.confirm({
          title: "Remove " + s.software_name + "?",
          message: "It is removed from " + target.name + " only. The application itself is not uninstalled.",
          confirmLabel: "Remove", variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.deletePcSoftware(s.pc_software_id)
            .then(function () { UI.toast.ok("Removed", s.software_name); return loadSoftware(); })
            .catch(function (e) { UI.toast.error("Could not remove", e.message); });
        });
      });

      row.appendChild(launchBtn);
      row.appendChild(delBtn);
      body.appendChild(row);
      rows.push(row);
    });
    Motion.stagger(rows, { step: 0.02, y: 8 });

    host.querySelector("#btnAddSw").addEventListener("click", openAddForm);
    var scanBtn = host.querySelector("#btnScan");
    if (scanBtn && !scanBtn.disabled) scanBtn.addEventListener("click", scanStation);
  }

  /* ==========================================================================
     SCAN A LIVE STATION  (IPC: fetch-pc-software)
     ========================================================================== */
  function scanStation() {
    var target = pc();
    if (!target) return;
    var t = UI.toast({ title: "Scanning " + target.name, message: "This can take 10–30 seconds the first time.", status: "info", duration: 0 });

    Store.scanPcSoftware(target.name)
      .then(function (result) {
        t.dismiss();
        if (result && result.success) {
          scanned = result.software || [];
          var withPath = scanned.filter(function (s) { return s.path && s.path.trim(); }).length;
          UI.toast.ok("Found " + scanned.length + " items", withPath + " with a usable path");
          openAddForm();
        } else {
          UI.toast.error("Scan failed", (result && result.error) || "Unknown error");
        }
      })
      .catch(function (e) { t.dismiss(); UI.toast.error("Scan failed", e.message); });
  }

  /* ==========================================================================
     ADD SOFTWARE
     ========================================================================== */
  function openAddForm() {
    var target = pc();
    if (!target) return;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label" for="swMaster">Pick from the catalogue</label>' +
        '<select class="select" id="swMaster"><option value="">Loading catalogue…</option></select>' +
        '<div class="field-hint">Fills in the name. You still set the path on this station.</div>' +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label field-req" for="swName">Name</label>' +
        '<input class="input" id="swName" placeholder="Counter-Strike 2">' +
      "</div>" +
      '<div class="field" style="position:relative">' +
        '<label class="field-label field-req" for="swPath">Executable path on ' + UI.esc(target.name) + "</label>" +
        '<input class="input mono" id="swPath" placeholder="C:\\Program Files\\Game\\game.exe" autocomplete="off">' +
        '<div class="suggest hidden" id="swSuggest"></div>' +
        '<div class="field-hint" id="swPathHint">' +
          (scanned.length ? "Type to search the " + scanned.length + " items found on this station." : "Scan the station to search installed applications.") +
        "</div>" +
      "</div>" +
      /*
       * No icon or video field here, on purpose.
       *
       * Artwork is uploaded once in Software Master on the admin side, and the
       * station's software list resolves it by name when it is read — so a
       * station row that stores no artwork of its own always shows whatever
       * the catalogue currently holds. Typing a URL here used to copy the
       * catalogue's value into the station row, which froze it: re-uploading
       * a logo centrally never reached the stations already set up, and the
       * only way to fix one was to remove and re-add the software.
       *
       * What is left is a read-only look at what the catalogue has, so it is
       * obvious where the tile's artwork comes from.
       */
      '<div class="field hidden" id="swArtField">' +
        '<label class="field-label">Artwork</label>' +
        '<div class="row gap-3" style="align-items:center">' +
          '<div class="sw-icon" id="swArtIcon"></div>' +
          '<div class="field-hint grow" id="swArtHint"></div>' +
        "</div>" +
      "</div>";

    UI.modal({
      title: "Add software",
      description: "Makes the application launchable on " + target.name + ".",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add software", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#swName").value.trim();
            var path = ctx.body.querySelector("#swPath").value.trim();
            if (!name || !path) {
              Motion.shake(ctx.node);
              UI.toast.warn("Name and path are required");
              return false;
            }
            return Store.addPcSoftware({
              pc_id: parseInt(target.pc_id, 10),
              software_name: name,
              software_path: path,
              // Artwork deliberately not sent — leaving it empty is what lets
              // the catalogue's current icon and video show through.
              is_active: true
            })
              .then(function () { UI.toast.ok("Added", name); return loadSoftware(); })
              .then(function () { return true; })
              .catch(function (e) { UI.toast.error("Could not add software", e.message); return false; });
          }
        }
      ]
    });

    /* --- catalogue dropdown --- */
    var master = body.querySelector("#swMaster");
    var fillMaster = function (list) {
      masterList = list;
      master.innerHTML = '<option value="">— Choose from catalogue —</option>';
      list.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = JSON.stringify({ name: s.software_name, icon: s.software_icon });
        opt.textContent = s.software_name;
        master.appendChild(opt);
      });
    };
    if (masterList.length) fillMaster(masterList);
    else Store.getSoftwareMaster()
      .then(fillMaster)
      .catch(function () { master.innerHTML = '<option value="">Catalogue unavailable</option>'; });

    var artField = body.querySelector("#swArtField");
    var artIcon = body.querySelector("#swArtIcon");
    var artHint = body.querySelector("#swArtHint");

    function showArtwork(icon, name) {
      artField.classList.remove("hidden");
      artIcon.innerHTML = icon
        ? '<img src="' + UI.esc(icon.indexOf("/") === 0 ? Store.API_BASE + icon : icon) + '" alt="">'
        : UI.esc((name || "?").charAt(0).toUpperCase());
      artHint.textContent = icon
        ? "From the catalogue. Change it in Software Master and every station follows."
        : "Nothing in the catalogue yet — add it in Software Master and it appears here.";
    }

    master.addEventListener("change", function () {
      if (!master.value) { artField.classList.add("hidden"); return; }
      try {
        var sel = JSON.parse(master.value);
        body.querySelector("#swName").value = sel.name || "";
        showArtwork(sel.icon, sel.name);
        body.querySelector("#swPath").focus();
      } catch (e) { /* malformed option */ }
    });

    /* --- path autocomplete from the live scan --- */
    var pathInput = body.querySelector("#swPath");
    var suggest = body.querySelector("#swSuggest");

    function showSuggestions() {
      if (!scanned.length) return;
      var q = pathInput.value.toLowerCase();
      var matches = (q
        ? scanned.filter(function (s) {
            return (s.path && s.path.toLowerCase().indexOf(q) !== -1) ||
                   (s.name && s.name.toLowerCase().indexOf(q) !== -1);
          })
        : scanned).slice(0, 50);

      if (!matches.length) { suggest.classList.add("hidden"); return; }

      // Entries with a resolved path are more useful, so float them up.
      matches.sort(function (a, b) { return (b.path ? 1 : 0) - (a.path ? 1 : 0); });

      suggest.innerHTML = matches.map(function (s) {
        return '<div class="suggest-item" data-path="' + UI.esc(s.path || "") + '" data-name="' + UI.esc(s.name || "") + '">' +
          '<div class="suggest-name">' + UI.esc(s.name || "Unknown") + "</div>" +
          '<div class="suggest-path">' + UI.esc(s.path || "(no path found)") + "</div>" +
        "</div>";
      }).join("");
      suggest.classList.remove("hidden");

      UI.$$(".suggest-item", suggest).forEach(function (item) {
        item.addEventListener("mousedown", function (e) {
          e.preventDefault();
          pathInput.value = item.dataset.path;
          var nameInput = body.querySelector("#swName");
          if (!nameInput.value) nameInput.value = item.dataset.name;
          suggest.classList.add("hidden");
        });
      });
    }

    pathInput.addEventListener("input", showSuggestions);
    pathInput.addEventListener("focus", showSuggestions);
    pathInput.addEventListener("blur", function () {
      setTimeout(function () { suggest.classList.add("hidden"); }, 150);
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.games = {
    title: "Games & software",
    subtitle: "What each station can launch",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Games &amp; software</div>' +
            '<div class="page-sub">Configure the applications available on each station.</div>' +
          "</div>" +
        "</div>" +
        '<div class="grid" style="grid-template-columns:300px minmax(0,1fr);align-items:start">' +
          '<div class="card">' +
            '<div class="card-head"><h2>Stations</h2></div>' +
            '<div id="gamePcList" style="max-height:calc(100vh - 260px);overflow:auto"></div>' +
          "</div>" +
          '<div class="card" id="gameDetail"></div>' +
        "</div>";
      root.appendChild(page);

      offs.push(Store.on("pcs", function () { renderList(); }));
      offs.push(Store.on("connected", function () { renderList(); renderDetail(); }));
      offs.push(Store.on("running", renderDetail));

      renderList();

      // Opens on the first PC, not the first station — the first station on
      // the floor may well be the pool table.
      var stations = configurableStations();
      if (!selectedPC && stations.length) selectPC(stations[0].name);
      else renderDetail();
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    },

    /** Called by the station panel's "Manage" button. */
    focusPC: function (name) { selectPC(name); }
  };
})(window);
