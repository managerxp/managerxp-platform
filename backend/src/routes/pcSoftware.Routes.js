import express from 'express';
import {
  getAllPcSoftware,
  getPcSoftwareById,
  getSoftwareByPcId,
  createPcSoftware,
  updatePcSoftware,
  deletePcSoftware,
  togglePcSoftwareStatus
} from '../controllers/pcSoftware.controller.js';
import { requireStaff } from '../middleware/authGuards.js';

const pcSoftwareRouter = express.Router();

/*
 * Which titles are installed on which station, and the path to launch them.
 *
 * Unlike the catalogue this is per-café data: it names executables on that
 * café's machines. It was entirely unauthenticated, which meant anyone
 * reaching the server could read every café's install paths or point a
 * station's "launch" at any file on disk.
 *
 * Café staff only. This is deliberately not admin-gated — linking a game to a
 * PC is the café's own work, done from its own console, and ManagerXP has no
 * business editing it.
 */
const staff = requireStaff('Café staff access required');

pcSoftwareRouter.get('/', staff, getAllPcSoftware);
pcSoftwareRouter.post('/', staff, createPcSoftware);
pcSoftwareRouter.get('/pc/:pcId', staff, getSoftwareByPcId);
pcSoftwareRouter.get('/:id', staff, getPcSoftwareById);
pcSoftwareRouter.put('/:id', staff, updatePcSoftware);
pcSoftwareRouter.delete('/:id', staff, deletePcSoftware);
pcSoftwareRouter.patch('/:id/toggle-status', staff, togglePcSoftwareStatus);

export default pcSoftwareRouter;