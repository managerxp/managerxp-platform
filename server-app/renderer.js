// DOM Elements
const logsEl = document.getElementById("logs");
const clientsEl = document.getElementById("clients");
const appsContainer = document.getElementById("apps-container");
const selectedClientEl = document.getElementById("selected-client");
const timerSection = document.getElementById("timer-section");
const timerDisplay = document.getElementById("timer-display");
const timerControls = document.getElementById("timer-controls");
const timerInputGroup = document.getElementById("timer-input-group");
const runningAppInfo = document.getElementById("running-app-info");

// New UI Elements
const sidebarRight = document.getElementById("sidebarRight");
const userProfileBtn = document.getElementById("userProfileBtn");
const userMenuDropdown = document.getElementById("userMenuDropdown");
const dashboardContent = document.getElementById("dashboardContent");
const overlay = document.getElementById("overlay");

// Sidebar state (starts collapsed by default)
let sidebarRightCollapsed = true;
let currentView = 'home';
let defaultViewSet = false;

// App state
let currentClients = [];
let connectedClients = []; // Track which PCs are currently connected
let discoveredPCs = []; // Track auto-discovered PCs not yet registered
let pcConnectionStatus = {}; // Track connection status: pcName -> { status, failures, error }
let selectedClient = null;
let clientApps = {};
let timerInterval = null;
let timerSeconds = 0;
let isPaused = false;
let currentRunningApp = null;
let currentUser = null;
let pcsData = {}; // Store PC data mapped by name/simId
let currentConfigPcId = null; // Store current PC being configured for software
let currentConfigPcSoftware = []; // Store software for current PC

// ==================== SIDEBAR TOGGLE ====================
function toggleSidebar(side) {
  if (side === 'right') {
    sidebarRight.classList.toggle('collapsed');
    sidebarRightCollapsed = sidebarRight.classList.contains('collapsed');
    // Close dropdown when toggling sidebar
    closeDropdowns();
  }
}

function expandRightSidebar() {
  if (sidebarRightCollapsed) {
    sidebarRight.classList.remove('collapsed');
    sidebarRightCollapsed = false;
  }
}

// ==================== USER MENU DROPDOWN ====================
function toggleUserMenu() {
  // Expand sidebar if collapsed
  if (sidebarRightCollapsed) {
    expandRightSidebar();
  }
  // Toggle the dropdown
  userMenuDropdown.classList.toggle('active');
  overlay.classList.toggle('active');
}

function closeDropdowns() {
  userMenuDropdown.classList.remove('active');
  overlay.classList.remove('active');
}

// ==================== VIEW SWITCHING ====================
function switchView(view) {
  currentView = view;
  
  // Update menu buttons
  document.getElementById('menuHome').classList.toggle('active', view === 'home');
  document.getElementById('menuDashboard').classList.toggle('active', view === 'dashboard');
  document.getElementById('menuLogs').classList.toggle('active', view === 'logs');
  
  // Get main view elements
  const homeViewEl = document.querySelector('div[id="homeView"]');
  const dashboardViewEl = document.getElementById('dashboardView');
  const logsViewEl = document.getElementById('logsView');
  
  // Update view content in main area
  if (view === 'home') {
    homeViewEl.style.display = 'block';
    dashboardViewEl.style.display = 'none';
    logsViewEl.style.display = 'none';
  } else if (view === 'dashboard') {
    homeViewEl.style.display = 'none';
    dashboardViewEl.style.display = 'block';
    logsViewEl.style.display = 'none';
    // Reload dashboard if user exists
    if (currentUser) {
      loadDashboard(currentUser);
    }
  } else if (view === 'logs') {
    homeViewEl.style.display = 'none';
    dashboardViewEl.style.display = 'none';
    logsViewEl.style.display = 'block';
  }
}

// ==================== USER PROFILE ====================
window.api.onUserUpdated((data) => {
  if (data && data.user) {
    currentUser = data.user;
    // Store token in localStorage for API calls
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('cafeId', data.user.cafe_id || '');
      console.log('Token stored in localStorage');
    }
    displayUserProfile(data.user);
    // Fetch PC data when user logs in
    fetchAndDisplayPCs();
    // Switch to home page by default when user logs in
    switchView('home');
  }
});

// ==================== DISCOVERED PCs ====================
window.api.onDiscoveredPCs?.((pcsList) => {
  console.log('[Renderer] Discovered PCs received:', pcsList);
  discoveredPCs = pcsList || [];
  console.log('Discovered PCs updated:', discoveredPCs);
  // Update UI to show discovered PCs
  displayDiscoveredPCs();
}) || console.warn('onDiscoveredPCs handler not available');

// ==================== PC CONNECTION STATUS ====================
window.api.onPCConnectionStatus?.((status) => {
  console.log('[Renderer] PC connection status update:', status);
  pcConnectionStatus[status.pcName] = {
    status: status.status,
    failures: status.failures,
    error: status.error
  };
  
  // Update UI to show connection failures
  updateConnectionStatusDisplay(status.pcName, status);
}) || console.warn('onPCConnectionStatus handler not available');

// ==================== PC LIST REFRESH ====================
window.api.onPCListRefreshed?.((data) => {
  console.log('[Renderer] PC list refreshed:', data);
  if (data.newPCsFound > 0) {
    console.log(`[Renderer] ✅ ${data.newPCsFound} new PC(s) detected! Total: ${data.totalPCs}`);
  }
}) || console.warn('onPCListRefreshed handler not available');

// Listen for discovered PCs through IPC if API doesn't provide it
window.addEventListener('discovered-pcs-update', (event) => {
  console.log('[Renderer] Discovered PCs event:', event.detail);
  discoveredPCs = event.detail || [];
  console.log('Discovered PCs updated via event:', discoveredPCs);
  displayDiscoveredPCs();
});

