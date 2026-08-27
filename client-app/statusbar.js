/* ==========================================================================
   CafeXP Client — Status bar overlay
   Same behaviour as before: counts uptime, shows on every status change, and
   auto-hides three seconds after a successful connection.
   ========================================================================== */
const statusBarEl = document.getElementById("statusBar");
const statusBadgeEl = document.getElementById("statusBadge");
const statusDotEl = document.getElementById("statusDot");
const statusTextEl = document.getElementById("statusText");
const timerEl = document.getElementById("timer");

let startTime = Date.now();
let hideTimeout = null;

function updateTimer() {
  const elapsed = Date.now() - startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  timerEl.textContent =
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

setInterval(updateTimer, 1000);
updateTimer();

function paint(status) {
  const connected = status === "CONNECTED";
  // data-status drives the colour tokens; the element keeps its classes.
  statusBarEl.setAttribute("data-status", connected ? "online" : "offline");
  statusBadgeEl.setAttribute("data-status", connected ? "online" : "offline");
  statusDotEl.classList.toggle("dot-live", connected);
  statusTextEl.textContent = connected ? "CONNECTED" : "STATION OFFLINE";
}

/*
 * The bar appears on a *change*, not on every message.
 *
 * The main process now only pushes when the status really moved, but this
 * guards it too: showing itself is the one thing here a customer notices, and
 * it should happen when something happened — not because a socket was
 * re-established behind the scenes.
 */
let lastStatus = null;

function applyStatus(status, announce) {
  const changed = status !== lastStatus;
  lastStatus = status;
  paint(status);

  if (!announce || !changed) return;

  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  window.api.showStatusBar();

  if (status === "CONNECTED") {
    // Get out of the customer's way once the link is healthy.
    hideTimeout = setTimeout(() => {
      window.api.hideStatusBar();
    }, 3000);
  }
}

window.api.onStatus((status) => applyStatus(status, true));

/*
 * Ask once on load.
 *
 * This window is created alongside the main one, so a status pushed while it
 * was still loading was simply missed — leaving the strip reading CONNECTING
 * over a station that had been connected for minutes. Painted without
 * announcing, because nothing has changed for the customer; it is this window
 * catching up.
 */
if (window.api.getStatus) window.api.getStatus((status) => applyStatus(status, false));
