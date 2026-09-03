/*
 * The single sign-in door.
 *
 * One form, two kinds of principal. A ManagerXP administrator and a café owner
 * type into the same box and land where they belong, because the server knows
 * which they are and the person signing in should not have to.
 *
 * Order matters and is not arbitrary. Administrators are checked FIRST,
 * because an address can legitimately exist in both tables — the seeded
 * administrator was migrated from a `users` row and still has it. Checking
 * owners first would hand that person a café-owner token, bounce them off the
 * admin console, and send them back to this page in a loop.
 *
 * The café-owner path is not reimplemented here. It delegates to the existing
 * handler, so anything that changes about owner sign-in is picked up without
 * this file knowing about it. Two implementations of "check a password" is how
 * one of them ends up weaker than the other — which is exactly what had already
 * happened, and what this replaces.
 */
import { attemptAdminLogin } from './adminAuth.Controller.js';
import { login as ownerLogin } from './auth.Controller.js';

/* The one sentence every refusal gets, whichever table the address was in.
 *
 * The lockout answer is deliberately NOT normalised: it only appears after
 * five failures against a real administrator account, and telling someone who
 * has just corrected their password that waiting is the answer is worth more
 * than the little it reveals to an attacker already making five attempts. */
const REFUSED = 'Email or password is incorrect';

/** POST /api/auth/signin */
export const signin = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const result = await attemptAdminLogin(req, email, password);

    /* Not an administrator at all — fall through. Note this branch is reached
       without recording anything in the admin login log: an owner signing in
       is not a failed administrator attempt, and logging it as one would bury
       the real attempts under thousands of ordinary sign-ins. */
    if (result.notAnAdmin) {
      /*
       * Two adjustments to the owner handler's answer, both about not letting
       * the shared door leak which table an address lives in.
       *
       *   `kind` is added so the client routes on a stated fact rather than on
       *   the absence of one. Inferring "owner" from a missing field works
       *   until someone adds a field.
       *
       *   The refusal message is normalised. The admin path says "Email or
       *   password is incorrect" and the owner path said "Invalid
       *   credentials" — two different sentences for the same outcome, which
       *   is enough to tell an attacker whether an address is an
       *   administrator without ever guessing a password.
       */
      const sendJson = res.json.bind(res);
      res.json = (body) => {
        if (body?.success && body.data) body.data.kind = 'owner';
        if (body && body.success === false && res.statusCode === 401) {
          body.message = REFUSED;
        }
        return sendJson(body);
      };
      return ownerLogin(req, res);
    }

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: result.message,
      /* `kind` is what the client routes on. Without it the browser would have
         to infer the principal from the shape of the payload, which is the
         kind of guess that quietly breaks when a field is added. */
      data: { kind: 'admin', ...result.data }
    });
  } catch (error) {
    console.error('Sign-in failed:', error);
    res.status(500).json({ success: false, message: 'Could not sign you in. Please try again.' });
  }
};
