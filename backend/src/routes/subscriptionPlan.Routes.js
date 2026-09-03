import express from 'express';
import {
  createSubscriptionPlan,
  getAllSubscriptionPlans,
  getSubscriptionPlanById,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  getGamingXPFreeTrialPlan
} from '../controllers/subscriptionPlan.Controller.js';

const subscriptionPlanRouter = express.Router();


subscriptionPlanRouter.post('/', createSubscriptionPlan);
subscriptionPlanRouter.get('/', getAllSubscriptionPlans);
subscriptionPlanRouter.get('/gamingxp-free-trial', getGamingXPFreeTrialPlan);
subscriptionPlanRouter.get('/:id', getSubscriptionPlanById);
subscriptionPlanRouter.put('/:id', updateSubscriptionPlan);
subscriptionPlanRouter.delete('/:id', deleteSubscriptionPlan);

export default subscriptionPlanRouter;