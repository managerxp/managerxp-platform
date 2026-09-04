/*
 * Effective entitlements, for the CafeXP desktop application.
 *
 * The desktop console and its stations do not know about organizations — they
 * were built around `cafe_id` and still are. So this endpoint takes the café
 * identity the app already holds and resolves it to the organization behind
 * it, then answers from the same `entitlements.service.js` the portal and the
 * admin console use.
 *
 * That last part is the whole point, and section 57 is explicit about it:
 * there is ONE source of truth. If the desktop app computed its own answer
 * from a plan name, an admin who switched a feature off would see it stay on
 * in the café, which is worse than not having the control at all.
 *
 * Read-only. Nothing here can change an entitlement, only report one.
 */
import express from 'express';
import { requireAuth } from '../middleware/authGuards.js';
import { getEntitlements, getSubscription, getUsage, resolveOrganizationForCafe } from '../modules/entitlements/entitlements.service.js';
import { getSetting } from '../config/settings.js';

const router = express.Router();

/**
 * Which organization is this caller's café part of?
 *
 * The token's `cafe_id` is a claim like any other, so it is checked against
 * the row rather than trusted: the café is looked up, and the organization
 * comes from the café row in the database, never from the request.
 */
const resolveScope = (actor) => resolveOrganizationForCafe(actor?.cafe_id);

/**
 * GET /api/entitlements/me
 *
 * Everything the desktop app needs to decide what to show: which modules are
 * available, which features inside them, the subscription state, the limits
 * and what is used against them.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const scope = await resolveScope(req.actor);
    if (!scope) {
      /* A café that predates the tenancy migration, or a token with no café.
         Answering "everything on" would be a security hole; answering
         "everything off" would brick a working café. So it says plainly that
         it cannot tell, and the client decides — which, for the desktop app,
         means keeping its full navigation rather than hiding half of it on
         the strength of an answer nobody gave. */
      return res.json({
        success: true,
        data: { resolved: false, reason: 'no_organization', modules: null, features: null }
      });
    }

    const [entitlements, usage, graceHours] = await Promise.all([
      getEntitlements(scope.organizationId, scope.branchId),
      getUsage(scope.organizationId),
      getSetting('entitlements.offline_grace_hours', 72)
    ]);

    res.json({
      success: true,
      data: {
        resolved: true,
        organization_id: scope.organizationId,
        branch_id: scope.branchId,
        subscription: entitlements.subscription,
        modules: entitlements.modules,
        features: entitlements.features,
        enabled: entitlements.enabled,
        usage,
        /* Section 50: the app keeps working from its last successful
           authorisation for this long, so a dropped connection does not stop
           a café trading mid-service. */
        offline_grace_hours: Number(graceHours),
        checked_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Entitlement lookup failed:', error);
    res.status(500).json({ success: false, message: 'Could not load entitlements' });
  }
});

export default router;
