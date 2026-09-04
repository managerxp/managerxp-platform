import express from 'express';
import {
  listZones,
  createZone,
  updateZone,
  deleteZone,
  assignStations
} from '../controllers/floorZones.Controller.js';
import { requireStaff, requirePermission } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const floorZonesRouter = express.Router();
const feature = requireCafeFeature('FLOOR');

// Anyone who can see the floor can see how it is divided up.
floorZonesRouter.get('/', requireStaff('Café staff access required'), feature, listZones);

// Rearranging it is a manager's job.
const canEdit = requirePermission('floor.layout');

// Literal path before "/:id", or "assign" would be read as an id.
floorZonesRouter.put('/assign', canEdit, feature, assignStations);

floorZonesRouter.post('/', canEdit, feature, createZone);
floorZonesRouter.put('/:id', canEdit, feature, updateZone);
floorZonesRouter.delete('/:id', canEdit, feature, deleteZone);

export default floorZonesRouter;
