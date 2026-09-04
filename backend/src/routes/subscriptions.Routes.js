import express from 'express';
import {
  createSubscription,
  getAllSubscriptions,
  getSubscriptionById,
  deleteSubscription,
  deleteExpiredSubscriptions,
  getSubscriptionsByCafeId,
  listAddonCatalog
} from '../controllers/subscriptions.Controller.js';
import { requireStaff, requirePlatformAdmin } from '../middleware/authGuards.js';

const subscriptionsRouter = express.Router();

const staffOnly = requireStaff('Café staff access required');

// Literal path before "/:id", or "addons" would be read as a subscription id.
subscriptionsRouter.get('/addons/catalog', staffOnly, listAddonCatalog);

// Café-facing: creating/reading a subscription for the caller's own café
// (free-trial signup, billing screens). Controllers below scope every read
// and write to req.actor.cafe_id — a café token can never touch another
// café's row just by changing the id in the URL.
subscriptionsRouter.post('/', staffOnly, createSubscription);
subscriptionsRouter.get('/', staffOnly, getAllSubscriptions);
subscriptionsRouter.get('/cafe/:cafe_id', staffOnly, getSubscriptionsByCafeId);

// No live caller anywhere in the codebase reads/deletes a subscription by its
// own id or runs the expired-cleanup sweep — these are vendor-only tools, so
// they get the stricter platform-admin gate rather than the café-staff one.
subscriptionsRouter.get('/:id', requirePlatformAdmin, getSubscriptionById);
subscriptionsRouter.delete('/:id', requirePlatformAdmin, deleteSubscription);
subscriptionsRouter.delete('/expired/cleanup', requirePlatformAdmin, deleteExpiredSubscriptions);

export default subscriptionsRouter;