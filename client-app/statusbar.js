const statusBarEl = document.getElementById("statusBar");
const statusTextEl = document.getElementById("statusText");
const timerEl = document.getElementById("timer");

let startTime = Date.now();
let hideTimeout = null;

// Update timer every second
function updateTimer() {
  const elapsed = Date.now() - startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  
  timerEl.textContent = 
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Start timer
setInterval(updateTimer, 1000);
updateTimer();

window.api.onStatus((status) => {
  // Clear any pending hide timeout
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
  
  // Show the window
  window.api.showStatusBar();
  
  if (status === "CONNECTED") {
    statusTextEl.textContent = "CONNECTED";
    statusBarEl.className = "connected";
    
    // Hide after 3 seconds when connected
    hideTimeout = setTimeout(() => {
      window.api.hideStatusBar();
    }, 3000);
  } else {
    statusTextEl.textContent = "SIM OFFLINE";
    statusBarEl.className = "disconnected";
    // Stay visible when disconnected
  }
});
