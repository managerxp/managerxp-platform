/*
 * Rate limiters for the endpoints worth abusing.
 *
 * Deliberately NOT global. This backend also serves the CafeXP desktop apps,
 * which poll telemetry and reconcile sessions every few seconds from one café's
 * IP — a blanket limiter would throttle a busy café's own machines. So the
 * limiters below are mounted only on the routes where abuse is the concern:
 * signing in and resetting a password.
 *
 * Keyed by IP. If this is ever deployed behind a reverse proxy, set
 * `app.set('trust proxy', 1)` in server.js so the client IP is read from the
 * forwarded header rather than every request sharing the proxy's address.
 */
import rateLimit from 'express-rate-limit';

const minutes = (n) => n * 60 * 1000;

const refusal = (message) => (req, res) =>
  res.status(429).json({ success: false, message });

/*
 * Login. The limit counts only FAILED attempts (skipSuccessfulRequests), so a
 * café behind one public IP where dozens of customers sign in successfully all
 * evening is never touched — only a run of failures, which is what a brute
 * force looks like, is. Thirty failures in fifteen minutes is far more than a
 * person fat-fingering a password and far less than a useful guessing rate.
 */
export const loginLimiter = rateLimit({
  windowMs: minutes(15),
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: refusal('Too many sign-in attempts from here. Wait a few minutes and try again.')
});

/*
 * Password reset and OTP. Every one of these sends an email or a code, so they
 * are counted whether they "succeed" or not — the abuse is the sending itself
 * (mailbombing, OTP flooding), not a wrong guess. Reset is a rare action, so
 * the ceiling is low.
 */
export const resetLimiter = rateLimit({
  windowMs: minutes(15),
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: refusal('Too many password-reset requests from here. Wait a few minutes and try again.')
});

/*
 * The public booking page (managerxp.com/book/:slug) takes no login at all,
 * which is exactly what makes it worth limiting — nothing else stops a
 * script from filling a café's calendar with junk reservations.
 */
export const publicBookingLimiter = rateLimit({
  windowMs: minutes(15),
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: refusal('Too many booking attempts from here. Wait a few minutes and try again.')
});
