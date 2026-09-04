import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthLayout, { authFieldClasses, authLabelClasses } from '../components/AuthLayout';
import VerifyEmailStep from '../components/VerifyEmailStep';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, verifyEmail, resendVerification, isLoading } = useAuth();

  /* Set only when a login attempt is refused for an unverified address —
     switches the card over to the code step in place, rather than sending
     the person to a different page mid-attempt. */
  const [pendingVerification, setPendingVerification] = useState(null); // { email } | null

  /* Signup sends the new account's address through so it is already filled in
     — the one field somebody has definitely just typed correctly, and asking
     for it twice in ten seconds is a step that serves nobody. */
  const [form, setForm] = useState({
    email: location.state?.email || '',
    password: '',
  });
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  /* Where the browser goes to start a Google sign-in — the backend endpoint,
     which redirects on to Google's consent screen. The page's own origin
     rides along so the backend can send the browser back to wherever it
     actually came from (this machine, or another one's LAN IP) instead of
     a single fixed address from .env. */
  const API_BASE = import.meta.env.VITE_API_URL;
  const googleUrl = `${API_BASE}/api/auth/google?origin=${encodeURIComponent(window.location.origin)}`;

  /* A failed Google sign-in comes back to /login?error=<code>. Turn the code
     into something a person can read; anything unmapped gets a safe generic. */
  const googleError = (() => {
    const code = new URLSearchParams(location.search).get('error');
    if (!code) return '';
    return {
      google_not_configured: 'Google sign-in is not set up on this server yet.',
      google_denied: 'Google sign-in was cancelled.',
      google_email_unverified: 'That Google account has no verified email, so it cannot be used to sign in.',
      google_state_invalid: 'That Google sign-in link has expired. Please try again.'
    }[code] || 'Google sign-in could not be completed. Please try again.';
  })();
  /* Held in state rather than read from location on every render, so it
     survives a failed sign-in attempt clearing the error beneath it. */
  const [notice] = useState(location.state?.notice || '');

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      /* One form, two kinds of account. The server says which this is; the
         person signing in never had to choose, and there is no second login
         page to end up on the wrong one of. */
      const result = await signIn(form);

      /* ProtectedRoute stores a location object; the shells store a plain
         path. Both mean "put me back where I was trying to go" — but only if
         that destination belongs to the principal who just signed in. An
         administrator returning to a café owner's page, or the reverse, would
         bounce straight back here. */
      const state = location.state?.from;
      const from = typeof state === 'string' ? state : state?.pathname;
      const isAdminPath = from?.startsWith('/admin');

      if (from && isAdminPath === (result.kind === 'admin')) {
        navigate(from, { replace: true });
        return;
      }

      navigate(result.kind === 'admin' ? '/admin' : '/dashboard', { replace: true });
    } catch (err) {
      if (err.data?.verification_required) {
        setPendingVerification({ email: err.data.email || form.email });
        return;
      }
      setError(err.message || 'Unable to login');
    }
  };

  /* The password is still sitting in state from the attempt that got
     refused, so verifying the code can walk straight back into signing in
     rather than making the person type it a second time. */
  const onVerified = async () => {
    const result = await signIn(form);
    setPendingVerification(null);
    navigate(result.kind === 'admin' ? '/admin' : '/dashboard', { replace: true });
  };

  if (pendingVerification) {
    return (
      <AuthLayout
        title="Verify your email"
        subtitle="One more step before you can sign in"
        footer={
          <button
            type="button"
            onClick={() => setPendingVerification(null)}
            className="text-white hover:text-red-400 underline underline-offset-4 transition-colors"
          >
            Back to sign in
          </button>
        }
      >
        <VerifyEmailStep
          email={pendingVerification.email}
          sent={false}
          verify={(code) => verifyEmail(pendingVerification.email, code)}
          resend={() => resendVerification(pendingVerification.email)}
          onVerified={onVerified}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Login"
      subtitle="Sign in to your ManagerXP account"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="text-white hover:text-red-400 underline underline-offset-4 transition-colors">
            Create one
          </Link>
        </>
      }
    >
      <div aria-live="polite">
        {notice && !error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </div>
        )}
        {(error || googleError) && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error || googleError}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="email" className={authLabelClasses}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={onChange}
            required
            autoComplete="email"
            className={authFieldClasses}
            placeholder="name@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className={authLabelClasses}>
              Password
            </label>
            <Link
              to="/forgot-password"
              className="text-xs text-neutral-500 hover:text-red-400 underline underline-offset-4 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={onChange}
              required
              autoComplete="current-password"
              className={`${authFieldClasses} pr-11`}
              placeholder="Enter your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                     bg-gradient-to-br from-red-700 to-red-900 border border-white/10
                     py-2.5 text-sm font-semibold text-white
                     shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                     transition-all duration-300 active:scale-[0.99]
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              Login
            </>
          )}
        </button>
      </form>

      {/* Google sign-in. A plain link, not a fetch: OAuth is a full-page
          navigation to Google and back, so the browser must actually leave. */}
      <div className="relative my-5 flex items-center">
        <div className="flex-grow border-t border-white/10" />
        <span className="mx-3 text-[11px] font-medium uppercase tracking-wider text-neutral-500">or</span>
        <div className="flex-grow border-t border-white/10" />
      </div>
      <a
        href={googleUrl}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03]
                   py-2.5 text-sm font-semibold text-neutral-200 transition-colors
                   hover:border-white/20 hover:bg-white/[0.06] active:scale-[0.99]"
      >
        <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C33.6 6.1 29.1 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C33.6 6.1 29.1 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5 0 9.5-1.9 12.9-5l-6-5c-2 1.4-4.5 2.2-6.9 2.2-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6 5C40.9 36.7 44 31 44 24c0-1.3-.1-2.3-.4-3.5z"/>
        </svg>
        Continue with Google
      </a>
    </AuthLayout>
  );
};

export default Login;
