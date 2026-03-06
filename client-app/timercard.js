const timerDisplayEl = document.getElementById("timerDisplay");
const progressFillEl = document.getElementById("progressFill");
const timerCardEl = document.getElementById("timerCard");

let remainingSeconds = 0;
let totalSeconds = 0;
let timerInterval = null;
let currentAppName = "";

// Listen for timer start event
window.api.onStartTimer((data) => {
  currentAppName = data.appName;
  remainingSeconds = data.minutes * 60;
  totalSeconds = data.minutes * 60;
  
  // Add glow effect
  timerCardEl.classList.add('glow');
  
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
      timerCardEl.classList.remove('glow');
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
  
  // Calculate progress percentage
  const progressPercent = (remainingSeconds / totalSeconds) * 100;
  progressFillEl.style.width = `${progressPercent}%`;
  
  // Update color based on remaining time
  timerDisplayEl.className = 'timer-display';
  progressFillEl.className = 'progress-fill';
  
  if (remainingSeconds <= 60) {
    timerDisplayEl.classList.add('danger');
    progressFillEl.classList.add('danger');
  } else if (remainingSeconds <= 300) {
    timerDisplayEl.classList.add('warning');
    progressFillEl.classList.add('warning');
  }
}