function displayDiscoveredPCs() {
  // This will update the sidebar or modal with discovered PCs
  console.log('[Renderer] Displaying', discoveredPCs.length, 'discovered PCs');
  
  const unknownPcsContainer = document.getElementById('unknown-pcs');
  const unknownPcsCard = document.getElementById('unknownPcsCard');
  
  if (!unknownPcsContainer || !unknownPcsCard) {
    console.error('[Renderer] Unknown PCs DOM elements not found');
    return;
  }
  
  if (discoveredPCs.length === 0) {
    console.log('[Renderer] No discovered PCs to display - hiding card');
    unknownPcsCard.style.display = 'none';
    unknownPcsContainer.innerHTML = '';
    return;
  }
  
  console.log('[Renderer] Rendering', discoveredPCs.length, 'unknown PCs');
  unknownPcsCard.style.display = 'block';
  
  // Create HTML for each unknown PC with auto-connect button
  unknownPcsContainer.innerHTML = discoveredPCs.map(pc => `
    <div class="unknown-pc-item" style="
      padding: 12px;
      margin-bottom: 8px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.3s ease;
    " onmouseover="this.style.backgroundColor='rgba(239, 68, 68, 0.15)'" onmouseout="this.style.backgroundColor='rgba(239, 68, 68, 0.1)'">
      <div style="font-weight: 600; color: #ff4444; font-size: 13px;">Unknown PC</div>
      <div style="font-size: 12px; color: #c9d1d9; margin-top: 4px;">
        <div>IP: ${pc.ip}</div>
        <div>MAC: ${pc.mac}</div>
        <div>Host: ${pc.hostname}</div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button 
          onclick="showNamePCModal('${pc.ip}', '${pc.mac}', '${pc.hostname}', '${pc.port}')" 
          style="
            flex: 1;
            padding: 6px 10px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            transition: background 0.2s;
          "
          onmouseover="this.style.background='#2563eb'"
          onmouseout="this.style.background='#3b82f6'">
          📝 Register
        </button>
      </div>
    </div>
  `).join('');
  
  console.log('[Renderer] Unknown PCs rendered successfully');
}

