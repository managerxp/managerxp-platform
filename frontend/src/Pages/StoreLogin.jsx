import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthLayout, { authFieldClasses, authLabelClasses } from '../components/AuthLayout';

/**
 * Store sign-in — for a café's own staff.
 *
 * Deliberately a separate door from /login. That page authenticates the person
 * who owns the ManagerXP account against `users`; this one authenticates a
 * cashier or attendant against `staff`, and the token it returns carries the
 * permission list their role was granted.
 */
const StoreLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { staffLogin, isLoading } = useAuth();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await staffLogin(form);
      const from = location.state?.from?.pathname;
      navigate(from || '/store', { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    }
  };

  return (
    <AuthLayout
      title="Store sign in"
      subtitle="For café staff: cashiers, attendants and managers"
      footer={
        <>
          Own the account?{' '}
          <Link
            to="/login"
            className="text-white hover:text-red-400 underline underline-offset-4 transition-colors"
          >
            Sign in as the owner
          </Link>
        </>
      }
    >
      <div aria-live="polite">
        {error && (
          <div className="mt-4 flex items-center gap-2 border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="staffEmail" className={authLabelClasses}>
            Work email
          </label>
          <input
            id="staffEmail"
            name="email"
            type="email"
            value={form.email}
            onChange={onChange}
            required
            autoComplete="email"
            className={authFieldClasses}
            placeholder="priya@yourcafe.local"
          />
        </div>

        <div>
          <label htmlFor="staffPassword" className={authLabelClasses}>
            Password
          </label>
          <div className="relative">
            <input
              id="staffPassword"
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
              className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-400 hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden
                     bg-signal-deep hover:bg-signal-press
                     py-3.5 text-[15px] font-semibold text-white
                     transition-colors duration-150 active:translate-y-px
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <Store className="w-4 h-4" />
              Sign in to the store
            </>
          )}
        </button>

        <p className="text-xs text-neutral-400 leading-relaxed">
          Your account is created by the café owner, and what you can reach depends
          on the role they gave you. Ask them if you need more access.
        </p>
      </form>
    </AuthLayout>
  );
};

export default StoreLogin;
