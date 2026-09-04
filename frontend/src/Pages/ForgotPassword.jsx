import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, KeyRound } from 'lucide-react';
import AuthLayout, { authFieldClasses, authLabelClasses } from '../components/AuthLayout';

const API_BASE_URL = import.meta.env.VITE_API_URL;

/*
 * One page for both a café owner and a customer — a single door, the same
 * way /login already is. Whoever lands here typed their own email; the
 * backend works out which table (or both) it belongs to, and the response is
 * identical either way, so this page never has to ask "which kind of account
 * are you" or leak whether the address exists.
 *
 * A code rather than a link, because the account this restores access to is
 * as often reached from a shared station as from a personal one — six digits
 * are simple to type there.
 */
const ForgotPassword = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState('email'); // 'email' | 'reset' | 'done'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [devCode, setDevCode] = useState(''); // only ever populated when mail is unconfigured

  const post = async (path, body) => {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Something went wrong. Please try again.');
    }
    return data;
  };

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await post('/api/account/forgot-password', { email: email.trim().toLowerCase() });
      setNotice('If that email has an account, a 6-digit code is on its way. It expires in 10 minutes.');
      setDevCode(data?.data?.otp_debug || '');
      setStep('reset');
    } catch (err) {
      // The backend itself never reveals whether the email exists — a thrown
      // error here means the request didn't reach it at all.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(otp.trim())) {
      return setError('Enter the 6-digit code from your email');
    }
    if (password.length < 8) {
      return setError('Use a password of at least 8 characters');
    }
    if (password !== confirm) {
      return setError('Those passwords do not match');
    }

    setBusy(true);
    try {
      await post('/api/account/reset-password', {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
        password
      });
      setStep('done');
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setBusy(true);
    try {
      const data = await post('/api/account/forgot-password', { email: email.trim().toLowerCase() });
      setNotice('A new code is on its way.');
      setDevCode(data?.data?.otp_debug || '');
      setOtp('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={
        step === 'email' ? 'Forgot your password?'
        : step === 'reset' ? 'Enter the code'
        : 'Password changed'
      }
      subtitle={
        step === 'email'
          ? 'Enter the email on your account — café owner or customer, either works here.'
        : step === 'reset'
          ? `Check ${email} for a 6-digit code, then choose a new password.`
        : 'Taking you to the sign-in page.'
      }
      footer={
        <Link to="/login" className="text-white underline underline-offset-4 transition-colors hover:text-red-400">
          Back to sign in
        </Link>
      }
    >
      <div aria-live="polite">
        {notice && !error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {/* Only appears when the server has no mail transport configured —
            an operator setting this up for the first time is not locked out
            of their own console over a missing SMTP setting. */}
        {devCode && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 font-mono">
            Email is not configured on this server. Your code: <strong>{devCode}</strong>
          </div>
        )}
      </div>

      {step === 'email' && (
        <form onSubmit={requestCode} className="mt-5 space-y-4">
          <div>
            <label htmlFor="fp-email" className={authLabelClasses}>Email</label>
            <input
              id="fp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              className={authFieldClasses}
              placeholder="name@example.com"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                       bg-gradient-to-br from-red-700 to-red-900 border border-white/10
                       py-2.5 text-sm font-semibold text-white
                       shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                       transition-all duration-300 active:scale-[0.99]
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><KeyRound className="w-4 h-4" /> Send reset code</>}
          </button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={submitReset} className="mt-5 space-y-4">
          <div>
            <label htmlFor="fp-otp" className={authLabelClasses}>6-digit code</label>
            <input
              id="fp-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              required
              className={`${authFieldClasses} text-center text-lg tracking-[0.5em] font-mono`}
              placeholder="000000"
            />
          </div>

          <div>
            <label htmlFor="fp-pass" className={authLabelClasses}>New password</label>
            <div className="relative">
              <input
                id="fp-pass"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={`${authFieldClasses} pr-11`}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="fp-confirm" className={authLabelClasses}>Confirm password</label>
            <input
              id="fp-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className={authFieldClasses}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                       bg-gradient-to-br from-red-700 to-red-900 border border-white/10
                       py-2.5 text-sm font-semibold text-white
                       shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                       transition-all duration-300 active:scale-[0.99]
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Changing…</> : 'Change password'}
          </button>

          <button
            type="button"
            onClick={resend}
            disabled={busy}
            className="w-full text-center text-xs text-neutral-500 hover:text-white transition-colors disabled:opacity-50"
          >
            Didn't get a code? Send another
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Password changed. Redirecting to sign in…
        </div>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;
