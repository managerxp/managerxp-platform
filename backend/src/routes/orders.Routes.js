import express from 'express';
import {
  placeOrder, listOrders, listCustomerOrders, setOrderStatus
} from '../controllers/orders.Controller.js';
import { requireStaff, requireAuth, canReadWallet } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const ordersRouter = express.Router();
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('FNB');

// Customers place their own orders from the station.
ordersRouter.post('/', requireAuth, feature, placeOrder);
ordersRouter.get('/customer/:customerId', canReadWallet, feature, listCustomerOrders);

ordersRouter.get('/', staff, feature, listOrders);
ordersRouter.patch('/:id/status', staff, feature, setOrderStatus);

export default ordersRouter;
