/* ==========================================================================
   CafeXP — Settings
   The General, Branding & print and Sessions & kiosk tabs of the Settings hub
   (router.js adds Receipts, Subscription and Updates beside them). Only
   settings that map to something real are editable.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

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

    pane.appendChild(card);
    return pane;
  }

  /* ==========================================================================
     SYSTEM
     ========================================================================== */
  /* part: "general" draws Connection and Console, "sessions" draws the session
     buffer, cleanup and station unlock PIN; omitted draws all of them. target
     lets the caller supply the pane (so General can put the café card first). */
  function systemPane(part, target) {
    var pane = target || UI.el("div", { class: "grid grid-split" });

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

    /*
     * The PIN that unlocks a station kiosk from its own keyboard.
     *
     * A client runs sealed: the customer sitting at it cannot minimise it,
     * leave full screen or close it. Staff normally reach a station's desktop
     * from here — the station panel's Minimise client — which needs no PIN
     * because it is already an authenticated action by a named operator.
     *
     * This covers the case that cannot: the café's network or this console is
     * down and somebody is standing at the machine. Blank means the hatch is
     * refused outright rather than left open.
     */
    var kiosk = UI.el("div", { class: "card" });
    kiosk.innerHTML =
      '<div class="card-head"><h2>Station unlock PIN</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="field">' +
          '<label class="field-label" for="setUnlockPin">Four-digit PIN</label>' +
          '<div class="row gap-2" style="align-items:center">' +
            '<input class="input mono" id="setUnlockPin" inputmode="numeric" maxlength="4" ' +
              'placeholder="Not set" style="max-width:140px;letter-spacing:6px;font-size:18px">' +
            '<button class="btn btn-primary btn-sm" type="button" id="setUnlockPinSave">Save</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" id="setUnlockPinClear">Clear</button>' +
          "</div>" +
          '<div class="field-hint">Typed at a station after <strong>Ctrl+Alt+Shift+Q</strong> to ' +
            'unlock its kiosk. Clearing it refuses that shortcut entirely — staff use ' +
            '<strong>Minimise client</strong> on the station panel instead.</div>' +
        "</div>" +
        '<div class="notice" data-status="warning">' + Icon("alert", 15) +
          "<div>Anyone who knows this can reach the Windows desktop on any station. " +
          "Treat it like a key to the shop, and change it when staff leave.</div></div>" +
      "</div>";

    /* ---- start-of-session buffer ----
       Free minutes at the start of every session for the game or launcher to
       load. The countdown holds at its starting value and nothing is billed
       until this elapses — a session ended inside it costs nothing at all.
       Per café; five minutes if never set. */
    var buffer = UI.el("div", { class: "card" });
    buffer.innerHTML =
      '<div class="card-head"><h2>Before a session starts</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="field">' +
          '<label class="field-label" for="setGraceMinutes">Buffer time (minutes)</label>' +
          '<div class="row gap-2" style="align-items:center">' +
            '<input class="input" id="setGraceMinutes" type="number" min="0" max="30" step="1" ' +
              'style="max-width:100px">' +
            '<button class="btn btn-primary btn-sm" type="button" id="setGraceSave">Save</button>' +
          "</div>" +
          '<div class="field-hint">If a game takes time to load, the timer holds at its starting ' +
            'value for this long before it starts counting and billing the customer. Set to 0 to bill ' +
            'from the moment a session starts.</div>' +
        "</div>" +
      "</div>";

    /* ---- end-of-session cleanup ----
       What a station does the moment a session ends. The launcher sign-outs
       are the reason this exists: without them the next customer sits down at
       a machine still signed into the last one's Steam. */
    var LAUNCHER_NAMES = ["Steam", "Riot", "EA", "Epic", "Ubisoft", "Battle.net", "Rockstar"];
    var cleanup = UI.el("div", { class: "card" });
    cleanup.innerHTML =
      '<div class="card-head"><h2>After a session ends</h2>' +
        '<span class="badge badge-plain">Client-side</span></div>' +
      '<div class="card-body col gap-4">' +
        '<div class="faint" style="font-size:12px">Runs on the station the moment a session finishes.</div>' +
        '<div class="col gap-2">' +
          '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clClose"> Close the game</label>' +
          '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clLauncher"> Close the launchers</label>' +
          '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clSession"> Clear the CafeXP session on the station</label>' +
          /* Not a choice: the floor derives a station's state from its open
             session, so ending one frees the machine immediately. Shown ticked
             and disabled rather than omitted, because staff look for it. */
          '<label class="row gap-2" style="align-items:center">' +
            '<input type="checkbox" id="clAvailable" checked disabled> ' +
            '<span>Return the PC to Available <span class="faint">— always, as soon as the session ends</span></span></label>' +
        "</div>" +
        '<div class="notice" data-status="warning">' + Icon("alert", 16) +
          "<div><strong>Sign out of launchers</strong> — the next customer must never reach the last one's " +
          "gaming accounts. Turning one on clears that launcher's saved login on the station after every " +
          "session, so customers sign in each time.</div></div>" +
        '<div class="row gap-2 wrap" id="clSignout">' +
          LAUNCHER_NAMES.map(function (n) {
            return '<label class="row gap-2" style="align-items:center;cursor:pointer;padding:4px 8px">' +
              '<input type="checkbox" data-launcher="' + n + '"> ' + n + "</label>";
          }).join("") +
        "</div>" +
        '<div class="row gap-2"><button class="btn btn-primary btn-sm" id="clSave">' +
          Icon("check", 14) + '<span class="btn-label">Save cleanup settings</span></button></div>' +
      "</div>";

    if (part !== "sessions") { pane.appendChild(card); pane.appendChild(prefs); }
    if (part !== "general") { pane.appendChild(buffer); pane.appendChild(cleanup); pane.appendChild(kiosk); }

    setTimeout(function () {
      if (!document.body.contains(buffer)) return;
      var graceInput = buffer.querySelector("#setGraceMinutes");
      var graceSave = buffer.querySelector("#setGraceSave");
      if (!graceInput) return;

      Store.getSettings("session").then(function (rows) {
        var row = (rows || []).filter(function (r) { return r.setting_key === "session.grace_minutes"; })[0];
        if (document.body.contains(graceInput)) {
          graceInput.value = row && row.setting_value !== null ? row.setting_value : "5";
        }
      }).catch(function () {});

      graceSave.addEventListener("click", function () {
        var minutes = Number(graceInput.value);
        if (!Number.isFinite(minutes) || minutes < 0) {
          Motion.shake(graceInput);
          UI.toast.warn("Enter zero or more minutes");
          return;
        }
        UI.withBusy(graceSave, function () {
          return Store.setSetting("session.grace_minutes", minutes)
            .then(function () {
              UI.toast.ok("Buffer time saved",
                minutes > 0 ? "New sessions get " + minutes + " free minute" + (minutes === 1 ? "" : "s") + " to load."
                            : "New sessions bill from the moment they start.");
            })
            .catch(function (e) { UI.toast.error("Could not save", e.message); });
        });
      });
    }, 0);

    setTimeout(function () {
      if (!document.body.contains(cleanup)) return;
      var saveBtn = cleanup.querySelector("#clSave");
      if (!saveBtn) return;

      function readConfig() {
        var signout = {};
        UI.$$("#clSignout input[type=checkbox]", cleanup).forEach(function (c) {
          if (c.checked) signout[c.dataset.launcher] = true;
        });
        return {
          close_game: cleanup.querySelector("#clClose").checked,
          close_launcher: cleanup.querySelector("#clLauncher").checked,
          clear_session: cleanup.querySelector("#clSession").checked,
          return_available: true,   // derived by the floor; kept for the record
          signout: signout
        };
      }

      Store.getSettings("client").then(function (rows) {
        var row = (rows || []).filter(function (r) { return r.setting_key === "session.cleanup"; })[0];
        var cfg = {};
        if (row && row.setting_value) { try { cfg = JSON.parse(row.setting_value); } catch (e) { cfg = {}; } }
        if (!document.body.contains(cleanup)) return;
        cleanup.querySelector("#clClose").checked = cfg.close_game !== false;
        cleanup.querySelector("#clLauncher").checked = !!cfg.close_launcher;
        cleanup.querySelector("#clSession").checked = cfg.clear_session !== false;
        // clAvailable is fixed on — nothing to restore.
        var signout = cfg.signout || {};
        UI.$$("#clSignout input[type=checkbox]", cleanup).forEach(function (c) {
          c.checked = !!signout[c.dataset.launcher];
        });
      }).catch(function () {});

      saveBtn.addEventListener("click", function () {
        var cfg = readConfig();
        var outs = Object.keys(cfg.signout);
        UI.withBusy(saveBtn, function () {
          return Store.setSetting("session.cleanup", JSON.stringify(cfg))
            .then(function () {
              UI.toast.ok("Cleanup settings saved",
                outs.length ? "Signing out of " + outs.join(", ") + " after each session."
                            : "No launcher sign-outs configured.");
            })
            .catch(function (e) { UI.toast.error("Could not save", e.message); });
        });
      });
    }, 0);

    setTimeout(function () {
      var pinInput = pane.querySelector("#setUnlockPin");
      if (pinInput) {
        Store.getSettings("client").then(function (rows) {
          var row = (rows || []).filter(function (r) {
            return r.setting_key === "client.staff_unlock_pin";
          })[0];
          if (row && document.body.contains(pinInput)) pinInput.value = row.setting_value || "";
        }).catch(function () {});

        pinInput.addEventListener("input", function () {
          pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
        });

        /*
         * Saved on a button, not on blur.
         *
         * Blur fires when someone tabs away or clicks elsewhere mid-thought,
         * which for this field means a half-considered PIN going out to every
         * station without anybody deciding to send it. An explicit Save also
         * gives the confirmation a security setting deserves.
         */
        function savePin(value, verb) {
          var btn = pane.querySelector("#setUnlockPinSave");
          return UI.withBusy(btn, function () {
            return Store.setSetting("client.staff_unlock_pin", value)
              .then(function () {
                // Best-effort: the setting itself is already saved even if a
                // station happens to be unreachable right this second — it
                // still picks the new PIN up on its next connect either way.
                return Store.refreshUnlockPin().catch(function () {});
              })
              .then(function () {
                UI.toast.ok(value ? "Station unlock PIN saved" : "Station unlock PIN cleared",
                  value ? "Already active at every connected station."
                        : "Ctrl+Alt+Shift+Q is now refused at every station.");
              })
              .catch(function (e) { UI.toast.error("Could not " + verb + " the PIN", e.message); });
          });
        }

        pane.querySelector("#setUnlockPinSave").addEventListener("click", function () {
          var value = pinInput.value;
          if (value.length !== 4) {
            Motion.shake(pinInput);
            UI.toast.warn("A PIN must be four digits", "Use Clear to remove it instead.");
            return;
          }
          savePin(value, "save");
        });

        pane.querySelector("#setUnlockPinClear").addEventListener("click", function () {
          if (!pinInput.value) { UI.toast.info("No PIN is set"); return; }
          UI.confirm({
            title: "Clear the station unlock PIN?",
            message: "Ctrl+Alt+Shift+Q will be refused at every station. Staff will only be " +
              "able to reach a station's desktop through Minimise client on the station panel, " +
              "which needs this console to be reachable.",
            confirmLabel: "Clear it", variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            pinInput.value = "";
            savePin("", "clear");
          });
        });
      }

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

  /* ==========================================================================
     BRANDING & PRINT
     Logos and the kiosk wallpaper, and whether — and where — receipts print.
     Each control saves the moment it changes (an upload is its own action),
     so there is no half-saved state for a pane rebuild to throw away.
     ========================================================================== */
  function saveSetting(key, value, okMessage) {
    return Store.setSetting(key, value)
      .then(function () { if (okMessage) UI.toast.ok(okMessage); })
      .catch(function (e) { UI.toast.error("Could not save", e.message); throw e; });
  }

  /* A small image kept as a data URI in the setting itself — fine for a logo,
     which is why it is capped; the wallpaper is a real upload instead. */
  function logoRow(vals, key, label, hint, fallbackKey) {
    var id = "brand" + key.replace(/\W/g, "");
    var wrap = UI.el("div", { class: "field" });
    wrap.innerHTML =
      '<label class="field-label">' + UI.esc(label) + "</label>" +
      '<div class="rt-logo-row">' +
        '<div class="rt-logo-box"></div>' +
        '<div class="col gap-2">' +
          '<input type="file" id="' + id + '" accept="image/png,image/jpeg,image/svg+xml" class="hidden">' +
          '<button class="btn btn-outline btn-sm" type="button" data-act="pick">Choose image</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-act="clear">Remove</button>' +
        "</div>" +
      "</div>" +
      '<div class="field-hint">' + UI.esc(hint) + "</div>";

    var box = wrap.querySelector(".rt-logo-box");
    function paint() {
      var own = vals[key] || "";
      var shown = own || (fallbackKey && vals[fallbackKey]) || "";
      box.innerHTML = shown
        ? '<img src="' + UI.esc(shown) + '" alt="' + UI.esc(label) + '">'
        : '<span class="faint">No logo</span>';
      box.title = own || !shown ? "" : "Using the receipt logo";
    }
    paint();

    var file = wrap.querySelector("#" + id);
    wrap.querySelector('[data-act="pick"]').addEventListener("click", function () { file.click(); });
    wrap.querySelector('[data-act="clear"]').addEventListener("click", function () {
      saveSetting(key, "", label + " removed").then(function () { vals[key] = ""; paint(); }, function () {});
    });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 400 * 1024) {
        UI.toast.warn("That image is too large", "Use one under 400 KB.");
        file.value = "";
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var uri = String(reader.result);
        saveSetting(key, uri, label + " saved").then(function () { vals[key] = uri; paint(); }, function () {})
          .then(function () { file.value = ""; });
      };
      reader.readAsDataURL(f);
    });
    return wrap;
  }

  function wallpaperRow(vals) {
    var wrap = UI.el("div", { class: "field" });
    wrap.innerHTML =
      '<label class="field-label">Kiosk wallpaper</label>' +
      '<div class="rt-logo-row">' +
        '<div class="rt-logo-box"></div>' +
        '<div class="col gap-2">' +
          '<input type="file" id="brandWallpaper" accept="image/*,video/*" class="hidden">' +
          '<button class="btn btn-outline btn-sm" type="button" data-act="pick">Choose image or video</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-act="clear">Remove</button>' +
        "</div>" +
      "</div>" +
      '<div class="field-hint">Shown full-screen behind the welcome/sign-in screen on every station. Up to 30 MB.</div>';

    var box = wrap.querySelector(".rt-logo-box");
    function paint() {
      var url = vals["billing.wallpaper_url"] || "";
      if (!url) { box.innerHTML = '<span class="faint">No wallpaper</span>'; return; }
      box.innerHTML = vals["billing.wallpaper_type"] === "video"
        ? '<video src="' + UI.esc(url) + '" muted loop autoplay playsinline></video>'
        : '<img src="' + UI.esc(url) + '" alt="Current wallpaper">';
    }
    paint();

    var pickBtn = wrap.querySelector('[data-act="pick"]');
    var file = wrap.querySelector("#brandWallpaper");
    pickBtn.addEventListener("click", function () { file.click(); });
    wrap.querySelector('[data-act="clear"]').addEventListener("click", function () {
      saveSetting("billing.wallpaper_url", "")
        .then(function () { return saveSetting("billing.wallpaper_type", "", "Wallpaper removed"); })
        .then(function () { vals["billing.wallpaper_url"] = ""; vals["billing.wallpaper_type"] = ""; paint(); }, function () {});
    });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) {
        UI.toast.warn("That file is too large", "Use an image or video under 30 MB.");
        file.value = "";
        return;
      }
      UI.withBusy(pickBtn, function () {
        return Store.uploadCafeWallpaper(f)
          .then(function (data) {
            return saveSetting("billing.wallpaper_url", data.url)
              .then(function () { return saveSetting("billing.wallpaper_type", data.type, "Wallpaper saved"); })
              .then(function () { vals["billing.wallpaper_url"] = data.url; vals["billing.wallpaper_type"] = data.type; paint(); });
          })
          .catch(function (e) { UI.toast.error("Could not upload that file", e.message); })
          .finally(function () { file.value = ""; });
      });
    });
    return wrap;
  }

  function printingCard(vals) {
    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Printing</h2></div>' +
      '<div class="card-body col gap-4">' +
        '<label class="check-row"><input type="checkbox" class="check" id="prEnabled">' +
          "<span><strong>Print receipts</strong>" +
          '<span class="faint block">Off disables every Print button. Bills are still saved and can be viewed on screen.</span></span></label>' +
        '<div class="field"><label class="field-label" for="prPrinter">Printer</label>' +
          '<div class="row gap-2" style="align-items:center">' +
            '<select class="input" id="prPrinter"></select>' +
            '<button class="btn btn-outline btn-sm" type="button" id="prRefresh">Refresh</button>' +
          "</div>" +
          '<div class="field-hint" id="prHint"></div></div>' +
        '<label class="check-row"><input type="checkbox" class="check" id="prSilent">' +
          "<span><strong>Print without asking</strong>" +
          '<span class="faint block">Sends the receipt straight to the printer above with no Windows print dialog — ' +
          "what a thermal printer at the counter wants.</span></span></label>" +
        '<div><button class="btn btn-outline btn-sm" type="button" id="prTest">Test print</button></div>' +
      "</div>";

    var enabled = card.querySelector("#prEnabled");
    var silent = card.querySelector("#prSilent");
    var select = card.querySelector("#prPrinter");
    var hint = card.querySelector("#prHint");
    enabled.checked = String(vals["billing.print_enabled"]) !== "false";
    silent.checked = String(vals["billing.print_silent"]) === "true";

    enabled.addEventListener("change", function () {
      saveSetting("billing.print_enabled", String(enabled.checked),
        enabled.checked ? "Receipt printing on" : "Receipt printing off");
    });
    silent.addEventListener("change", function () { saveSetting("billing.print_silent", String(silent.checked)); });
    select.addEventListener("change", function () { saveSetting("billing.printer_name", select.value, "Printer saved"); });

    function loadPrinters() {
      var list = global.api && global.api.listPrinters ? global.api.listPrinters() : Promise.resolve([]);
      return list.catch(function () { return []; }).then(function (printers) {
        var chosen = vals["billing.printer_name"] || "";
        select.innerHTML = '<option value="">System default printer</option>' + printers.map(function (p) {
          return '<option value="' + UI.esc(p.name) + '">' + UI.esc(p.displayName) + (p.isDefault ? " (default)" : "") + "</option>";
        }).join("");
        // A saved printer that is no longer installed stays listed, so the
        // choice is not silently swapped for the default.
        if (chosen && !printers.some(function (p) { return p.name === chosen; })) {
          select.insertAdjacentHTML("beforeend", '<option value="' + UI.esc(chosen) + '">' + UI.esc(chosen) + " (not found)</option>");
        }
        select.value = chosen;
        hint.textContent = printers.length
          ? printers.length + " printer" + (printers.length === 1 ? "" : "s") + " found on this computer."
          : "No printer found. Connect it and install its driver in Windows, then press Refresh.";
      });
    }
    loadPrinters();
    card.querySelector("#prRefresh").addEventListener("click", loadPrinters);

    card.querySelector("#prTest").addEventListener("click", function () {
      var body = UI.el("div", { class: "col gap-3" });
      body.innerHTML = global.CXReceipt.buildHtml({
        bill_number: "TEST-PRINT", created_at: new Date(), customer_name: "Test",
        items: [{ description: "Test line", quantity: 1, amount: 100 }],
        subtotal: 100, total: 100, payments: [], balance_due: 0
      }, vals);
      UI.modal({
        title: "Test print", description: "Sends a sample receipt to the printer.", body: body,
        actions: [
          { label: "Close", variant: "ghost" },
          { label: "Print", variant: "primary", icon: "download",
            onClick: function () { global.CXReceipt.print(); return false; } }
        ]
      });
    });
    return card;
  }

  function brandingPane() {
    var pane = UI.el("div", { class: "grid grid-split" });
    pane.appendChild(UI.el("div", { class: "faint", text: "Loading…" }));

    Store.getSettings("billing").then(function (rows) {
      var vals = {};
      (rows || []).forEach(function (r) { vals[r.setting_key] = r.setting_value; });

      var logos = UI.el("div", { class: "card" });
      logos.innerHTML =
        '<div class="card-head"><h2>Logos</h2></div>' +
        '<div class="card-body col gap-4"></div>';
      var body = logos.querySelector(".card-body");
      body.appendChild(logoRow(vals, "billing.logo", "Receipt logo",
        "Printed at the top of every bill. PNG, JPEG or SVG under 400 KB — a thermal printer renders about 200px wide."));
      body.appendChild(logoRow(vals, "billing.kiosk_logo", "Kiosk front-screen logo",
        "Shown on the welcome and sign-in screen at every station. Leave empty to use the receipt logo.",
        "billing.logo"));
      body.appendChild(wallpaperRow(vals));

      UI.clear(pane);
      pane.appendChild(logos);
      pane.appendChild(printingCard(vals));
    }).catch(function (e) {
      UI.clear(pane);
      pane.appendChild(UI.errorState(e.message));
    });
    return pane;
  }

  function generalPane() { return systemPane("general", businessPane()); }
  function sessionsPane() { return systemPane("sessions"); }

  /*
   * Each Settings tab is its own page module. The Settings entry in the
   * sidebar is a hub (see router.js) whose tabs are these three plus Receipts,
   * Subscription and Updates, which used to be separate menu entries — so the
   * tab bar is the router's now, not this file's.
   *
   * A pane is not rebuilt while the operator is working in it, or when nothing
   * it shows has changed: render() used to rebuild on every `pcs` and `user`
   * event, and those fire whenever a session starts or ends anywhere on the
   * floor — which flickered the page and threw away a form mid-keystroke. The
   * panes do read live station data, so the subscriptions stay; they just may
   * not redraw when nothing has changed.
   */
  function settingsTab(paneFn, subtitle) {
    var offs = [];
    var rootEl = null;
    var lastPaneSig = "";

    function paneSignature() {
      return [
        (Store.state.pcs || []).map(function (p) {
          return [p.pc_id, p.name, p.ip_address || "", p.category || "", Store.pcStatus(p), p.client_version || ""].join(":");
        }).join(";"),
        Store.state.user ? [Store.state.user.id || "", Store.state.user.email || ""].join(":") : ""
      ].join("|");
    }

    function render() {
      if (!rootEl) return;
      var host = rootEl.querySelector("#settingsPane");
      if (!host) return;

      // The signature is deliberately not stamped when this returns early, so
      // the pending change is simply applied the next time round.
      if (host.childElementCount && host.contains(document.activeElement)) return;

      var sig = paneSignature();
      if (sig === lastPaneSig && host.childElementCount) return;
      lastPaneSig = sig;

      UI.clear(host);
      var pane = paneFn();
      host.appendChild(pane);
      Motion.enter(pane, { y: 8 });
    }

    return {
      title: "Settings",
      subtitle: subtitle,

      mount: function (root) {
        rootEl = root;
        var page = UI.el("div", { class: "page" });
        page.innerHTML = '<div id="settingsPane"></div>';
        root.appendChild(page);

        offs.push(Store.on("pcs", render));
        offs.push(Store.on("user", render));
        lastPaneSig = "";
        render();
      },

      unmount: function () {
        offs.forEach(function (f) { f(); });
        offs = [];
        rootEl = null;
        // The pane goes with the page, so the next mount must draw rather than
        // recognise its own signature and skip.
        lastPaneSig = "";
      }
    };
  }

  // "settings" stays the General tab's id, so every existing go("settings") lands there.
  global.CXPages.settings = settingsTab(generalPane, "Cafe, connection and console");
  global.CXPages["settings-branding"] = settingsTab(brandingPane, "Logos, kiosk wallpaper and receipt printing");
  global.CXPages["settings-sessions"] = settingsTab(sessionsPane, "What happens when a session starts and ends, and the station unlock PIN");
})(window);
