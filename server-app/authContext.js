/**
 * Auth Context Module for ServerXP Desktop App
 * Manages authentication state including user_id, cafe_id, and token
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class AuthContext {
  constructor() {
    this.user = null;
    this.token = null;
    this.isAuthenticated = false;
    this.listeners = [];
    this.authFilePath = null;

    // Initialize file path
    this.initAuthFilePath();

    // Restore from file
    this.restoreFromStorage();
  }

  /**
   * Initialize the auth file path
   */
  initAuthFilePath() {
    try {
      const appUserDataPath = app.getPath('userData');
      this.authFilePath = path.join(appUserDataPath, 'auth.json');
    } catch (error) {
      // Fallback if app is not ready
      this.authFilePath = path.join(process.cwd(), '.auth.json');
    }
  }

  /**
   * Initialize auth context from stored data
   */
  restoreFromStorage() {
    try {
      if (!this.authFilePath) return;
      
      if (fs.existsSync(this.authFilePath)) {
        const data = fs.readFileSync(this.authFilePath, 'utf-8');
        const { user, token } = JSON.parse(data);
        /* Re-derived through setAuth rather than assigned straight across, so
           a session saved before the café was read from the token gains it on
           the next start instead of staying broken until a fresh sign-in. */
        if (token && user) {
          this.setAuth(user, token);
        } else {
          this.user = user || null;
          this.token = token || null;
          this.isAuthenticated = false;
        }
      }
    } catch (error) {
      console.error('Failed to restore auth from storage:', error);
      this.user = null;
      this.token = null;
      this.isAuthenticated = false;
    }
  }

  /**
   * Set authentication data from backend response
   * @param {Object} userData - User object from backend
   * @param {string} token - JWT token from backend
   */
  /**
   * Read the claims out of a JWT without verifying it.
   *
   * The backend verifies; this only needs to know what it was told. The token
   * is the better source for identity than the user object beside it: the
   * login response's `user` varies by which login path answered, while the
   * token's claims are what every guard on the server actually reads.
   */
  decodeToken(token) {
    try {
      const part = String(token).split('.')[1];
      if (!part) return {};
      const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        .toString('utf8');
      return JSON.parse(json) || {};
    } catch (error) {
      return {};
    }
  }

  setAuth(userData, token) {
    /*
     * The café comes from the token when the user object does not carry it.
     *
     * Café logins put `cafe_id` in the token but the `user` object that comes
     * back varies by login path — the admin branch returns only an email and a
     * role. Trusting the user object alone left the console signed in with no
     * café, so every station query bailed before it was sent and the floor
     * showed an empty room.
     */
    const claims = token ? this.decodeToken(token) : {};

    this.user = {
      id: userData.id || claims.id || claims.staff_id || null,
      user_id: userData.id || claims.id || claims.staff_id || null, // Alias for compatibility
      email: userData.email || claims.email,
      name: userData.name || claims.name,
      phone_number: userData.phone_number,
      address: userData.address,
      role: userData.role || claims.role,
      cafe_id: userData.cafe_id || claims.cafe_id || null,
      created_at: userData.created_at
    };
    
    this.token = token;
    this.isAuthenticated = true;

    // Persist to localStorage
    this.saveToStorage();
    
    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Clear authentication data
   */
  clearAuth() {
    this.user = null;
    this.token = null;
    this.isAuthenticated = false;
    
    // Clear from file
    if (this.authFilePath) {
      try {
        if (fs.existsSync(this.authFilePath)) {
          fs.unlinkSync(this.authFilePath);
        }
      } catch (error) {
        console.error('Failed to clear auth file:', error);
      }
    }
    
    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Get current user
   * @returns {Object|null} Current user object or null
   */
  getUser() {
    return this.user;
  }

  /**
   * Get user ID
   * @returns {string|null} User ID or null
   */
  getUserId() {
    return this.user?.id || null;
  }

  /**
   * Get cafe ID for current user
   * @returns {string|null} Cafe ID or null
   */
  /*
   * The café this console works for, as claimed by the token.
   *
   * Deliberately not choosable here. An earlier attempt let the operator pick
   * from a list of cafés when the account named none — which meant showing one
   * café's staff the names of every other café on the platform, and let a
   * console point itself at books it had no business opening. Which café a
   * console serves follows from who signed in, and nothing else.
   */
  getCafeId() {
    return this.user?.cafe_id || null;
  }

  /**
   * Get current token
   * @returns {string|null} JWT token or null
   */
  getToken() {
    return this.token;
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} Authentication status
   */
  isLoggedIn() {
    return this.isAuthenticated && !!this.token && !!this.user;
  }

  /**
   * Verify token with backend
   * @param {string} backendUrl - Backend API URL
   * @returns {Promise<boolean>} Token validity
   */
  async verifyToken(backendUrl = 'http://localhost:5000') {
    if (!this.token) {
      return false;
    }

    try {
      const response = await fetch(`${backendUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data.user) {
          // Update user data from backend
          this.setAuth(data.data.user, this.token);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Token verification error:', error);
      return false;
    }
  }

  /**
   * Save auth data to file
   */
  saveToStorage() {
    if (!this.authFilePath) return;
    
    try {
      const dir = path.dirname(this.authFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.authFilePath, JSON.stringify({
        user: this.user,
        token: this.token
      }, null, 2));
    } catch (error) {
      console.error('Failed to save auth to storage:', error);
    }
  }

  /**
   * Subscribe to auth changes
   * @param {Function} callback - Function to call on auth change
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  /**
   * Notify all listeners of auth changes
   */
  notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener({
          user: this.user,
          token: this.token,
          isAuthenticated: this.isAuthenticated
        });
      } catch (error) {
        console.error('Error in auth listener:', error);
      }
    });
  }

  /**
   * Get full auth state
   * @returns {Object} Complete auth state
   */
  getAuthState() {
    return {
      user: this.user,
      token: this.token,
      isAuthenticated: this.isAuthenticated,
      userId: this.user?.id || null,
      cafeId: this.getCafeId(),
      userEmail: this.user?.email || null,
      userRole: this.user?.role || null
    };
  }

  /**
   * Update user data (e.g., after profile update)
   * @param {Object} updatedUserData - Updated user data from backend
   */
  updateUser(updatedUserData) {
    if (this.user) {
      this.user = {
        ...this.user,
        ...updatedUserData
      };
      this.saveToStorage();
      this.notifyListeners();
    }
  }
}

// Create singleton instance
const authContext = new AuthContext();

module.exports = authContext;
