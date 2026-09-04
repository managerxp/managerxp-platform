import express from 'express';
import {
  register,
  login,
  createCustomer,
  getCustomers,
  getCustomerById,
  getMyProfile,
  exportMyData,
  deleteMyAccount,
  setCustomerTier,
  getCustomerCredit
} from '../controllers/customer.Controller.js';
import { verifyCustomerEmail, resendCustomerVerification } from '../controllers/emailVerification.Controller.js';
import { requireStaff, requirePermission, requireAuth } from '../middleware/authGuards.js';
import { loginLimiter, resetLimiter } from '../middleware/rateLimit.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const customerRouter = express.Router();
const feature = requireCafeFeature('CUSTOMERS');

// Public: the client app registers and signs customers in. The login limiter
// counts only failed attempts, so a busy café's successful sign-ins — many
// from one IP — are never throttled; only a run of failures is.
customerRouter.post('/register', register);
customerRouter.post('/login', loginLimiter, login);

// Public: finishing sign-up. Both send an email, so they share the OTP
// limiter with password reset rather than the login one.
customerRouter.post('/verify-email', resetLimiter, verifyCustomerEmail);
customerRouter.post('/resend-verification', resetLimiter, resendCustomerVerification);

/* A customer reading their own profile — including how long they've played,
   which the client only ever had a stale login-time snapshot of otherwise.
   Not feature-gated: seeing your own account works regardless of whether
   this café's package includes the staff-facing Customers module. Literal
   path before "/:id", or "me" would be read as a customer id. */
customerRouter.get('/me', requireAuth, getMyProfile);

/* DPDP Act, 2023 — a customer's own right to export or erase their data.
   Not feature-gated, same reasoning as /me: this works regardless of
   whether the café's package includes the Customers module. */
customerRouter.get('/me/export', requireAuth, exportMyData);
customerRouter.delete('/me', requireAuth, deleteMyAccount);

// Staff only: these return other people's contact details.
customerRouter.post('/', requirePermission('customers.manage'), feature, createCustomer);
customerRouter.get('/', requireStaff('Café staff access required'), feature, getCustomers);
customerRouter.get('/:id', requireStaff('Café staff access required'), feature, getCustomerById);

/* What they owe and what is left of their limit — read by the till before it
   offers to put a ticket on their tab. */
customerRouter.get('/:id/credit', requireStaff('Café staff access required'), feature, getCustomerCredit);

/* Making somebody a regular grants a standing discount and the right to owe
   the café money, so it needs the same permission as managing customers
   rather than merely being staff. */
customerRouter.patch('/:id/tier', requirePermission('customers.manage'), feature, setCustomerTier);

export default customerRouter;
