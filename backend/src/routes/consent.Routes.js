import express from 'express';
import { recordConsent } from '../controllers/consent.Controller.js';
import { consentLimiter } from '../middleware/rateLimit.js';

const consentRouter = express.Router();

// No auth: the website's consent panel, used by visitors without an account.
consentRouter.post('/', consentLimiter, recordConsent);

export default consentRouter;
