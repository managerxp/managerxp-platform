/* ==========================================================================
   CafeXP Client — Launch timer card

   Counts down the block the server sent with LAUNCH_APP. Two behaviours were
   added on top of the plain countdown:

     - It beeps when time is running low, and again when the block ends, so a
       player deep in a fullscreen game notices without watching the corner.

     - It offers "+ Extend" once the clock is low. A tap asks the console to
       add another block; the extra time is added to the bill and settled at
       the counter later, so it works even with an empty wallet.

   And one behaviour was deliberately removed: hitting zero no longer closes
   the game. A player is never cut off mid-match — the block simply runs over,
   the card says so, the console is told, and staff (or the player, by
   extending) decide what happens next.
   ========================================================================== */
const timerDisplayEl = document.getElementById("timerDisplay");
const progressFillEl = document.getElementById("progressFill");
const timerCardEl = document.getElementById("timerCard");
const appNameEl = document.getElementById("appName");
const timerLabelEl = document.getElementById("timerLabel");
const extendBtnEl = document.getElementById("extendBtn");

let remainingSeconds = 0;
let totalSeconds = 0;
let timerInterval = null;
let currentAppName = "";

/* Thresholds the card's states and beeps key off. Warning at five minutes,
   the same figure the portal and the server use. */
const WARN_AT = 5 * 60;
let warnedAt = false;     // one warning beep per block, not one a second
let overtime = false;     // the block has run out and we are past it
let overtimeBeepAt = 0;   // throttles the periodic over-time reminder beep

/* ----------------------------------------------------------------------------
   Beep. Web Audio rather than an asset, so there is nothing to bundle or fail
   to load, and the tone can differ by urgency. Wrapped because a renderer that
   has never had a user gesture can refuse to start an AudioContext — a missing
   beep must never take the countdown down with it.
   ---------------------------------------------------------------------------- */
let audioCtx = null;
function beep(frequency, durationMs, volume) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = volume == null ? 0.12 : volume;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    osc.start(now);
    // A short fade so it reads as a soft chime, not a click.
    gain.gain.setValueAtTime(gain.gain.value, now + (durationMs / 1000) - 0.03);
    gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
  } catch (e) {
    /* No audio device, or a policy that blocks it. The visual states still
       carry the message; the beep is an enhancement, not the mechanism. */
  }
}

function warningBeep() { beep(880, 180, 0.10); }
function overtimeBeep() { beep(660, 160, 0.12); setTimeout(function () { beep(660, 160, 0.12); }, 220); }

window.api.onStartTimer((data) => {
  currentAppName = data.appName;
  remainingSeconds = data.minutes * 60;
  totalSeconds = data.minutes * 60;
  warnedAt = false;
  overtime = false;

  appNameEl.textContent = currentAppName;
  appNameEl.title = currentAppName;
  timerCardEl.classList.add("glow");
  hideExtend();

  if (timerInterval) clearInterval(timerInterval);

  updateDisplay();
  timerInterval = setInterval(tick, 1000);
});

/* The console added another block. Grow the clock in place rather than
   restarting it, so the running total and the bar stay continuous. */
if (window.api.onExtendTimer) {
  window.api.onExtendTimer((data) => {
    const addMinutes = Number(data && data.minutes) || 0;
    if (addMinutes <= 0) return;
    remainingSeconds += addMinutes * 60;
    totalSeconds += addMinutes * 60;
    overtime = false;
    warnedAt = remainingSeconds <= WARN_AT;   // don't re-beep if still low
    timerCardEl.classList.add("glow");
    if (!timerInterval) timerInterval = setInterval(tick, 1000);
    updateDisplay();
  });
}

function tick() {
  if (overtime) {
    // Past the block: count up the overage and nag gently, but never close.
    remainingSeconds -= 1;   // stays at/below zero; updateDisplay clamps it
    const over = Math.abs(Math.min(0, remainingSeconds));
    if (over - overtimeBeepAt >= 60) { overtimeBeep(); overtimeBeepAt = over; }
    updateDisplay();
    return;
  }

  remainingSeconds -= 1;

  if (!warnedAt && remainingSeconds <= WARN_AT && remainingSeconds > 0) {
    warnedAt = true;
    warningBeep();
    showExtend();
  }

  if (remainingSeconds <= 0) {
    remainingSeconds = 0;
    enterOvertime();
  }

  updateDisplay();
}

/* Time is up. The old code called window.api.timerExpired() here, which closed
   the game. It no longer does: the player keeps playing, the console is told
   the station is over its block, and the card invites an extension. */
function enterOvertime() {
  overtime = true;
  overtimeBeepAt = 0;
  timerCardEl.classList.remove("glow");
  overtimeBeep();
  showExtend();
  if (window.api.sessionOvertime) window.api.sessionOvertime(currentAppName);
}

function showExtend() {
  if (!extendBtnEl) return;
  extendBtnEl.hidden = false;
  timerCardEl.style.cursor = "pointer";
}
function hideExtend() {
  if (!extendBtnEl) return;
  extendBtnEl.hidden = true;
  timerCardEl.style.cursor = "";
}

/* Either the button or the body of the card, once low — a bigger target over a
   fullscreen game than a 12px button alone. */
function askExtend(e) {
  if (e) e.stopPropagation();
  if (extendBtnEl && extendBtnEl.hidden) return;   // not offered yet
  if (window.api.requestExtend) window.api.requestExtend();
  // Immediate feedback; the real clock grows when onExtendTimer arrives.
  timerLabelEl.textContent = "Extending…";
  beep(1040, 120, 0.08);
}
if (extendBtnEl) extendBtnEl.addEventListener("click", askExtend);
timerCardEl.addEventListener("click", function (e) {
  if (extendBtnEl && !extendBtnEl.hidden) askExtend(e);
});

function updateDisplay() {
  const shown = Math.max(0, remainingSeconds);
  const minutes = Math.floor(shown / 60);
  const seconds = shown % 60;
  timerDisplayEl.textContent =
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const progressPercent = totalSeconds > 0 ? (shown / totalSeconds) * 100 : 0;
  progressFillEl.style.width = `${progressPercent}%`;

  // One attribute drives the card, the numerals and the bar together.
  let state = "gaming";
  if (overtime) state = "expired";
  else if (remainingSeconds <= 60) state = "expired";
  else if (remainingSeconds <= WARN_AT) state = "warning";

  timerCardEl.setAttribute("data-status", state);

  if (overtime) {
    timerLabelEl.textContent = "Over · tap to extend";
  } else if (remainingSeconds > 0) {
    timerLabelEl.textContent = state === "expired" ? "Ending · extend?" : "Remaining";
  }
}
