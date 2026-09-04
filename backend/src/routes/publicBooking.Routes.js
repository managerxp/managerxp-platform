import express from 'express';
import { publicCafeInfo, publicAvailability, publicCreateReservation } from '../controllers/publicBooking.Controller.js';
import { publicBookingLimiter } from '../middleware/rateLimit.js';

const publicBookingRouter = express.Router();

// No auth anywhere on this router — a slug in the URL is the only "key".
publicBookingRouter.get('/:slug', publicCafeInfo);
publicBookingRouter.get('/:slug/availability', publicAvailability);
publicBookingRouter.post('/:slug/reservations', publicBookingLimiter, publicCreateReservation);

export default publicBookingRouter;
