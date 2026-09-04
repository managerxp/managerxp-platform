import express from 'express';
import { listActions, authorisePower } from '../controllers/stationPower.Controller.js';
import { requirePermission } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const stationPowerRouter = express.Router();

const canPower = requirePermission('station.power');
const feature = requireCafeFeature('PC_CONTROL');

stationPowerRouter.get('/power/actions', canPower, feature, listActions);
stationPowerRouter.post('/power', canPower, feature, authorisePower);

export default stationPowerRouter;
