/* ==========================================================================
   CafeXP Console — Update scheduling

   Decides *when* a staged update may be applied. Nothing here downloads or
   installs anything; it answers one question — "is now an acceptable moment?"
   — and the two components get different answers because the cost of being
   wrong differs.

     Client   A station is one seat. Waiting until nobody is sitting at it is
              sufficient, so it applies when idle. An optional window narrows
              that further for cafés that would rather it only happened at
              night even if a station is free at noon.

     Console  This machine coordinates every station and holds the WebSocket
              link to all of them. Restarting it disconnects the whole floor,
              so there is no such thing as "the console is idle" while the
              café is open. It gets a fixed time the operator chose — start or
              end of day — and applies then, or not at all.

   Downloading is deliberately never scheduled. It writes to a cache and
   interrupts nobody, so it happens as soon as an update exists; only the
   apply step waits.
   ========================================================================== */
(function (global) {
  "use strict";

  /** Minutes since midnight, or null if the input is not HH:MM. */
  function toMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function nowMinutes(at) {
    var d = at ? new Date(at) : new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /**
   * Is `now` inside [start, end]?
   *
   * Windows that cross midnight are the normal case here — a café's quiet
   * hours are 02:00 to 06:00, but plenty run 23:00 to 05:00. Comparing
   * start <= now <= end would silently never match those, so the wrapped case
   * is handled explicitly.
   */
  function withinWindow(startText, endText, at) {
    var start = toMinutes(startText);
    var end = toMinutes(endText);

    // No window configured means "no time restriction".
    if (start === null || end === null) return true;
    if (start === end) return true;

    var now = nowMinutes(at);
    return start < end
      ? (now >= start && now <= end)
      : (now >= start || now <= end);   // wraps midnight
  }

  /**
   * May this station apply its staged update now?
   *
   * `sessionActive` is the station's own state as the console knows it — the
   * console tracks sessions, so it can answer this without asking the station
   * and without trusting the station's answer.
   */
  function clientMayApply(settings, station, at) {
    var mode = settings["updates.client_apply_mode"] || "idle";

    if (mode === "manual") {
      return { ok: false, reason: "Set to manual — an operator applies this" };
    }

    // The rule the whole feature exists for. Checked first so it can never be
    // reached past by a window calculation.
    if (station && station.sessionActive) {
      return { ok: false, reason: "A session is running on this station" };
    }
    if (station && station.online === false) {
      return { ok: false, reason: "Station is offline" };
    }

    if (!withinWindow(settings["updates.client_window_start"],
                      settings["updates.client_window_end"], at)) {
      return {
        ok: false,
        reason: "Outside the update window (" +
          settings["updates.client_window_start"] + "–" +
          settings["updates.client_window_end"] + ")"
      };
    }

    return { ok: true, reason: "Station is free" };
  }

  /**
   * May the console apply its own staged update now?
   *
   * Two gates beyond the clock. It must not be mid-rollout — replacing the
   * coordinator while it is coordinating would strand stations part-updated
   * with nothing driving them to finish. And it will not restart while
   * customers are playing, because every station loses its link when it does.
   */
  function serverMayApply(settings, floor, at) {
    var mode = settings["updates.server_apply_mode"] || "manual";

    if (mode === "manual") {
      return { ok: false, reason: "Set to manual — apply it yourself when convenient" };
    }

    if (floor && floor.rolloutInFlight) {
      return { ok: false, reason: "A client rollout is still in progress" };
    }
    if (floor && floor.activeSessions > 0) {
      return {
        ok: false,
        reason: floor.activeSessions + " session" +
          (floor.activeSessions === 1 ? " is" : "s are") + " still running"
      };
    }

    var target = toMinutes(settings["updates.server_apply_at"] || "04:00");
    if (target === null) return { ok: false, reason: "No apply time is set" };

    /*
     * A ten-minute arrival window rather than an exact match. The scheduler
     * ticks every few minutes, so demanding now === target would mean a tick
     * landing at 04:06 skips the day entirely and the console never updates.
     */
    var now = nowMinutes(at);
    var delta = Math.abs(now - target);
    // Handle the wrap: 23:58 is two minutes from 00:00, not 1438.
    if (delta > 720) delta = 1440 - delta;

    if (delta > 10) {
      return {
        ok: false,
        reason: "Scheduled for " + (settings["updates.server_apply_at"] || "04:00") +
          (mode === "end_of_day" ? " (end of day)" : mode === "start_of_day" ? " (start of day)" : "")
      };
    }

    return { ok: true, reason: "Inside the scheduled window" };
  }

  /** Human summary for the Updates page, so the policy is visible not implied. */
  function describe(settings) {
    var clientMode = settings["updates.client_apply_mode"] || "idle";
    var start = settings["updates.client_window_start"];
    var end = settings["updates.client_window_end"];
    var serverMode = settings["updates.server_apply_mode"] || "manual";
    var serverAt = settings["updates.server_apply_at"] || "04:00";

    return {
      client: clientMode === "manual"
        ? "Staged and left for you to apply."
        : (toMinutes(start) !== null && toMinutes(end) !== null
          ? "Applied when a station is free, between " + start + " and " + end + "."
          : "Applied as soon as a station is free."),
      server: serverMode === "manual"
        ? "You apply console updates yourself."
        : "Applied at " + serverAt +
          (serverMode === "end_of_day" ? ", at the end of the day." : ", at the start of the day.") +
          " Stations briefly disconnect."
    };
  }

  var api = {
    toMinutes: toMinutes,
    withinWindow: withinWindow,
    clientMayApply: clientMayApply,
    serverMayApply: serverMayApply,
    describe: describe
  };

  // Usable from the console renderer and from main.js, which is a CommonJS
  // context — the same rules must apply in both or they will drift.
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.CXUpdateSchedule = api;
})(typeof window !== "undefined" ? window : null);
