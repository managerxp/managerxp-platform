import express from 'express';
import {
  createPlan, listPlans, updatePlan, setPlanStatus,
  subscribe, listMemberships, getCustomerMembership, cancelMembership,
  listPlansCatalog, subscribeSelf
} from '../controllers/memberships.Controller.js';
import { requireStaff, requireAuth, canReadWallet } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const membershipsRouter = express.Router();
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('MEMBERSHIP');

// Literal segments before "/:id" so they are not read as ids.
membershipsRouter.get('/plans', staff, feature, listPlans);
membershipsRouter.post('/plans', staff, feature, createPlan);
membershipsRouter.put('/plans/:id', staff, feature, updatePlan);
membershipsRouter.patch('/plans/:id/status', staff, feature, setPlanStatus);
membershipsRouter.post('/plans/:id/subscribe', staff, feature, subscribe);

// Self-service: what a customer could subscribe to, and doing it themselves.
membershipsRouter.get('/plans/catalog', requireAuth, feature, listPlansCatalog);
membershipsRouter.post('/plans/:id/subscribe-self', requireAuth, feature, subscribeSelf);

membershipsRouter.get('/customer/:customerId', canReadWallet, feature, getCustomerMembership);

membershipsRouter.get('/', staff, feature, listMemberships);
membershipsRouter.post('/:id/cancel', staff, feature, cancelMembership);

export default membershipsRouter;