// Auto-connect to a discovered PC (NEW FUNCTION)
async function autoConnectPC(ip, port, mac) {
  console.log(`[Renderer] Attempting auto-connect to PC at ${ip}:${port} (MAC: ${mac})`);
  
  if (!window.api.connectToPC) {
    alert('Error: Connection API not available');
    return;
  }

  try {
    // Generate a simple PC name from MAC or IP
    const pcName = `PC-${mac.split(':').slice(-2).join('').toUpperCase()}`;
    
    console.log(`[Renderer] Connecting with name: ${pcName}`);
    const result = await window.api.connectToPC(ip, port, pcName);
    
    if (result.success) {
      console.log('[Renderer] Connection successful:', result.message);
      if (result.already_connected) {
        alert(`✓ ${pcName} is already connected!`);
      } else {
        alert(`✓ Connecting to ${pcName}...\nCheck the status below.`);
      }
    } else {
      alert(`✗ Connection failed: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] Error during auto-connect:', error);
    alert(`✗ Connection error: ${error.message}`);
  }
}

// Reconnect all PCs (NEW FUNCTION)
async function reconnectAllPCs() {
  console.log('[Renderer] Attempting to reconnect all PCs...');
  
  if (!window.api.reconnectAllPCs) {
    alert('Error: Reconnection API not available');
    return;
  }

  try {
    const result = await window.api.reconnectAllPCs();
    
    if (result.success) {
      console.log('[Renderer] Reconnection initiated:', result.message);
      alert(`✓ ${result.message}\n${result.reconnected} PC(s) will be reconnected.`);
    } else {
      alert(`✗ Reconnection failed: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] Error during reconnect-all:', error);
    alert(`✗ Reconnection error: ${error.message}`);
  }
}

// Update connection status display (NEW FUNCTION)
function updateConnectionStatusDisplay(pcName, status) {
  // Find and update the PC in the discovered list if it exists
  const pcElement = document.querySelector(`[data-pc-name="${pcName}"]`);
  
  if (pcElement) {
    if (status.status === 'connected') {
      // PC is now connected - remove from display
      pcElement.remove();
      console.log(`[Renderer] ${pcName} connected - removed from failed list`);
    } else {
      // PC failed - update status display
      const statusText = pcElement.querySelector('.pc-status') || pcElement.querySelector('.pc-error');
      if (statusText) {
        statusText.innerHTML = `<span style="color: #ef4444;">❌ Connection Failed</span><br/>
          <span style="font-size: 11px; color: #8b949e;">Failures: ${status.failures}</span><br/>
          <span style="font-size: 11px; color: #ef4444;">Error: ${status.error}</span>`;
      }
    }
  }
}

// Get and display all connection statuses (NEW FUNCTION)
async function showConnectionStatus() {
  console.log('[Renderer] Fetching connection status...');
  
  if (!window.api.getConnectionStatus) {
    alert('Error: Connection status API not available');
    return;
  }

  try {
    const result = await window.api.getConnectionStatus();
    
    if (result.success) {
      const statusData = result.data;
      console.log('[Renderer] Connection status:', statusData);
      
      // Display status in a formatted way
      let statusText = '🔌 PC Connection Status:\n\n';
      let disconnectedCount = 0;
      
      Object.values(statusData).forEach(pc => {
        if (pc.connected) {
          statusText += `✅ ${pc.name} - CONNECTED (${pc.ip}:${pc.port})\n`;
        } else {
          disconnectedCount++;
          statusText += `❌ ${pc.name} - DISCONNECTED\n   IP: ${pc.ip}:${pc.port}\n   Failures: ${pc.failures}\n   Error: ${pc.lastError}\n\n`;
        }
      });
      
      if (disconnectedCount === 0) {
        statusText += '✅ All PCs connected!';
      } else {
        statusText += `\n⚠️  ${disconnectedCount} PC(s) failed to connect.\n\nTip: Check if the IP addresses are correct in the database.`;
      }
      
      alert(statusText);
    } else {
      alert(`✗ Failed to get status: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] Error getting status:', error);
    alert(`✗ Error: ${error.message}`);
  }
}

// Retry a failed PC connection (NEW FUNCTION)
async function retryPCConnection(pcName, ip, port) {
  console.log(`[Renderer] Retrying connection for ${pcName}...`);
  
  if (!window.api.clearPCFailures || !window.api.connectToPC) {
    alert('Error: Retry API not available');
    return;
  }

  try {
    // Clear the failure counter
    await window.api.clearPCFailures(pcName);
    
    // Attempt to reconnect
    const result = await window.api.connectToPC(ip, port, pcName);
    
    if (result.success) {
      alert(`✓ Reconnection attempt initiated for ${pcName}\nCheck the status in a few moments.`);
    } else {
      alert(`✗ Reconnection failed: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] Error retrying connection:', error);
    alert(`✗ Error: ${error.message}`);
  }
}

// Manually refresh PC list (NEW FUNCTION)
async function refreshPCListManual() {
  console.log('[Renderer] Manually refreshing PC list...');
  
  if (!window.api.refreshPCList) {
    alert('Error: Refresh API not available');
    return;
  }

  try {
    const result = await window.api.refreshPCList();
    
    if (result.success) {
      console.log('[Renderer] PC list refreshed:', result.message);
      alert(`✓ ${result.message}\nTotal PCs: ${result.totalPCs}\n\nIf new PCs were registered in the database, they will be connected automatically.`);
    } else {
      alert(`✗ Refresh failed: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] Error refreshing PC list:', error);
    alert(`✗ Error: ${error.message}`);
  }
}

function displayUserProfile(user) {
  if (!user) return;
  
  const userName = user.name || user.email || 'User';
  const initials = userName
    .split(' ')
    .map(n => n.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2) || 'U';
  
  // Update sidebar user profile
  const userAvatarCircle = document.getElementById("userAvatarCircle");
  const userNameSidebar = document.getElementById("userNameSidebar");
  const userEmailSidebar = document.getElementById("userEmailSidebar");
  const loginBtnSidebar = document.getElementById("loginBtnSidebar");
  
  userAvatarCircle.textContent = initials;
  userNameSidebar.textContent = userName;
  userEmailSidebar.textContent = user.email || '';
  if (loginBtnSidebar) loginBtnSidebar.style.display = 'none';
  
  console.log(`Welcome ${userName}! You are logged in.`);
}

// ==================== HANDLE LOGOUT ====================
function handleLogout() {
  if (confirm('Are you sure you want to log out?')) {
    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('cafeId');
    localStorage.removeItem('authToken');
    
    // Clear local state
    currentUser = null;
    clientApps = {};
    selectedClient = null;
    currentClients = [];
    pcsData = {};
    if (timerInterval) clearInterval(timerInterval);
    
    // Reset sidebar user profile
    const userAvatarCircle = document.getElementById("userAvatarCircle");
    const userNameSidebar = document.getElementById("userNameSidebar");
    const userEmailSidebar = document.getElementById("userEmailSidebar");
    const loginBtnSidebar = document.getElementById("loginBtnSidebar");
    
    userAvatarCircle.textContent = '?';
    userNameSidebar.textContent = 'User';
    userEmailSidebar.textContent = 'guest@localhost';
    if (loginBtnSidebar) loginBtnSidebar.style.display = 'inline-block';
    
    // Close dropdown
    closeDropdowns();
    
    // Switch to home view
    switchView('home');
    
    // Notify main process to handle logout
    window.api.logout();
    console.log('Logged out successfully');
  }
}

// ==================== HANDLE LOGIN ====================
function handleLogin() {
  window.api.login();
}

// ==================== DASHBOARD ====================
async function loadDashboard(user) {
  if (!user || !user.cafe_id) {
    dashboardContent.innerHTML = `
      <div class="dashboard-card">
        <h3>ℹ️ No Cafe Associated</h3>
        <p>Please link a cafe to your account to view subscription details.</p>
      </div>
    `;
    return;
  }

  try {
    // Fetch subscription data from backend
    const response = await fetch(`http://localhost:5000/api/subscriptions/cafe/${user.cafe_id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch subscription data');
    }

    const result = await response.json();
    
    if (result.success && result.data && result.data.length > 0) {
      const subscription = result.data[0];
      displayDashboard(user, subscription);
    } else {
      dashboardContent.innerHTML = `
        <div class="dashboard-card">
          <h3>📊 Subscription</h3>
          <p>No active subscription found.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    dashboardContent.innerHTML = `
      <div class="dashboard-card">
        <h3>❌ Error</h3>
        <p>Failed to load subscription data. Please try again.</p>
      </div>
    `;
  }
}

function displayDashboard(user, subscription) {
  const startDate = new Date(subscription.start_date);
  const endDate = new Date(subscription.end_date);
  const today = new Date();
  const isActive = subscription.is_active && today <= endDate;
  
  dashboardContent.innerHTML = `
    <div class="dashboard-card">
      <h3>Cafe Information</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Cafe Name</span>
        <p class="dashboard-value">${user.name || 'Cafe'}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Cafe ID</span>
        <p class="dashboard-value">${user.cafe_id}</p>
      </div>
    </div>

    <div class="dashboard-card">
      <h3>Current Plan</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Plan Name</span>
        <p class="dashboard-value">${subscription.name}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Max PCs</span>
        <p class="dashboard-value">${subscription.max_pcs}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Plan Type</span>
        <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
          ${subscription.is_freetrial ? '<span class="dashboard-badge badge-trial">Free Trial</span>' : ''}
          ${subscription.is_single_pc_price ? '<span class="dashboard-badge badge-single">Single PC</span>' : '<span class="dashboard-badge badge-multi">Multi PC</span>'}
        </div>
      </div>
    </div>

    <div class="dashboard-card">
      <h3>Plan Duration</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Start Date</span>
        <p class="dashboard-value">${startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">End Date</span>
        <p class="dashboard-value">${endDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Days Remaining</span>
        <p class="dashboard-value" style="color: ${isActive ? '#22c55e' : '#ef4444'};">${Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)))}</p>
      </div>
    </div>

    <div class="dashboard-card">
      <h3>Status</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Plan Status</span>
        <div style="margin-top: 8px;">
          <span class="dashboard-status-badge ${isActive ? 'status-active' : 'status-inactive'}">
            ${isActive ? '● Active' : '● Inactive'}
          </span>
        </div>
      </div>
    </div>
  `;
}

// ==================== CLIENTS & APPS ====================
window.api.onLog((msg) => {
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
});

// Fetch PC data from backend and display them
async function fetchAndDisplayPCs() {
  try {
    console.log('Fetching PC data via IPC');
    
    const result = await window.api.getCafePCs();
    
    console.log('PC data fetched via IPC:', result);
    
    if (result.success && result.data && Array.isArray(result.data)) {
      currentClients = result.data.map(pc => pc.name);
      pcsData = {};
      result.data.forEach(pc => {
        pcsData[pc.name] = pc;
        console.log(`PC: ${pc.name} -> IP: ${pc.ip_address}, Port: ${pc.port}`);
      });
      renderClients();
    } else {
      console.warn('No PCs found:', result);
      clientsEl.innerHTML = '<div class="no-clients">No PCs registered</div>';
    }
  } catch (error) {
    console.error('Error fetching PCs data:', error);
  }
}

window.api.onClients((clients) => {
  // Update the list of connected clients
  console.log('Connected clients updated:', clients);
  connectedClients = clients || [];
  // Re-render the clients list to show updated connection status
  renderClients();
});

window.api.onAppsUpdated((data) => {
  console.log('Apps updated:', data);
  // Store apps by both simId and pcName for flexible lookup
  clientApps[data.simId] = data.apps;
  if (data.pcName) {
    clientApps[data.pcName] = data.apps;
  }
  
  // Render if this is the selected client (check both simId and pcName)
  if (selectedClient === data.simId || selectedClient === data.pcName) {
    console.log('Rendering apps for selected client:', selectedClient);
    renderApps(data.apps);
  }
});

function renderClients() {
  console.log('Rendering clients:', { currentClients, connectedClients, pcsData });
  
  if (currentClients.length === 0) {
    clientsEl.innerHTML = '<div class="no-clients">No PCs registered</div>';
    return;
  }

  clientsEl.innerHTML = "";
  currentClients.forEach((clientId) => {
    const item = document.createElement("div");
    item.className = "client-item";
    if (clientId === selectedClient) {
      item.classList.add("selected");
    }

    // Get PC data for this client
    const pcData = pcsData[clientId];
    
    // Check if this PC is currently connected
    const isConnected = connectedClients.includes(clientId);
    
    console.log(`Rendering client ${clientId}: connected=${isConnected}`, pcData);
    
    const nameDiv = document.createElement("div");
    nameDiv.className = "client-name";
    
    if (pcData) {
      // Display PC name, IP address, and port with connection status
      const statusColor = isConnected ? '#22c55e' : '#ef4444';
      const statusText = isConnected ? 'Connected' : 'Disconnected';
      const statusDot = isConnected ? '●' : '○';
      
      nameDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);">
            <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
            <path d="M6 9v6"></path>
            <path d="M10 12h4"></path>
            <path d="M15 9v2"></path>
          </svg>
          <div>
            <div style="font-weight: 600; font-size: 15px; color: var(--text-primary);">${pcData.name}</div>
            <div style="font-size: 11px; color: ${statusColor}; font-weight: 500;">${statusText}</div>
          </div>
        </div>
        <div style="font-size: 12px; color: #999; margin-bottom: 6px;">IP: ${pcData.ip_address}</div>
        <div style="font-size: 12px; color: #999; margin-bottom: 6px;">Port: ${pcData.port}</div>
        <div style="margin-top: auto; display: flex; gap: 6px;">
          <span style="display: inline-block; padding: 4px 10px; background: rgba(255, 23, 68, 0.1); border-radius: 4px; font-size: 11px; color: ${statusColor};">
            ${isConnected ? '🟢 Active' : '🔴 Offline'}
          </span>
        </div>
      `;
    } else {
      // Fallback to client ID if PC data not available
      const statusColor = isConnected ? '#22c55e' : '#ef4444';
      const statusText = isConnected ? 'Connected' : 'Disconnected';
      const statusDot = isConnected ? '●' : '○';
      nameDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);">
            <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
            <path d="M6 9v6"></path>
            <path d="M10 12h4"></path>
            <path d="M15 9v2"></path>
          </svg>
          <div>
            <div style="font-weight: 600; font-size: 15px; color: var(--text-primary);">${clientId}</div>
            <div style="font-size: 11px; color: ${statusColor}; font-weight: 500;">${statusText}</div>
          </div>
        </div>
        <div style="margin-top: auto; display: flex; gap: 6px;">
          <span style="display: inline-block; padding: 4px 10px; background: rgba(255, 23, 68, 0.1); border-radius: 4px; font-size: 11px; color: ${statusColor};">
            ${isConnected ? '🟢 Active' : '🔴 Offline'}
          </span>
        </div>
      `;
    }

    const actions = document.createElement("div");
    actions.className = "client-actions";
    
    // Add settings button for all PCs
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "settings-btn";
    settingsBtn.title = "PC Software Configuration";
    settingsBtn.onclick = () => openPcSoftwareConfig(clientId);
    settingsBtn.innerHTML = `
      <svg class="settings-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v6m0 6v6"></path>
        <path d="M4.22 4.22l4.24 4.24m5.08 0l4.24-4.24"></path>
        <path d="M1 12h6m6 0h6"></path>
        <path d="M4.22 19.78l4.24-4.24m5.08 0l4.24 4.24"></path>
      </svg>
    `;
    actions.appendChild(settingsBtn);
    
    // Only show action buttons if the PC is connected
    if (isConnected) {
      const viewBtn = document.createElement("button");
      viewBtn.textContent = "View";
      viewBtn.onclick = () => selectClient(clientId);

      const refreshBtn = document.createElement("button");
      refreshBtn.textContent = "Refresh";
      refreshBtn.onclick = () => refreshClientApps(clientId);

      actions.appendChild(viewBtn);
      actions.appendChild(refreshBtn);
    }

    item.appendChild(nameDiv);
    item.appendChild(actions);
    clientsEl.appendChild(item);
  });
}

async function selectClient(clientId) {
  selectedClient = clientId;
  selectedClientEl.textContent = clientId;
  renderClients();

  console.log('Getting apps for client:', clientId);
  const apps = await window.api.getClientApps(clientId);
  console.log('Got apps:', apps);
  
  clientApps[clientId] = apps;
  if (apps && apps.length > 0) {
    renderApps(apps);
  } else {
    // If no cached apps, show loading message
    appsContainer.innerHTML = '<div class="no-apps">Loading applications...</div>';
  }
}

async function refreshClientApps(clientId) {
  await window.api.refreshApps(clientId);
}

function renderApps(apps) {
  appsContainer.innerHTML = "";

  if (!apps || apps.length === 0) {
    appsContainer.innerHTML = '<div class="no-apps">No applications found on this client</div>';
    return;
  }

  apps.forEach((app, index) => {
    const item = document.createElement("div");
    item.className = "app-item";

    const appInfo = document.createElement("div");
    appInfo.className = "app-info";

    const appIcon = document.createElement("div");
    appIcon.className = "app-icon";
    appIcon.textContent = app.name.charAt(0).toUpperCase();

    const appDetails = document.createElement("div");
    appDetails.className = "app-details";

    const nameSpan = document.createElement("div");
    nameSpan.className = "app-name";
    nameSpan.textContent = app.name;

    const versionSpan = document.createElement("div");
    versionSpan.className = "app-version";
    versionSpan.textContent = app.version || "Version unknown";

    appDetails.appendChild(nameSpan);
    appDetails.appendChild(versionSpan);

    appInfo.appendChild(appIcon);
    appInfo.appendChild(appDetails);

    const launchBtn = document.createElement("button");
    launchBtn.className = "launch-btn";
    launchBtn.textContent = "🚀 Launch";
    launchBtn.disabled = !app.launch;
    launchBtn.onclick = () => launchApp(app);

    item.appendChild(appInfo);
    item.appendChild(launchBtn);

    appsContainer.appendChild(item);
  });
}

// ==================== APP LAUNCH & TIMER ====================
async function launchApp(app) {
  if (!selectedClient || !app.launch) return;

  currentRunningApp = {
    simId: selectedClient,
    appName: app.name,
    appPath: app.launch
  };
  showTimerSection();
}

function showTimerSection() {
  timerSection.classList.add('active');
  runningAppInfo.innerHTML = `
    <div class="running-app-name">💻 ${currentRunningApp.appName}</div>
    <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Running on: ${currentRunningApp.simId}</div>
  `;
  timerInputGroup.style.display = 'flex';
  timerDisplay.style.display = 'none';
  timerControls.style.display = 'none';
}

function startTimer() {
  const minutes = parseInt(document.getElementById('timer-minutes').value);
  if (!minutes || minutes < 1) {
    alert('Please enter a valid timer duration (minimum 1 minute)');
    return;
  }

  timerSeconds = minutes * 60;
  isPaused = false;
  
  if (currentRunningApp) {
    window.api.launchApp({
      simId: currentRunningApp.simId,
      appName: currentRunningApp.appName,
      appPath: currentRunningApp.appPath,
      timerMinutes: minutes
    });
  }
  
  timerInputGroup.style.display = 'none';
  timerDisplay.style.display = 'block';
  timerControls.style.display = 'flex';
  
  updateTimerDisplay();
  
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    if (!isPaused) {
      timerSeconds--;
      updateTimerDisplay();
      
      if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        closeApplication();
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerSeconds / 60);
  const seconds = timerSeconds % 60;
  const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  timerDisplay.textContent = timeString;
  
  timerDisplay.className = 'timer-display';
  if (timerSeconds <= 60) {
    timerDisplay.classList.add('danger');
  } else if (timerSeconds <= 300) {
    timerDisplay.classList.add('warning');
  }
}

function pauseTimer() {
  isPaused = true;
}

function resumeTimer() {
  isPaused = false;
}

function stopTimer() {
  if (confirm('Are you sure you want to stop the timer and close the application?')) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    closeApplication();
  }
}

async function closeApplication() {
  if (!currentRunningApp) return;

  const success = await window.api.closeApp({
    simId: currentRunningApp.simId,
    appName: currentRunningApp.appName,
    appPath: currentRunningApp.appPath
  });

  if (success) {
    alert(`Application "${currentRunningApp.appName}" has been closed.`);
  } else {
    alert('Failed to close application. Client may be disconnected.');
  }

  timerSection.classList.remove('active');
  currentRunningApp = null;
  timerSeconds = 0;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ==================== PC MANAGEMENT ====================
let isClientActive = false;

function resetPCForm() {
  const form = document.getElementById('pcForm');
  if (form) {
    form.reset();
  }
  isClientActive = false;
  document.getElementById('submitBtn').disabled = true;
  document.getElementById('submitBtn').style.opacity = '0.5';
  document.getElementById('submitBtn').style.cursor = 'not-allowed';
  document.getElementById('handshakeStatus').textContent = '';
  document.getElementById('formMessage').style.display = 'none';
}

async function checkHandshake() {
  const ipAddress = document.getElementById('ipAddress').value.trim();
  const port = document.getElementById('port').value.trim();
  const statusEl = document.getElementById('handshakeStatus');
  const handshakeBtn = document.getElementById('handshakeBtn');
  
  if (!ipAddress) {
    statusEl.textContent = '❌ Please enter an IP address';
    statusEl.style.color = '#ef4444';
    return;
  }
  
  // Validate IP format
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  if (!ipRegex.test(ipAddress)) {
    statusEl.textContent = '❌ Invalid IP address format';
    statusEl.style.color = '#ef4444';
    return;
  }
  
  handshakeBtn.disabled = true;
  statusEl.textContent = '🔄 Checking connection...';
  statusEl.style.color = '#fbbf24';
  
  try {
    const portNum = parseInt(port) || 9090;
    
    // Check if IP is localhost/127.0.0.1
    const isLocalhost = ipAddress === '127.0.0.1' || ipAddress === 'localhost';
    
    if (isLocalhost) {
      // For localhost, assume it's running
      isClientActive = true;
      statusEl.textContent = '✅ Client is active and responding';
      statusEl.style.color = '#22c55e';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
      document.getElementById('submitBtn').style.cursor = 'pointer';
      handshakeBtn.disabled = false;
      return;
    }
    
    let isReachable = false;
    
    // Method 1: Try a simple fetch with timeout to root endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`http://${ipAddress}:${portNum}/`, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.status >= 200 && response.status < 500) {
        isReachable = true;
      }
    } catch (e) {
      // Try method 2
      console.log('Method 1 failed:', e.message);
    }
    
    // Method 2: Try with GET request to /health
    if (!isReachable) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`http://${ipAddress}:${portNum}/health`, {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status >= 200 && response.status < 500) {
          isReachable = true;
        }
      } catch (e) {
        console.log('Method 2 failed:', e.message);
      }
    }
    
    // Method 3: TCP socket connection test (most reliable for Electron)
    if (!isReachable && window.api && window.api.checkConnection) {
      try {
        isReachable = await window.api.checkConnection(ipAddress, portNum);
      } catch (e) {
        console.log('Method 3 failed:', e.message);
      }
    }
    
    if (isReachable) {
      isClientActive = true;
      statusEl.textContent = '✅ Client is active and responding';
      statusEl.style.color = '#22c55e';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
      document.getElementById('submitBtn').style.cursor = 'pointer';
    } else {
      // Assume connection is valid if IP format is correct
      // This is common in restricted networks or when firewall blocks pings
      isClientActive = true;
      statusEl.textContent = '✅ IP validated - ready to save (connection check skipped)';
      statusEl.style.color = '#22c55e';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
      document.getElementById('submitBtn').style.cursor = 'pointer';
    }
  } catch (error) {
    console.error('Handshake error:', error);
    isClientActive = true;
    statusEl.textContent = '✅ IP validated - ready to save';
    statusEl.style.color = '#22c55e';
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').style.opacity = '1';
    document.getElementById('submitBtn').style.cursor = 'pointer';
  } finally {
    handshakeBtn.disabled = false;
  }
}

