import express from 'express';
import {
  listSettings,
  getSettingByKey,
  updateSetting,
  updateSettings,
  effectiveSettings
} from '../controllers/settings.Controller.js';
import { requireStaff, requirePermission } from '../middleware/authGuards.js';

const settingsRouter = express.Router();

/*
 * These routes used to sit behind a bare `requireStaff`, which meant any staff
 * account — a cashier included — could read and change every café-wide setting,
 * the hourly rate among them. The `settings.view` and `settings.manage`
 * permissions existed in the catalogue but nothing checked them.
 *
 * Owners still pass both, because an owner token is treated as full authority.
 */
const canRead = requirePermission('settings.view');
const canWrite = requirePermission('settings.manage');

// `effective` is the resolved values the apps run on. Any staff surface may
// need them to render correctly, so it stays open to staff.
settingsRouter.get('/effective', requireStaff('Café staff access required'), effectiveSettings);

// Literal path before "/:key", or it would be read as a key.
settingsRouter.get('/', canRead, listSettings);
settingsRouter.put('/', canWrite, updateSettings);
settingsRouter.get('/:key', canRead, getSettingByKey);
settingsRouter.put('/:key', canWrite, updateSetting);

export default settingsRouter;
