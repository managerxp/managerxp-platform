import express from 'express';
import {
  listCodes,
  validateCode,
  createCode,
  setCodeStatus,
  deleteCode,
  listRedemptions
} from '../controllers/discounts.Controller.js';
import { requireStaff, requirePermission } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const discountsRouter = express.Router();

const staff = requireStaff('Café staff access required');
const canManage = requirePermission('discounts.manage');
const feature = requireCafeFeature('BILLING');

// A cashier needs to check a code without being able to invent one.
discountsRouter.post('/validate', staff, feature, validateCode);
discountsRouter.get('/', staff, feature, listCodes);

discountsRouter.post('/', canManage, feature, createCode);
discountsRouter.get('/:id/redemptions', canManage, feature, listRedemptions);
discountsRouter.patch('/:id/status', canManage, feature, setCodeStatus);
discountsRouter.delete('/:id', canManage, feature, deleteCode);

export default discountsRouter;
