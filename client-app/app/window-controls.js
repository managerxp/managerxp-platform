/* ==========================================================================
   CafeXP Client — On-screen window controls
   The window is frameless, so these replace the OS title bar entirely. They
   live inside the portal's own nav where there is one, and fall back to a
   floating cluster on the pages that have no nav (welcome, login, register).
   Self-injecting: each page only has to include this script.
   ========================================================================== */
(function (global) {
  "use strict";

  var api = global.api || {};

  var ICON = {
    minimize: '<path d="M5 12h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    restore:
      '<rect x="4" y="8" width="12" height="12" rx="2"/>' +
      '<path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/>',
    exitFull: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3' +
      'M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    enterFull: '<path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3' +
      'M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  }

  function button(id, icon, label, extraClass) {
    return '<button class="cx-wc-btn' + (extraClass ? " " + extraClass : "") + '" id="' + id +
      '" title="' + label + '" aria-label="' + label + '">' + svg(icon) + "</button>";
  }

  function mount() {
    // Without the bridge these would be dead buttons.
    if (!api.toggleFullscreen) return;
    if (document.getElementById("cxWindowControls")) return;

    // Prefer the portal's nav, so the controls read as part of the app rather
    // than as something pasted over it.
    var host = document.querySelector(".nav .nav-right");
    var inNav = !!host;

    var bar = document.createElement("div");
    bar.id = "cxWindowControls";
    bar.className = inNav ? "cx-window-controls cx-wc-inline" : "cx-window-controls";
    bar.innerHTML =
      button("cxFullscreen", ICON.exitFull, "Exit full screen  (F11 or Esc)") +
      button("cxMinimize", ICON.minimize, "Minimise") +
      button("cxMaximize", ICON.maximize, "Maximise") +
      button("cxClose", ICON.close, "Close", "cx-wc-close");

    if (inNav) host.appendChild(bar);
    else document.body.appendChild(bar);

    var fsBtn = bar.querySelector("#cxFullscreen");
    var maxBtn = bar.querySelector("#cxMaximize");

    function paintFullscreen(isFullscreen) {
      fsBtn.innerHTML = svg(isFullscreen ? ICON.exitFull : ICON.enterFull);
      var label = isFullscreen ? "Exit full screen  (F11 or Esc)" : "Enter full screen  (F11)";
      fsBtn.setAttribute("title", label);
      fsBtn.setAttribute("aria-label", label);
      // Maximising is meaningless while full screen; say so rather than let it
      // look like a button that does nothing.
      maxBtn.disabled = false;
      maxBtn.setAttribute("title", isFullscreen ? "Leave full screen" : "Maximise");
    }

    function paintMaximized(isMaximized) {
      maxBtn.innerHTML = svg(isMaximized ? ICON.restore : ICON.maximize);
      var label = isMaximized ? "Restore" : "Maximise";
      maxBtn.setAttribute("title", label);
      maxBtn.setAttribute("aria-label", label);
    }

    bar.querySelector("#cxMinimize").addEventListener("click", function () { api.minimizeWindow(); });
    fsBtn.addEventListener("click", function () { api.toggleFullscreen(); });
    maxBtn.addEventListener("click", function () {
      if (api.toggleMaximizeWindow) api.toggleMaximizeWindow();
    });

    // Closing the portal on a café station is not a casual click.
    bar.querySelector("#cxClose").addEventListener("click", function () {
      if (!api.closeWindow) return;
      if (global.CXUI && global.CXUI.confirm) {
        global.CXUI.confirm({
          title: "Close CafeXP?",
          message: "This station stops reporting to the café console and the customer " +
            "loses this screen. Their session keeps running on the café's side.",
          confirmLabel: "Close",
          variant: "danger"
        }).then(function (ok) { if (ok) api.closeWindow(); });
      } else {
        api.closeWindow();
      }
    });

    if (api.onFullscreenChanged) api.onFullscreenChanged(paintFullscreen);
    if (api.isFullscreen) api.isFullscreen().then(paintFullscreen).catch(function () {});
    if (api.onMaximizedChanged) api.onMaximizedChanged(paintMaximized);
    if (api.isMaximized) api.isMaximized().then(paintMaximized).catch(function () {});

    // A frameless window cannot be dragged unless something says it may.
    // Double-clicking the bar toggles maximise, as a real title bar does.
    var nav = document.querySelector(".nav");
    if (nav) {
      nav.addEventListener("dblclick", function (e) {
        if (e.target.closest("button, input, select, a, .chip-stat")) return;
        if (api.toggleMaximizeWindow) api.toggleMaximizeWindow();
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})(window);
