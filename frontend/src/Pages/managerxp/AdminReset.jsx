import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../lib/adminApi';
import { Button, Field, Input, Banner } from '../../components/admin/ui';
import AuthLayout from '../../components/AuthLayout';

/*
 * Where an administrator's setup link lands.
 *
 * Public by necessity — the person using it cannot sign in yet, which is the
 * whole reason they are here. The token in the URL is the credential, and the
 * server checks it against a stored hash with a 24-hour expiry.
 *
 * The minimum is ten characters rather than the customer-facing eight: this
 * password opens every customer's account, not one.
 */
const AdminReset = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setNotice(null);
    if (password.length < 10) {
      return setNotice({ tone: 'bad', text: 'Use a password of at least 10 characters' });
    }
    if (password !== confirm) {
      return setNotice({ tone: 'bad', text: 'Those passwords do not match' });
    }

    setBusy(true);
    try {
      await adminApi.resetPassword(token, password);
      setDone(true);
      /* Straight to the sign-in page. Asking someone to find it themselves
         after they have just proved who they are is a step for nobody. */
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
      setBusy(false);
    }
  };

  /* Same shell as /login. This is an auth page — no session, choosing a
     password — so it should look like one rather than like a stray console
     screen that happens to be public. */
  const copy = !token
    ? {
        title: 'This link is incomplete',
        subtitle: 'The token is missing from the address. Ask whoever sent it to send the whole link, including everything after the question mark.'
      }
    : done
      ? { title: 'Password set', subtitle: 'Taking you to the sign-in page.' }
      : {
          title: 'Choose your password',
          subtitle: 'This account can see and change every ManagerXP customer, so pick something you do not use anywhere else.'
        };

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        !token && (
          <Link to="/login" className="text-white underline underline-offset-4 transition-colors hover:text-red-400">
            Back to sign in
          </Link>
        )
      }
    >
      {token && !done && (
        <>
          <div aria-live="polite">
            {notice && <div className="mt-4"><Banner tone={notice.tone}>{notice.text}</Banner></div>}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Password" id="ar-pass" hint="At least 10 characters">
              <Input id="ar-pass" type="password" value={password} autoFocus
                     autoComplete="new-password"
                     onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password" id="ar-confirm">
              <Input id="ar-confirm" type="password" value={confirm}
                     autoComplete="new-password"
                     onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Setting…' : 'Set password'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
};

export default AdminReset;