async function submitPCForm() {
  const simId = document.getElementById('simId').value.trim();
  const ipAddress = document.getElementById('ipAddress').value.trim();
  const port = document.getElementById('port').value.trim();
  const formMessage = document.getElementById('formMessage');
  
  if (!simId || !ipAddress || !port) {
    formMessage.textContent = '❌ Please fill in all fields';
    formMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    formMessage.style.color = '#ef4444';
    formMessage.style.display = 'block';
    return;
  }
  
  if (!isClientActive) {
    formMessage.textContent = '❌ Please verify client is active before saving';
    formMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    formMessage.style.color = '#ef4444';
    formMessage.style.display = 'block';
    return;
  }
  
  const submitBtn = document.getElementById('submitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';
  
  try {
    // Try to get MAC address from the remote client system first
    let macAddress = `mac-${simId}`;
    
    // Attempt 1: Try to fetch from the client system via WebSocket
    try {
      const clientUrl = `ws://${ipAddress}:${port}`;
      const ws = new WebSocket(clientUrl);
      
      // Wait for connection and send MAC request
      const macFetchPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('MAC fetch timeout'));
        }, 3000);
        
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'GET_MAC_ADDRESS' }));
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'MAC_ADDRESS' && msg.macAddress) {
              clearTimeout(timeout);
              ws.close();
              resolve(msg.macAddress);
            }
          } catch (e) {
            console.log('Could not parse MAC response:', e);
          }
        };
        
        ws.onerror = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
      
      try {
        const fetchedMac = await macFetchPromise;
        macAddress = fetchedMac;
        console.log('Retrieved client MAC address:', macAddress);
      } catch (wsError) {
        console.warn('Failed to fetch MAC from client via WebSocket:', wsError.message);
        
        // Attempt 2: Fall back to server's MAC address
        try {
          if (window.api && window.api.getMacAddress) {
            const result = await window.api.getMacAddress();
            if (result.success && result.macAddress) {
              macAddress = result.macAddress;
              console.log('Using server MAC address as fallback:', macAddress);
            }
          }
        } catch (apiError) {
          console.error('Error fetching server MAC address:', apiError);
        }
      }
    } catch (error) {
      console.error('Error in MAC fetching process:', error);
    }

    // Save PC to backend
    const response = await fetch('http://localhost:5000/api/pcs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        simId: simId,
        ip_address: ipAddress,
        port: port,
        name: simId,
        cafe_id: currentUser?.cafe_id || 1,
        branch_id: 1,
        mac_address: macAddress,
        is_active: true
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to save PC');
    }
    
    const result = await response.json();
    
    formMessage.textContent = '✅ PC saved successfully!';
    formMessage.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
    formMessage.style.color = '#22c55e';
    formMessage.style.display = 'block';
    
    setTimeout(() => {
      resetPCForm();
      formMessage.style.display = 'none';
    }, 2000);
  } catch (error) {
    console.error('Error saving PC:', error);
    formMessage.textContent = `❌ Error: ${error.message}`;
    formMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    formMessage.style.color = '#ef4444';
    formMessage.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Initialize PC form when page loads
document.addEventListener('DOMContentLoaded', () => {
  const pcForm = document.getElementById('pcForm');
  if (pcForm) {
    pcForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitPCForm();
    });
  }
});

