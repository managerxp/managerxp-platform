import express from 'express';
import { listAudit, auditFacets, entityHistory } from '../controllers/audit.Controller.js';
import { requirePermission } from '../middleware/authGuards.js';

const auditRouter = express.Router();

// Read only, by design: rows are written by the actions they describe and
// nothing is allowed to edit or remove them afterwards.
const canRead = requirePermission('audit.view');

auditRouter.get('/facets', canRead, auditFacets);
auditRouter.get('/entity/:entity/:id', canRead, entityHistory);
auditRouter.get('/', canRead, listAudit);

export default auditRouter;
