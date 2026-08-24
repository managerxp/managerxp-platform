/* ==========================================================================
   CafeXP Admin — Sessions
   The Sessions page, plus the dialogs the Floor and station panel reuse:
   starting a session, extending, transferring and ending it.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var DURATIONS = [30, 60, 120, 180];
  var EXTEND_BY = [15, 30, 60];
  var defaultRate = 60;

  Store.sessionDefaults()
    .then(function (d) { if (d && d.rate_per_hour != null) defaultRate = Number(d.rate_per_hour); })
    .catch(function () { /* fall back to the constant above */ });

  function coins(value) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return whole ? String(Math.round(n)) : n.toFixed(2); }
  }

  function clock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return (h > 0 ? pad(h) + ":" : "") + pad(m) + ":" + pad(sec);
  }

  /** Open-ended sessions have no remaining time — show elapsed instead. */
  function displayTime(session) {
    return session.remaining_seconds === null
      ? clock(session.elapsed_seconds)
      : clock(session.remaining_seconds);
  }

  function timeLabel(session) {
    return session.remaining_seconds === null ? "elapsed" : "remaining";
  }

  /* ==========================================================================
     ELIGIBILITY
     A session can only start on a station that is registered, active and
     actually connected — otherwise the customer would be sat in front of a
     machine that never receives their session.
     ========================================================================== */
  function canStartSession(pc) {
    if (!pc) return { ok: false, reason: "Station not found" };
    if (pc.is_active === false) return { ok: false, reason: "This station is deactivated" };
    if (pc.status === "INACTIVE") return { ok: false, reason: "This station is not in service" };
    if (pc.status === "MAINTENANCE") return { ok: false, reason: "This station is under maintenance" };
    if (Store.sessionFor(pc.name)) return { ok: false, reason: "This station already has a session" };
    /* Only a networked station can be offline. A pool table has nothing to
       connect to, so requiring a connection here would make it unsellable. */
    if (Store.isNetworked(pc) && !Store.isConnected(pc.name)) {
      return { ok: false, reason: "This station is offline" };
    }
    return { ok: true };
  }

  /* ==========================================================================
     START A SESSION
     ========================================================================== */
  function startSessionDialog(pcName, onStarted) {
    var pc = Store.getPC(pcName);
    var eligible = canStartSession(pc);
    if (!eligible.ok) { UI.toast.warn("Can't start a session here", eligible.reason); return; }

    var mode = "customer";     // customer | guest
    var chosen = null;         // selected customer row
    var searchTimer = null;

    var body = UI.el("div", { class: "col gap-5" });
    body.innerHTML =
      '<div class="segmented" id="whoMode" style="width:100%">' +
        '<button type="button" data-mode="customer" aria-selected="true" style="flex:1">Registered customer</button>' +
        '<button type="button" data-mode="guest" aria-selected="false" style="flex:1">Guest</button>' +
      "</div>" +

      '<div id="customerPane" class="col gap-3">' +
        '<div class="row gap-2">' +
          '<div class="search grow">' + Icon("search", 15) +
            '<input class="input" id="sessCustSearch" placeholder="Search name, mobile or email…" autocomplete="off" data-autofocus>' +
          "</div>" +
          '<button type="button" class="btn btn-outline" id="sessNewCust">' + Icon("plus", 15) +
            '<span class="btn-label">New</span></button>' +
        "</div>" +
        '<div id="sessCustResults" style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-md)"></div>' +
      "</div>" +

      '<div id="guestPane" class="col gap-3 hidden">' +
        '<div class="grid grid-2" style="gap:var(--s-3)">' +
          '<div class="field"><label class="field-label field-req" for="guestName">Guest name</label>' +
            '<input class="input" id="guestName" placeholder="Walk-in"></div>' +
          '<div class="field"><label class="field-label" for="guestPhone">Mobile</label>' +
            '<input class="input" id="guestPhone" placeholder="Optional"></div>' +
        "</div>" +
        '<div class="notice" data-status="warning">' + Icon("info", 16) +
          "<div>Guests have no wallet, so time is settled at the counter.</div></div>" +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label">Duration</label>' +
        '<div class="row gap-2 wrap" id="durationRow">' +
          DURATIONS.map(function (m) {
            return '<button type="button" class="chip" data-min="' + m + '">' +
              (m >= 60 ? (m / 60) + "h" : m + " min") + "</button>";
          }).join("") +
          '<button type="button" class="chip" data-min="">Open-ended</button>' +
        "</div>" +
      "</div>" +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="sessMinutes">Minutes</label>' +
          '<input class="input" id="sessMinutes" type="number" min="1" max="1440" value="60"></div>' +

        /* The rate comes from the Gaming Price Master, not from a box staff
           type into. Whatever is chosen here is sent as an id; the server
           loads the price itself and ignores any amount in the request, so the
           figure on the bill is one the café actually set. */
        '<div class="field"><label class="field-label field-req" for="sessPrice">Gaming price</label>' +
          '<select class="select" id="sessPrice"><option value="">Loading prices…</option></select>' +
          '<div class="field-hint" id="sessPriceHint">From the Gaming Price Master.</div></div>' +
      "</div>" +

      /* Only reachable when the station\'s type has no price set up. Kept so a
         counter can still start the clock at 2am rather than being blocked by
         a missing catalogue row — never as a way around the master. */
      '<div class="field hidden" id="sessRateWrap">' +
        '<label class="field-label" for="sessRate">Rate (XP / hour)</label>' +
        '<input class="input" id="sessRate" type="number" min="0" step="1" value="' + defaultRate + '">' +
        '<div class="field-hint">No catalogue price covers this station, so the ' +
          "default hourly rate applies.</div></div>" +

      '<div class="field"><label class="field-label" for="sessGame">Launch a game with the session</label>' +
        '<select class="select" id="sessGame"><option value="">Nothing — just start the clock</option>' +
          '<option value="__custom">Custom path…</option></select>' +
        '<input class="input mono hidden" id="sessGamePath" spellcheck="false" ' +
          'style="margin-top:var(--s-2)" placeholder="C:\\Program Files\\Game\\game.exe">' +
        '<div class="field-hint" id="sessGameHint">Optional. The station launches it as soon as the session starts.</div></div>' +

      '<div class="notice" data-status="accent" id="sessPreview"></div>';

    var dialog = UI.modal({
      title: "Start a session on " + pcName,
      description: "The station shows the customer their countdown.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Start session", variant: "primary", icon: "play",
          onClick: function (ctx) {
            var minutesRaw = ctx.body.querySelector("#sessMinutes").value;
            var openEnded = ctx.body.querySelector("#sessMinutes").disabled;
            var priceSel = ctx.body.querySelector("#sessPrice");
            var payload = {
              pc_id: pc.pc_id,
              planned_minutes: openEnded ? null : parseInt(minutesRaw, 10)
            };

            if (priceSel.value) {
              /* An id, never an amount. The server resolves the rate. */
              payload.gaming_price_id = Number(priceSel.value);
            } else if (rates.length) {
              Motion.shake(priceSel);
              UI.toast.warn("Choose a gaming price", "The rate comes from the price master.");
              return false;
            } else {
              // No catalogue price exists for this station type.
              payload.rate_per_hour = Number(ctx.body.querySelector("#sessRate").value) || 0;
            }

            if (mode === "customer") {
              if (!chosen) {
                Motion.shake(ctx.body.querySelector("#sessCustSearch"));
                UI.toast.warn("Choose a customer", "Search and select who is playing.");
                return false;
              }
              payload.customer_id = chosen.customer_id;
            } else {
              var name = ctx.body.querySelector("#guestName").value.trim();
              if (!name) {
                Motion.shake(ctx.body.querySelector("#guestName"));
                UI.toast.warn("Give the guest a name");
                return false;
              }
              payload.guest_name = name;
              payload.guest_phone = ctx.body.querySelector("#guestPhone").value.trim() || null;
            }

            if (!openEnded && (!payload.planned_minutes || payload.planned_minutes < 1)) {
              Motion.shake(ctx.body.querySelector("#sessMinutes"));
              return false;
            }

            var game = chosenGame(ctx.body);
            if (game === false) {
              Motion.shake(ctx.body.querySelector("#sessGamePath"));
              UI.toast.warn("Give the full path to the executable");
              return false;
            }

            return Store.startSession(payload)
              .then(function (session) {
                UI.toast.ok("Session started", session.customer_name + " on " + pcName);
                if (onStarted) onStarted(session);
                // The session is the record; the launch is a convenience on
                // top of it, so a failed launch must not read as a failed
                // session or roll anything back.
                if (game) {
                  Store.launchApp(pcName, game, payload.planned_minutes || 60)
                    .then(function () { UI.toast.ok(game.name + " launched", pcName); })
                    .catch(function (e) {
                      UI.toast.error("Session started, launch failed", e.message);
                    });
                }
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not start the session", err.message);
                return false;
              });
          }
        }
      ]
    });

    /* ---- gaming price ----------------------------------------------------
       Offered by the station's own type: a PS5 station shows PS5 prices, a
       pool table shows pool prices. A station with no type set is general
       purpose and shows everything, because refusing to price it would be
       worse than showing a longer list. */
    var priceSelect = body.querySelector("#sessPrice");
    var priceHint = body.querySelector("#sessPriceHint");
    var rateWrap = body.querySelector("#sessRateWrap");
    var rates = [];

    global.CXRates.list()
      .then(function (all) {
        rates = pc.category
          ? all.filter(function (r) { return r.category === pc.category; })
          : all;

        if (!rates.length) {
          priceSelect.innerHTML = '<option value="">No price set for this station</option>';
          priceSelect.disabled = true;
          priceHint.textContent = pc.category
            ? "Nothing priced for " + pc.category + " yet — add one under Gaming Prices."
            : "No gaming prices set up yet.";
          rateWrap.classList.remove("hidden");
          return;
        }

        priceSelect.disabled = false;
        priceSelect.innerHTML =
          (rates.length === 1 ? "" : '<option value="">— Select price —</option>') +
          rates.map(function (r) {
            return '<option value="' + r.price_id + '">' +
              UI.esc(r.software_name + " · " + r.session_name) + " — " +
              UI.esc(global.CXRates.money(r.price, r.currency)) + "</option>";
          }).join("");
        /* One price for this station type is not a choice — preselect it so
           staff are not made to confirm the only option there is. */
        if (rates.length === 1) priceSelect.value = rates[0].price_id;
        priceHint.textContent = pc.category
          ? rates.length + " " + pc.category + " price" + (rates.length === 1 ? "" : "s") +
            " — the rate is taken from here, not typed."
          : "The rate is taken from the price master, not typed.";
        refresh();
      })
      .catch(function (err) {
        /* A price list that will not load must not strand a customer at the
           counter: fall back to the hourly rate and say why. */
        priceSelect.innerHTML = '<option value="">Could not load prices</option>';
        priceSelect.disabled = true;
        priceHint.textContent = err.message;
        rateWrap.classList.remove("hidden");
      });

    priceSelect.addEventListener("change", function () { refresh(); });

    /* ---- game to launch with the session ---- */
    var gameSelect = body.querySelector("#sessGame");
    var gamePath = body.querySelector("#sessGamePath");
    var gameHint = body.querySelector("#sessGameHint");
    var stationApps = [];

    /** null = launch nothing, false = invalid input, otherwise the app. */
    function chosenGame() {
      var v = gameSelect.value;
      if (!v) return null;
      if (v === "__custom") {
        var path = gamePath.value.trim();
        if (!path) return false;
        var name = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") || "Application";
        return { name: name, launch: path, custom: true };
      }
      return stationApps[parseInt(v, 10)] || null;
    }

    gameSelect.addEventListener("change", function () {
      gamePath.classList.toggle("hidden", gameSelect.value !== "__custom");
      if (gameSelect.value === "__custom") gamePath.focus();
    });

    // The station's own list, so staff pick rather than type a path.
    Store.getPcSoftwareViaIPC(pc.pc_id).then(function (response) {
      var rows = (response && response.data) || [];
      stationApps = rows
        .filter(function (s) { return s.software_path; })
        .map(function (s) {
          return { name: s.software_name, launch: s.software_path, icon: s.software_icon };
        });
      if (!stationApps.length) {
        gameHint.textContent = "This station has no software configured — use a custom path, " +
          "or add it under Games.";
        return;
      }
      var custom = gameSelect.querySelector('option[value="__custom"]');
      stationApps.forEach(function (app, i) {
        var opt = UI.el("option", { value: String(i), text: app.name });
        gameSelect.insertBefore(opt, custom);
      });
    }).catch(function () {
      gameHint.textContent = "Could not read this station's software list — a custom path still works.";
    });

    /* ---- mode switch ---- */
    var customerPane = body.querySelector("#customerPane");
    var guestPane = body.querySelector("#guestPane");
    UI.$$("#whoMode button", body).forEach(function (btn) {
      btn.addEventListener("click", function () {
        mode = btn.dataset.mode;
        UI.$$("#whoMode button", body).forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        customerPane.classList.toggle("hidden", mode !== "customer");
        guestPane.classList.toggle("hidden", mode === "customer");
        refresh();
      });
    });

    /* ---- customer search ---- */
    var searchInput = body.querySelector("#sessCustSearch");
    var results = body.querySelector("#sessCustResults");

    function renderResults(rows) {
      UI.clear(results);
      if (!rows.length) {
        results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">No customers match.</div>';
        return;
      }
      rows.forEach(function (c) {
        var row = UI.el("button", {
          type: "button",
          class: "kv",
          style: { width: "100%", padding: "10px var(--s-4)", border: 0, background: "transparent", textAlign: "left" }
        });
        row.innerHTML =
          '<span class="row gap-3" style="min-width:0">' +
            '<span class="avatar" style="width:26px;height:26px;font-size:10px">' +
              UI.esc(UI.initials(c.customer_name)) + "</span>" +
            "<span style='min-width:0'>" +
              '<span style="display:block;font-size:13px;font-weight:600">' + UI.esc(c.customer_name) + "</span>" +
              '<span class="faint" style="font-size:11px">' + UI.esc(c.phone_number || c.email || "") + "</span>" +
            "</span>" +
          "</span>" +
          '<span style="font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">' +
            (c.wallet_balance === null ? "—" : coins(c.wallet_balance)) +
            '<span class="faint" style="font-size:10px;margin-left:3px">XP</span></span>';
        row.addEventListener("click", function () {
          chosen = c;
          searchInput.value = c.customer_name;
          UI.clear(results);
          refresh();
        });
        results.appendChild(row);
      });
    }

    function search() {
      Store.getCustomers({ search: searchInput.value.trim(), limit: 25 })
        .then(function (body2) { renderResults(body2.data || []); })
        .catch(function (err) {
          results.innerHTML = '<div class="faint" style="padding:var(--s-4);font-size:12px">' +
            UI.esc(err.message) + "</div>";
        });
    }

    searchInput.addEventListener("input", function () {
      chosen = null;
      refresh();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(search, 250);
    });
    search();

    // Register a walk-in without leaving the dialog, then select them.
    body.querySelector("#sessNewCust").addEventListener("click", function () {
      global.CXPages.customers.addCustomerDialog(function (created) {
        chosen = created;
        searchInput.value = created.customer_name;
        UI.clear(results);
        refresh();
        UI.toast.info("Selected " + created.customer_name, "Set the duration and start.");
      });
    });

    /* ---- duration + preview ---- */
    var minutesInput = body.querySelector("#sessMinutes");
    var rateInput = body.querySelector("#sessRate");
    var preview = body.querySelector("#sessPreview");
    var durationChips = UI.$$("#durationRow .chip", body);

    durationChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        if (chip.dataset.min === "") {
          minutesInput.disabled = true;
          minutesInput.value = "";
        } else {
          minutesInput.disabled = false;
          minutesInput.value = chip.dataset.min;
        }
        durationChips.forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
        refresh();
      });
    });

    /** The price the customer is actually being sold, if one is chosen. */
    function selectedRate() {
      if (!priceSelect || !priceSelect.value) return null;
      return rates.filter(function (r) {
        return String(r.price_id) === priceSelect.value;
      })[0] || null;
    }

    /*
     * What an hour costs under the chosen price.
     *
     * A block price is converted the same way the server converts it —
     * ₹200 per 30 minutes is ₹400 an hour — so the figure quoted here is the
     * figure that will be billed. Unlimited prices have no hourly rate and are
     * handled separately below.
     */
    function effectiveHourly(rateRow) {
      if (!rateRow) return Number(rateInput.value) || 0;
      if (!rateRow.duration_minutes) return null;          // unlimited
      return Number(rateRow.price) / (rateRow.duration_minutes / 60);
    }

    function refresh() {
      var openEnded = minutesInput.disabled;
      var minutes = parseInt(minutesInput.value, 10) || 0;
      var chosenRate = selectedRate();
      var rate = effectiveHourly(chosenRate);
      durationChips.forEach(function (c) {
        if (c.dataset.min !== "") c.setAttribute("aria-pressed", String(Number(c.dataset.min) === minutes));
      });

      /* An unlimited price is a flat charge, so neither the duration nor the
         open-ended switch changes what it costs. */
      if (chosenRate && rate === null) {
        preview.setAttribute("data-status", "accent");
        preview.innerHTML = Icon("info", 16) +
          "<div><strong>" + UI.esc(chosenRate.software_name) + " · " +
          UI.esc(chosenRate.session_name) + "</strong> — a flat <strong>" +
          coins(chosenRate.price) + " XP</strong> however long it runs.</div>";
        return;
      }

      if (openEnded) {
        preview.setAttribute("data-status", "warning");
        preview.innerHTML = Icon("clock", 16) +
          "<div>Open-ended — charged at <strong>" + coins(rate) + " XP/hour</strong> for however long it runs." +
          (chosenRate ? " (" + UI.esc(chosenRate.session_name) + " rate)" : "") + "</div>";
        return;
      }
      if (!minutes) {
        preview.innerHTML = Icon("info", 16) + "<div>Pick a duration.</div>";
        return;
      }

      var cost = Number((rate * (minutes / 60)).toFixed(2));
      var balance = mode === "customer" && chosen ? Number(chosen.wallet_balance || 0) : null;
      var short = balance !== null && balance < cost;

      preview.setAttribute("data-status", short ? "warning" : "accent");
      preview.innerHTML = Icon(short ? "alert" : "info", 16) +
        "<div>Full " + minutes + " minutes costs <strong>" + coins(cost) + " XP</strong>" +
        (balance !== null
          ? short
            ? ". " + UI.esc(chosen.customer_name) + " has <strong>" + coins(balance) +
              " XP</strong> — the shortfall is settled at the counter."
            : ". Balance after: <strong>" + coins(balance - cost) + " XP</strong>."
          : ". Charged when the session ends.") +
        "</div>";
    }

    minutesInput.addEventListener("input", refresh);
    rateInput.addEventListener("input", refresh);
    durationChips[1].click();   // default to one hour
    return dialog;
  }

  /* ==========================================================================
     END A SESSION
     ========================================================================== */
  function endSessionDialog(session, onEnded) {
    var cost = session.running_amount;
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="col">' +
        '<div class="kv"><span class="kv-key">Customer</span><span class="kv-val">' +
          UI.esc(session.customer_name) + (session.is_guest ? " (guest)" : "") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Station</span><span class="kv-val mono">' +
          UI.esc(session.pc_name) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Time played</span><span class="kv-val mono">' +
          clock(session.elapsed_seconds) + "</span></div>" +
        /* The price as it was sold, not as the master reads today. A session
           started before a price rise is settled at the old figure, and this
           is where staff see which one that was. */
        '<div class="kv"><span class="kv-key">Rate</span><span class="kv-val">' +
          (session.pricing_unit === "FLAT"
            ? coins(session.flat_amount) + " XP flat"
            : coins(session.rate_per_hour) + " XP / hour") + "</span></div>" +
        (session.price_label
          ? '<div class="kv"><span class="kv-key">Price</span><span class="kv-val">' +
            UI.esc(session.price_label) + "</span></div>"
          : "") +
        '<div class="kv"><span class="kv-key">Amount due</span><span class="kv-val" ' +
          'style="font-size:18px;font-weight:750">' + coins(cost) + " XP</span></div>" +
      "</div>" +
      (session.is_guest
        ? '<div class="notice" data-status="warning">' + Icon("info", 16) +
          "<div>Guests have no wallet — collect " + coins(cost) + " XP worth at the counter.</div></div>"
        : session.wallet_balance !== null && session.wallet_balance < cost
          ? '<div class="notice" data-status="warning">' + Icon("alert", 16) +
            "<div>Balance is <strong>" + coins(session.wallet_balance) + " XP</strong>, short of " +
            coins(cost) + " XP. The session still ends and the amount is recorded as outstanding.</div></div>"
          : '<div class="notice" data-status="online">' + Icon("check", 16) +
            "<div>Charged to the wallet, leaving <strong>" +
            coins(Number(session.wallet_balance || 0) - cost) + " XP</strong>.</div></div>") +
      '<label class="switch" style="margin-top:var(--s-2)">' +
        '<input type="checkbox" id="waiveCharge"><span class="switch-track"></span>' +
        '<span style="font-size:13px">Waive the charge (free session)</span>' +
      "</label>";

    return UI.modal({
      title: "End session",
      body: body,
      actions: [
        { label: "Keep playing", variant: "ghost" },
        {
          label: "End session", variant: "danger", icon: "stop",
          onClick: function (ctx) {
            var waive = ctx.body.querySelector("#waiveCharge").checked;
            return Store.endSession(session, { charge: !waive })
              .then(function (r) {
                var ended = r.data;
                UI.toast({
                  title: "Session ended",
                  message: ended.payment_status === "paid"
                    ? coins(ended.amount_charged) + " XP charged to " + ended.customer_name
                    : ended.payment_status === "waived"
                      ? "No charge applied"
                      : coins(ended.amount_charged) + " XP outstanding",
                  status: ended.payment_status === "unpaid" ? "warn" : "ok"
                });
                if (onEnded) onEnded(ended);
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not end the session", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     CANCEL

     Not the same as ending. Ending bills the time played; cancelling says the
     session should never have been started — wrong station, wrong customer,
     wrong price — and charges nothing.

     The record is kept either way. A café where a station can be occupied for
     twenty minutes and leave no trace is a café where a missing takings figure
     has no explanation, so the row survives with who cancelled it and when.
     ========================================================================== */
  function cancelSessionDialog(session, onDone) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="col">' +
        '<div class="kv"><span class="kv-key">Customer</span><span class="kv-val">' +
          UI.esc(session.customer_name || "Guest") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Station</span><span class="kv-val mono">' +
          UI.esc(session.pc_name) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Held for</span><span class="kv-val mono">' +
          clock(session.elapsed_seconds) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Would have cost</span><span class="kv-val">' +
          coins(session.running_amount) + " XP</span></div>" +
      "</div>" +
      '<div class="notice" data-status="warning">' + Icon("alert", 16) +
        "<div><strong>Nothing will be charged</strong> and the station is released. " +
        "The session stays on record as cancelled — it is not deleted.</div></div>" +
      '<div class="field"><label class="field-label" for="cancelReason">Reason</label>' +
        '<input class="input" id="cancelReason" maxlength="255" ' +
          'placeholder="Wrong station" data-autofocus>' +
        '<div class="field-hint">Recorded against the session and in the audit trail.</div></div>';

    return UI.modal({
      title: "Cancel this session?",
      description: "Use this only when the session should not have been started.",
      body: body,
      actions: [
        { label: "Keep it", variant: "ghost" },
        {
          label: "Cancel session", variant: "danger", icon: "close",
          onClick: function (ctx) {
            var reason = ctx.body.querySelector("#cancelReason").value.trim();
            return Store.cancelSession(session, { reason: reason })
              .then(function () {
                UI.toast.ok("Session cancelled", session.pc_name + " is free — nothing charged");
                if (onDone) onDone();
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not cancel", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     EXTEND / TRANSFER
     ========================================================================== */
  function extendDialog(session, onDone) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label">Add time</label>' +
        '<div class="row gap-2" id="extendRow">' +
          EXTEND_BY.map(function (m) {
            return '<button type="button" class="chip" data-min="' + m + '">+' + m + " min</button>";
          }).join("") +
        "</div></div>" +
      '<div class="field"><label class="field-label field-req" for="extendMinutes">Minutes</label>' +
        '<input class="input" id="extendMinutes" type="number" min="1" max="1440" value="30" data-autofocus></div>';

    var dialog = UI.modal({
      title: "Extend session",
      description: session.customer_name + " on " + session.pc_name,
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Extend", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var minutes = parseInt(ctx.body.querySelector("#extendMinutes").value, 10);
            if (!minutes || minutes < 1) { Motion.shake(ctx.node); return false; }
            return Store.extendSession(session, minutes)
              .then(function (s) {
                UI.toast.ok("Extended by " + minutes + " minutes", clock(s.remaining_seconds) + " left");
                if (onDone) onDone(s);
                return true;
              })
              .catch(function (err) { UI.toast.error("Could not extend", err.message); return false; });
          }
        }
      ]
    });

    var input = body.querySelector("#extendMinutes");
    UI.$$("#extendRow .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () { input.value = chip.dataset.min; });
    });
    return dialog;
  }

  function transferDialog(session, onDone) {
    // Only stations with no session of their own can receive one.
    var free = Store.state.pcs.filter(function (pc) {
      return pc.name !== session.pc_name && !Store.sessionFor(pc.name);
    });

    var body = UI.el("div", { class: "col gap-4" });
    if (!free.length) {
      body.innerHTML = '<div class="notice" data-status="warning">' + Icon("alert", 16) +
        "<div>Every other station is busy or unregistered.</div></div>";
      return UI.modal({
        title: "Transfer session", body: body,
        actions: [{ label: "Close", variant: "ghost" }]
      });
    }

    body.innerHTML =
      '<div class="notice" data-status="info">' + Icon("info", 16) +
        "<div>Time already played moves with the customer — nothing is lost.</div></div>" +
      '<div class="field"><label class="field-label field-req" for="transferPc">Move to</label>' +
        '<select class="select" id="transferPc">' +
          free.map(function (pc) {
            return '<option value="' + pc.pc_id + '">' + UI.esc(pc.name) + "</option>";
          }).join("") +
        "</select></div>";

    return UI.modal({
      title: "Transfer session",
      description: session.customer_name + " from " + session.pc_name,
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Transfer", variant: "primary", icon: "link",
          onClick: function (ctx) {
            var target = parseInt(ctx.body.querySelector("#transferPc").value, 10);
            return Store.transferSession(session, target)
              .then(function (s) {
                UI.toast.ok("Moved to " + s.pc_name, s.customer_name);
                if (onDone) onDone(s);
                return true;
              })
              .catch(function (err) { UI.toast.error("Could not transfer", err.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     SESSIONS PAGE
     ========================================================================== */
  var rootEl = null, offs = [], filter = "open", rows = [], loading = false, listError = null;

  var FILTERS = [
    { id: "open", label: "Active & paused", status: "active,paused" },
    { id: "ended", label: "Completed", status: "ended" },
    { id: "all", label: "All", status: "" }
  ];

  function load() {
    var f = FILTERS.filter(function (x) { return x.id === filter; })[0];
    loading = true;
    listError = null;
    render();
    return Store.listSessions({ status: f.status, limit: 100 })
      .then(function (body) { rows = body.data || []; loading = false; render(); })
      .catch(function (err) { loading = false; listError = err.message; rows = []; render(); });
  }

  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#sessionTable");
    if (!host) return;
    UI.clear(host);

    if (loading && !rows.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (listError) { host.appendChild(UI.errorState(listError, load)); return; }

    if (!rows.length) {
      host.appendChild(UI.emptyState({
        icon: "sessions",
        title: filter === "ended" ? "No completed sessions" : "No sessions running",
        text: filter === "ended"
          ? "Sessions appear here once they finish."
          : "Start one from the Floor to put a customer on a station.",
        actions: [{ label: "Go to Floor", icon: "floor", variant: "primary",
          onClick: function () { global.CXRouter.go("floor"); } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Customer</th><th>Station</th><th>Status</th><th>Started</th>" +
      "<th>Time</th><th class='td-num'>Amount</th><th>Payment</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    rows.forEach(function (s) {
      var live = Store.sessionFor(s.pc_name);
      var session = live && live.session_id === s.session_id ? live : s;
      var isOpen = session.status !== "ended";

      var tr = UI.el("tr", { dataset: { status: session.status === "paused" ? "maintenance" : session.status === "ended" ? "idle" : "gaming" } });
      tr.innerHTML =
        "<td><strong>" + UI.esc(session.customer_name || "—") + "</strong>" +
          (session.is_guest ? ' <span class="badge badge-plain">Guest</span>' : "") + "</td>" +
        '<td class="mono">' + UI.esc(session.pc_name || "—") + "</td>" +
        '<td><span class="badge">' + UI.esc(session.status) + "</span></td>" +
        "<td>" + UI.esc(new Date(session.started_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</td>" +
        '<td class="mono" data-session-time="' + session.session_id + '">' +
          (isOpen ? displayTime(session) : clock(session.elapsed_seconds)) + "</td>" +
        '<td class="td-num" data-session-amount="' + session.session_id + '">' +
          coins(isOpen ? session.running_amount : session.amount_charged) + " XP</td>" +
        '<td><span class="badge" data-status="' +
          ({ paid: "online", unpaid: "offline", waived: "idle", pending: "gaming", not_applicable: "idle" }[session.payment_status] || "idle") +
          '">' + UI.esc(session.payment_status.replace("_", " ")) + "</span></td>" +
        '<td class="td-actions"></td>';

      if (isOpen) {
        var actions = tr.querySelector(".td-actions");
        var endBtn = UI.el("button", {
          class: "btn btn-danger btn-sm",
          html: Icon("stop", 13) + '<span class="btn-label">End</span>'
        });
        endBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          endSessionDialog(session, load);
        });
        actions.appendChild(endBtn);

        /* Food and drink for someone already playing. Opens the till with
           their ticket started, so it settles with their gaming time instead
           of becoming a separate sale nobody can tie back to them. */
        var addBtn = UI.el("button", {
          class: "btn btn-outline btn-sm",
          html: Icon("fnb", 13) + '<span class="btn-label">Add items</span>'
        });
        addBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          global.CXOpenTillForSession(session);
        });
        actions.appendChild(addBtn);

        /* Deliberately the quieter of the two. Ending is the normal close and
           should be the obvious button; cancelling writes off the time and
           wants a moment's thought first. */
        var cancelBtn = UI.el("button", {
          class: "btn btn-ghost btn-sm",
          html: Icon("close", 13) + '<span class="btn-label">Cancel</span>'
        });
        cancelBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          cancelSessionDialog(session, load);
        });
        actions.appendChild(cancelBtn);
      }
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /** Only the time and amount cells change each second. */
  function tick() {
    if (!rootEl) return;
    Object.keys(Store.state.sessions).forEach(function (name) {
      var s = Store.state.sessions[name];
      var timeCell = rootEl.querySelector('[data-session-time="' + s.session_id + '"]');
      var amountCell = rootEl.querySelector('[data-session-amount="' + s.session_id + '"]');
      if (timeCell) timeCell.textContent = displayTime(s);
      if (amountCell) amountCell.textContent = coins(s.running_amount) + " XP";
    });
  }

  global.CXPages.sessions = {
    title: "Sessions",
    subtitle: "Who is playing, and what they owe",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Sessions</div>' +
            '<div class="page-sub">Live play sessions and completed history.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="sessRefresh">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="sessStart">' + Icon("play", 15) +
              '<span class="btn-label">Start session</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar"><div class="row gap-2" id="sessFilters">' +
          FILTERS.map(function (f) {
            return '<button class="chip" data-filter="' + f.id + '"' +
              (f.id === filter ? ' aria-pressed="true" data-status="accent"' : "") + ">" + f.label + "</button>";
          }).join("") +
        "</div></div>" +
        '<div class="card card-body-flush" id="sessionTable"></div>';
      root.appendChild(page);

      UI.$$("#sessFilters .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          filter = chip.dataset.filter;
          UI.$$("#sessFilters .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
            if (c === chip) c.setAttribute("data-status", "accent");
            else c.removeAttribute("data-status");
          });
          load();
        });
      });

      var refreshBtn = page.querySelector("#sessRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return Store.loadSessions().then(load); });
      });

      var startBtn = page.querySelector("#sessStart");
      function syncStartButton() {
        var ready = Store.state.pcs.filter(function (pc) { return canStartSession(pc).ok; });
        startBtn.disabled = ready.length === 0;
        startBtn.setAttribute("data-tip", ready.length
          ? ready.length + " station(s) ready"
          : "No station is connected and free right now");
        return ready;
      }
      startBtn.addEventListener("click", function () {
        var ready = syncStartButton();
        if (!ready.length) return;
        // One eligible station: skip the picker entirely.
        if (ready.length === 1) { startSessionDialog(ready[0].name, load); return; }
        global.CXRouter.go("floor");
        UI.toast.info("Pick a station", "Choose a free station on the floor to start a session.");
      });
      offs.push(Store.on("connected", syncStartButton));
      offs.push(Store.on("pcs", syncStartButton));
      offs.push(Store.on("sessions", syncStartButton));
      syncStartButton();

      offs.push(Store.on("sessions", load));
      offs.push(Store.on("session-tick", tick));

      load();
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    }
  };

  global.CXSessionUI = {
    canStartSession: canStartSession,
    startSessionDialog: startSessionDialog,
    endSessionDialog: endSessionDialog,
    cancelSessionDialog: cancelSessionDialog,
    extendDialog: extendDialog,
    transferDialog: transferDialog,
    clock: clock,
    coins: coins,
    displayTime: displayTime,
    timeLabel: timeLabel
  };
})(window);