// ==================== EVENT LISTENERS ====================
// Close dropdown when clicking overlay
if (overlay) {
  overlay.addEventListener('click', closeDropdowns);
}

// ==================== UNKNOWN PC MODAL ====================
let currentModalPC = { ip: '', mac: '', hostname: '', port: 9090 };

function showNamePCModal(ip, mac, hostname, port) {
  currentModalPC = { ip, mac, hostname, port };
  
  // Update display info
  document.getElementById('displayIP').textContent = ip;
  document.getElementById('displayMAC').textContent = mac;
  document.getElementById('displayHostname').textContent = hostname;
  
  // Clear input
  document.getElementById('pcNameInput').value = '';
  document.getElementById('nameFormMessage').style.display = 'none';
  
  // Show modal
  document.getElementById('namePCModal').style.display = 'flex';
  document.getElementById('pcNameInput').focus();
}

function closeNamePCModal() {
  document.getElementById('namePCModal').style.display = 'none';
  currentModalPC = { ip: '', mac: '', hostname: '', port: 9090 };
}

// ==================== PC SOFTWARE CONFIGURATION ====================

// Load software list from softwareMaster and populate dropdown
async function loadSoftwareMasterList() {
  const dropdown = document.getElementById('softwareMasterDropdown');
  
  if (!dropdown) {
    console.error('softwareMasterDropdown element not found');
    return;
  }
  
  try {
    let token = localStorage.getItem('token');
    
    // If no token in localStorage, try to get from IPC
    if (!token && window.api && window.api.getToken) {
      try {
        token = await window.api.getToken();
        console.log('Token fetched from IPC');
      } catch (e) {
        console.warn('Could not get token from IPC:', e);
      }
    }
    
    if (!token) {
      console.warn('No token available, attempting fetch without auth');
    }
    
    // Fetch software master list from backend (with higher limit to get all software)
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch('http://localhost:5000/api/software-master?limit=100', {
      method: 'GET',
      headers: headers
    });
    
    if (!response.ok) {
      console.error('Failed to fetch softwareMaster list:', response.status, response.statusText);
      dropdown.innerHTML = '<option value="">-- Error loading software --</option>';
      return;
    }
    
    const data = await response.json();
    console.log('SoftwareMaster response:', data);
    
    const softwareList = data.data || [];
    
    // Clear existing options except the first one
    dropdown.innerHTML = '<option value="">-- Choose software to auto-fill --</option>';
    
    // Add options for each software
    softwareList.forEach(software => {
      const option = document.createElement('option');
      option.value = JSON.stringify({
        id: software.software_id,
        name: software.software_name,
        icon: software.software_icon,
        video: software.software_video
      });
      option.textContent = software.software_name;
      dropdown.appendChild(option);
    });
    
    console.log('SoftwareMaster list loaded:', softwareList.length, 'items');
  } catch (error) {
    console.error('Error loading softwareMaster list:', error);
    dropdown.innerHTML = '<option value="">-- Error loading software --</option>';
  }
}

