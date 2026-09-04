import express from 'express';
import { activateLicense, checkLicense } from '../controllers/licenses.Controller.js';

const router = express.Router();

/* ==========================================================================
   LICENCE ACTIVATION  (public by necessity)

   A fresh install has no account — activating is how it gets one — so these
   two routes cannot sit behind a token. The key itself is the credential.

   Both are written on that basis: every failure returns the same shape, the
   messages avoid confirming which part was wrong, and every attempt is
   recorded in license_activations so a flood of guesses is visible after the
   fact rather than invisible.
   ========================================================================== */
router.post('/activate', activateLicense);
router.post('/check', checkLicense);

export default router;
