/* ==========================================================================
   CafeXP Client — Customer & station state
   Thin wrapper over the existing preload bridge. It changes no IPC channel
   and adds no network calls; it just gives the portal views one place to read
   from and subscribe to.
   ========================================================================== */
(function (global) {
  "use strict";

  var api = global.api || {};

  var state = {
    user: null,          // customer record stored by the login page
    token: null,
    pcName: null,        // set by the server via SET_NAME
    connection: "DISCONNECTED",
    ready: false,

    // Play session, mirrored from the same "start-timer" event that drives the
    // floating timer card. This countdown is for display; the timer card window
    // remains the one that reports expiry to the main process.
    play: null,          // { appName, totalSeconds, remaining, startedAt }
    launching: null,     // { appName } while a launch is in flight
    endedAt: null        // set when a session finishes, for the ended screen
  };

  /* Thresholds the timer's visual states key off. */
  var WARN_AT = 15 * 60;
  var CRITICAL_AT = 5 * 60;

  var ticker = null;

  var listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return function () { listeners[evt] = listeners[evt].filter(function (f) { return f !== fn; }); };
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error("[session] listener failed on " + evt, e); }
    });
  }

  function init() {
    if (api.getUserInfo) {
      api.getUserInfo(function (user) {
        state.user = user || null;
        emit("user", state.user);
      });
    }
    if (api.getToken) {
      api.getToken(function (token) { state.token = token || null; });
    }
    if (api.getPcName) {
      api.getPcName(function (name) { state.pcName = name || null; emit("pc", state.pcName); });
    }
    if (api.onPcName) {
      api.onPcName(function (name) { state.pcName = name || null; emit("pc", state.pcName); });
    }
    if (api.getStatus) {
      api.getStatus(function (status) { state.connection = status; emit("connection", status); });
    }
    if (api.onStatus) {
      api.onStatus(function (status) {
        var changed = state.connection !== status;
        state.connection = status;
        if (changed) emit("connection", status);
      });
    }
    /* ---------- play session ---------- */
    if (api.onStartTimer) {
      api.onStartTimer(function (data) {
        if (!data) return;
        state.play = {
          appName: data.appName,
          totalSeconds: data.minutes * 60,
          remaining: data.minutes * 60,
          startedAt: Date.now()
        };
        state.launching = null;
        state.endedAt = null;
        startTicking();
        emit("play", state.play);
      });
    }

    if (api.onAppLaunching) {
      api.onAppLaunching(function (data) {
        state.launching = { appName: (data && data.appName) || "your game" };
        emit("launching", state.launching);
      });
    }

    if (api.onAppLaunchFailed) {
      api.onAppLaunchFailed(function (data) {
        state.launching = null;
        emit("launch-failed", data || {});
      });
    }

    if (api.onAppClosed) {
      api.onAppClosed(function (data) {
        endPlay((data && data.appName) || null);
      });
    }

    state.ready = true;
  }

  /* ==========================================================================
     PLAY SESSION COUNTDOWN
     ========================================================================== */
  function startTicking() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (!state.play) { clearInterval(ticker); ticker = null; return; }

      // Derive from wall-clock rather than counting ticks, so the display
      // stays accurate if the renderer is throttled while a game has focus.
      var elapsed = Math.floor((Date.now() - state.play.startedAt) / 1000);
      var remaining = Math.max(0, state.play.totalSeconds - elapsed);
      var previous = state.play.remaining;
      state.play.remaining = remaining;

      if (remaining !== previous) emit("tick", state.play);

      if (previous > WARN_AT && remaining <= WARN_AT) emit("warning", state.play);
      if (previous > CRITICAL_AT && remaining <= CRITICAL_AT) emit("critical", state.play);
      if (remaining === 0) endPlay(state.play.appName);
    }, 500);
  }

  function endPlay(appName) {
    if (!state.play) return;
    var finished = state.play;
    state.play = null;
    state.launching = null;
    state.endedAt = Date.now();
    if (ticker) { clearInterval(ticker); ticker = null; }
    emit("play-ended", { appName: appName || finished.appName, session: finished });
  }

  /** normal | warning | critical — drives every timer surface. */
  function timerState() {
    if (!state.play) return "idle";
    if (state.play.remaining <= CRITICAL_AT) return "critical";
    if (state.play.remaining <= WARN_AT) return "warning";
    return "normal";
  }

  function progress() {
    if (!state.play || !state.play.totalSeconds) return 0;
    return Math.max(0, Math.min(100, (state.play.remaining / state.play.totalSeconds) * 100));
  }

  function isOnline() { return state.connection === "CONNECTED"; }

  function displayName() {
    if (!state.user) return "Guest";
    return state.user.customer_name || state.user.name || state.user.email || "Guest";
  }

  function firstName() {
    return String(displayName()).trim().split(/\s+/)[0];
  }

  function signOut() {
    if (api.storeToken) api.storeToken(null);
    if (api.storeUserInfo) api.storeUserInfo(null);
    state.user = null;
    state.token = null;
    if (api.navigateTo) api.navigateTo("login");
  }

  /** mm:ss, or h:mm:ss once the session passes an hour. */
  function clock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return h > 0 ? pad(h) + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec);
  }

  global.CXSession = {
    state: state,
    on: on,
    emit: emit,
    init: init,
    isOnline: isOnline,
    displayName: displayName,
    firstName: firstName,
    signOut: signOut,
    timerState: timerState,
    progress: progress,
    clock: clock,
    WARN_AT: WARN_AT,
    CRITICAL_AT: CRITICAL_AT
  };
})(window);
