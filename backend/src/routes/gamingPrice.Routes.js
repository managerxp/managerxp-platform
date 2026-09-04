import express from 'express';
import {
  createPrice,
  listPrices,
  lookupPrice,
  getPriceById,
  updatePrice,
  setPriceStatus,
  deletePrice,
  priceMatrix
} from '../controllers/gamingPrice.Controller.js';
import { requireStaff } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const gamingPriceRouter = express.Router();

const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('SESSION_MANAGEMENT');

// Literal paths must be declared before "/:id", or Express would treat
// "lookup" and "matrix" as ids.
gamingPriceRouter.get('/lookup', staff, feature, lookupPrice);
gamingPriceRouter.get('/matrix', staff, feature, priceMatrix);

gamingPriceRouter.get('/', staff, feature, listPrices);
gamingPriceRouter.post('/', staff, feature, createPrice);
gamingPriceRouter.get('/:id', staff, feature, getPriceById);
gamingPriceRouter.put('/:id', staff, feature, updatePrice);
gamingPriceRouter.patch('/:id/status', staff, feature, setPriceStatus);
gamingPriceRouter.delete('/:id', staff, feature, deletePrice);

export default gamingPriceRouter;
