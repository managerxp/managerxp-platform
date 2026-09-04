import express from 'express';
import {
  createPackage, listPackages, updatePackage, setPackageStatus, deletePackage,
  purchasePackage, listCustomerPackages, consumeUnits, cancelCustomerPackage,
  listPackagesCatalog, purchasePackageSelf
} from '../controllers/packages.Controller.js';
import { requireStaff, requireAuth, canReadWallet } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const packagesRouter = express.Router();
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('PRODUCTS');

// Customers may read their own packages; canReadWallet enforces ownership.
packagesRouter.get('/customer/:customerId', canReadWallet, feature, listCustomerPackages);

// Self-service: what a customer could buy, and buying it. Literal path
// before "/:id" so "catalog" is never read as a package id.
packagesRouter.get('/catalog', requireAuth, feature, listPackagesCatalog);
packagesRouter.post('/:id/purchase-self', requireAuth, feature, purchasePackageSelf);

packagesRouter.get('/', staff, feature, listPackages);
packagesRouter.post('/', staff, feature, createPackage);
packagesRouter.put('/:id', staff, feature, updatePackage);
packagesRouter.patch('/:id/status', staff, feature, setPackageStatus);
packagesRouter.delete('/:id', staff, feature, deletePackage);
packagesRouter.post('/:id/purchase', staff, feature, purchasePackage);

packagesRouter.post('/customer-package/:id/consume', staff, feature, consumeUnits);
packagesRouter.post('/customer-package/:id/cancel', staff, feature, cancelCustomerPackage);

export default packagesRouter;