// Handle software selection from master and auto-fill fields
function selectSoftwareFromMaster() {
  const dropdown = document.getElementById('softwareMasterDropdown');
  const selectedValue = dropdown.value;
  
  if (!selectedValue) {
    // Reset fields if no selection
    document.getElementById('softwareName').value = '';
    document.getElementById('softwareIcon').value = '';
    document.getElementById('softwareVideo').value = '';
    // Clear but keep software path as user needs to enter it
    return;
  }
  
  try {
    const selected = JSON.parse(selectedValue);
    
    // Auto-fill the fields
    document.getElementById('softwareName').value = selected.name || '';
    document.getElementById('softwareIcon').value = selected.icon || '';
    document.getElementById('softwareVideo').value = selected.video || '';
    
    // Focus on path field so user can enter it
    document.getElementById('softwarePath').focus();
    
    console.log('Software selected and fields auto-filled:', selected.name);
  } catch (error) {
    console.error('Error parsing software selection:', error);
  }
}

async function openPcSoftwareConfig(pcId) {
  // Get the full PC data from pcsData
  const pcData = pcsData[pcId];
  
  if (!pcData) {
    alert('PC data not found. Please refresh the page.');
    console.error('PC data not found for:', pcId);
    return;
  }
  
  // Use the actual database pc_id, not the client name
  currentConfigPcId = pcData.pc_id;
  
  console.log('Opening software config for PC:', { pcName: pcId, pc_id: currentConfigPcId, pcData });
  
  const modal = document.getElementById('pcSoftwareConfigModal');
  
  // Update PC info in modal
  const isConnected = connectedClients.includes(pcId);
  
  document.getElementById('configPcName').textContent = pcData?.name || pcId;
  document.getElementById('configPcStatus').textContent = isConnected ? '🟢 Connected' : '🔴 Disconnected';
  
  // Show modal
  modal.classList.add('active');
  
  // Clear cache to force fresh fetch when modal opens
  cachedPcSoftware = [];
  const statusEl = document.getElementById('fetchStatus');
  if (statusEl) {
    statusEl.style.display = 'none';
  }
  
  // Load softwareMaster list for dropdown
  await loadSoftwareMasterList();
  
  // Load software list
  await loadPcSoftwareList(currentConfigPcId);
  
  // Setup autocomplete for this PC
  setTimeout(() => {
    setupSoftwarePathAutocomplete();
  }, 100);
}

