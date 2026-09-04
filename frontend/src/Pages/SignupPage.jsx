import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Rocket } from 'lucide-react';
import { portalApi, portalAuth } from '../lib/portalApi';
import { adminAuth } from '../lib/adminApi';
import { useAuth } from '../context/AuthContext';
import { COUNTRIES, countryByCode, flagOf, joinPhone } from '../lib/geo';
import AuthLayout, { authFieldClasses, authLabelClasses, ConsentCheckbox } from '../components/AuthLayout';
import LocationSelector from '../components/LocationSelector';
import VerifyEmailStep from '../components/VerifyEmailStep';

/*
 * Sign up — one page, whether the visitor arrived at /signup or /start-trial.
 *
 * There used to be two: a plain account signup and a trial signup, which meant
 * a customer could create an account owning no business and then wonder why
 * the product was empty. Every route now lands here, and every signup creates
 * the account, the business, the first branch and the trial together.
 *
 * It wears AuthLayout, the same shell as /login — same card, same HUD strip,
 * same field and button treatment. Somebody moving between the two pages is
 * looking at one product, and the styling is imported from there rather than
 * copied, so it cannot drift.
 *
 * Two steps, not one long form. Asking a stranger for a dozen fields before
 * anything has happened is where signup flows lose people; step one is the
 * account they would create anywhere, step two is about their café, and by
 * then they have already invested something.
 *
 * Both steps post together — the server does the lot in one transaction, so
 * there is no state where an account exists with no business attached.
 */

const DEFAULT_COUNTRY = 'IN';

