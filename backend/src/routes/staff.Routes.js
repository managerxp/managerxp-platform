import express from 'express';
import {
  staffLogin, whoAmI, listStaff, createStaff, updateStaff, setStaffStatus,
  listRoles, listPermissions, createRole, setRolePermissions, deleteRole,
  createPermission, deletePermission
} from '../controllers/staff.Controller.js';
import { requireStaff, requireAuth, requirePermission } from '../middleware/authGuards.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const staffRouter = express.Router();
const feature = requireCafeFeature('STAFF');

// Public: staff sign in here. Not feature-gated — a café that has staff
// accounts (created while the feature was on) must still be able to sign
// them in even if the feature is later switched off, the same way an
// expired subscription still lets someone see why it is expired.
staffRouter.post('/login', loginLimiter, staffLogin);

// Any authenticated principal can ask what it is allowed to do — the admin UI
// uses this to hide what the signed-in person cannot use.
staffRouter.get('/me', requireAuth, whoAmI);

// Reading the catalogue needs only staff access; changing it needs the right.
staffRouter.get('/permissions', requireStaff(), feature, listPermissions);
staffRouter.post('/permissions', requirePermission('staff.manage'), feature, createPermission);
staffRouter.delete('/permissions/:key', requirePermission('staff.manage'), feature, deletePermission);
staffRouter.get('/roles', requirePermission('staff.view'), feature, listRoles);
staffRouter.post('/roles', requirePermission('staff.manage'), feature, createRole);
staffRouter.put('/roles/:id/permissions', requirePermission('staff.manage'), feature, setRolePermissions);
staffRouter.delete('/roles/:id', requirePermission('staff.manage'), feature, deleteRole);

staffRouter.get('/', requirePermission('staff.view'), feature, listStaff);
staffRouter.post('/', requirePermission('staff.manage'), feature, createStaff);
staffRouter.put('/:id', requirePermission('staff.manage'), feature, updateStaff);
staffRouter.patch('/:id/status', requirePermission('staff.manage'), feature, setStaffStatus);

export default staffRouter;
