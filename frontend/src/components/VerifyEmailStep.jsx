import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { authFieldClasses, authLabelClasses } from './AuthLayout';

/*
 * The code-entry step shared by Login and Signup — whichever screen an
 * unverified address is caught at, typing the six digits back looks and
 * behaves identically. `verify`/`resend` are handed in rather than called
 * directly, since Login talks to the café-owner endpoints and the client app
 * would talk to the customer ones; this component only knows about the shape
 * of the code, never which principal it belongs to.
 */
const VerifyEmailStep = ({ email, verify, resend, onVerified, sent = true }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(sent ? `We sent a six-digit code to ${email}.` : '');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit code');
      return;
    }
    setVerifying(true);
    try {
      await verify(code.trim());
      await onVerified();
    } catch (err) {
      setError(err.message || 'Could not verify that code');
    } finally {
      setVerifying(false);
    }
  };

  const onResend = async () => {
    setError('');
    setResending(true);
    try {
      await resend();
    } finally {
      // Resend is deliberately generic server-side — this can't tell whether
      // it actually found an account to send to, so it never claims to.
      setNotice('A new code is on its way, if that address needs verifying.');
      setResending(false);
    }
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-neutral-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <span>
          Enter the six-digit code sent to <strong className="text-white">{email}</strong> to finish
          setting up this account.
        </span>
      </div>

      <div aria-live="polite">
        {notice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="otp-code" className={authLabelClasses}>
            Verification code
          </label>
          <input
            id="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`${authFieldClasses} text-center text-lg tracking-[0.5em]`}
            placeholder="000000"
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={verifying}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                     bg-gradient-to-br from-red-700 to-red-900 border border-white/10
                     py-2.5 text-sm font-semibold text-white
                     shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                     transition-all duration-300 active:scale-[0.99]
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {verifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify email'
          )}
        </button>
      </form>

      <button
        type="button"
        onClick={onResend}
        disabled={resending}
        className="w-full text-center text-xs text-neutral-500 hover:text-red-400 underline underline-offset-4 transition-colors disabled:opacity-60"
      >
        {resending ? 'Sending...' : "Didn't get a code? Resend"}
      </button>
    </div>
  );
};

export default VerifyEmailStep;
