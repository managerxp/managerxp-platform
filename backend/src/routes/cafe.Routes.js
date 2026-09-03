// cafeRoutes.js
import express from 'express';
import {
  createCafe,
  updateCafe,
  deleteCafe,
  getAllCafes,
  getCafeById
} from '../controllers/cafe.Controller.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/authGuards.js';

const cafeRouter = express.Router();

/*
 * Cafés — the customers of the platform.
 *
 * Every route here was open. Anyone who could reach the port could list every
 * café registered with ManagerXP, and rename or delete any of them. The list
 * alone is commercially sensitive: it tells one operator who else is a
 * customer and how many there are.
 *
 *   READ   any signed-in principal, scoped in the controller. A café sees its
 *          own; a platform administrator sees all.
 *
 *   WRITE  platform administrators only. Creating, renaming and deleting a
 *          café is an act of running the platform, not of running a café.
 */
cafeRouter.get('/', requireAuth, getAllCafes);
cafeRouter.get('/:cafe_id', requireAuth, getCafeById);

cafeRouter.post('/', requirePlatformAdmin, createCafe);
cafeRouter.put('/:cafe_id', requirePlatformAdmin, updateCafe);
cafeRouter.delete('/:cafe_id', requirePlatformAdmin, deleteCafe);

export default cafeRouter;
