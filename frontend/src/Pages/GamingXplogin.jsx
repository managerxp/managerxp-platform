import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, LogIn, Lock, Mail } from 'lucide-react';
import AuthLayout, { authFieldClasses, authLabelClasses } from '../components/AuthLayout';
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
    <AuthLayout
      title="Cafe Login"
      subtitle="Sign in to send this account's session to the CafeXP desktop app."
      footer={
        <>
          New to CafeXP?{' '}
          <Link to="/signup" className="text-white hover:text-red-400 underline underline-offset-4 transition-colors">
            Create an account
          </Link>
        </>
      }
    >
      <div aria-live="polite">
        {successMessage && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {successMessage}
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <form onSubmit={handleLogin} className="mt-5 space-y-4">
        <div>
          <label htmlFor="gxp-email" className={authLabelClasses}>
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-neutral-500" />
            <input
              id="gxp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              required
              className={`${authFieldClasses} pl-9`}
              placeholder="cafe@example.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="gxp-password" className={authLabelClasses}>
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-neutral-500" />
            <input
              id="gxp-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              required
              className={`${authFieldClasses} pl-9 pr-11`}
              placeholder="Enter password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={loading}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 hover:text-white transition-colors disabled:opacity-50"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <label htmlFor="gxp-remember" className="flex items-center gap-2 cursor-pointer select-none text-neutral-400 hover:text-neutral-300 transition-colors">
            <input
              id="gxp-remember"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/[0.03] accent-red-500 disabled:cursor-not-allowed"
            />
            Remember me
          </label>
          <Link
            to="/forgot-password"
            className="text-xs text-neutral-500 hover:text-red-400 underline underline-offset-4 transition-colors"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                     bg-gradient-to-br from-red-700 to-red-900 border border-white/10
                     py-2.5 text-sm font-semibold text-white
                     shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                     transition-all duration-300 active:scale-[0.99]
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Logging in...
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              Login
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  );
};

export default GamerXpLogin;
