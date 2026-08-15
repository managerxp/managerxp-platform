/* ==========================================================================
   CafeXP Client — Launch timer card
   Unchanged behaviour: counts down the minutes the server sent with
   LAUNCH_APP and tells the main process when it hits zero so the application
   is closed. Only the presentation changed.
   ========================================================================== */
const timerDisplayEl = document.getElementById("timerDisplay");
const progressFillEl = document.getElementById("progressFill");
const timerCardEl = document.getElementById("timerCard");
const appNameEl = document.getElementById("appName");
const timerLabelEl = document.getElementById("timerLabel");

let remainingSeconds = 0;
let totalSeconds = 0;
let timerInterval = null;
let currentAppName = "";

window.api.onStartTimer((data) => {
  currentAppName = data.appName;
  remainingSeconds = data.minutes * 60;
  totalSeconds = data.minutes * 60;

  appNameEl.textContent = currentAppName;
  appNameEl.title = currentAppName;
  timerCardEl.classList.add("glow");

  if (timerInterval) clearInterval(timerInterval);

  updateDisplay();
  timerInterval = setInterval(() => {
    remainingSeconds--;

    if (remainingSeconds <= 0) {
      remainingSeconds = 0;
      clearInterval(timerInterval);
      timerCardEl.classList.remove("glow");
      timerLabelEl.textContent = "Time's up";
      window.api.timerExpired(currentAppName);
    }

    updateDisplay();
  }, 1000);
});

function updateDisplay() {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  timerDisplayEl.textContent =
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const progressPercent = totalSeconds > 0 ? (remainingSeconds / totalSeconds) * 100 : 0;
  progressFillEl.style.width = `${progressPercent}%`;

  // One attribute drives the card, the numerals and the bar together.
  let state = "gaming";
  if (remainingSeconds <= 60) state = "expired";
  else if (remainingSeconds <= 300) state = "warning";

  timerCardEl.setAttribute("data-status", state);
  if (remainingSeconds > 0) {
    timerLabelEl.textContent = state === "expired" ? "Ending now" : "Remaining";
  }
}
