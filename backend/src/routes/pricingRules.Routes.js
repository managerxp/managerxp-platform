import express from 'express';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  previewRates
} from '../controllers/pricingRules.Controller.js';
import { requireStaff } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const pricingRulesRouter = express.Router();
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('SESSION_MANAGEMENT');

// Literal segment first, so "preview" is never read as a rule id.
pricingRulesRouter.get('/preview', staff, feature, previewRates);

pricingRulesRouter.get('/', staff, feature, listRules);
pricingRulesRouter.post('/', staff, feature, createRule);
pricingRulesRouter.put('/:id', staff, feature, updateRule);
pricingRulesRouter.delete('/:id', staff, feature, deleteRule);

export default pricingRulesRouter;
