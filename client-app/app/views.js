/* ==========================================================================
   CafeXP Client — Portal views
   Home · Games · Food · Shop · Rewards · Account

   Where a feature has no server behind it yet, the view renders its real
   layout with an explicit "waiting on the server" panel rather than invented
   balances, catalogues or orders.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Icon = global.CXIcon, Motion = global.CXMotion, Session = global.CXSession;
  global.CXViews = {};

  /* Uploaded product images are a relative /uploads/... path from the café's
     own backend; a few older rows may still hold a full external URL from
     before there was an upload button. Only the relative kind needs the
     backend's own host prefixed. */
  function imageSrc(url) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    var base = global.CXWallet && global.CXWallet.apiBase ? global.CXWallet.apiBase() : "";
    return base + url;
  }

  /* ==========================================================================
     SHARED PIECES
     ========================================================================== */

  /** Panel for a feature the server does not provide yet. */
  function awaiting(opts) {
    var node = UI.el("div", { class: "awaiting" });
    node.innerHTML =
      '<div class="awaiting-mark">' + Icon(opts.icon || "info", 28) + "</div>" +
      '<div class="awaiting-title">' + UI.esc(opts.title) + "</div>" +
      '<div class="awaiting-text">' + UI.esc(opts.text) + "</div>" +
      (opts.note ? '<div class="awaiting-note">' + opts.note + "</div>" : "");
    return node;
  }

  function sectionHead(title, actionLabel, onAction) {
    var head = UI.el("div", { class: "shelf-head" }, [
      UI.el("div", { class: "shelf-title", text: title })
    ]);
    if (actionLabel) {
      var btn = UI.el("button", {
        class: "shelf-more",
        html: '<span>' + UI.esc(actionLabel) + "</span>" + Icon("chevronR", 15),
        onClick: onAction
      });
      head.appendChild(btn);
    }
    return head;
  }

  /** The café session the staff started for this customer. */
  function cafeSessionCard(session, online, pc) {
    var st = Session.sessionState();
    var paused = session.status === "paused";
    var timed = session.remaining_seconds !== null;

    var card = UI.el("div", {
      class: "session-card",
      dataset: {
        status: paused ? "warning" : st === "critical" ? "expired" : st === "warning" ? "warning" : "gaming",
        timer: st === "paused" ? "normal" : st
      }
    });

    var caption = paused ? "Paused"
      : !timed ? "Time played"
      : st === "critical" ? "Session ending soon"
      : st === "warning" ? "15 minutes left"
      : "Time remaining";

    // An open-ended session has no total to fill a ring against.
    var pct = timed && session.planned_minutes
      ? Math.max(0, Math.min(100, (Session.sessionClockSeconds() / (session.planned_minutes * 60)) * 100))
      : 100;

    card.innerHTML =
      '<div class="row-between" style="align-items:flex-start">' +
        "<div>" +
          '<div class="session-label">Your station</div>' +
          '<div style="font-family:var(--font-mono);font-size:26px;font-weight:750;letter-spacing:-.02em;margin-top:6px">' +
            UI.esc(pc || "—") + "</div>" +
        "</div>" +
        '<span class="badge badge-lg" data-status="' + (online ? "online" : "offline") + '">' +
          '<span class="dot' + (online ? " dot-live" : "") + '"></span>' +
          (online ? "Online" : "Offline") + "</span>" +
      "</div>" +
      '<div style="margin-top:var(--s-6);padding-top:var(--s-6);border-top:1px solid var(--line);display:flex;gap:var(--s-6);align-items:center">' +
        '<div class="timer-ring" data-ring style="--pct:' + pct + '">' +
          '<div class="timer-ring-inner">' +
            '<div class="timer-digits timer-digits-lg" data-session-digits>' +
              Session.clock(Session.sessionClockSeconds()) + "</div>" +
            '<div class="timer-caption" data-session-caption>' + UI.esc(caption) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="grow" style="min-width:0">' +
          '<div class="session-label">Playing as</div>' +
          '<div style="font-size:var(--t-h2);font-weight:720;letter-spacing:-.02em;margin-top:6px" class="truncate">' +
            UI.esc(session.customer_name || "Guest") + "</div>" +
          '<div class="muted" style="font-size:var(--t-sm);margin-top:var(--s-3);line-height:1.55">' +
            (paused
              ? "Your session is on hold. Ask a staff member when you're ready to carry on."
              : timed
                ? "Ask a staff member if you'd like more time."
                : "Open-ended — play as long as you like.") +
          "</div>" +
        "</div>" +
      "</div>";

    var digits = card.querySelector("[data-session-digits]");
    var captionEl = card.querySelector("[data-session-caption]");
    var ring = card.querySelector("[data-ring]");
    var off = Session.on("session-tick", function () {
      if (!card.isConnected) { off(); return; }
      var s2 = Session.sessionState();
      digits.textContent = Session.clock(Session.sessionClockSeconds());
      card.setAttribute("data-timer", s2 === "paused" ? "normal" : s2);
      if (timed && session.planned_minutes) {
        ring.style.setProperty("--pct",
          Math.max(0, Math.min(100, (Session.sessionClockSeconds() / (session.planned_minutes * 60)) * 100)));
      }
      captionEl.textContent = s2 === "critical" ? "Session ending soon"
        : s2 === "warning" ? "15 minutes left"
        : timed ? "Time remaining" : "Time played";
    });

    return card;
  }

  /**
   * The station / session card. When a game is running it becomes the primary
   * timer surface, driven by the same countdown as the floating timer card.
   */
  function stationCard() {
    var online = Session.isOnline();
    var pc = Session.state.pcName;
    var cafeSession = Session.state.session;

    // A café session is the real thing; the launch timer is a fallback.
    if (cafeSession) return cafeSessionCard(cafeSession, online, pc);

    var play = Session.state.play;
    var timerState = Session.timerState();

    var card = UI.el("div", {
      class: "session-card",
      dataset: {
        status: play ? (timerState === "critical" ? "expired" : timerState === "warning" ? "warning" : "gaming")
                     : (online ? "online" : "offline"),
        timer: timerState
      }
    });

    var header =
      '<div class="row-between" style="align-items:flex-start">' +
        "<div>" +
          '<div class="session-label">Your station</div>' +
          '<div style="font-family:var(--font-mono);font-size:30px;font-weight:750;letter-spacing:-.02em;margin-top:6px">' +
            UI.esc(pc || "Not assigned") + "</div>" +
        "</div>" +
        // Explicit status: this badge reports the connection, not the timer,
        // so it must not inherit the card's state.
        '<span class="badge badge-lg" data-status="' + (online ? "online" : "offline") + '">' +
          '<span class="dot' + (online ? " dot-live" : "") + '"></span>' +
          (online ? "Online" : "Offline") + "</span>" +
      "</div>";

    if (play) {
      var caption = timerState === "critical" ? "Session ending soon"
                  : timerState === "warning" ? "15 minutes left"
                  : "Time remaining";
      card.innerHTML = header +
        '<div style="margin-top:var(--s-6);padding-top:var(--s-6);border-top:1px solid var(--line);display:flex;gap:var(--s-6);align-items:center">' +
          '<div class="timer-ring" data-ring style="--pct:' + Session.progress() + '">' +
            '<div class="timer-ring-inner">' +
              '<div class="timer-digits timer-digits-lg" data-timer-digits>' + Session.clock(play.remaining) + "</div>" +
              '<div class="timer-caption">' + caption + "</div>" +
            "</div>" +
          "</div>" +
          '<div class="grow" style="min-width:0">' +
            '<div class="session-label">Now playing</div>' +
            '<div style="font-size:var(--t-h2);font-weight:720;letter-spacing:-.02em;margin-top:6px" class="truncate">' +
              UI.esc(play.appName) + "</div>" +
            '<div class="muted" style="font-size:var(--t-sm);margin-top:var(--s-3);line-height:1.55">' +
              "Play continues after the timer reaches zero — staff will settle the extra time." +
            "</div>" +
          "</div>" +
        "</div>";

      // Keep this card's numerals in step with the shared countdown.
      var digits = card.querySelector("[data-timer-digits]");
      var ring = card.querySelector("[data-ring]");
      var off = Session.on("tick", function (p) {
        if (!card.isConnected) { off(); return; }
        digits.textContent = Session.clock(p.remaining);
        ring.style.setProperty("--pct", Session.progress());
        var s = Session.timerState();
        card.setAttribute("data-timer", s);
        card.setAttribute("data-status", s === "critical" ? "expired" : s === "warning" ? "warning" : "gaming");
      });
    } else {
      card.innerHTML = header +
        '<div style="margin-top:var(--s-6);padding-top:var(--s-5);border-top:1px solid var(--line)">' +
          '<div class="session-label">Session time</div>' +
          '<div class="muted" style="font-size:var(--t-body);margin-top:6px;line-height:1.55">' +
            (online
              ? "No session is running on this station. When staff start one, the countdown appears here and on the floating timer card."
              : "This station has lost its link to the café server. Please let a staff member know.") +
          "</div>" +
        "</div>";
    }

    return card;
  }

  /*
   * Mount a self-replacing station card.
   *
   * stationCard() only builds a snapshot; its own "tick"/"session-tick"
   * listeners update the numbers in place but never swap the card itself. A
   * session ending stops those ticks (session.js clears the interval), which
   * left this card frozen showing the last numbers it drew rather than
   * falling back to "no session running" — indistinguishable, from the
   * counter, from the session still charging. Rebuilding on every "session"
   * event (fired on start, end and cancel alike) is what a fresh screen or a
   * router change already gets for free; this is the same fix for the one
   * screen that doesn't remount on its own.
   */
  function mountStationCard(container) {
    var card = stationCard();
    container.appendChild(card);
    var off = Session.on("session", function () {
      if (!card.isConnected) { off(); return; }
      var fresh = stationCard();
      card.replaceWith(fresh);
      card = fresh;
    });
    return card;
  }

  /* ==========================================================================
     HOME
     ========================================================================== */
  global.CXViews.home = {
    label: "Home",
    icon: "dashboard",
    title: "Home",
    mount: function (root, ctx) {
      var view = UI.el("div", { class: "view-bleed" });

      /* ---- hero ---- */
      var play = Session.state.play;
      var hero = UI.el("section", { class: "hero" });
      hero.innerHTML =
        '<div class="hero-art"></div>' +
        '<div class="vignette"></div>' +
        '<div class="hero-inner">' +
          '<span class="hero-eyebrow">' + Icon("sparkle", 13) +
            (play ? "Now playing" : "Your gaming hub") + "</span>" +
          '<h1 class="hero-title">' +
            (play ? UI.esc(play.appName) : "Welcome back, " + UI.esc(Session.firstName())) +
          "</h1>" +
          '<div class="hero-meta">' +
            (play
              ? '<span class="timer-digits" style="font-size:24px" data-hero-timer>' +
                  Session.clock(play.remaining) + "</span><span class='faint'>remaining</span>"
              : "") +
            '<span class="badge badge-lg" data-status="' + (Session.isOnline() ? "online" : "offline") + '">' +
              '<span class="dot' + (Session.isOnline() ? " dot-live" : "") + '"></span>' +
              (Session.isOnline() ? "Station online" : "Station offline") + "</span>" +
            '<span class="mono faint">' + UI.esc(Session.state.pcName || "Station not assigned") + "</span>" +
          "</div>" +
          '<div class="hero-actions">' +
            '<button class="btn btn-primary btn-hero" id="heroGames">' + Icon("games", 18) +
              '<span class="btn-label">Browse games</span></button>' +
            '<button class="btn btn-outline btn-hero" id="heroFood">' + Icon("fnb", 18) +
              '<span class="btn-label">Order food</span></button>' +
          "</div>" +
        "</div>";
      view.appendChild(hero);

      var body = UI.el("div", { class: "view" });

      /* ---- session + quick actions ---- */
      var split = UI.el("div", {
        class: "grid",
        style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(320px,380px)", gap: "var(--s-6)", alignItems: "start" }
      });

      var left = UI.el("div", { class: "col", style: { gap: "var(--s-6)" } });

      /* Library shelf */
      var libSection = UI.el("section");
      libSection.appendChild(sectionHead("Your library", "See all", function () { ctx.go("games"); }));
      libSection.appendChild(awaiting({
        icon: "games",
        title: "Your library is on its way",
        text: "The games your café has set up for this station will appear here. Ask a staff member if you expected to see something.",
        note: "Waiting for the server to send this station's game list."
      }));
      left.appendChild(libSection);

      split.appendChild(left);

      var right = UI.el("div", { class: "col", style: { gap: "var(--s-5)" } });
      mountStationCard(right);

      var quick = UI.el("div", { class: "card card-pad col", style: { gap: "var(--s-3)" } });
      quick.innerHTML = '<div class="session-label" style="margin-bottom:var(--s-2)">Quick actions</div>';
      [
        ["billing", "My wallet", "wallet"],
        ["membership", "Membership", "membership"],
        ["fnb", "Order food", "food"],
        ["packages", "Visit the shop", "shop"],
        ["plan", "Rewards", "rewards"],
        ["customers", "My account", "account"]
      ].forEach(function (item) {
        var btn = UI.el("button", {
          class: "btn btn-outline btn-block",
          style: { justifyContent: "flex-start", gap: "var(--s-3)" },
          html: Icon(item[0], 17) + '<span class="btn-label">' + item[1] + "</span>",
          onClick: function () { ctx.go(item[2]); }
        });
        quick.appendChild(btn);
      });
      right.appendChild(quick);

      split.appendChild(right);
      body.appendChild(split);
      view.appendChild(body);
      root.appendChild(view);

      hero.querySelector("#heroGames").addEventListener("click", function () { ctx.go("games"); });
      hero.querySelector("#heroFood").addEventListener("click", function () { ctx.go("food"); });

      var heroTimer = hero.querySelector("[data-hero-timer]");
      if (heroTimer) {
        var offHero = Session.on("tick", function (p) {
          if (!heroTimer.isConnected) { offHero(); return; }
          heroTimer.textContent = Session.clock(p.remaining);
        });
      }

      Motion.enter(hero.querySelector(".hero-inner"), { y: 20, duration: 0.5 });
      Motion.stagger([left, right], { step: 0.06, y: 16 });
    }
  };

  /* ==========================================================================
     GAMES
     ========================================================================== */
  /* Kept across mounts so navigating away and back does not stack listeners. */
  var gamesOff = null;

  /**
   * Self-service start — the picker a customer uses to begin their own
   * session, shown in place of the plain launch grid while the station is
   * idle. Pick a game, pick a price, tap Start; the console starts the
   * session with its own token and the chosen title launches the moment it
   * actually goes active (handled in the main process, not here).
   *
   * The wallet gate is enforced server-side (see session.Controller.js's
   * `require_prepaid`) — this UI only shows the balance so the customer isn't
   * surprised by the refusal, it never decides on its own whether Start works.
   */
  function startPicker(view) {
    var Wallet = global.CXWallet;
    var host = UI.el("div", { class: "col gap-4" });
    var selectedGame = null, selectedPriceId = null, starting = false;
    /* null until the game's account mode has been answered. Only asked when
       the café actually offers a choice — a game that is venue-only or
       own-login-only has one possible answer, so asking would be a step that
       decides nothing. */
    var useVenue = null;

    function needsAccountChoice(g) {
      return !!g && g.account_mode === "CUSTOMER_OR_VENUE";
    }
    /* What will actually happen, once the choice (if any) is made. */
    function resolvedUseVenue(g) {
      if (!g) return false;
      if (g.account_mode === "VENUE_ACCOUNT") return true;
      if (g.account_mode === "CUSTOMER_ACCOUNT") return false;
      return useVenue === true;
    }

    function priceLabel(p) {
      var length = p.is_unlimited ? "Unlimited" : (
        p.duration_minutes >= 60
          ? (p.duration_minutes % 60 === 0 ? (p.duration_minutes / 60) + " Hr" : p.duration_minutes + " Min")
          : p.duration_minutes + " Min"
      );
      return length + " · " + Wallet.money(p.price);
    }

    function render() {
      UI.clear(host);

      var games = Session.state.startGames || [];
      var prices = Session.state.startPrices || [];

      if (!games.length) {
        host.appendChild(awaiting({
          icon: "games", title: "No games set up on this station yet",
          text: "Ask a staff member to add a game to this station before you can start a session yourself."
        }));
        return;
      }
      if (!prices.length) {
        host.appendChild(awaiting({
          icon: "billing", title: "No price set for this station",
          text: "Ask a staff member to set a price for this station's type before you can start a session yourself."
        }));
        return;
      }

      host.appendChild(UI.el("div", { class: "shelf-title", text: "1. Choose a game" }));
      var gameGrid = UI.el("div", { class: "game-tile-grid" });
      games.forEach(function (g) {
        /* Keyed on the PLATFORM, not the game: the same title installed from
           two stores is two separate things to launch, and picking "F1 25"
           without saying which copy would leave the launcher guessing. */
        var chosen = selectedGame && selectedGame.game_platform_id === g.game_platform_id;
        var art = imageSrc(g.icon_url);
        var el = UI.el("button", {
          class: "game-tile",
          dataset: chosen ? { status: "accent" } : {}
        });
        el.innerHTML =
          (art
            ? '<span class="game-tile-art" style="background-image:url(\'' + UI.esc(art) + "')\"></span>"
            : '<span class="game-tile-art game-tile-art-fallback">' +
                '<span class="avatar" style="width:44px;height:44px;font-size:15px">' +
                  UI.esc(UI.initials ? UI.initials(g.name) : g.name.slice(0, 2).toUpperCase()) +
                "</span></span>") +
          '<span class="game-tile-shade"></span>' +
          (chosen ? '<span class="game-tile-check" data-status="online">' + Icon("check", 13) + "</span>" : "") +
          '<span class="game-tile-label">' +
            '<span class="game-tile-name">' + UI.esc(g.name) + "</span>" +
            '<span class="game-tile-meta">' + UI.esc([g.category, g.platform].filter(Boolean).join(" · ")) + "</span>" +
          "</span>";
        el.addEventListener("click", function () {
          selectedGame = g;
          useVenue = null;   // a new game asks its own account question
          render();
        });
        gameGrid.appendChild(el);
      });
      host.appendChild(gameGrid);

      /* ---- 2. How to play it, when the café offers both ways ---- */
      var step = 2;
      if (needsAccountChoice(selectedGame)) {
        host.appendChild(UI.el("div", { class: "shelf-title", text: "2. Choose how you want to play" }));
        var choices = UI.el("div", { class: "col gap-2" });
        [
          [true, "Just play", "Use a venue account", "play"],
          [false, "Log in", "Use your own account", "customers"]
        ].forEach(function (c) {
          var picked = useVenue === c[0];
          var btn = UI.el("button", {
            class: "card card-pad row gap-4",
            style: { alignItems: "center", textAlign: "left", cursor: "pointer", width: "100%" },
            dataset: picked ? { status: "accent" } : {}
          });
          btn.innerHTML =
            '<span class="tx-icon" style="flex:0 0 auto">' + Icon(c[3], 18) + "</span>" +
            '<span class="grow" style="min-width:0">' +
              '<span style="display:block;font-size:14px;font-weight:700">' + c[1] + "</span>" +
              '<span class="faint" style="font-size:12px">' + c[2] + "</span>" +
            "</span>" +
            (picked ? '<span class="tx-icon" data-status="online" style="flex:0 0 auto">' + Icon("check", 14) + "</span>" : "");
          btn.addEventListener("click", function () { useVenue = c[0]; render(); });
          choices.appendChild(btn);
        });
        host.appendChild(choices);
        step = 3;
      } else if (selectedGame && selectedGame.account_mode === "VENUE_ACCOUNT") {
        var venueNote = UI.el("div", { class: "notice", dataset: { status: "idle" } });
        venueNote.innerHTML = Icon("info", 16) +
          "<div>The café provides the account for this game — just pick how long you want to play.</div>";
        host.appendChild(venueNote);
      }

      host.appendChild(UI.el("div", { class: "shelf-title", text: step + ". Choose how long" }));
      var priceRow = UI.el("div", { class: "row gap-2 wrap" });
      prices.forEach(function (p) {
        var chip = UI.el("button", {
          class: "chip", text: priceLabel(p),
          "aria-pressed": String(selectedPriceId === p.price_id)
        });
        if (selectedPriceId === p.price_id) chip.setAttribute("data-status", "accent");
        chip.addEventListener("click", function () { selectedPriceId = p.price_id; render(); });
        priceRow.appendChild(chip);
      });
      host.appendChild(priceRow);

      var balance = Wallet.state.balance;
      var selectedPrice = prices.filter(function (p) { return p.price_id === selectedPriceId; })[0];
      if (selectedPrice) {
        var covers = balance !== null && balance >= selectedPrice.price;
        var note = UI.el("div", { class: "notice" });
        note.setAttribute("data-status", covers ? "online" : "warning");
        note.innerHTML = Icon(covers ? "check" : "alert", 16) + "<div>" +
          (balance === null
            ? "Checking your balance…"
            : covers
              ? "Your wallet holds " + UI.esc(Wallet.money(balance)) + " — enough to start."
              : "Your wallet holds " + UI.esc(Wallet.money(balance)) + ", and this needs " +
                UI.esc(Wallet.money(selectedPrice.price)) + ". Top up at the counter to start.") +
          "</div>";
        host.appendChild(note);
      }

      if (Session.state.startFailed) {
        var errNote = UI.el("div", { class: "notice", dataset: { status: "error" } });
        errNote.innerHTML = Icon("alert", 16) + "<div>" + UI.esc(Session.state.startFailed) + "</div>";
        host.appendChild(errNote);
      }

      var startBtn = UI.el("button", {
        class: "btn btn-primary btn-lg btn-block",
        html: Icon("play", 17) + '<span class="btn-label">' + (starting ? "Starting…" : "Start session") + "</span>"
      });
      // A game that offers both account routes cannot start until one is picked.
      var accountAnswered = !needsAccountChoice(selectedGame) || useVenue !== null;
      startBtn.disabled = !selectedGame || !selectedPriceId || !accountAnswered || starting;
      startBtn.addEventListener("click", function () {
        starting = true;
        render();
        Session.requestStartSession(selectedGame, selectedPriceId, resolvedUseVenue(selectedGame));
      });
      host.appendChild(startBtn);
    }

    render();
    view.appendChild(host);

    return {
      /* The console answered, or a session just went active — either way the
         "Starting…" state is over. */
      stopWaiting: function () { starting = false; render(); },
      refresh: render
    };
  }

  global.CXViews.games = {
    label: "Games",
    icon: "games",
    title: "Games",
    mount: function (root) {
      var idle = !Session.state.session;

      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">' + (idle ? "Start a session" : "Choose a game") + "</div>" +
            '<div class="view-sub">' + (idle
              ? "Pick a game and a duration to start playing — no staff needed."
              : "Everything your café has made available on this station.") + "</div>" +
          "</div>" +
          (idle ? "" :
            '<div class="row gap-3">' +
              '<div class="search" style="width:300px">' + Icon("search", 16) +
                '<input class="input" id="gameSearch" type="search" placeholder="Search games…"></div>' +
            "</div>") +
        "</div>";
      root.appendChild(view);

      if (gamesOff) { gamesOff.forEach(function (off) { try { off(); } catch (e) {} }); gamesOff = null; }

      /* -------- idle: self-service start picker -------- */
      if (idle) {
        var picker = startPicker(view);
        Session.requestStartOptions();
        gamesOff = [
          Session.on("start-options", picker.refresh),
          Session.on("start-failed", picker.stopWaiting),
          // The balance line updates once the wallet actually loads, rather
          // than sitting on "Checking your balance…" until the next repaint.
          global.CXWallet.on(picker.refresh)
          // No need to watch for the session actually starting here — the
          // portal shell already re-mounts the active view on every "session"
          // change (see portal.js), which re-runs this same mount function
          // and finds `Session.state.session` truthy on the next pass.
        ];
        Motion.enter(view, { y: 14 });
        return;
      }

      /* -------- mid-session: plain launch grid (unchanged) -------- */
      var grid = UI.el("div", { class: "col gap-3", id: "gameGrid" });
      view.appendChild(grid);

      var filter = "";

      function card(g) {
        var el = UI.el("button", {
          class: "card card-pad row gap-4",
          style: { alignItems: "center", textAlign: "left", cursor: "pointer", width: "100%" }
        });
        el.innerHTML =
          '<span class="avatar" style="width:44px;height:44px;font-size:15px;flex:0 0 auto">' +
            UI.esc(UI.initials ? UI.initials(g.name) : g.name.slice(0, 2).toUpperCase()) + "</span>" +
          '<span class="grow" style="min-width:0">' +
            '<span style="display:block;font-size:15px;font-weight:700">' + UI.esc(g.name) + "</span>" +
            '<span class="faint" style="font-size:12px">' +
              UI.esc([g.category, g.platform].filter(Boolean).join(" · ")) + "</span>" +
          "</span>" +
          '<span class="btn btn-primary btn-sm" style="flex:0 0 auto">' + Icon("play", 14) +
            '<span class="btn-label">Play</span></span>';
        el.addEventListener("click", function () {
          Session.launchGame(g);   // portal's global "launching" handler shows the overlay
        });
        return el;
      }

      function render() {
        UI.clear(grid);
        var games = (Session.state.games || []).filter(function (g) {
          return !filter || (g.name || "").toLowerCase().indexOf(filter) !== -1
            || (g.category || "").toLowerCase().indexOf(filter) !== -1;
        });

        if (!Session.state.games || !Session.state.games.length) {
          grid.appendChild(awaiting({
            icon: "games",
            title: "No games have reached this station yet",
            text: "Your café's staff choose which games appear here. Once a session starts and the server sends this station's library, every title shows up with a play button.",
            note: "Waiting for the server to send this station's game list."
          }));
          return;
        }
        if (!games.length) {
          grid.appendChild(awaiting({ icon: "games", title: "No games match", text: "Nothing matches “" + filter + "”." }));
          return;
        }
        var made = [];
        games.forEach(function (g) { var c = card(g); grid.appendChild(c); made.push(c); });
        Motion.stagger(made, { step: 0.03, y: 8 });
      }

      view.querySelector("#gameSearch").addEventListener("input", function (e) {
        filter = e.target.value.trim().toLowerCase();
        render();
      });

      // Re-render live when the console pushes an updated list.
      gamesOff = [Session.on("games", render)];

      render();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     FOOD  (live menu from /api/products/menu)
     ========================================================================== */
  var cart = {};          // product_id -> { product, quantity }  (survives view swaps)

  function cartLines() {
    return Object.keys(cart).map(function (k) { return cart[k]; })
      .filter(function (l) { return l.quantity > 0; });
  }
  function cartTotal() {
    return cartLines().reduce(function (sum, l) {
      return sum + Number(l.product.price) * l.quantity;
    }, 0);
  }
  function cartCount() {
    return cartLines().reduce(function (n, l) { return n + l.quantity; }, 0);
  }

  /*
   * Food and Shop are the same feature twice over — a café-run product
   * catalogue, browsed and ordered to a station — split only by the `kind`
   * the backend already tags each category with ('FNB' vs 'SHOP'). One mount
   * function serves both; only the copy and which half of the catalogue it
   * asks for differ.
   */
  function mountProductShop(root, ctx, opts) {
      var Wallet = global.CXWallet;
      var activeCategory = "All";

      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">' + UI.esc(opts.pageTitle) + "</div>" +
            '<div class="view-sub">' + UI.esc(opts.subtitle) + "</div>" +
          "</div>" +
          '<button class="btn btn-primary btn-lg" id="foodCartBtn">' + Icon("fnb", 17) +
            '<span class="btn-label">Your order</span>' +
            '<span class="chip-count" id="foodCartCount" style="background:rgba(0,0,0,.25)">0</span>' +
          "</button>" +
        "</div>" +
        '<div class="row gap-2 wrap" id="foodCats" style="margin-bottom:var(--s-6)"></div>' +
        '<div id="foodHost"></div>' +
        '<div id="foodOrders" style="margin-top:var(--s-12)"></div>';
      root.appendChild(view);

      var host = view.querySelector("#foodHost");
      var catsRow = view.querySelector("#foodCats");
      var ordersHost = view.querySelector("#foodOrders");
      host.appendChild(UI.skeletonCards(6, "260px"));

      function syncCartButton() {
        var count = cartCount();
        view.querySelector("#foodCartCount").textContent = count;
        view.querySelector("#foodCartBtn").disabled = count === 0;
      }

      /*
       * What the menu and the order list are currently showing.
       *
       * Both painters ran on every wallet emit, and the wallet emits for
       * anything it does — a balance refresh, a transaction load, a top-up —
       * none of which change the menu. Each emit tore down every product card
       * and re-ran the staggered slide-in, which is what the flicker was.
       *
       * The signature is the rendered input itself rather than a list of
       * fields, because a menu is a few dozen small objects: stringifying it
       * costs microseconds and cannot miss a field the way a hand-written
       * list can. The cart is deliberately absent — quantities are written
       * straight into their own elements by setQty and never need a repaint.
       */
      var lastMenuSig = "";
      var lastOrdersSig = "";

      /* ---- menu ---- */
      function paintMenu(s) {
        var sig = s.menuError ? "error:" + s.menuError
          : !s.menu ? "loading"
          : activeCategory + "::" + JSON.stringify(s.menu);
        if (sig === lastMenuSig && host.childElementCount) return;
        lastMenuSig = sig;

        UI.clear(catsRow);
        UI.clear(host);

        if (s.menuError) {
          host.appendChild(UI.emptyState({
            icon: "alert", status: "error",
            title: "Couldn't load the menu",
            text: "The café server didn't respond. Please try again.",
            actions: [{ label: "Try again", icon: "refresh", onClick: function () { Wallet.loadMenu(); } }]
          }));
          return;
        }
        if (!s.menu) { host.appendChild(UI.skeletonCards(6, "260px")); return; }

        var all = s.menu.data || [];
        if (!all.length) {
          host.appendChild(UI.emptyState({
            icon: opts.emptyIcon,
            title: opts.emptyTitle,
            text: opts.emptyText
          }));
          return;
        }

        // Category chips, driven by whatever the café actually has.
        var categories = ["All"].concat(s.menu.categories || []);
        categories.forEach(function (name) {
          var chip = UI.el("button", {
            class: "chip",
            text: name,
            "aria-pressed": String(name === activeCategory)
          });
          if (name === activeCategory) chip.setAttribute("data-status", "accent");
          chip.addEventListener("click", function () {
            activeCategory = name;
            paintMenu(s);
          });
          catsRow.appendChild(chip);
        });

        var shown = activeCategory === "All"
          ? all
          : (s.menu.grouped[activeCategory] || []);

        var grid = UI.el("div", { class: "grid-products" });
        shown.forEach(function (product) {
          var line = cart[product.product_id];
          var qty = line ? line.quantity : 0;

          var card = UI.el("div", { class: "product" });
          card.innerHTML =
            '<div class="product-art"' +
              (product.image_url ? ' style="background-image:url(' + UI.esc(imageSrc(product.image_url)) + ')"' : "") + ">" +
              (product.stock_state === "low"
                ? '<span class="badge" data-status="warning" style="position:absolute;top:10px;left:10px">Only ' +
                  product.stock_quantity + " left</span>"
                : "") +
            "</div>" +
            '<div class="product-body">' +
              '<div class="product-name">' + UI.esc(product.product_name) + "</div>" +
              (product.description
                ? '<div class="product-desc">' + UI.esc(product.description) + "</div>" : "") +
              '<div class="product-price">' + UI.esc(Wallet.money(product.price)) + "</div>" +
            "</div>";

          var foot = UI.el("div", { class: "product-foot" });
          var stepper = UI.el("div", { class: "stepper" });
          stepper.innerHTML =
            '<button data-minus aria-label="One fewer">' + Icon("close", 12) + "</button>" +
            '<span class="stepper-value" data-qty>' + qty + "</span>" +
            '<button data-plus aria-label="One more">' + Icon("plus", 12) + "</button>";

          var qtyEl = stepper.querySelector("[data-qty]");
          var minus = stepper.querySelector("[data-minus]");
          var plus = stepper.querySelector("[data-plus]");

          function setQty(next) {
            // Never let the customer add more than the shelf holds.
            var cap = product.track_stock ? Number(product.stock_quantity) : Infinity;
            next = Math.max(0, Math.min(next, cap));
            if (next === 0) delete cart[product.product_id];
            else cart[product.product_id] = { product: product, quantity: next };
            qtyEl.textContent = next;
            minus.disabled = next === 0;
            plus.disabled = next >= cap;
            addBtn.classList.toggle("btn-primary", next > 0);
            addBtn.classList.toggle("btn-outline", next === 0);
            syncCartButton();
            Motion.animate(qtyEl, { transform: ["scale(.7)", "scale(1)"] },
              { duration: 0.22, easing: Motion.EASE.out });
          }

          var addBtn = UI.el("button", {
            class: "btn " + (qty > 0 ? "btn-primary" : "btn-outline") + " grow",
            html: '<span class="btn-label">Add to order</span>'
          });
          addBtn.addEventListener("click", function () {
            var current = cart[product.product_id];
            setQty((current ? current.quantity : 0) + 1);
          });

          minus.addEventListener("click", function () {
            var current = cart[product.product_id];
            setQty((current ? current.quantity : 0) - 1);
          });
          plus.addEventListener("click", function () {
            var current = cart[product.product_id];
            setQty((current ? current.quantity : 0) + 1);
          });
          minus.disabled = qty === 0;

          foot.appendChild(stepper);
          foot.appendChild(addBtn);
          card.appendChild(foot);
          grid.appendChild(card);
        });

        host.appendChild(grid);
        Motion.stagger(grid.children, { step: 0.025, y: 12 });
      }

      /* ---- my orders ---- */
      var ORDER_TONE = {
        PLACED: "warning", CONFIRMED: "gaming", PREPARING: "gaming",
        READY: "online", DELIVERED: "idle", CANCELLED: "offline"
      };
      var ORDER_COPY = {
        PLACED: "Sent to the kitchen", CONFIRMED: "Confirmed", PREPARING: "Being prepared",
        READY: "Ready — on its way", DELIVERED: "Delivered", CANCELLED: "Cancelled"
      };

      /*
       * A kitchen order moves through fixed stages, and "Preparing" on its own
       * does not tell the customer how far along that is. The track shows the
       * whole journey with the current stage marked, so the answer to "how
       * much longer" is visible rather than inferred.
       *
       * Cancelled is not a stage on the path — it is a stop — so it renders as
       * a single state rather than a part-filled track.
       */
      var ORDER_STEPS = ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
      var STEP_LABEL = {
        PLACED: "Sent", CONFIRMED: "Confirmed", PREPARING: "Cooking",
        READY: "Ready", DELIVERED: "Delivered"
      };

      function orderTrack(status) {
        var track = UI.el("div", { class: "order-track" });

        if (status === "CANCELLED") {
          track.dataset.status = "offline";
          track.innerHTML = '<div class="order-track-cancelled">' +
            Icon("close", 13) + "<span>This order was cancelled</span></div>";
          return track;
        }

        var reached = ORDER_STEPS.indexOf(status);
        if (reached === -1) reached = 0;

        track.innerHTML = ORDER_STEPS.map(function (step, i) {
          var state = i < reached ? "done" : (i === reached ? "current" : "todo");
          return '<div class="order-step" data-state="' + state + '">' +
            '<span class="order-step-dot"></span>' +
            '<span class="order-step-label">' + STEP_LABEL[step] + "</span>" +
          "</div>";
        }).join("");

        // The bar fills to the current stage, so progress reads at a glance.
        track.style.setProperty(
          "--reached",
          (reached / (ORDER_STEPS.length - 1) * 100).toFixed(1) + "%"
        );
        return track;
      }

      function paintOrders(s) {
        /* Same guard as the menu: an order list only changes when an order
           does, not when the balance is refreshed underneath it. */
        var sig = JSON.stringify(s.orders || []);
        if (sig === lastOrdersSig) return;
        lastOrdersSig = sig;

        UI.clear(ordersHost);
        if (!s.orders || !s.orders.length) return;

        ordersHost.appendChild(sectionHead("Your orders", null, null));
        var card = UI.el("div", { class: "card card-body-flush" });
        s.orders.slice(0, 8).forEach(function (order) {
          var row = UI.el("div", {
            class: "kv",
            style: { padding: "14px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: ORDER_TONE[order.status] || "idle" }
          });
          row.innerHTML =
            '<span style="min-width:0">' +
              '<span class="mono" style="font-size:13px;font-weight:650;display:block">' +
                UI.esc(order.order_number) + "</span>" +
              '<span class="faint" style="font-size:11px">' +
                UI.esc(order.items.map(function (i) { return i.quantity + "× " + i.product_name; }).join(", ")) +
              "</span></span>" +
            '<span style="text-align:right;white-space:nowrap">' +
              '<span style="font-size:15px;font-weight:750">' + UI.esc(Wallet.money(order.total)) + "</span>" +
              '<span style="display:block;margin-top:3px"><span class="badge" data-status="' +
                (ORDER_TONE[order.status] || "idle") + '">' +
                UI.esc(ORDER_COPY[order.status] || order.status) + "</span></span>" +
            "</span>";

          var wrap = UI.el("div", {
            style: { borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: ORDER_TONE[order.status] || "idle" }
          });
          row.style.borderBottom = "0";
          wrap.appendChild(row);
          wrap.appendChild(orderTrack(order.status));
          card.appendChild(wrap);
        });
        ordersHost.appendChild(card);
      }

      /* ---- cart drawer ---- */
      function openCart() {
        var lines = cartLines();
        if (!lines.length) return;

        var body = UI.el("div", { class: "col" });
        function paintCart() {
          UI.clear(body);
          var current = cartLines();
          if (!current.length) { drawer.close(); return; }

          current.forEach(function (line) {
            var row = UI.el("div", { class: "cart-line" });
            row.innerHTML =
              "<span><span class='cart-name'>" + UI.esc(line.product.product_name) + "</span>" +
                "<span class='cart-qty'>" + line.quantity + " × " +
                UI.esc(Wallet.money(line.product.price)) + "</span></span>" +
              "<span class='cart-amount'>" +
                UI.esc(Wallet.money(line.product.price * line.quantity)) + "</span>";
            body.appendChild(row);
          });

          var totals = UI.el("div", { class: "cart-total" });
          totals.innerHTML =
            "<span class='cart-total-label'>Total</span>" +
            "<span class='cart-total-value'>" + UI.esc(Wallet.money(cartTotal())) + "</span>";
          body.appendChild(totals);

          var balance = Wallet.state.balance;
          var note = UI.el("div", { class: "notice", style: { marginTop: "var(--s-5)" } });
          if (balance === null) {
            note.setAttribute("data-status", "idle");
            note.innerHTML = Icon("info", 16) + "<div>Your order will be added to your bill.</div>";
          } else if (balance >= cartTotal()) {
            note.setAttribute("data-status", "online");
            note.innerHTML = Icon("check", 16) +
              "<div>Paid from your wallet, leaving <strong>" +
              UI.esc(Wallet.money(balance - cartTotal())) + "</strong>.</div>";
          } else {
            note.setAttribute("data-status", "warning");
            note.innerHTML = Icon("alert", 16) +
              "<div>Your wallet holds <strong>" + UI.esc(Wallet.money(balance)) +
              "</strong>. The rest goes on your bill to settle at the counter.</div>";
          }
          body.appendChild(note);
        }

        var drawer = UI.drawer({
          head: '<div class="row-between"><div class="page-title" style="font-size:21px">Your order</div></div>',
          body: body,
          foot: "",
          onClose: function () { syncCartButton(); }
        });

        var placeBtn = UI.el("button", {
          class: "btn btn-primary btn-lg btn-block",
          html: Icon("check", 17) + '<span class="btn-label">Place order</span>'
        });
        placeBtn.addEventListener("click", function () {
          UI.withBusy(placeBtn, function () {
            return Wallet.placeOrder(
              cartLines().map(function (l) {
                return { product_id: l.product.product_id, quantity: l.quantity };
              }),
              { pc_name: Session.state.pcName || null }
            )
              .then(function (r) {
                UI.toast.ok(r.message, r.data.order_number);
                cart = {};
                syncCartButton();
                drawer.close();
              })
              .catch(function (err) {
                UI.toast.error("Order failed", err.message);
                // Stock may have moved under us, so refresh the menu.
                Wallet.loadMenu();
              });
          });
        });
        drawer.foot.appendChild(placeBtn);

        paintCart();
      }

      view.querySelector("#foodCartBtn").addEventListener("click", openCart);

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paintMenu(s);
        paintOrders(s);
      });

      // Food and Shop share one cached menu slot on the wallet — only trust
      // it for an instant repaint when it's actually this page's kind, or a
      // customer flipping tabs would see the other one's items for a moment.
      if (Wallet.state.menu && Wallet.state.menu.kind === opts.kind) {
        paintMenu(Wallet.state); paintOrders(Wallet.state);
      }
      Wallet.loadMenu(opts.kind);
      Wallet.loadOrders();
      syncCartButton();
      Motion.enter(view, { y: 14 });
  }

  global.CXViews.food = {
    label: "Food",
    icon: "fnb",
    title: "Food & drink",
    mount: function (root, ctx) {
      mountProductShop(root, ctx, {
        kind: "FNB",
        pageTitle: "Food & drink",
        subtitle: "Order to your station without leaving your seat.",
        emptyIcon: "fnb",
        emptyTitle: "Nothing on the menu right now",
        emptyText: "The kitchen hasn't put anything up for order. Ask a staff member what's available."
      });
    }
  };

  /* ==========================================================================
     APPS
     "Access your own games" — sign in to your own launcher on this station.
     Real, not a placeholder: it asks the same detectLaunchers() the café
     console already uses to badge a station "Steam ✓ Riot ✓", and opening a
     tile actually launches it. Every launcher the station knows how to
     detect is shown, not just the four brands a competitor happened to
     screenshot — an installed one you'd otherwise never notice is still
     worth surfacing.
     ========================================================================== */
  global.CXViews.apps = {
    label: "Apps",
    icon: "panel",
    title: "Apps",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Access your own games</div>' +
          '<div class="view-sub">Sign in to your own Steam, Epic, Battle.net or other account on this station.</div>' +
        "</div></div>";

      var grid = UI.el("div", { class: "launcher-grid" });
      view.appendChild(grid);
      root.appendChild(view);
      Motion.enter(view, { y: 14 });

      if (!global.api || !global.api.getLaunchers) {
        grid.appendChild(awaiting({
          icon: "panel",
          title: "Not available on this build",
          text: "This station's client needs updating before launcher access works here."
        }));
        return;
      }

      grid.appendChild(UI.skeletonCards ? UI.skeletonCards(4, "120px") : UI.el("div"));

      global.api.getLaunchers(function (launchers) {
        UI.clear(grid);
        var names = Object.keys(launchers || {});
        if (!names.length) {
          grid.appendChild(awaiting({
            icon: "panel", title: "No launchers found",
            text: "Ask a staff member to install a game launcher on this station."
          }));
          return;
        }

        names.forEach(function (name) {
          var info = launchers[name] || {};
          var tile = UI.el("button", {
            class: "launcher-tile",
            dataset: info.installed ? {} : { status: "idle" }
          });
          tile.disabled = !info.installed;
          tile.innerHTML =
            '<span class="launcher-tile-icon">' + Icon("panel", 26) + "</span>" +
            '<span class="launcher-tile-name">' + UI.esc(name) + "</span>" +
            '<span class="launcher-tile-status">' + (info.installed ? "Ready" : "Not installed") + "</span>";

          if (info.installed) {
            tile.addEventListener("click", function () {
              tile.disabled = true;
              global.api.openLauncher(name).then(function (r) {
                tile.disabled = false;
                if (!r || !r.success) {
                  UI.toast({ title: "Couldn't open " + name, message: (r && r.error) || undefined, status: "error" });
                }
              });
            });
          }
          grid.appendChild(tile);
        });
      });
    }
  };

  /* ==========================================================================
     SHOP
     ========================================================================== */
  global.CXViews.shop = {
    label: "Shop",
    icon: "packages",
    title: "Shop",
    mount: function (root, ctx) {
      mountProductShop(root, ctx, {
        kind: "SHOP",
        pageTitle: "Shop",
        subtitle: "Accessories, merch and café extras.",
        emptyIcon: "packages",
        emptyTitle: "The shop is empty for now",
        emptyText: "Ask a staff member what's in stock — items your café puts up for sale will appear here, with pictures and prices, ready to add to your bill."
      });
    }
  };

  /* ==========================================================================
     REWARDS
     ========================================================================== */
  global.CXViews.rewards = {
    label: "Prize Vault",
    icon: "plan",
    title: "Prize Vault",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Prize Vault</div>' +
          '<div class="view-sub">Earn as you play.</div>' +
        "</div></div>";

      view.appendChild(awaiting({
        icon: "plan",
        title: "The Prize Vault hasn't launched yet",
        text: "Points for time played and money spent, free hours and credit to redeem — all of it lands here once your café turns it on.",
        note: "Requires a loyalty ledger on the server. Nothing in the platform counts points today, so there is no balance to show you."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     RESERVATIONS  (live, from /api/reservations)
     ========================================================================== */
  var RES_STATUS_LABEL = {
    CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", CANCELLED: "Cancelled",
    NO_SHOW: "No-show", COMPLETED: "Completed"
  };
  var RES_STATUS_TONE = {
    CONFIRMED: "accent", CHECKED_IN: "online", CANCELLED: "idle", NO_SHOW: "error", COMPLETED: "idle"
  };

  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  global.CXViews.reservations = {
    label: "Book",
    icon: "reservations",
    title: "Reservations",
    mount: function (root) {
      var Wallet = global.CXWallet;
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Reservations</div>' +
          '<div class="view-sub">Book a station ahead of time, or manage what you\'ve already booked.</div>' +
        "</div></div>" +
        '<div class="card card-pad col gap-3" id="resForm">' +
          '<div class="shelf-title">Book a station</div>' +
          '<div class="grid grid-2" style="gap:var(--s-3)">' +
            '<div class="field"><label class="field-label" for="resCategory">Station type</label>' +
              '<select class="select" id="resCategory"></select></div>' +
            '<div class="field"><label class="field-label" for="resDate">Date</label>' +
              '<input class="input" id="resDate" type="date"></div>' +
          "</div>" +
          '<div class="grid grid-2" style="gap:var(--s-3)">' +
            '<div class="field"><label class="field-label" for="resTime">Start time</label>' +
              '<input class="input" id="resTime" type="time"></div>' +
            '<div class="field"><label class="field-label" for="resDuration">Duration</label>' +
              '<select class="select" id="resDuration">' +
                [[30, "30 min"], [60, "1 hr"], [90, "1.5 hr"], [120, "2 hr"]].map(function (d) {
                  return '<option value="' + d[0] + '"' + (d[0] === 60 ? " selected" : "") + ">" + d[1] + "</option>";
                }).join("") +
              "</select></div>" +
          "</div>" +
          '<div class="notice hidden" id="resAvail"></div>' +
          '<button class="btn btn-primary btn-block" id="resBook">Book this slot</button>' +
        "</div>" +
        '<div id="resListHost" style="margin-top:var(--s-8)"></div>';
      root.appendChild(view);

      var catSelect = view.querySelector("#resCategory");
      var dateInput = view.querySelector("#resDate");
      var timeInput = view.querySelector("#resTime");
      var durationSelect = view.querySelector("#resDuration");
      var availBox = view.querySelector("#resAvail");
      var bookBtn = view.querySelector("#resBook");
      var listHost = view.querySelector("#resListHost");

      var now = new Date();
      now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
      dateInput.value = now.toISOString().slice(0, 10);
      timeInput.value = now.toTimeString().slice(0, 5);

      function currentWindow() {
        var start = new Date(dateInput.value + "T" + timeInput.value);
        var end = new Date(start.getTime() + Number(durationSelect.value) * 60000);
        return { start: start, end: end };
      }

      function checkAvail() {
        if (!catSelect.value || !dateInput.value || !timeInput.value) { availBox.classList.add("hidden"); return; }
        var w = currentWindow();
        Wallet.checkReservationAvailability({
          category: catSelect.value, start_time: w.start.toISOString(), end_time: w.end.toISOString()
        }).then(function (d) {
          availBox.classList.remove("hidden");
          availBox.setAttribute("data-status", d.available ? "online" : "error");
          availBox.innerHTML = Icon(d.available ? "check" : "alert", 16) +
            "<div>" + (d.available
              ? (d.total - d.booked) + " of " + d.total + " " + UI.esc(d.category) + " free then."
              : "No " + UI.esc(d.category) + " stations free at that time.") + "</div>";
          bookBtn.disabled = !d.available;
        }).catch(function () { availBox.classList.add("hidden"); });
      }
      [catSelect, dateInput, timeInput, durationSelect].forEach(function (el) {
        el.addEventListener("change", checkAvail);
      });

      bookBtn.addEventListener("click", function () {
        var w = currentWindow();
        bookBtn.disabled = true;
        Wallet.bookReservation({
          category: catSelect.value, start_time: w.start.toISOString(), end_time: w.end.toISOString()
        }).then(function () {
          UI.toast({ title: "Booked", message: catSelect.value + " on " + fmtWhen(w.start.toISOString()), status: "ok" });
          checkAvail();
        }).catch(function (e) {
          bookBtn.disabled = false;
          UI.toast({ title: "Could not book that", message: e.message, status: "error" });
        });
      });

      function renderList(s) {
        UI.clear(listHost);
        var list = s.reservations || [];
        listHost.appendChild(UI.el("div", { class: "shelf-title", style: { marginBottom: "var(--s-4)" }, text: "Your bookings" }));
        if (!list.length) {
          listHost.appendChild(UI.emptyState({
            icon: "reservations", title: "Nothing booked yet",
            text: "Book a station above and it will show up here."
          }));
          return;
        }
        var wrap = UI.el("div", { class: "card card-body-flush" });
        list.forEach(function (r) {
          var row = UI.el("div", {
            class: "kv", style: { padding: "12px var(--s-5)", borderBottom: "1px solid var(--line-faint)", alignItems: "flex-start" }
          });
          row.innerHTML =
            "<span><span style='font-size:13px;font-weight:600;display:block'>" +
              UI.esc(r.pc_name || (r.category ? "Any " + r.category : "")) + "</span>" +
              "<span class='faint' style='font-size:11px'>" + UI.esc(fmtWhen(r.start_time)) + "</span></span>";
          var right = UI.el("span", { class: "row gap-2", style: { alignItems: "center" } });
          right.innerHTML = '<span class="badge" data-status="' + (RES_STATUS_TONE[r.status] || "idle") + '">' +
            (RES_STATUS_LABEL[r.status] || r.status) + "</span>";
          if (r.status === "CONFIRMED") {
            var cancelBtn = UI.el("button", { class: "btn btn-ghost btn-sm", html: Icon("close", 13) });
            cancelBtn.title = "Cancel";
            cancelBtn.addEventListener("click", function () {
              UI.confirm({
                title: "Cancel this booking?", message: "The station is freed for that time.",
                confirmLabel: "Cancel booking", variant: "danger"
              }).then(function (ok) {
                if (!ok) return;
                Wallet.cancelReservation(r.reservation_id)
                  .then(function () { UI.toast({ title: "Booking cancelled", status: "ok" }); })
                  .catch(function (e) { UI.toast({ title: "Could not cancel", message: e.message, status: "error" }); });
              });
            });
            right.appendChild(cancelBtn);
          }
          row.appendChild(right);
          wrap.appendChild(row);
        });
        listHost.appendChild(wrap);
      }

      var off = Wallet.on(function (s) { if (view.isConnected) renderList(s); else off(); });
      Wallet.loadBookableCategories().then(function (cats) {
        if (!view.isConnected) return;
        if (!cats.length) {
          catSelect.innerHTML = '<option value="">No station types set up</option>';
          bookBtn.disabled = true;
          return;
        }
        catSelect.innerHTML = cats.map(function (c) {
          return '<option value="' + UI.esc(c.category) + '">' + UI.esc(c.category) + "</option>";
        }).join("");
        checkAvail();
      });
      if (Wallet.state.reservations.length) renderList(Wallet.state);
      Wallet.loadReservations();
      Motion.enter(view, { y: 14 });
    }
  };

  global.CXViews.membership = {
    label: "Membership",
    icon: "membership",
    title: "Membership",
    mount: function (root) {
      var Wallet = global.CXWallet;
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Membership</div>' +
          '<div class="view-sub">Your tier and what it gets you.</div>' +
        "</div></div>" +
        '<div id="memHost"></div>';
      root.appendChild(view);

      var host = view.querySelector("#memHost");
      host.appendChild(UI.skeletonRows(4));

      function subscribe(plan, btn) {
        UI.confirm({
          title: "Subscribe to " + plan.plan_name + "?",
          message: Wallet.money(plan.price) + " comes out of your wallet balance right now." +
            (Wallet.state.membership ? " Your current membership ends immediately." : ""),
          confirmLabel: "Subscribe — " + Wallet.money(plan.price),
          variant: "primary"
        }).then(function (ok) {
          if (!ok) return;
          btn.disabled = true;
          Wallet.subscribeMembership(plan.plan_id)
            .then(function () { UI.toast({ title: "Membership active", message: plan.plan_name, status: "ok" }); })
            .catch(function (e) {
              btn.disabled = false;
              UI.toast({ title: "Could not subscribe", message: e.message, status: "error" });
            });
        });
      }

      function paintPlans(s) {
        var plans = s.planCatalog || [];
        var shelf = UI.el("section", { style: { marginTop: s.membership ? "var(--s-8)" : "var(--s-5)" } });
        shelf.innerHTML = '<div class="shelf-title" style="margin-bottom:var(--s-4)">' +
          (s.membership ? "Switch plan" : "Available plans") + "</div>";
        if (!plans.length) {
          shelf.appendChild(UI.emptyState({
            icon: "membership", title: "No plans on sale right now",
            text: "Ask a staff member about membership — tiers come with a standing discount on gaming."
          }));
          host.appendChild(shelf);
          return;
        }
        var grid = UI.el("div", { class: "grid-products" });
        plans.forEach(function (plan) {
          var isCurrent = s.membership && s.membership.plan_id === plan.plan_id;
          var card = UI.el("div", { class: "card card-pad col gap-3" });
          card.innerHTML =
            "<div><div class='session-label'>" + UI.esc(plan.tier) + "</div>" +
              '<div style="font-size:18px;font-weight:750;margin-top:2px">' + UI.esc(plan.plan_name) + "</div>" +
              (plan.description ? '<div class="faint" style="font-size:12px;margin-top:2px">' + UI.esc(plan.description) + "</div>" : "") +
            "</div>" +
            '<div style="font-size:24px;font-weight:800;letter-spacing:-.02em">' + UI.esc(Wallet.money(plan.price)) +
              '<span style="font-size:12px;color:var(--text-3);font-weight:600"> / ' + plan.duration_days + " days</span></div>" +
            (plan.discount_percent ? '<div class="faint" style="font-size:12px">' + plan.discount_percent + "% off gaming</div>" : "");
          if (isCurrent) {
            card.innerHTML += '<span class="badge" data-status="online" style="align-self:flex-start">Current plan</span>';
          } else {
            var btn = UI.el("button", { class: "btn btn-primary btn-block", text: "Subscribe" });
            btn.addEventListener("click", function () { subscribe(plan, btn); });
            card.appendChild(btn);
          }
          grid.appendChild(card);
        });
        shelf.appendChild(grid);
        host.appendChild(shelf);
        Motion.stagger(grid.children, { step: 0.04, y: 12 });
      }

      function paint(s) {
        UI.clear(host);
        var m = s.membership;

        if (!m) {
          host.appendChild(UI.emptyState({
            icon: "membership",
            title: "You're not a member yet",
            text: "Ask a staff member about membership — tiers come with a standing discount on gaming and a joining bonus."
          }));
          paintPlans(s);
          return;
        }

        var card = UI.el("div", { class: "wallet-card" });
        card.innerHTML =
          '<div class="row-between" style="align-items:flex-start">' +
            "<div><div class='wallet-label'>" + UI.esc(m.tier) + " member</div>" +
              '<div style="font-size:38px;font-weight:820;letter-spacing:-.03em;margin-top:6px">' +
                UI.esc(m.plan_name) + "</div></div>" +
            '<span class="badge badge-lg" data-status="' + (m.days_remaining <= 7 ? "warning" : "online") + '">' +
              m.days_remaining + " days left</span>" +
          "</div>" +
          '<div class="row gap-6 wrap" style="margin-top:var(--s-6)">' +
            (m.discount_percent ? "<div><div class='session-label'>Discount</div>" +
              '<div style="font-size:22px;font-weight:750">' + m.discount_percent + "%</div></div>" : "") +
            "<div><div class='session-label'>Valid until</div>" +
              '<div style="font-size:22px;font-weight:750">' + UI.esc(UI.fmtDate(m.expires_at)) + "</div></div>" +
          "</div>";
        host.appendChild(card);

        if (m.perks && m.perks.length) {
          var perks = UI.el("div", { class: "card card-pad", style: { marginTop: "var(--s-5)" } });
          perks.innerHTML = "<div class='session-label' style='margin-bottom:var(--s-4)'>What you get</div>" +
            '<ul style="display:flex;flex-direction:column;gap:10px">' +
            m.perks.map(function (p) {
              return '<li style="display:flex;gap:10px;align-items:center;font-size:var(--t-body)">' +
                '<span class="tx-icon" data-status="online" style="width:28px;height:28px">' + Icon("check", 14) + "</span>" +
                "<span>" + UI.esc(p) + "</span></li>";
            }).join("") + "</ul>";
          host.appendChild(perks);
          Motion.stagger(perks.querySelectorAll("li"), { step: 0.04, y: 8 });
        }

        paintPlans(s);
      }

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paint(s);
      });
      if (Wallet.state.entitlementsLoaded) paint(Wallet.state);
      Wallet.loadEntitlements();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     WALLET  (live, from /api/wallet)
     ========================================================================== */
  var TX_STATUS = { credit: "online", debit: "accent" };

  function transactionRow(tx) {
    var Wallet = global.CXWallet;
    var isCredit = tx.direction === "credit";
    var row = UI.el("div", { class: "tx-row", dataset: { status: TX_STATUS[tx.direction] || "idle" } });

    var when = new Date(tx.created_at);
    var meta = [
      isNaN(when) ? null : when.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      tx.method || null,
      tx.note || null
    ].filter(Boolean).join(" · ");

    row.innerHTML =
      '<span class="tx-icon">' + Icon(isCredit ? "plus" : "fnb", 18) + "</span>" +
      '<div style="min-width:0">' +
        '<div class="tx-title">' + UI.esc(Wallet.categoryLabel(tx.category)) + "</div>" +
        '<div class="tx-meta truncate">' + UI.esc(meta) + "</div>" +
      "</div>" +
      "<div>" +
        // The coin mark is illegible at this size, so the unit is spelled out.
        '<div class="tx-amount">' + (isCredit ? "+" : "−") + UI.esc(Wallet.amount(tx.amount)) +
          '<span style="font-size:11px;font-weight:700;letter-spacing:.06em;opacity:.72;margin-left:4px">XP</span>' +
        "</div>" +
        '<div class="tx-balance">' + UI.esc(Wallet.money(tx.balance_after)) + "</div>" +
      "</div>";
    return row;
  }

  global.CXViews.wallet = {
    label: "Wallet",
    icon: "billing",
    title: "Wallet",
    mount: function (root, ctx) {
      var Wallet = global.CXWallet;

      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">Wallet</div>' +
            '<div class="view-sub">Your café balance and everything it has paid for.</div>' +
          "</div>" +
          '<div class="row gap-3">' +
            '<button class="btn btn-outline" id="walletRefresh">' + Icon("refresh", 16) +
              '<span class="btn-label">Refresh</span></button>' +
          "</div>" +
        "</div>" +
        '<div style="display:grid;grid-template-columns:minmax(320px,420px) minmax(0,1fr);gap:var(--s-6);align-items:start" id="walletGrid">' +
          '<div id="walletBalance"></div>' +
          '<div class="card card-body-flush" id="walletLedger"></div>' +
        "</div>";
      root.appendChild(view);

      var balanceHost = view.querySelector("#walletBalance");
      var ledgerHost = view.querySelector("#walletLedger");

      function renderBalance(s) {
        UI.clear(balanceHost);

        if (s.loading && s.balance === null) {
          var skel = UI.el("div", { class: "wallet-card col", style: { gap: "var(--s-4)" } });
          skel.innerHTML =
            '<div class="skel skel-line" style="width:40%"></div>' +
            '<div class="skel" style="height:52px;width:70%"></div>' +
            '<div class="skel skel-line" style="width:55%"></div>';
          balanceHost.appendChild(skel);
          return;
        }

        if (s.error) {
          balanceHost.appendChild(walletError(s.error));
          return;
        }

        var card = UI.el("div", { class: "wallet-card" });
        card.innerHTML =
          '<div class="row gap-6" style="align-items:center">' +
            '<div class="grow">' +
              '<div class="wallet-label">XP Coin balance</div>' +
              '<div class="wallet-amount-row">' +
                '<span class="wallet-balance" id="walletAmount">' + UI.esc(Wallet.amount(s.balance)) + "</span>" +
                '<span class="wallet-unit">XP</span>' +
              "</div>" +
            "</div>" +
            global.CXCoin(112, { detail: "full", spin: true }).replace('class="xp-coin', 'class="xp-coin xp-coin-hero') +
          "</div>" +
          '<div class="wallet-sub">Earn · Redeem · Grow</div>' +
          '<div class="wallet-actions">' +
            '<button class="btn btn-primary btn-lg grow" id="walletTopup">' + Icon("plus", 17) +
              '<span class="btn-label">Add coins</span></button>' +
          "</div>" +
          '<div class="wallet-foot faint">Or ask a member of staff to add coins at the counter.</div>';
        balanceHost.appendChild(card);

        /* Only offered when the café has a gateway switched on — a button that
           opens a dialog saying "not available" is worse than no button. The
           check is cheap and cached, so it runs on every paint. */
        var topupBtn = card.querySelector("#walletTopup");
        topupBtn.addEventListener("click", function () { global.CXTopup.open(); });

        global.CXWallet.topupOptions()
          .then(function (opts) {
            if (!opts || !opts.enabled) topupBtn.closest(".wallet-actions").remove();
          })
          .catch(function () {
            var host = topupBtn.closest(".wallet-actions");
            if (host) host.remove();
          });

        // Count the balance up on first paint and on any change.
        var amountEl = card.querySelector("#walletAmount");
        var previous = amountEl.dataset.shown != null ? Number(amountEl.dataset.shown) : 0;
        Motion.countTo(amountEl, Number(s.balance), {
          duration: 0.6,
          format: function (v) { return Wallet.amount(v); }
        });
        amountEl.dataset.shown = s.balance;
        if (previous !== s.balance) Motion.pulse(card, "rgba(255,23,68,.32)");
      }

      function walletError(code) {
        var copy = {
          "not-signed-in": ["You're not signed in", "Sign in to see your wallet balance."],
          "no-token": ["Your session needs refreshing", "Please sign in again to load your wallet."],
          denied: ["We can't show this wallet", "Please sign in again, or ask a staff member for help."],
          missing: ["No wallet found", "Ask a staff member to set up your wallet at the counter."],
          unreachable: ["Can't reach your wallet", "The café server didn't respond. Please try again."]
        }[code] || ["Something went wrong", "We couldn't load your wallet."];

        return UI.emptyState({
          icon: "alert",
          status: code === "unreachable" || code === "denied" ? "error" : "warning",
          title: copy[0],
          text: copy[1],
          actions: [{ label: "Try again", icon: "refresh", variant: "outline", onClick: function () { Wallet.load(); } }]
        });
      }

      function renderLedger(s) {
        UI.clear(ledgerHost);
        ledgerHost.appendChild(UI.el("div", {
          class: "card-head",
          html: "<h2>Recent activity</h2>" +
            (s.total ? '<span class="badge badge-plain">' + s.total + " total</span>" : "")
        }));

        if (s.loading && !s.transactions.length) {
          ledgerHost.appendChild(UI.skeletonRows(5));
          return;
        }
        if (s.error) {
          ledgerHost.appendChild(UI.el("div", { class: "card-body" }, [walletError(s.error)]));
          return;
        }
        if (!s.transactions.length) {
          ledgerHost.appendChild(UI.emptyState({
            icon: "billing",
            title: "Nothing here yet",
            text: "Top-ups and anything you spend at the café will be listed here."
          }));
          return;
        }

        var list = UI.el("div");
        var rows = [];
        s.transactions.forEach(function (tx) {
          var row = transactionRow(tx);
          list.appendChild(row);
          rows.push(row);
        });
        ledgerHost.appendChild(list);
        Motion.stagger(rows, { step: 0.02, y: 8, maxDelay: 0.2 });
      }

      function paint(s) { renderBalance(s); renderLedger(s); }

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paint(s);
      });

      var refreshBtn = view.querySelector("#walletRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return Wallet.load(); });
      });

      paint(Wallet.state);
      Wallet.load();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     ACCOUNT  (real customer data)
     ========================================================================== */
  /* Shared by the account order history — the food view has its own copies
     inside its mount closure, and lifting both here keeps the two in step. */
  var ORDER_TONE_ACCT = {
    PLACED: "warning", CONFIRMED: "gaming", PREPARING: "gaming",
    READY: "online", DELIVERED: "idle", CANCELLED: "offline"
  };
  var ACCT_STEPS = ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
  var ACCT_STEP_LABEL = {
    PLACED: "Sent", CONFIRMED: "Confirmed", PREPARING: "Cooking",
    READY: "Ready", DELIVERED: "Delivered"
  };

  function accountOrderTrack(status) {
    var track = UI.el("div", { class: "order-track" });

    if (status === "CANCELLED") {
      track.dataset.status = "offline";
      track.innerHTML = '<div class="order-track-cancelled">' +
        Icon("close", 13) + "<span>This order was cancelled</span></div>";
      return track;
    }

    var reached = ACCT_STEPS.indexOf(status);
    if (reached === -1) reached = 0;

    track.innerHTML = ACCT_STEPS.map(function (step, i) {
      var state = i < reached ? "done" : (i === reached ? "current" : "todo");
      return '<div class="order-step" data-state="' + state + '">' +
        '<span class="order-step-dot"></span>' +
        '<span class="order-step-label">' + ACCT_STEP_LABEL[step] + "</span>" +
      "</div>";
    }).join("");

    track.style.setProperty(
      "--reached",
      (reached / (ACCT_STEPS.length - 1) * 100).toFixed(1) + "%"
    );
    return track;
  }

  global.CXViews.account = {
    label: "Account",
    icon: "customers",
    title: "My account",
    mount: function (root, ctx) {
      var user = Session.state.user;
      var view = UI.el("div", { class: "view" });

      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">My account</div>' +
          '<div class="view-sub">Your CafeXP profile.</div>' +
        "</div></div>";

      if (!user) {
        view.appendChild(UI.emptyState({
          icon: "customers",
          title: "You're not signed in",
          text: "Sign in to see your profile and session.",
          actions: [{ label: "Sign in", variant: "primary", onClick: function () { Session.signOut(); } }]
        }));
        root.appendChild(view);
        return;
      }

      var split = UI.el("div", {
        style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(300px,360px)", gap: "var(--s-6)", alignItems: "start" }
      });

      var profile = UI.el("div", { class: "card" });
      profile.innerHTML =
        '<div class="card-body">' +
          '<div class="row gap-5" style="align-items:center;margin-bottom:var(--s-6)">' +
            '<span class="avatar-orb" style="width:72px;height:72px;font-size:26px">' +
              UI.esc(UI.initials(Session.displayName())) + "</span>" +
            "<div>" +
              '<div style="font-size:var(--t-h1);font-weight:780;letter-spacing:-.02em">' +
                UI.esc(Session.displayName()) + "</div>" +
              '<div class="muted" style="font-size:var(--t-body);margin-top:2px">' +
                UI.esc(user.email || "") + "</div>" +
            "</div>" +
          "</div>" +
          '<div class="col">' +
            '<div class="kv"><span class="kv-key">Mobile</span><span class="kv-val">' +
              UI.esc(user.phone_number || "—") + "</span></div>" +
            '<div class="kv"><span class="kv-key">Address</span><span class="kv-val">' +
              UI.esc(UI.fmtAddress(user.address)) + "</span></div>" +
            '<div class="kv"><span class="kv-key">Customer ID</span><span class="kv-val mono">#' +
              UI.esc(user.customer_id != null ? user.customer_id : "—") + "</span></div>" +
            '<div class="kv"><span class="kv-key">Member since</span><span class="kv-val">' +
              UI.esc(user.created_at ? UI.fmtDate(user.created_at) : "—") + "</span></div>" +
            '<div class="kv"><span class="kv-key">Hours played</span><span class="kv-val" id="acctHoursPlayed">—</span></div>' +
          "</div>" +
        "</div>" +
        '<div class="card-foot row gap-2">' +
          '<button class="btn btn-danger btn-sm" id="signOutBtn">' + Icon("logout", 15) +
            '<span class="btn-label">Sign out</span></button>' +
        "</div>";

      // Bills — real, from the café server. Read-only: staff take payment.
      var Wallet = global.CXWallet;
      var history = UI.el("div", { class: "card" });
      history.innerHTML =
        '<div class="card-head"><h2>Your history</h2>' +
          '<div class="tabs tabs-sm" id="acctTabs">' +
            '<button data-tab="bills" aria-selected="true">Bills</button>' +
            '<button data-tab="orders" aria-selected="false">Orders</button>' +
          "</div>" +
        "</div>";
      var histBody = UI.el("div", { class: "card-body-flush" });
      histBody.appendChild(UI.skeletonRows(3));
      history.appendChild(histBody);

      // Which pane the card is showing. Both panes read data the account
      // already loads, so switching costs nothing extra.
      var acctTab = "bills";

      var STATUS_TONE = { OPEN: "warning", PARTIAL: "gaming", PAID: "online", VOID: "idle" };

      function paintOrderHistory(s) {
        UI.clear(histBody);

        if (!s.orders || !s.orders.length) {
          histBody.appendChild(UI.emptyState({
            icon: "fnb",
            title: "No orders yet",
            text: "Anything you order from the Food menu shows up here, with its progress."
          }));
          return;
        }

        var made = [];
        s.orders.forEach(function (order) {
          var block = UI.el("div", {
            style: { padding: "14px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: ORDER_TONE_ACCT[order.status] || "idle" }
          });
          block.innerHTML =
            '<div class="row-between">' +
              '<span style="min-width:0">' +
                '<span class="mono" style="font-size:13px;font-weight:650;display:block">' +
                  UI.esc(order.order_number) + "</span>" +
                '<span class="faint" style="font-size:11px">' +
                  UI.esc(order.items.map(function (i) { return i.quantity + "× " + i.product_name; }).join(", ")) +
                "</span></span>" +
              '<span style="font-size:15px;font-weight:750;white-space:nowrap">' +
                UI.esc(Wallet.money(order.total)) + "</span>" +
            "</div>";
          block.appendChild(accountOrderTrack(order.status));
          histBody.appendChild(block);
          made.push(block);
        });
        Motion.stagger(made, { step: 0.02, y: 6 });
      }

      function paintHistory(s) {
        if (acctTab === "orders") paintOrderHistory(s);
        else paintBills(s);
      }

      function paintBills(s) {
        UI.clear(histBody);

        if (s.billsError) {
          histBody.appendChild(UI.emptyState({
            icon: "alert", status: "error",
            title: "Couldn't load your bills",
            text: "The café server didn't respond. Please try again.",
            actions: [{ label: "Try again", icon: "refresh", onClick: function () { Wallet.loadBills(); } }]
          }));
          return;
        }
        if (!s.bills.length) {
          histBody.appendChild(UI.emptyState({
            icon: "billing",
            title: "No bills yet",
            text: "Your gaming time and anything you order will be itemised here."
          }));
          return;
        }

        var made = [];
        s.bills.forEach(function (bill) {
          var row = UI.el("div", {
            class: "kv",
            style: { padding: "14px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: STATUS_TONE[bill.status] || "idle" }
          });
          row.innerHTML =
            '<span style="min-width:0">' +
              '<span class="mono" style="font-size:13px;font-weight:650;display:block">' +
                UI.esc(bill.bill_number) + "</span>" +
              '<span class="faint" style="font-size:11px">' +
                UI.esc(new Date(bill.created_at).toLocaleString([], {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                })) + (bill.pc_name ? " · " + UI.esc(bill.pc_name) : "") + "</span>" +
            "</span>" +
            '<span style="text-align:right;white-space:nowrap">' +
              '<span style="font-size:15px;font-weight:750;font-variant-numeric:tabular-nums">' +
                UI.esc(Wallet.money(bill.total)) + "</span>" +
              '<span style="display:block;margin-top:3px"><span class="badge" data-status="' +
                (STATUS_TONE[bill.status] || "idle") + '">' +
                (bill.status === "PAID" ? "Paid"
                  : bill.status === "PARTIAL" ? "Part paid — " + Wallet.money(bill.balance_due) + " due"
                  : bill.status === "OPEN" ? Wallet.money(bill.balance_due) + " due"
                  : "Void") + "</span></span>" +
            "</span>";
          histBody.appendChild(row);
          made.push(row);
        });
        Motion.stagger(made, { step: 0.02, y: 6 });
      }

      var offBills = Wallet.on(function (s) {
        if (!history.isConnected) { offBills(); return; }
        paintHistory(s);
      });
      if (Wallet.state.bills.length) paintHistory(Wallet.state);
      Wallet.loadBills();

      UI.$$("#acctTabs button", history).forEach(function (btn) {
        btn.addEventListener("click", function () {
          acctTab = btn.dataset.tab;
          UI.$$("#acctTabs button", history).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          paintHistory(Wallet.state);
        });
      });

      var col = UI.el("div", { class: "col", style: { gap: "var(--s-6)" } });
      col.appendChild(profile);
      col.appendChild(history);
      split.appendChild(col);

      var side = UI.el("div", { class: "col", style: { gap: "var(--s-5)" } });
      mountStationCard(side);

      // Wallet summary, straight from the live balance.
      var Wallet = global.CXWallet;
      var walletBox = UI.el("div", { class: "card card-pad" });
      function paintWalletBox(s) {
        walletBox.innerHTML =
          '<div class="row-between" style="align-items:center">' +
            '<div><div class="session-label">XP Coin</div>' +
              '<div class="coin-inline" style="margin-top:6px">' +
                '<span style="font-size:30px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums">' +
                  (s.error ? "—" : s.balance === null ? "…" : UI.esc(Wallet.amount(s.balance))) + "</span>" +
                '<span style="font-size:13px;font-weight:750;letter-spacing:.08em;color:var(--accent-hot)">XP</span>' +
              "</div>" +
            "</div>" +
            (s.error
              ? '<span class="badge" data-status="warning">Unavailable</span>'
              : global.CXCoin(52, { detail: "plain", spin: true })) +
          "</div>" +
          '<button class="btn btn-outline btn-block" style="margin-top:var(--s-4)" id="walletOpen">' +
            Icon("billing", 16) + '<span class="btn-label">View wallet</span></button>';
        walletBox.querySelector("#walletOpen").addEventListener("click", function () { ctx.go("wallet"); });
      }
      paintWalletBox(Wallet.state);
      var offWallet = Wallet.on(function (s) {
        if (!walletBox.isConnected) { offWallet(); return; }
        paintWalletBox(s);
      });
      side.appendChild(walletBox);

      split.appendChild(side);

      view.appendChild(split);
      root.appendChild(view);

      profile.querySelector("#signOutBtn").addEventListener("click", function () {
        UI.confirm({
          title: "Sign out?",
          message: "You'll be returned to the sign-in screen on this station.",
          confirmLabel: "Sign out",
          variant: "danger"
        }).then(function (ok) { if (ok) Session.signOut(); });
      });

      /* Total time actually played, across every ended session — live from
         the server, not the login-time snapshot cached in Session.state.user
         (which predates most of that play and never gets refreshed). */
      Wallet.request("/api/customers/me").then(function (body) {
        var el = profile.querySelector("#acctHoursPlayed");
        var seconds = Number(body && body.data && body.data.total_play_seconds) || 0;
        if (!el || !el.isConnected) return;
        var hrs = Math.floor(seconds / 3600);
        var mins = Math.round((seconds % 3600) / 60);
        el.textContent = hrs > 0 ? (hrs + "h " + mins + "m") : (mins + "m");
      }).catch(function () {
        var el = profile.querySelector("#acctHoursPlayed");
        if (el && el.isConnected) el.textContent = "—";
      });

      Motion.stagger([col, side], { step: 0.06, y: 16 });
    }
  };
})(window);
