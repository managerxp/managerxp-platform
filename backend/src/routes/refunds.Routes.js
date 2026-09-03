import express from 'express';
import { getRefund, listRefunds } from '../controllers/refunds.Controller.js';
import { requirePermission } from '../middleware/authGuards.js';

const router = express.Router();

/* ==========================================================================
   REFUNDS

   Creating one lives on the bill (POST /api/bills/:id/refund) because a refund
   only exists against an invoice — there is no such thing as a free-standing
   refund, and a route that implied otherwise would invite one.

   These two are the read side: the refund register for reporting, and a single
   refund for the receipt.
   ========================================================================== */
router.get('/', requirePermission('billing.view'), listRefunds);
router.get('/:refundId', requirePermission('billing.view'), getRefund);

export default router;
