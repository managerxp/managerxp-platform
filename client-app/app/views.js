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

  /**
   * The station / session card. When a game is running it becomes the primary
   * timer surface, driven by the same countdown as the floating timer card.
   */
  function stationCard() {
    var online = Session.isOnline();
    var pc = Session.state.pcName;
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
              "Your game closes automatically when the timer reaches zero." +
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
      right.appendChild(stationCard());

      var quick = UI.el("div", { class: "card card-pad col", style: { gap: "var(--s-3)" } });
      quick.innerHTML = '<div class="session-label" style="margin-bottom:var(--s-2)">Quick actions</div>';
      [
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
  global.CXViews.games = {
    label: "Games",
    icon: "games",
    title: "Games",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">Games</div>' +
            '<div class="view-sub">Everything your café has made available on this station.</div>' +
          "</div>" +
          '<div class="row gap-3">' +
            '<div class="search" style="width:300px">' + Icon("search", 16) +
              '<input class="input" type="search" placeholder="Search games…" disabled></div>' +
          "</div>" +
        "</div>";

      view.appendChild(awaiting({
        icon: "games",
        title: "No games have reached this station yet",
        text: "Your café's staff choose which games appear here. Once the server sends this station's library, every title shows up with its artwork and a play button.",
        note: "The client talks to the server over its existing connection, which today carries launch and close commands but no game catalogue. " +
              "Sending the configured list — the same one behind <code>/api/pc-software</code> — is what switches this page on."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     FOOD
     ========================================================================== */
  global.CXViews.food = {
    label: "Food",
    icon: "fnb",
    title: "Food & drink",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">Food &amp; drink</div>' +
            '<div class="view-sub">Order to your station without leaving your seat.</div>' +
          "</div>" +
        "</div>" +
        '<div class="row gap-2 wrap" style="margin-bottom:var(--s-6);opacity:.5;pointer-events:none">' +
          ["All", "Burgers", "Pizza", "Snacks", "Drinks", "Desserts", "Combos"].map(function (c, i) {
            return '<button class="chip"' + (i === 0 ? ' aria-pressed="true" data-status="accent"' : "") + ">" + c + "</button>";
          }).join("") +
        "</div>";

      view.appendChild(awaiting({
        icon: "fnb",
        title: "Ordering isn't switched on yet",
        text: "When your café sets up its menu, you'll be able to browse food and drinks here, add them to an order and have it brought to your station.",
        note: "Needs a products catalogue and an orders endpoint on the café server. Neither exists yet, so there is nothing to show — " +
              "rather than display a menu nobody can cook."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     SHOP
     ========================================================================== */
  global.CXViews.shop = {
    label: "Shop",
    icon: "packages",
    title: "Shop",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Shop</div>' +
          '<div class="view-sub">Accessories, merch and café extras.</div>' +
        "</div></div>";

      view.appendChild(awaiting({
        icon: "packages",
        title: "The shop is empty for now",
        text: "Items your café puts on sale will appear here, with pictures and prices, ready to add to your bill.",
        note: "Shares the same products catalogue as Food. Once that exists on the server, both pages fill in."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     REWARDS
     ========================================================================== */
  global.CXViews.rewards = {
    label: "Rewards",
    icon: "plan",
    title: "Rewards",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Rewards</div>' +
          '<div class="view-sub">Earn as you play.</div>' +
        "</div></div>";

      view.appendChild(awaiting({
        icon: "plan",
        title: "Rewards haven't launched yet",
        text: "Points for time played and money spent, free hours and credit to redeem — all of it lands here once your café turns it on.",
        note: "Requires a loyalty ledger on the server. Nothing in the platform counts points today, so there is no balance to show you."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     ACCOUNT  (real customer data)
     ========================================================================== */
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
              UI.esc(typeof user.address === "string" ? user.address : JSON.stringify(user.address || "—")) + "</span></div>" +
            '<div class="kv"><span class="kv-key">Customer ID</span><span class="kv-val mono">#' +
              UI.esc(user.customer_id != null ? user.customer_id : "—") + "</span></div>" +
            '<div class="kv"><span class="kv-key">Member since</span><span class="kv-val">' +
              UI.esc(user.created_at ? UI.fmtDate(user.created_at) : "—") + "</span></div>" +
          "</div>" +
        "</div>" +
        '<div class="card-foot row gap-2">' +
          '<button class="btn btn-danger btn-sm" id="signOutBtn">' + Icon("logout", 15) +
            '<span class="btn-label">Sign out</span></button>' +
        "</div>";

      var history = UI.el("div", { class: "card" });
      history.innerHTML = '<div class="card-head"><h2>History</h2></div>';
      var histBody = UI.el("div", { class: "card-body" });
      histBody.appendChild(awaiting({
        icon: "sessions",
        title: "Nothing recorded yet",
        text: "Your past sessions, orders and payments will be listed here.",
        note: "Sessions and orders aren't stored by the café server yet, so there is no history to read."
      }));
      histBody.querySelector(".awaiting").style.margin = "0";
      history.appendChild(histBody);

      var col = UI.el("div", { class: "col", style: { gap: "var(--s-6)" } });
      col.appendChild(profile);
      col.appendChild(history);
      split.appendChild(col);

      var side = UI.el("div", { class: "col", style: { gap: "var(--s-5)" } });
      side.appendChild(stationCard());
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

      Motion.stagger([col, side], { step: 0.06, y: 16 });
    }
  };
})(window);
