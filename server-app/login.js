// Clear any cached auth data from previous sessions
try {
  localStorage.removeItem('auth');
  sessionStorage.clear();
} catch (error) {
  console.log('Storage already clean');
}

// Get DOM elements
const loginForm = document.getElementById('loginForm');
const webBtn = document.getElementById('webBtn');
const checkBtn = document.getElementById('checkBtn');
const errorMsg = document.getElementById('errorMsg');
const loadingMsg = document.getElementById('loadingMsg');

// Display message about token being received
const checkMessage = document.createElement('div');
checkMessage.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 20px; border-radius: 8px; color: #4ade80; text-align: center; z-index: 9999; display: none;';
checkMessage.innerHTML = '<p style="margin: 0; font-size: 14px;">✓ Token received from web app!<br/>Logging you in...</p>';
document.body.appendChild(checkMessage);

// Reset button states on page load
function resetButtonStates() {
  checkBtn.disabled = false;
  webBtn.disabled = false;
  loadingMsg.classList.remove('show');
  errorMsg.classList.remove('show');
}

// Initialize button states
resetButtonStates();

// Listen for when token is received (login will auto-trigger in main.js)
// Show a message to the user that login is happening
setTimeout(() => {
  // Check if checkMessage is still showing (meaning login didn't happen)
  // This is just a fallback
}, 5000);

// Handle "Login via Web App" button
webBtn.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openWebApp();
  errorMsg.classList.remove('show');
});

// Handle "I've Logged In - Continue" button
checkBtn.addEventListener('click', async (e) => {
  e.preventDefault();

  // Show loading state
  checkBtn.disabled = true;
  loadingMsg.classList.add('show');
  errorMsg.classList.remove('show');

  try {
    // Try to verify authentication with backend — window.api.backendLocal is
    // ManagerXP's real backend address (see main.js's BACKEND_LOCAL), not
    // necessarily this machine, so it must be asked rather than assumed.
    const backendBase = (window.api && window.api.backendLocal) || 'http://localhost:5000';
    const response = await fetch(`${backendBase}/api/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      
      if (data.success && data.data && data.data.user) {
        handleLoginSuccess(data.data.user, data.data.token);
      } else {
        showError('No active login session. Please login through the web app first.');
        checkBtn.disabled = false;
        loadingMsg.classList.remove('show');
      }
    } else {
      showError('You are not logged in. Please login through the web app first.');
      checkBtn.disabled = false;
      loadingMsg.classList.remove('show');
    }
  } catch (error) {
    console.error('Verification error:', error);
    showError('Connection error. Could not reach the ManagerXP backend.');
    checkBtn.disabled = false;
    loadingMsg.classList.remove('show');
  }
});

/*
 * Signing in happens through the web platform only.
 *
 * There was a "paste a token" box here as a development shortcut. It asked an
 * operator to handle a raw bearer token by hand — the one credential that
 * grants everything this console can do — which is both a habit worth not
 * teaching and an obvious thing to phish for. The web sign-in hands the token
 * over directly, so nobody needs to see it.
 */

// Handle successful login
function handleLoginSuccess(user, token) {
  console.log('===== LOGIN SUCCESS - SENDING TOKEN =====');
  console.log('[LoginPage] User:', user.email || user.name);
  console.log('[LoginPage] Token length:', token ? token.length : 0);
  console.log('[LoginPage] Calling window.api.setAuth()...');
  
  // Use auth context through IPC
  window.api.setAuth(user, token);
  
  console.log('[LoginPage] window.api.setAuth() called');
  console.log('===== TOKEN SENT TO MAIN PROCESS =====');
}

// Show error message
function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.add('show');
}

// Enter continues, the same as clicking the button.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !checkBtn.disabled) {
    checkBtn.click();
  }
});
