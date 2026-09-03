import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { portalApi, portalAuth } from '../lib/portalApi';
import { Button, Field, Input, Banner } from '../components/portal/ui';

/*
 * Accepting an invitation.
 *
 * The token arrives in the link the owner copied out of Users & Staff. It is
 * the only proof this person was invited, so it is never typed — if it is
 * missing from the URL there is nothing to salvage and the page says so
 * instead of offering a form that cannot succeed.
 *
 * Setting a password and signing in are the same action here. Making someone
 * choose a password and then immediately type it again on a login screen adds
 * a step that only serves the implementation.
 */
const AcceptInvite = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) return setError('Use a password of at least 8 characters');
    if (password !== confirm) return setError('Those passwords do not match');

    setSaving(true);
    try {
      const data = await portalApi.acceptInvite(token, password);
      portalAuth.setToken(data.token);
      if (data.organization_id) portalAuth.setOrganization(data.organization_id);
      portalAuth.setBranch('all');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-red-500 text-sm font-black text-white">XP</span>
          <span className="text-xl font-semibold tracking-tight text-white">CafeXP</span>
        </Link>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-7">
          {!token ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight text-white">This link is incomplete</h1>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                The invitation code is missing from the address. Ask whoever invited you to send
                the link again — copying the whole thing, including everything after the question mark.
              </p>
              <Link to="/login" className="mt-6 inline-block text-sm text-red-400 hover:text-red-300">
                Sign in instead
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight text-white">Set your password</h1>
              <p className="mt-1.5 text-sm text-neutral-400">
                You have been invited to a CafeXP account. Choose a password and you are in.
              </p>

              {error && <div className="mt-5"><Banner tone="bad">{error}</Banner></div>}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <Field label="Password" id="ai-pass" required hint="At least 8 characters">
                  <Input id="ai-pass" type="password" value={password}
                         onChange={(e) => setPassword(e.target.value)}
                         autoComplete="new-password" autoFocus />
                </Field>
                <Field label="Confirm password" id="ai-confirm" required>
                  <Input id="ai-confirm" type="password" value={confirm}
                         onChange={(e) => setConfirm(e.target.value)}
                         autoComplete="new-password" />
                </Field>
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? 'Setting up…' : 'Accept invitation'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AcceptInvite;
