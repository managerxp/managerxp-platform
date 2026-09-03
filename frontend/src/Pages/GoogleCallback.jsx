import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';

/*
 * Where the browser lands after Google sends it back through the backend.
 *
 * The backend put the app's token and a compact user object in the URL
 * *fragment* (`#token=…&user=…`) — a fragment the server never sees. This page
 * reads them, hands them to the auth context, wipes them out of the address bar
 * so a shared link or the back button cannot replay a session, and moves on to
 * the dashboard.
 */
const GoogleCallback = () => {
  const navigate = useNavigate();
  const { completeGoogleLogin } = useAuth();
  const [error, setError] = useState('');
  // Guard against React's double-invoke in dev running this twice.
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const rawUser = params.get('user');

    // Clear the fragment immediately, whatever happens next.
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setError('Google sign-in did not complete. Please try again.');
      return;
    }

    try {
      let user = null;
      if (rawUser) {
        // base64 → JSON. atob handles the standard alphabet the backend used.
        user = JSON.parse(decodeURIComponent(escape(atob(rawUser))));
      }
      completeGoogleLogin(token, user);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError('Could not read the sign-in response. Please try again.');
    }
  }, [completeGoogleLogin, navigate]);

  return (
    <AuthLayout title="Signing you in" subtitle="Finishing your Google sign-in">
      {error ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-neutral-300">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-sm font-semibold text-red-400 underline underline-offset-4 hover:text-red-300"
          >
            Back to login
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-neutral-400">
          <Loader2 className="h-7 w-7 animate-spin text-red-400" />
          <p className="text-sm">One moment…</p>
        </div>
      )}
    </AuthLayout>
  );
};

export default GoogleCallback;
