/*
 * Location master routes.
 *
 * Reads are public because the signup form needs them before anyone has an
 * account, and a list of countries is not sensitive. Writes require a
 * ManagerXP administrator: this is one shared table for every tenant, so a
 * café editing it would be editing every other café's list too.
 *
 * There is deliberately no create or delete endpoint. The master is filled by
 * the importer from a dataset file; the only mutation an operator needs is
 * switching something off, which is reversible.
 */
import express from 'express';
import {
  listCountries, listStates, listCities, getCountryBundle, setLocationActive
} from '../controllers/locations.Controller.js';
import { requireAdmin, requirePermission } from '../middleware/adminAuth.js';

const router = express.Router();

router.get('/countries', listCountries);
router.get('/countries/:countryId/states', listStates);
router.get('/states/:stateId/cities', listCities);
router.get('/country/:countryId', getCountryBundle);

router.patch('/:kind/:id/status', requireAdmin, requirePermission('settings.edit'), setLocationActive);

export default router;
