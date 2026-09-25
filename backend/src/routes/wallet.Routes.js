import express from 'express';
import {
  getWallet,
  getTransactions,
  creditWallet,
  debitWallet
} from '../controllers/wallet.Controller.js';
import { canReadWallet, requirePermission } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const walletRouter = express.Router();
const feature = requireCafeFeature('WALLET');

// Customers read their own wallet; staff can read any.
walletRouter.get('/customer/:customerId', canReadWallet, feature, getWallet);
walletRouter.get('/customer/:customerId/transactions', canReadWallet, feature, getTransactions);

// Money only moves on a staff token with the specific permission for it —
// "is any staff" let a role with no finance access still credit or debit a
// wallet, since wallet.credit/wallet.debit exist and are assigned per role
// but were never actually checked here.
walletRouter.post('/customer/:customerId/credit', requirePermission('wallet.credit'), feature, creditWallet);
walletRouter.post('/customer/:customerId/debit', requirePermission('wallet.debit'), feature, debitWallet);

export default walletRouter;
