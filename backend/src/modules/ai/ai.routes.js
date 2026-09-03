import express from 'express';
import { askController, healthController, suggestionsController } from './ai.controller.js';
import { requirePermission } from '../../middleware/authGuards.js';
import { requireCafeFeature } from '../entitlements/entitlements.service.js';

const aiRouter = express.Router();

/*
 * CafeXP AI sits behind its own permission rather than riding on reports.view.
 *
 * The AI reaches across revenue, sessions, stations, F&B, customers and
 * payments in a single question. A cashier who may see the till should not
 * gain the café's full trading picture simply because an AI endpoint exists —
 * which is exactly what would happen if this were guarded by requireStaff.
 *
 * Every route is read-only. There is no write endpoint in this module, and the
 * tool layer contains no statement that is not a SELECT.
 */
const canAsk = requirePermission('ai.ask');

/*
 * `canAsk` only checks the caller's ROLE — it says nothing about whether this
 * café's subscription includes the module at all. Without this, ManagerXP
 * switching the AI feature off for one customer (section 57's entitlement
 * overrides) hid the sidebar entry in the desktop console but left the
 * endpoint itself answering, since nothing here ever consulted the same
 * resolver.
 */
const requireAi = requireCafeFeature('AI');

aiRouter.get('/health', canAsk, requireAi, healthController);
aiRouter.get('/suggestions', canAsk, requireAi, suggestionsController);
aiRouter.post('/ask', canAsk, requireAi, askController);

export default aiRouter;
