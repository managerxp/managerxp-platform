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
        this.user = user;
        this.token = token;
        this.isAuthenticated = !!token && !!user;
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
  setAuth(userData, token) {
    this.user = {
      id: userData.id,
      user_id: userData.id, // Alias for compatibility
      email: userData.email,
      name: userData.name,
      phone_number: userData.phone_number,
      address: userData.address,
      role: userData.role,
      cafe_id: userData.cafe_id || null,
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
      cafeId: this.user?.cafe_id || null,
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
