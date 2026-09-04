import express from 'express';
import {
  startSession,
  listSessions,
  getSession,
  pauseSession,
  resumeSession,
  extendSession,
  transferSession,
  endSession,
  cancelSession,
  getDefaults
} from '../controllers/session.Controller.js';
import { requireStaff } from '../middleware/authGuards.js';
import { requireCafeFeature } from '../modules/entitlements/entitlements.service.js';

const sessionRouter = express.Router();

// Sessions are a staff surface end to end — the client learns about its own
// session from the admin over the existing WebSocket, not from here.
const staff = requireStaff('Café staff access required');
const feature = requireCafeFeature('SESSION_MANAGEMENT');

sessionRouter.get('/defaults', staff, feature, getDefaults);
sessionRouter.get('/', staff, feature, listSessions);
sessionRouter.post('/', staff, feature, startSession);
sessionRouter.get('/:id', staff, feature, getSession);
sessionRouter.post('/:id/pause', staff, feature, pauseSession);
sessionRouter.post('/:id/resume', staff, feature, resumeSession);
sessionRouter.post('/:id/extend', staff, feature, extendSession);
sessionRouter.post('/:id/transfer', staff, feature, transferSession);
sessionRouter.post('/:id/end', staff, feature, endSession);

/* Started by mistake. Records who and when, releases the station, charges
   nothing — and never removes the row. */
sessionRouter.post('/:id/cancel', staff, feature, cancelSession);

export default sessionRouter;
