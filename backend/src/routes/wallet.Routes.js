import express from 'express';
import {
  getWallet,
  getTransactions,
  creditWallet,
  debitWallet
} from '../controllers/wallet.Controller.js';
import { canReadWallet, canMoveMoney } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const walletRouter = express.Router();
const feature = requireCafeFeature('WALLET');

// Customers read their own wallet; staff can read any.
walletRouter.get('/customer/:customerId', canReadWallet, feature, getWallet);
walletRouter.get('/customer/:customerId/transactions', canReadWallet, feature, getTransactions);

// Money only moves on a staff token.
walletRouter.post('/customer/:customerId/credit', canMoveMoney, feature, creditWallet);
walletRouter.post('/customer/:customerId/debit', canMoveMoney, feature, debitWallet);

export default walletRouter;
