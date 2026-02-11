const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");
const countdownEl = document.getElementById("countdown");
const logsEl = document.getElementById("logs");

let startTime = Date.now();
let assignedTimeMinutes = 0;
let countdownEndTime = null;

// Update elapsed timer every second
function updateTimer() {
  const elapsed = Date.now() - startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  
  timerEl.textContent = 
    `Elapsed Time: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Update countdown timer
function updateCountdown() {
  if (!countdownEndTime) {
    countdownEl.textContent = "Remaining Time: --:--:--";
    countdownEl.classList.remove('warning');
    return;
  }
  
  const remaining = countdownEndTime - Date.now();
  
  if (remaining <= 0) {
    countdownEl.textContent = "Remaining Time: 00:00:00";
    countdownEl.classList.add('warning');
    return;
  }
  
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  
  countdownEl.textContent = 
    `Remaining Time: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // Add warning if less than 5 minutes remaining
  if (remaining < 300000) {
    countdownEl.classList.add('warning');
  } else {
    countdownEl.classList.remove('warning');
  }
}

// Function to set timer
function setTimer() {
  const minutes = parseInt(document.getElementById('assignedMinutes').value);
  if (minutes && minutes > 0) {
    assignedTimeMinutes = minutes;
    countdownEndTime = Date.now() + (minutes * 60000);
    window.api.setAssignedTime(minutes);
  }
}

// Make setTimer available globally
window.setTimer = setTimer;

// Start timers
setInterval(updateTimer, 1000);
setInterval(updateCountdown, 1000);
updateTimer();
updateCountdown();

// Listen for assigned time from server or main process
window.api.onAssignedTime((minutes) => {
  assignedTimeMinutes = minutes;
  countdownEndTime = Date.now() + (minutes * 60000);
  document.getElementById('assignedMinutes').value = minutes;
});

window.api.onStatus((status) => {
  statusEl.textContent = status;
  statusEl.className = status === "CONNECTED"
    ? "connected"
    : "disconnected";
});

window.api.onLog((msg) => {
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
});

