import express from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listProducts, customerMenu, createProduct, updateProduct,
  setAvailability, deleteProduct, adjustStock, listMovements, inventorySummary,
  uploadProductImage
} from '../controllers/products.Controller.js';
import { requireStaff, requireAuth } from '../middleware/authGuards.js';
import { catalogAssetUpload, handleCatalogUploadErrors } from '../middleware/catalogAssetUpload.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const productsRouter = express.Router();
const staff = requireStaff('Café staff access required');

// The catalogue (menu) is the FNB module; stock tracking on top of it is its
// own INVENTORY feature, so the two are gated separately even though they
// share this router.
const fnb = requireCafeFeature('FNB');
const inventory = requireCafeFeature('INVENTORY');

// Any signed-in customer may read the menu — it is what they order from.
productsRouter.get('/menu', requireAuth, fnb, customerMenu);

// Literal paths before "/:id".
productsRouter.post('/upload-image', staff, fnb, catalogAssetUpload, handleCatalogUploadErrors, uploadProductImage);
productsRouter.get('/categories', staff, fnb, listCategories);
productsRouter.post('/categories', staff, fnb, createCategory);
productsRouter.put('/categories/:id', staff, fnb, updateCategory);
productsRouter.delete('/categories/:id', staff, fnb, deleteCategory);
productsRouter.get('/inventory/summary', staff, inventory, inventorySummary);

productsRouter.get('/', staff, fnb, listProducts);
productsRouter.post('/', staff, fnb, createProduct);
productsRouter.put('/:id', staff, fnb, updateProduct);
productsRouter.patch('/:id/availability', staff, fnb, setAvailability);
productsRouter.delete('/:id', staff, fnb, deleteProduct);
productsRouter.post('/:id/stock', staff, inventory, adjustStock);
productsRouter.get('/:id/movements', staff, inventory, listMovements);

export default productsRouter;