/** A labelled field in the auth card's idiom. */
const Field = ({ label, id, required, hint, children }) => (
  <div>
    <label htmlFor={id} className={authLabelClasses}>
      {label}{required && <span className="ml-1 text-red-400">*</span>}
    </label>
    {children}
    {hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
  </div>
);

const SignupPage = () => {
  const navigate = useNavigate();
  const { verifyEmail, resendVerification } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  /* Set once signup succeeds and the account is waiting on its code —
     swaps the wizard over to the verify step in place of step 1/2. */
  const [pendingVerification, setPendingVerification] = useState(null); // { email } | null

  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', confirm: '',
    /* dialCountry is only the phone prefix. The business location is chosen
       separately below, because where someone's mobile is registered and where
       their café stands are frequently not the same country. */
    dialCountry: DEFAULT_COUNTRY, dial: countryByCode(DEFAULT_COUNTRY).dial,
    organization_name: '', branch_name: '',
    address_line_1: '', address_line_2: '', postal_code: '', pc_count: '',
    consent: false
  });

  /* Ids, plus the resolved rows the selector hands back, so currency and
     timezone can be shown without a second request. */
  const [location, setLocation] = useState({
    country_id: null, state_id: null, city_id: null,
    country: null, state: null, city: null
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onDialCountry = (e) => {
    const code = e.target.value;
    const c = countryByCode(code);
    setForm((f) => ({ ...f, dialCountry: code, dial: c?.dial || f.dial }));
  };

  /* The selector clears the levels below whatever changed, so this only has to
     take what it is given. Putting the reset rules here as well would be a
     second place for them to drift. */
  const onLocation = (next) => setLocation((prev) => ({ ...prev, ...next }));

  const stepOneValid =
    form.name.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
    form.password.length >= 8 &&
    form.password === form.confirm &&
    form.consent;

  const next = (e) => {
    e.preventDefault();
    setError(null);
    // Named, specific reasons — "invalid form" leaves someone hunting.
    if (!form.name.trim()) return setError('Enter your full name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address');
    if (form.password.length < 8) return setError('Use a password of at least 8 characters');
    if (form.password !== form.confirm) return setError('Those passwords do not match');
    if (!form.consent) return setError('Please agree to the Privacy Policy to continue');
    setStep(2);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.organization_name.trim()) return setError('What is your business called?');
    /* Checked here so the person is told which field is missing, rather than
       being handed the server's answer to a request that was never going to
       work. The server checks the same things again regardless — this is
       courtesy, not enforcement. */
    if (!location.country_id) return setError('Select the country your café is in');
    if (!location.state_id) return setError('Select a state or province');
    if (!location.city_id) return setError('Select a city');

    setSaving(true);
    try {
      const data = await portalApi.signup({
        name: form.name.trim(),
        email: form.email.trim(),
        /* Stored with its country code, so the number is still dialable — and
           still matches — after the café opens a branch abroad. */
        phone: joinPhone(form.dial, form.phone),
        password: form.password,
        organization_name: form.organization_name.trim(),
        branch_name: form.branch_name.trim() || form.organization_name.trim(),
        address_line_1: form.address_line_1.trim(),
        address_line_2: form.address_line_2.trim(),
        postal_code: form.postal_code.trim(),
        /* Ids, not names. A spelling of "Bengaluru" is a display detail; the
           id is what the record actually means. */
        country_id: location.country_id,
        state_id: location.state_id,
        city_id: location.city_id,
        pc_count: form.pc_count ? Number(form.pc_count) : undefined
      });

      /* Signing up does not sign you in — the account cannot be signed into
         at all until the address is verified, so there is nothing here worth
         discarding, but the same defensive sign-out stays: any session
         already in this browser is cleared so a half-remembered earlier
         login cannot be mistaken for the new account. */
      adminAuth.signOut();
      portalAuth.signOut();

      if (data.verification_required) {
        setPendingVerification({ email: form.email.trim(), organizationName: data.organization.name });
        return;
      }

      // Defensive fallback — should not be reachable while the backend always
      // sends a code at signup, but a signup that somehow skipped it (an
      // account created before this existed, say) should still land somewhere
      // sane rather than get stuck.
      navigate('/login', {
        replace: true,
        state: {
          notice: `${data.organization.name} is ready. Sign in with ${form.email.trim()} to continue.`,
          email: form.email.trim()
        }
      });
    } catch (err) {
      setError(err.message);
      setStep(1);   // most failures are the email being taken
    } finally {
      setSaving(false);
    }
  };

  const onVerified = async () => {
    navigate('/login', {
      replace: true,
      state: {
        notice: `${pendingVerification.organizationName} is ready. Sign in with ${pendingVerification.email} to continue.`,
        email: pendingVerification.email
      }
    });
  };

  if (pendingVerification) {
    return (
      <AuthLayout
        title="Verify your email"
        subtitle="One more step and your café is ready"
        footer={<>Your trial has already started — verifying just unlocks signing in.</>}
      >
        <VerifyEmailStep
          email={pendingVerification.email}
          verify={(code) => verifyEmail(pendingVerification.email, code)}
          resend={() => resendVerification(pendingVerification.email)}
          onVerified={onVerified}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      wide={step === 2}
      title={step === 1 ? 'Create your account' : 'Tell us about your café'}
      subtitle={
        step === 1
          ? 'Full access to every CafeXP feature for 15 days. No card required.'
          : 'We will set up your business and first branch automatically.'
      }
      footer={
        step === 1 ? (
          <>
            Already have an account?{' '}
            <Link to="/login" className="text-white underline underline-offset-4 transition-colors hover:text-red-400">
              Sign in
            </Link>
          </>
        ) : (
          <>Your trial includes every CafeXP feature — PC control, sessions, billing, POS, inventory, customers and reports.</>
        )
      }
    >
      {/* Progress, in the card's own mono idiom rather than numbered bubbles. */}
      <div className="mt-5">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          <span className={step === 1 ? 'text-red-400' : ''}>01 · account</span>
          <span className={step === 2 ? 'text-red-400' : ''}>02 · your café</span>
        </div>
        <div className="mt-2 h-px w-full bg-white/10">
          <div
            className="h-px bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
            style={{ width: step === 1 ? '50%' : '100%' }}
          />
        </div>
      </div>

      <div aria-live="polite">
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/*
        The key on each form matters more than it looks.

        Without it React sees one <form> in one position and reuses the DOM
        nodes underneath when the step changes — so step one's "Confirm
        password" input becomes step two's "First branch" input, carrying the
        typed value across with it. The result is the customer's password
        sitting in plain text in an ordinary text field, on screen, one field
        away from a business name they are about to submit.

        Distinct keys make the two steps separate subtrees: step one unmounts,
        its inputs are destroyed, and nothing survives into step two.
      */}
      {step === 1 ? (
        <form key="step-account" onSubmit={next} className="mt-5 space-y-4">
          <Field label="Full name" id="st-name" required>
            <input id="st-name" value={form.name} onChange={set('name')} className={authFieldClasses}
                   placeholder="Priya Nair" autoComplete="name" autoFocus />
          </Field>

          <Field label="Email" id="st-email" required hint="You will sign in with this">
            <input id="st-email" type="email" value={form.email} onChange={set('email')}
                   className={authFieldClasses} placeholder="name@example.com" autoComplete="email" />
          </Field>

          <Field label="Mobile number" id="st-phone" hint="For account recovery and billing alerts">
            {/* One control, two inputs. Splitting the dial code out lets a
                number be typed the way it is written down locally, without
                anyone guessing whether to include the country. */}
            {/* The widths live on wrappers, not on the fields. authFieldClasses
                carries w-full, and a competing width utility on the same element
                is a coin toss decided by Tailwind's stylesheet order — which it
                loses, sending the input off the edge of the card. */}
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <select
                  value={form.dialCountry}
                  onChange={onDialCountry}
                  aria-label="Country dialling code"
                  className={authFieldClasses}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-neutral-950">
                      {flagOf(c.code)} +{c.dial}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <input id="st-phone" type="tel" value={form.phone} onChange={set('phone')}
                       className={authFieldClasses} placeholder="98765 00011" autoComplete="tel" />
              </div>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" id="st-pass" required hint="At least 8 characters">
              <div className="relative">
                <input id="st-pass" type={showPassword ? 'text' : 'password'} value={form.password}
                       onChange={set('password')} className={`${authFieldClasses} pr-11`}
                       autoComplete="new-password" />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 transition-colors hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <Field label="Confirm password" id="st-confirm" required>
              <input id="st-confirm" type={showPassword ? 'text' : 'password'} value={form.confirm}
                     onChange={set('confirm')} className={authFieldClasses} autoComplete="new-password" />
            </Field>
          </div>

          <ConsentCheckbox
            id="st-consent"
            checked={form.consent}
            onChange={(v) => setForm((f) => ({ ...f, consent: v }))}
          >
            I agree to the{' '}
            <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer"
                  className="text-white underline underline-offset-4 hover:text-red-400">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link to="/terms-of-service" target="_blank" rel="noopener noreferrer"
                  className="text-white underline underline-offset-4 hover:text-red-400">
              Terms of Service
            </Link>, and consent to ManagerXP collecting and processing my personal data as described.
          </ConsentCheckbox>

          <button
            type="submit"
            disabled={!stepOneValid}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl
                       border border-white/10 bg-gradient-to-br from-red-700 to-red-900
                       py-2.5 text-sm font-semibold text-white
                       shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                       transition-all duration-300 active:scale-[0.99]
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </form>
      ) : (
        <form key="step-cafe" onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" id="st-org" required
                   hint="The company or group — you can add more branches later">
              <input id="st-org" value={form.organization_name} onChange={set('organization_name')}
                     className={authFieldClasses} placeholder="Riverside Gaming Group" autoFocus />
            </Field>
            <Field label="First branch" id="st-branch" hint="Leave blank to use your business name">
              <input id="st-branch" value={form.branch_name} onChange={set('branch_name')}
                     className={authFieldClasses} placeholder="Hyderabad" />
            </Field>
          </div>

          <div className="pt-1">
            <div className="mb-3 flex items-center gap-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-500">
                business_location
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-red-500/40 to-transparent" />
            </div>

            <LocationSelector
              variant="auth"
              countryId={location.country_id}
              stateId={location.state_id}
              cityId={location.city_id}
              onChange={onLocation}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address" id="st-address1" required>
              <input id="st-address1" value={form.address_line_1} onChange={set('address_line_1')}
                     className={authFieldClasses} placeholder="Road No. 12, Banjara Hills"
                     autoComplete="address-line1" />
            </Field>
            <Field label="Landmark / floor" id="st-address2" hint="Optional">
              <input id="st-address2" value={form.address_line_2} onChange={set('address_line_2')}
                     className={authFieldClasses} placeholder="Above City Centre Mall"
                     autoComplete="address-line2" />
            </Field>
            <Field label="Postal / ZIP code" id="st-postal">
              <input id="st-postal" value={form.postal_code} onChange={set('postal_code')}
                     className={authFieldClasses} placeholder="500034" autoComplete="postal-code" />
            </Field>
            <Field label="Number of gaming PCs" id="st-pcs"
                   hint="Roughly is fine — you can change it later">
              <input id="st-pcs" type="number" min="1" value={form.pc_count}
                     onChange={set('pc_count')} className={authFieldClasses} placeholder="20" />
            </Field>
          </div>

          {/* Both come from the country master rather than being guessed
              from the city, and both stay editable later under
              Organization. Shown here so the customer knows what they are
              agreeing to be billed in before they agree to it. */}
          {location.country && (
            <p className="font-mono text-[11px] text-neutral-600">
              Billed in <span className="text-neutral-400">{location.country.currency_code}</span>
              {location.country.timezone && (
                <> · times shown in <span className="text-neutral-400">{location.country.timezone}</span></>
              )}. Both can be changed later under Organization.
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold
                         text-neutral-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={saving}
              className="group relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl
                         border border-white/10 bg-gradient-to-br from-red-700 to-red-900
                         py-2.5 text-sm font-semibold text-white
                         shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)]
                         transition-all duration-300 active:scale-[0.99]
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Setting up your account...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  Start free trial
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};

export default SignupPage;
