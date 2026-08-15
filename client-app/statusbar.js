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

window.api.onStatus((status) => {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  window.api.showStatusBar();
  paint(status);

  if (status === "CONNECTED") {
    // Get out of the customer's way once the link is healthy.
    hideTimeout = setTimeout(() => {
      window.api.hideStatusBar();
    }, 3000);
  }
});
