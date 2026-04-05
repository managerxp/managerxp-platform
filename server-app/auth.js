const BACKEND_URL = 'http://localhost:5000/api/auth';

class AuthManager {
  constructor() {
    this.user = null;
    this.token = null;
    this.loadFromStorage();
  }

  // Load user and token from localStorage
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('auth');
      if (stored) {
        const auth = JSON.parse(stored);
        this.user = auth.user;
        this.token = auth.token;
        return true;
      }
    } catch (error) {
      console.error('Error loading auth:', error);
    }
    return false;
  }

  // Save user and token to localStorage
  saveToStorage() {
    try {
      localStorage.setItem('auth', JSON.stringify({
        user: this.user,
        token: this.token
      }));
    } catch (error) {
      console.error('Error saving auth:', error);
    }
  }

  // Login user - takes email and password
  async login(email, password) {
    try {
      const response = await fetch(`${BACKEND_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      if (data.success && data.data) {
        this.user = data.data.user;
        this.token = data.data.token;
        this.saveToStorage();
        return {
          success: true,
          user: this.user,
          token: this.token
        };
      }

      throw new Error(data.message || 'Invalid response from server');
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Logout user
  logout() {
    this.user = null;
    this.token = null;
    localStorage.removeItem('auth');
  }

  // Check if user is authenticated
  isAuthenticated() {
    return this.user !== null && this.token !== null;
  }

  // Get current user
  getUser() {
    return this.user;
  }

  // Get token
  getToken() {
    return this.token;
  }
}

// Export for use in renderer
const authManager = new AuthManager();
