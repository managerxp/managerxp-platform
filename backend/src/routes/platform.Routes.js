import express from 'express';
import {
  getOverview,
  listCafes, setCafeStatus,
  listSubscriptions, createSubscription, updateSubscription,
  recordPayment, listPayments,
  createPaymentLink, listPaymentLinks, cancelPaymentLink,
  listPlans, updatePlanPricing,
  getPayLink, startLinkPayment, completeLinkPayment,
  createCafe, listUsers, createUser, resetUserPassword
} from '../controllers/platform.Controller.js';
import {
  listLicenses, createLicense, revokeLicense, unbindLicense, listActivations
} from '../controllers/licenses.Controller.js';
import {
  listReleases, createRelease, updateRelease, getRollout
} from '../controllers/updates.Controller.js';
import { requirePlatformAdmin, requireReleaseAgent } from '../middleware/authGuards.js';

const router = express.Router();

/* ==========================================================================
   PUBLIC — the pay page

   Mounted first and deliberately unguarded: the point of a payment link is
   that a café owner can pay it without an account. The token in the path is
   the credential — 24 random bytes, expiring, and worth exactly one payment.

   Note what these three routes cannot do: they never reveal a café's data,
   never accept an amount, and never sign anybody in.
   ========================================================================== */
router.get('/pay/:token', getPayLink);
router.post('/pay/:token/order', startLinkPayment);
router.post('/pay/:token/complete', completeLinkPayment);

/* The GitHub release workflow publishing a build it just made. Ahead of
   requirePlatformAdmin on purpose — see requireReleaseAgent. A request
   without its token falls straight through to the ordinary admin-gated
   /releases route below, unaffected. */
router.post('/releases', requireReleaseAgent, createRelease);

/* ==========================================================================
   PLATFORM ADMIN — everything below crosses tenant boundaries

   requirePlatformAdmin checks the role *value*, not merely that a role is
   present: a café owner's token carries a role and would otherwise sail
   through a naive check and be handed every customer's billing.
   ========================================================================== */
router.use(requirePlatformAdmin);

router.get('/overview', getOverview);

router.get('/cafes', listCafes);
router.post('/cafes', createCafe);
router.patch('/cafes/:id/status', setCafeStatus);

router.get('/users', listUsers);
router.post('/users', createUser);
router.post('/users/:id/reset-password', resetUserPassword);

/* Licence keys. Issuing one is how a customer's install is allowed to run;
   revoking one stops a café trading, which is why it demands a reason. */
router.get('/licenses', listLicenses);
router.post('/licenses', createLicense);
router.post('/licenses/:id/revoke', revokeLicense);
router.post('/licenses/:id/unbind', unbindLicense);
router.get('/licenses/:id/activations', listActivations);

/* Client releases. Publishing one is what makes it reachable by every café,
   so it demands a checksum — see createRelease. */
router.get('/releases', listReleases);
router.post('/releases', createRelease);
router.patch('/releases/:id', updateRelease);
router.get('/releases-rollout', getRollout);

router.get('/subscriptions', listSubscriptions);
router.post('/subscriptions', createSubscription);
router.patch('/subscriptions/:id', updateSubscription);

router.get('/payments', listPayments);
router.post('/payments', recordPayment);

router.get('/payment-links', listPaymentLinks);
router.post('/payment-links', createPaymentLink);
router.post('/payment-links/:id/cancel', cancelPaymentLink);

router.get('/plans', listPlans);
router.patch('/plans/:id/pricing', updatePlanPricing);

export default router;
