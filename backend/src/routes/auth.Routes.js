import express from 'express';
import { register, login, getAllUsers, verifyToken, verify } from '../controllers/auth.Controller.js';
import { signin } from '../controllers/signin.Controller.js';
import { startGoogleAuth, googleCallback } from '../controllers/googleAuth.Controller.js';
import { verifyEmail, resendVerification } from '../controllers/emailVerification.Controller.js';
import { requirePlatformAdmin } from '../middleware/authGuards.js';
import { registerValidation, loginValidation } from '../utils/validation.js';
import { validate } from '../middleware/validationMiddleware.js';
import { loginLimiter, resetLimiter } from '../middleware/rateLimit.js';

const AuthRouter = express.Router();

AuthRouter.post('/register', registerValidation, validate, register);
AuthRouter.post('/login', loginLimiter, loginValidation, validate, login);
/*
 * The single door: administrators and café owners sign in here and the server
 * works out which they are. /login stays for the desktop apps and anything
 * else already pointed at it.
 */
AuthRouter.post('/signin', loginLimiter, loginValidation, validate, signin);
AuthRouter.post('/verify-token', verifyToken);
AuthRouter.post('/verify', verify);

/*
 * Email verification for a new account. Both are limited: verify because it
 * accepts a guessable six-digit code, resend because every call sends mail.
 */
AuthRouter.post('/verify-email', resetLimiter, verifyEmail);
AuthRouter.post('/resend-verification', resetLimiter, resendVerification);

/*
 * Sign in with Google. Both are GET because the browser follows them as plain
 * navigations — /google starts the redirect dance, /google/callback is where
 * Google returns. No rate limiter: these are redirect endpoints, not a
 * password field to hammer, and Google itself is the gate.
 */
AuthRouter.get('/google', startGoogleAuth);
AuthRouter.get('/google/callback', googleCallback);
/*
 * Every account's name, email, phone and address. This was reachable with no
 * token at all — a full customer list for anyone who found the URL. It is a
 * platform-admin view, so it is guarded as one.
 */
AuthRouter.get('/users', requirePlatformAdmin, getAllUsers);

export default AuthRouter;