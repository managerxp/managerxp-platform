import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import whiteLogo from '../assets/whitelogo.png';
import { useAuth } from '../context/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const GamerXpLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const { login: authLogin, staffLogin } = useAuth();

  // Send token to electron app
  const sendTokenToElectron = (token, user) => {
    try {
      // Send token to electron via HTTP endpoint — a local IPC bridge on this
      // same machine, not the backend API, so it stays on localhost
      // regardless of environment.
      fetch('http://localhost:3334/auth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: token,
          user: user
        })
      })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            console.log('Token successfully sent to electron app');
          } else {
            console.error('Failed to send token:', data.message);
          }
        })
        .catch(error => {
          console.error('Error sending token to electron:', error);
        });
    } catch (err) {
      console.error('Error in sendTokenToElectron:', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Validate inputs
      if (!email || !password) {
        setError('Please fill in all fields');
        setLoading(false);
        return;
      }

      /*
       * Two kinds of account sign in at this door, and they live in different
       * tables: the cafe owner in `users`, their staff in `staff`. The owner
       * endpoint is tried first, and a rejection there falls through to the
       * staff endpoint rather than being reported as a bad password — a
       * cashier typing correct credentials was previously just told
       * "Invalid credentials".
       */
      const credentials = { email: email.trim(), password };

      const attempt = async (path) => {
        const res = await fetch(`${API_BASE_URL}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials)
        });
        return { ok: res.ok, body: await res.json() };
      };

      let kind = 'owner';
      let attemptResult = await attempt('/api/auth/login');

      if (!attemptResult.ok || !attemptResult.body?.success) {
        const staffAttempt = await attempt('/api/staff/login');
        if (staffAttempt.ok && staffAttempt.body?.success) {
          kind = 'staff';
          attemptResult = staffAttempt;
        }
      }

      const data = attemptResult.body;

      if (!attemptResult.ok || !data?.success) {
        setError(data?.message || 'Login failed. Please try again.');
        setLoading(false);
        return;
      }

      if (data.success && data.data) {
        // A staff record carries staff_name/role_name; present it in the shape
        // the rest of this screen already reads.
        const token = data.data.token;
        const user = kind === 'staff'
          ? {
              ...data.data.staff,
              name: data.data.staff?.staff_name,
              role: data.data.staff?.role_name,
              permissions: data.data.permissions || []
            }
          : data.data.user;

        // Store auth data in context and localStorage
        if (kind === 'staff' && staffLogin) {
          await staffLogin(credentials);
        } else if (authLogin) {
          await authLogin({ email, password });
        } else {
          localStorage.setItem('auth_token', token);
          localStorage.setItem('auth_user', JSON.stringify(user));
        }

        // Remember me functionality
        if (rememberMe) {
          localStorage.setItem('remember_email', email);
        } else {
          localStorage.removeItem('remember_email');
        }

        // Send token to electron app (server app)
        sendTokenToElectron(token, user);

        // Show success message
        // Some staff names already carry the role, so only add it when it is
        // not already there — otherwise you get "Priya (Cashier) (Cashier)".
        const who = user.name || user.email;
        const roleSuffix =
          kind === 'staff' && user.role &&
          !who.toLowerCase().includes(String(user.role).toLowerCase())
            ? ` (${user.role})`
            : '';
        setSuccessMessage(
          `Welcome ${who}${roleSuffix}! Token sent to Server App. You can close this window.`
        );
        console.log('Login successful for:', user.name || user.email);
        
        // Reset form
        setEmail('');
        setPassword('');
        setLoading(false);
      } else {
        setError('Login failed. Please check your credentials.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred. Please check if the server is running.');
      setLoading(false);
    }
  };

  // Load remembered email on component mount
  React.useEffect(() => {
    const rememberedEmail = localStorage.getItem('remember_email');
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-body relative overflow-hidden">
      
      {/* --- Background Ambient Effects --- */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-red-600/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-red-600/5 rounded-full blur-3xl"></div>
        {/* Grid Pattern */}
        <div 
            className="absolute inset-0 opacity-10" 
            style={{ backgroundImage: 'linear-gradient(rgba(255,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,0,0,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        ></div>
      </div>

      {/* --- Login Card Container --- */}
      <div className="relative z-10 w-full max-w-md">
        
        {/* Logo Component */}
        <div className="flex justify-center mb-6">
          <img src={whiteLogo} alt="GamerXp Logo" className="h-16 w-auto" />
        </div>

        {/* --- Main Card --- */}
        <div className="relative bg-[#0a0a0a]/80 backdrop-blur-xl border border-[#1a1a1a] rounded-2xl shadow-2xl p-8 overflow-hidden">
          
          {/* Header */}
          <div className="text-center mb-10">
            <h2 className="text-3xl font-display font-bold text-white mb-2 tracking-wide">
              CAFE LOGIN
            </h2>
            <p className="text-gray-500 text-sm">
              Enter the arena. Start your session.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-6">
            
            {/* Success Message */}
            {successMessage && (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm animate-pulse">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{successMessage}</span>
                </div>
              </div>
            )}
            
            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm animate-pulse">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{error}</span>
                </div>
              </div>
            )}
            
            {/* Email Input Group */}
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-transparent opacity-0 group-hover:opacity-20 blur-sm transition duration-300 rounded-lg"></div>
              <div className="relative">
                <label className="block text-xs font-bold text-red-500 uppercase tracking-widest mb-2 ml-1">
                  Email ID
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500 group-hover:text-red-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"></path></svg>
                  </span>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="w-full bg-[#111111] text-white placeholder-gray-600 border border-[#222] focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 rounded-lg py-3.5 pl-12 pr-4 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="cafe@example.com"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Password Input Group */}
            <div className="relative group">
              <div className="relative">
                <label className="block text-xs font-bold text-red-500 uppercase tracking-widest mb-2 ml-1">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500 group-hover:text-red-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                  </span>
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="w-full bg-[#111111] text-white placeholder-gray-600 border border-[#222] focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 rounded-lg py-3.5 pl-12 pr-12 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Enter password"
                    required
                  />
                  {/* Toggle Password Visibility */}
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-500 hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {showPassword ? (
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
                    ) : (
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Options Row */}
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center space-x-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  className="form-checkbox bg-[#111] border-[#333] text-red-500 rounded focus:ring-red-500 focus:ring-offset-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" 
                />
                <span className="text-gray-500 group-hover:text-gray-300 transition-colors">Remember Me</span>
              </label>
              <Link to="/forgot-password" className="text-red-500 hover:text-red-400 font-semibold transition-colors hover:underline">
                Forgot Password?
              </Link>
            </div>

            {/* Login Button */}
            <div className="pt-4">
              <button 
                type="submit"
                disabled={loading}
                className="relative w-full group overflow-hidden bg-red-600 text-white font-display font-bold uppercase tracking-widest py-4 rounded-lg transition-all duration-300 hover:bg-red-500 shadow-lg shadow-red-600/20 hover:shadow-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
              >
                <span className="relative z-10 flex items-center justify-center gap-3">
                  {loading ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Logging in...
                    </>
                  ) : (
                    <>
                      Login to Arena
                      <svg className="w-5 h-5 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                    </>
                  )}
                </span>
              </button>
            </div>

          </form>

          {/* Footer */}
          <div className="mt-8 text-center text-sm text-gray-600 border-t border-[#1a1a1a] pt-6">
            New to the cafe?{' '}
            <a href="#" className="text-red-500 font-bold hover:text-red-400 transition-colors">
              Create Account
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GamerXpLogin;