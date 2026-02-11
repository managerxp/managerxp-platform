const timerDisplayEl = document.getElementById("timerDisplay");

let remainingSeconds = 0;
let timerInterval = null;
let currentAppName = "";

// Listen for timer start event
window.api.onStartTimer((data) => {
  currentAppName = data.appName;
  remainingSeconds = data.minutes * 60;
  
  // Clear any existing interval
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Start countdown
  updateDisplay();
  timerInterval = setInterval(() => {
    remainingSeconds--;
    
    if (remainingSeconds <= 0) {
      remainingSeconds = 0;
      clearInterval(timerInterval);
      // Notify main process that timer expired
      window.api.timerExpired(currentAppName);
    }
    
    updateDisplay();
  }, 1000);
});

function updateDisplay() {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  
  const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  timerDisplayEl.textContent = timeString;
  
  // Update color based on remaining time
  timerDisplayEl.className = 'timer-display';
  if (remainingSeconds <= 60) {
    timerDisplayEl.classList.add('danger');
  } else if (remainingSeconds <= 300) {
    timerDisplayEl.classList.add('warning');
  }
}
