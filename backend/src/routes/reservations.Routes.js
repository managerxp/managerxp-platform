import express from 'express';
import {
  checkAvailability, createReservation, listReservations, listCustomerReservations,
  cancelReservation, checkInReservation, markNoShow, listBookableCategories, getStoreHours
} from '../controllers/reservations.Controller.js';
import { requireStaff, requireAuth } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const reservationsRouter = express.Router();
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('RESERVATIONS');

// Literal paths before "/:id".
reservationsRouter.get('/categories', requireAuth, feature, listBookableCategories);
reservationsRouter.get('/hours', requireAuth, feature, getStoreHours);
reservationsRouter.get('/availability', requireAuth, feature, checkAvailability);
reservationsRouter.get('/customer/:customerId', requireAuth, feature, listCustomerReservations);

reservationsRouter.get('/', staff, feature, listReservations);
// Either a customer booking for themself, or staff booking for a customer/guest.
reservationsRouter.post('/', requireAuth, feature, createReservation);

// Cancel: staff, or the customer who booked it — enforced inside the controller.
reservationsRouter.post('/:id/cancel', requireAuth, feature, cancelReservation);
reservationsRouter.post('/:id/check-in', staff, feature, checkInReservation);
reservationsRouter.post('/:id/no-show', staff, feature, markNoShow);

export default reservationsRouter;
