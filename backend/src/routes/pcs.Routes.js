import express from 'express';
import {
  getAllPCs,
  getPCById,
  createPC,
  updatePC,
  deletePC,
  restorePC,
  getPCsByBranch,
  getActivePCs,
  getPCsByCafe,
  checkPCExists,
  registerDiscoveredPC,
  reportClientVersion
} from '../controllers/pcs.Controller.js';
import { requireAuth, requireStaff } from '../middleware/authGuards.js';

const pcsRouter = express.Router();

/*
 * Stations.
 *
 * The mutating routes have been staff-only for a while. The reads were left
 * open on the reasoning that they "expose nothing beyond the café's own machine
 * names" — which was wrong. Every row carries the station's IP address, MAC
 * address and the port the console connects on, so the endpoint handed out a
 * map of a café's internal network to anyone who could reach the port.
 *
 * They now require a token and are scoped to the caller's own café inside the
 * controller: the vendor sees everything, everybody else sees their own, and
 * another café's stations read as absent rather than forbidden.
 */
const staff = requireStaff('Café staff access required');

pcsRouter.get('/', requireAuth, getAllPCs);
pcsRouter.get('/active', requireAuth, getActivePCs);
pcsRouter.get('/branch/:branchId', requireAuth, getPCsByBranch);
pcsRouter.get('/:id', requireAuth, getPCById);
pcsRouter.get('/cafe/:cafeId', requireAuth, getPCsByCafe);

// check-exists only answers "is this MAC known", and the discovery listener
// calls it as stations announce themselves, so it stays open.
pcsRouter.post('/check-exists', checkPCExists);

pcsRouter.post('/', staff, createPC);
pcsRouter.post('/register-discovered', staff, registerDiscoveredPC);
pcsRouter.put('/:id', staff, updatePC);
pcsRouter.delete('/:id', staff, deletePC);
pcsRouter.patch('/:id/restore', staff, restorePC);
pcsRouter.post('/:id/client-version', staff, reportClientVersion);

export default pcsRouter;