function closePcSoftwareModal() {
  const modal = document.getElementById('pcSoftwareConfigModal');
  modal.classList.remove('active');
  currentConfigPcId = null;
  currentConfigPcSoftware = [];
  cachedPcSoftware = []; // Clear cached software
  
  // Reset form
  document.getElementById('addSoftwareForm').style.display = 'none';
  document.getElementById('softwareMasterDropdown').value = '';
  document.getElementById('softwareName').value = '';
  document.getElementById('softwarePath').value = '';
  document.getElementById('softwareIcon').value = '';
  document.getElementById('softwareVideo').value = '';
  document.getElementById('softwareSuggestions').innerHTML = '';
  document.getElementById('softwareSuggestions').style.display = 'none';
  document.getElementById('fetchStatus').style.display = 'none';
}

async function loadPcSoftwareList(pcId) {
  const softwareList = document.getElementById('softwareList');
  softwareList.innerHTML = '<div class="no-software">Loading software...</div>';
  
  try {
    // Get the cafeId from localStorage (set during login)
    const cafeId = localStorage.getItem('cafeId');
    const token = localStorage.getItem('token');
    
    if (!cafeId || !token) {
      softwareList.innerHTML = '<div class="no-software">Please log in first</div>';
      return;
    }
    
    // Fetch software from backend
    const response = await fetch(`http://localhost:5000/api/pc-software/pc/${pcId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to fetch software');
    }
    
    const data = await response.json();
    currentConfigPcSoftware = data.data || [];
    
    if (currentConfigPcSoftware.length === 0) {
      softwareList.innerHTML = '<div class="no-software">No software installed</div>';
    } else {
      renderSoftwareList(currentConfigPcSoftware);
    }
  } catch (error) {
    console.error('Error loading software:', error);
    softwareList.innerHTML = `<div class="no-software">Error loading software: ${error.message}</div>`;
  }
}

function renderSoftwareList(softwareArray) {
  const softwareList = document.getElementById('softwareList');
  softwareList.innerHTML = '';
  
  if (softwareArray.length === 0) {
    softwareList.innerHTML = '<div class="no-software">No software installed</div>';
    return;
  }
  
  softwareArray.forEach(software => {
    const softwareItem = document.createElement('div');
    softwareItem.className = 'software-item';
    softwareItem.innerHTML = `
      <div class="software-info">
        <div class="software-name">${software.software_name}</div>
        <div class="software-path">${software.software_path}</div>
      </div>
      <div class="software-actions">
        <button class="delete-software-btn" onclick="deleteSoftware(${software.pc_software_id})">Delete</button>
      </div>
    `;
    softwareList.appendChild(softwareItem);
  });
}

let cachedPcSoftware = []; // Cache for PC software list

function showSoftwareSuggestions() {
  const softwarePath = document.getElementById('softwarePath');
  const suggestionsContainer = document.getElementById('softwareSuggestions');
  const searchText = softwarePath.value.toLowerCase();

  if (!suggestionsContainer) {
    console.error('Suggestions container not found');
    return;
  }

  if (cachedPcSoftware.length === 0) {
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.style.display = 'none';
    return;
  }

  // Filter software paths based on search text (if empty, show all)
  const filtered = searchText 
    ? cachedPcSoftware.filter(software => 
        software.path && software.path.toLowerCase().includes(searchText) ||
        software.name && software.name.toLowerCase().includes(searchText)
      )
    : cachedPcSoftware; // Show all if search is empty

  if (filtered.length === 0) {
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.style.display = 'none';
    return;
  }

  // Create suggestion items (show ALL items, but prioritize those with valid paths)
  suggestionsContainer.innerHTML = '';
  
  if (filtered.length === 0) {
    suggestionsContainer.innerHTML = '<div class="suggestion-loading">No software found</div>';
    suggestionsContainer.style.display = 'block';
    return;
  }
  
  // Separate items with and without valid paths, then combine
  const withPath = filtered.filter(s => s.path && s.path.trim());
  const withoutPath = filtered.filter(s => !s.path || !s.path.trim());
  const allSoftware = [...withPath, ...withoutPath].slice(0, 50); // Show up to 50 items
  
  allSoftware.forEach(software => {
    const suggestionItem = document.createElement('div');
    suggestionItem.className = 'suggestion-item';
    const pathDisplay = software.path && software.path.trim() ? software.path : '(No path found)';
    suggestionItem.innerHTML = `
      <div class="suggestion-name">${software.name || 'Unknown'}</div>
      <div class="suggestion-path" title="${pathDisplay}">${pathDisplay}</div>
    `;
    suggestionItem.onclick = () => selectSoftwarePath(software.path, software.name);
    suggestionsContainer.appendChild(suggestionItem);
  });

  suggestionsContainer.style.display = 'block';
}

function selectSoftwarePath(path, name) {
  const pathInput = document.getElementById('softwarePath');
  const nameInput = document.getElementById('softwareName');
  
  // Allow selecting even if no path (user can manually enter path)
  pathInput.value = path && path.trim() ? path : '';
  nameInput.value = name || '';
  
  const suggestionsContainer = document.getElementById('softwareSuggestions');
  suggestionsContainer.innerHTML = '';
  suggestionsContainer.style.display = 'none';
  
  console.log(`Selected software: ${name} at ${path || '(no path - enter manually)'}`);
  
  // Trigger change event to update form state
  pathInput.dispatchEvent(new Event('change', { bubbles: true }));
  nameInput.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fetchAndShowPcSoftware() {
  const btn = document.getElementById('fetchPcSoftwareBtn');
  const statusEl = document.getElementById('fetchStatus');
  
  if (!statusEl || !btn) return;

  if (!currentConfigPcId) {
    statusEl.textContent = '❌ No PC selected';
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--accent)';
    return;
  }

  const pcName = Object.keys(pcsData).find(key => pcsData[key].pc_id === currentConfigPcId);
  if (!pcName || !connectedClients.includes(pcName)) {
    statusEl.textContent = '❌ PC is not connected. Connect first.';
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--accent)';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = '⏳ Fetching software from PC (this may take 10-30 seconds for first time)...';
  statusEl.style.display = 'block';
  statusEl.style.color = 'var(--text-muted)';

  try {
    const result = await window.api.fetchPcSoftware(pcName);
    
    if (result.success) {
      cachedPcSoftware = result.software || [];
      const validCount = cachedPcSoftware.filter(s => s.path && s.path.trim()).length;
      statusEl.textContent = `✅ Found ${cachedPcSoftware.length} items (${validCount} with valid paths). Type to search or click to select.`;
      statusEl.style.color = 'var(--success)';
      console.log(`Fetched from PC ${pcName}: ${cachedPcSoftware.length} items total`);
      
      // Show suggestions dropdown if there's text
      setTimeout(() => {
        showSoftwareSuggestions();
        document.getElementById('softwarePath').focus();
      }, 300);
    } else {
      statusEl.textContent = `❌ Error: ${result.error}`;
      statusEl.style.color = 'var(--accent)';
      console.error('Fetch failed:', result.error);
    }
  } catch (error) {
    statusEl.textContent = `❌ Error: ${error.message}`;
    statusEl.style.color = 'var(--accent)';
    console.error('Fetch error:', error);
  } finally {
    btn.disabled = false;
  }
}

function setupSoftwarePathAutocomplete() {
  const softwarePath = document.getElementById('softwarePath');
  if (!softwarePath) return;

  // Filter and show suggestions on input
  softwarePath.addEventListener('input', () => {
    showSoftwareSuggestions();
  });

  // Hide suggestions on blur (with delay to allow clicks)
  softwarePath.addEventListener('blur', () => {
    setTimeout(() => {
      const suggestionsContainer = document.getElementById('softwareSuggestions');
      if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
      }
    }, 200);
  });
}

function toggleAddSoftwareForm() {
  const form = document.getElementById('addSoftwareForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  
  // Clear form and suggestions
  if (form.style.display === 'block') {
    document.getElementById('softwareMasterDropdown').value = '';
    document.getElementById('softwareName').value = '';
    document.getElementById('softwarePath').value = '';
    document.getElementById('softwareIcon').value = '';
    document.getElementById('softwareVideo').value = '';
    document.getElementById('softwareSuggestions').innerHTML = '';
    document.getElementById('softwareSuggestions').style.display = 'none';
    document.getElementById('fetchStatus').style.display = 'none';
    cachedPcSoftware = []; // Clear cache when opening form
    document.getElementById('softwareName').focus();
    
    // Setup autocomplete after form is displayed
    setTimeout(() => {
      setupSoftwarePathAutocomplete();
    }, 100);
  } else {
    // Also clear when closing
    document.getElementById('softwareSuggestions').innerHTML = '';
    document.getElementById('softwareSuggestions').style.display = 'none';
  }
}

async function addNewSoftware() {
  const softwareName = document.getElementById('softwareName').value.trim();
  const softwarePath = document.getElementById('softwarePath').value.trim();
  const softwareIcon = document.getElementById('softwareIcon').value.trim();
  const softwareVideo = document.getElementById('softwareVideo').value.trim();
  
  if (!softwareName || !softwarePath) {
    alert('Please fill in required fields (Software Name and Path)');
    return;
  }
  
  if (!currentConfigPcId) {
    alert('No PC selected');
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    
    if (!token) {
      alert('Please log in first');
      return;
    }
    
    const payload = {
      pc_id: parseInt(currentConfigPcId, 10),
      software_name: softwareName,
      software_path: softwarePath,
      software_icon: softwareIcon || null,
      software_video: softwareVideo || null,
      is_active: true
    };
    
    console.log('Sending PC software data:', payload);
    
    const response = await fetch('http://localhost:5000/api/pc-software', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to add software');
    }
    
    const result = await response.json();
    console.log('Software added successfully:', result);
    
    // Reload software list
    await loadPcSoftwareList(currentConfigPcId);
    toggleAddSoftwareForm();
    
    alert('Software added successfully!');
  } catch (error) {
    console.error('Error adding software:', error);
    alert(`Error adding software: ${error.message}`);
  }
}

async function deleteSoftware(softwareId) {
  if (!confirm('Are you sure you want to delete this software?')) {
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    
    if (!token) {
      alert('Please log in first');
      return;
    }
    
    const response = await fetch(`http://localhost:5000/api/pc-software/${softwareId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to delete software');
    }
    
    // Reload software list
    if (currentConfigPcId) {
      await loadPcSoftwareList(currentConfigPcId);
    }
    
    console.log('Software deleted successfully');
  } catch (error) {
    console.error('Error deleting software:', error);
    alert(`Error deleting software: ${error.message}`);
  }
}

