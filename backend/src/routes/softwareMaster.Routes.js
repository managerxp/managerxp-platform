import express from 'express';
import {
  upload,
  createSoftware,
  getAllSoftware,
  getSoftwareById,
  updateSoftware,
  deleteSoftware,
  permanentDeleteSoftware,
  getSoftwareCategories,
  createHouseActivity,
  updateHouseActivity,
  deleteHouseActivity,
  setSoftwareCategory
} from '../controllers/softwareMaster.controller.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/authGuards.js';

const softwareMasterRouter = express.Router();

/*
 * The gaming software catalogue — the titles ManagerXP publishes, with their
 * artwork and trailers. A café's console picks from this list when it links a
 * game to a station, and the station shows the artwork to the player.
 *
 * Every route here was previously unauthenticated, including the permanent
 * delete. Anyone who could reach the server could upload a 50 MB file or erase
 * the catalogue every café reads from. The split now is:
 *
 *   READ   any signed-in principal. The café console and its stations need
 *          the catalogue to work, and a game's name and cover art are not a
 *          secret — they are published to be seen.
 *
 *   WRITE  ManagerXP administrators only. This is one shared catalogue across
 *          every customer, so a café editing it would be editing every other
 *          café's library too.
 */
softwareMasterRouter.get('/', requireAuth, getAllSoftware);

/* Must be declared before '/:id', or Express reads "categories" as an id and
   this endpoint is never reached. */
softwareMasterRouter.get('/categories', requireAuth, getSoftwareCategories);

/*
 * House activities — what the café itself sells time on.
 *
 * A pool table or a dartboard is not something ManagerXP publishes, and before
 * these routes existed there was no way to price one: the price master can only
 * reference a row in this table, and only an administrator could create one.
 *
 * Café-writable, and narrow on purpose. The controller refuses any of these
 * against a published title, so a café can add and manage its own dartboard
 * and cannot rename or delete somebody else's catalogue.
 */
softwareMasterRouter.post('/house', requireAuth, createHouseActivity);
softwareMasterRouter.put('/house/:id', requireAuth, updateHouseActivity);
softwareMasterRouter.delete('/house/:id', requireAuth, deleteHouseActivity);

/*
 * Filing a title into a category is café-writable for both kinds.
 *
 * A category is not part of a title's identity — it is how this café arranges
 * its own till. Making an operator raise a ticket with ManagerXP because their
 * PS5 tiles sit under the wrong tab would be absurd. Name, artwork and whether
 * a published title exists at all remain administrator-only below.
 */
softwareMasterRouter.patch('/:id/category', requireAuth, setSoftwareCategory);

softwareMasterRouter.get('/:id', requireAuth, getSoftwareById);

softwareMasterRouter.post('/', requirePlatformAdmin, upload, createSoftware);
softwareMasterRouter.put('/:id', requirePlatformAdmin, upload, updateSoftware);

/* Deactivates — the title stops being offered but the row survives, so a
   station that still has it linked does not lose its artwork. */
softwareMasterRouter.delete('/:id', requirePlatformAdmin, deleteSoftware);

/* Actually destroys the row and its uploaded files. Kept separate from the
   soft delete precisely because it cannot be undone. */
softwareMasterRouter.delete('/permanent/:id', requirePlatformAdmin, permanentDeleteSoftware);

export default softwareMasterRouter;
