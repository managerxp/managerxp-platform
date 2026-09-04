import express from 'express';
import {
  createSession,
  listSessions,
  getSessionById,
  updateSession,
  setSessionStatus,
  deleteSession
} from '../controllers/sessionMaster.Controller.js';
import { requireStaff } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const sessionMasterRouter = express.Router();

// Master data — staff only.
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('SESSION_MANAGEMENT');

sessionMasterRouter.get('/', staff, feature, listSessions);
sessionMasterRouter.post('/', staff, feature, createSession);
sessionMasterRouter.get('/:id', staff, feature, getSessionById);
sessionMasterRouter.put('/:id', staff, feature, updateSession);
sessionMasterRouter.patch('/:id/status', staff, feature, setSessionStatus);
sessionMasterRouter.delete('/:id', staff, feature, deleteSession);

export default sessionMasterRouter;
