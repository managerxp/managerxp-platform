import express from 'express';
import { forgotPassword, verifyOtp, resetPassword } from '../controllers/accountReset.Controller.js';
import { resetLimiter } from '../middleware/rateLimit.js';

/*
 * Public by necessity — nobody asking to reset a password can be signed in
 * yet. Every handler treats its input as untrusted and answers generically,
 * which is what makes that safe. The reset limiter caps how often these can be
 * hit from one IP, since each one sends an email or an OTP.
 */
const accountResetRouter = express.Router();

accountResetRouter.post('/forgot-password', resetLimiter, forgotPassword);
accountResetRouter.post('/verify-otp', resetLimiter, verifyOtp);
accountResetRouter.post('/reset-password', resetLimiter, resetPassword);

export default accountResetRouter;
