import express from 'express';
import {
  ingest,
  latest,
  history,
  alerts,
  clearStation
} from '../controllers/telemetry.Controller.js';
import { requireStaff, requirePermission } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const telemetryRouter = express.Router();

const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('PC_CONTROL');

// The admin console relays what its stations report.
telemetryRouter.post('/', staff, feature, ingest);

// Literal paths before "/:pcName".
telemetryRouter.get('/latest', requirePermission('telemetry.view'), feature, latest);
telemetryRouter.get('/alerts', requirePermission('telemetry.view'), feature, alerts);
telemetryRouter.get('/history/:pcName', requirePermission('telemetry.view'), feature, history);

// Wiping a station's history is a management action, not a viewing one.
telemetryRouter.delete('/:pcName', requirePermission('floor.layout'), feature, clearStation);

export default telemetryRouter;