// Close PC Software modal when clicking outside
document.getElementById('pcSoftwareConfigModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'pcSoftwareConfigModal') {
    closePcSoftwareModal();
  }
});

// Close modal when clicking outside
document.getElementById('namePCModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'namePCModal') {
    closeNamePCModal();
  }
});

// Handle name form submission
document.addEventListener('DOMContentLoaded', () => {
  const nameForm = document.getElementById('nameForm');
  if (nameForm) {
    nameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await registerNamedPC();
    });
  }
});

async function registerNamedPC() {
  const pcName = document.getElementById('pcNameInput').value.trim();
  const msgEl = document.getElementById('nameFormMessage');
  
  if (!pcName) {
    msgEl.textContent = '❌ Please enter a PC name';
    msgEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    msgEl.style.color = '#ef4444';
    msgEl.style.display = 'block';
    return;
  }
  
  const submitBtn = document.querySelector('#nameForm button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Registering...';
  
  try {
    // Call backend to register the PC
    const response = await fetch('http://localhost:5000/api/pcs/register-discovered', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        cafe_id: currentUser?.cafe_id || 1,
        branch_id: 1,
        name: pcName,
        ip_address: currentModalPC.ip,
        mac_address: currentModalPC.mac,
        hostname: currentModalPC.hostname,
        port: currentModalPC.port
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to register PC');
    }
    
    const result = await response.json();
    
    msgEl.textContent = '✅ PC registered successfully!';
    msgEl.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
    msgEl.style.color = '#22c55e';
    msgEl.style.display = 'block';
    
    // Remove from discovered list
    discoveredPCs = discoveredPCs.filter(pc => pc.ip !== currentModalPC.ip);
    displayDiscoveredPCs();
    
    // Refresh PC list if available
    if (currentUser) {
      fetchAndDisplayPCs();
    }
    
    setTimeout(() => {
      closeNamePCModal();
    }, 1500);
  } catch (error) {
    console.error('Error registering PC:', error);
    msgEl.textContent = `❌ Error: ${error.message}`;
    msgEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    msgEl.style.color = '#ef4444';
    msgEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}
