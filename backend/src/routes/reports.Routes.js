import express from 'express';
import {
  summary,
  revenue,
  stations,
  hours,
  customers,
  products,
  finance,
  games
} from '../controllers/reports.Controller.js';
import { requirePermission } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const reportsRouter = express.Router();

const canRead = requirePermission('reports.view');
const feature = requireCafeFeature('REPORTS');

reportsRouter.get('/summary', canRead, feature, summary);
reportsRouter.get('/revenue', canRead, feature, revenue);
reportsRouter.get('/stations', canRead, feature, stations);
reportsRouter.get('/hours', canRead, feature, hours);
reportsRouter.get('/customers', canRead, feature, customers);
reportsRouter.get('/products', canRead, feature, products);
reportsRouter.get('/finance', canRead, feature, finance);
reportsRouter.get('/games', canRead, feature, games);

export default reportsRouter;
