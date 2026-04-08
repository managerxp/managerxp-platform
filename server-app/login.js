// Get DOM elements
const loginForm = document.getElementById('loginForm');
const webBtn = document.getElementById('webBtn');
const checkBtn = document.getElementById('checkBtn');
const tokenBtn = document.getElementById('tokenBtn');
const tokenInput = document.getElementById('tokenInput');
const errorMsg = document.getElementById('errorMsg');
const loadingMsg = document.getElementById('loadingMsg');

// Display message about token being received
const checkMessage = document.createElement('div');
checkMessage.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 20px; border-radius: 8px; color: #4ade80; text-align: center; z-index: 9999; display: none;';
checkMessage.innerHTML = '<p style="margin: 0; font-size: 14px;">✓ Token received from web app!<br/>Logging you in...</p>';
document.body.appendChild(checkMessage);

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
    // Try to verify authentication with backend
    const response = await fetch('http://localhost:5000/api/auth/verify', {
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
    showError('Connection error. Make sure the backend is running on localhost:5000');
    checkBtn.disabled = false;
    loadingMsg.classList.remove('show');
  }
});

// Handle token submission
tokenBtn.addEventListener('click', async (e) => {
  e.preventDefault();

  const token = tokenInput.value.trim();

  if (!token) {
    showError('Please paste a valid token');
    return;
  }

  tokenBtn.disabled = true;
  loadingMsg.classList.add('show');
  errorMsg.classList.remove('show');

  try {
    const response = await fetch('http://localhost:5000/api/auth/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      
      if (data.success && data.data && data.data.user) {
        handleLoginSuccess(data.data.user, token);
      } else {
        showError('Invalid token. Please try again.');
        tokenBtn.disabled = false;
        loadingMsg.classList.remove('show');
      }
    } else {
      const error = await response.json();
      showError(error.message || 'Invalid token. Please check and try again.');
      tokenBtn.disabled = false;
      loadingMsg.classList.remove('show');
    }
  } catch (error) {
    console.error('Token verification error:', error);
    showError('Failed to verify token. Please try again.');
    tokenBtn.disabled = false;
    loadingMsg.classList.remove('show');
  }
});

// Handle successful login
function handleLoginSuccess(user, token) {
  // Use auth context through IPC
  window.api.setAuth(user, token);
}

// Show error message
function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.add('show');
}

// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (document.activeElement === tokenInput && !tokenBtn.disabled) {
      tokenBtn.click();
    } else if (!checkBtn.disabled) {
      checkBtn.click();
    }
  }
});

// Clear error on input
tokenInput.addEventListener('focus', () => {
  errorMsg.classList.remove('show');
});
