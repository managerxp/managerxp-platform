/*
 * ManagerXP admin API.
 *
 * Mounted at /api/admin. Everything below the auth block requires a
 * ManagerXP administrator token — never a café owner's, whatever role value
 * it happens to carry — and every write additionally requires the permission
 * named on its line.
 *
 * Section 40: "Do not rely only on frontend route visibility." The sidebar
 * decides what is offered; these guards decide what is possible.
 */
import express from 'express';
import {
  login, me, logout, forgotPassword, resetPassword, changePassword
} from '../controllers/adminAuth.Controller.js';
import {
  dashboard,
  listOrganizations, getOrganization, getOrganizationEntitlements,
  setOverride, setOrganizationStatus,
  listStationTypes,
  listPackages, getPackage, createPackage, updatePackage,
  setPackageFeatures, setPackagePrices,
  listFeatureMaster, createFeature, updateFeature,
  listAddons, createAddon, updateAddon, deleteAddon,
  listAudit
} from '../controllers/admin.Controller.js';
import {
  listBranches, getPcPool, updateBranch,
  listSubscriptions, getSubscriptionDetail, updateSubscription,
  extendSubscription, setSubscriptionStatus,
  addSubscriptionAddon, removeSubscriptionAddon
} from '../controllers/adminBranches.Controller.js';
import {
  listInstallations, setInstallationStatus, forceReauth,
  listDevices, setDeviceStatus
} from '../controllers/adminEstate.Controller.js';
import {
  runBilling, createInvoice, listInvoices, getInvoice,
  listPayments, recordPayment, refundPayment, voidInvoice
} from '../controllers/adminBilling.Controller.js';
import {
  listGateways, saveGateway, verifyGateway, createInvoicePaymentLink, listOutbox,
  listPaymentLinks, createStandaloneLink, sendPaymentLink, cancelPaymentLink
} from '../controllers/adminGateway.Controller.js';
import {
  listPlatformSettings, updatePlatformSettings, sendTestEmail
} from '../controllers/adminSettings.Controller.js';
import {
  listAdminUsers, createAdminUser, updateAdminUser, resetAdminPassword,
  listLoginEvents, listRoles, setRolePermissions, createRole
} from '../controllers/adminUsers.Controller.js';
import { requireAdmin, requirePermission } from '../middleware/adminAuth.js';
import { loginLimiter, resetLimiter } from '../middleware/rateLimit.js';
import {
  adminListTickets, adminGetTicket, adminReply, adminUpdateTicket, adminGetAttachment
} from '../controllers/support.Controller.js';
import {
  listCatalog, getCatalogGame, createCatalogGame, updateCatalogGame, deleteCatalogGame,
  createPlatform, updatePlatform, deletePlatform,
  uploadCatalogLogo, uploadCatalogCover
} from '../controllers/gameCatalog.Controller.js';
import { catalogAssetUpload, handleCatalogUploadErrors } from '../middleware/catalogAssetUpload.js';
import { supportUpload, handleUploadErrors } from '../middleware/supportUpload.js';

const router = express.Router();

/* ==========================================================================
   PUBLIC — the door itself

   These four are the only unauthenticated routes. Rate limiting and lockout
   live inside the controller, on the database row, so restarting the process
   does not reset an attacker's allowance.
   ========================================================================== */
/* The controller already enforces a per-account lockout on the database row;
   these IP limiters sit in front of it as defence in depth — a distributed or
   enumeration attempt is turned away before it reaches the account logic. */
router.post('/auth/login', loginLimiter, login);
router.post('/auth/forgot-password', resetLimiter, forgotPassword);
router.post('/auth/reset-password', resetLimiter, resetPassword);

/* ========================================================================== */
router.use(requireAdmin);

router.get('/auth/me', me);
router.post('/auth/logout', logout);
router.post('/auth/change-password', changePassword);

router.get('/dashboard', dashboard);

/* Customers. Suspending one stops a café trading, so it sits behind its own
   permission rather than riding on organizations.edit. */
router.get('/organizations', requirePermission('organizations.view'), listOrganizations);
router.get('/organizations/:id', requirePermission('organizations.view'), getOrganization);
router.get('/organizations/:id/entitlements', requirePermission('organizations.view'), getOrganizationEntitlements);
router.put('/organizations/:id/overrides/:featureKey', requirePermission('subscriptions.edit'), setOverride);
router.post('/organizations/:id/status', requirePermission('organizations.suspend'), setOrganizationStatus);

/* Branches, across every customer. The PC pool sits under the organization
   because that is what owns the capacity — a branch only draws on it. */
router.get('/branches', requirePermission('branches.view'), listBranches);
router.patch('/branches/:id', requirePermission('branches.edit'), updateBranch);
router.get('/organizations/:id/pool', requirePermission('branches.view'), getPcPool);

/* Subscriptions. Extending and changing status are separate from the general
   editor because they are the two an operator reaches for under pressure, and
   because cancelling is not something to reach by accident inside a form. */
router.get('/subscriptions', requirePermission('subscriptions.view'), listSubscriptions);
router.get('/subscriptions/:id', requirePermission('subscriptions.view'), getSubscriptionDetail);
router.patch('/subscriptions/:id', requirePermission('subscriptions.edit'), updateSubscription);
router.post('/subscriptions/:id/extend', requirePermission('subscriptions.edit'), extendSubscription);
router.post('/subscriptions/:id/status', requirePermission('subscriptions.cancel', 'subscriptions.edit'), setSubscriptionStatus);
router.post('/subscriptions/:id/addons', requirePermission('subscriptions.edit'), addSubscriptionAddon);
router.delete('/subscriptions/:id/addons/:rowId', requirePermission('subscriptions.edit'), removeSubscriptionAddon);

/* SaaS billing — what cafés pay ManagerXP. Deliberately not the café's own
   till: `payments.view` here is subscription revenue, never a gamer's bill.
   The billing run creates money owed across every customer at once, so it
   needs the same permission as issuing an invoice by hand. */
router.get('/invoices', requirePermission('payments.view'), listInvoices);
router.get('/invoices/:id', requirePermission('payments.view'), getInvoice);
router.post('/invoices', requirePermission('subscriptions.edit'), createInvoice);
router.post('/invoices/:id/payments', requirePermission('payments.view'), recordPayment);
router.post('/invoices/:id/void', requirePermission('subscriptions.edit'), voidInvoice);

router.get('/payments', requirePermission('payments.view'), listPayments);
router.post('/payments/:id/refund', requirePermission('payments.refund'), refundPayment);

router.post('/billing/run', requirePermission('subscriptions.edit'), runBilling);

/* ManagerXP's own merchant account, and the links it issues. Configuring a
   gateway is a payments concern; issuing a link against an invoice demands
   the same permission as recording money against one. */
router.get('/gateways', requirePermission('payments.view'), listGateways);
router.put('/gateways/:provider', requirePermission('settings.edit', 'payments.view'), saveGateway);
router.post('/gateways/:provider/verify', requirePermission('settings.edit', 'payments.view'), verifyGateway);
router.post('/invoices/:id/payment-link', requirePermission('payments.view'), createInvoicePaymentLink);
router.get('/email-outbox', requirePermission('payments.view'), listOutbox);

/* Standalone payment links — a bill before there is an invoice to bill
   against. Sending one is the same authority as raising one; cancelling is
   deliberately not, because a cancelled link a customer already holds is a
   support call. */
router.get('/payment-links', requirePermission('payments.view'), listPaymentLinks);
router.post('/payment-links', requirePermission('payments.view'), createStandaloneLink);
router.post('/payment-links/:id/send', requirePermission('payments.view'), sendPaymentLink);
router.post('/payment-links/:id/cancel', requirePermission('subscriptions.edit'), cancelPaymentLink);

/* The estate: what is installed and what is plugged into it. Revoking is
   separated from suspending because only one of them is reversible here. */
router.get('/installations', requirePermission('installations.view'), listInstallations);
router.post('/installations/:id/status', requirePermission('installations.revoke'), setInstallationStatus);
router.post('/installations/:id/reauth', requirePermission('installations.revoke'), forceReauth);

router.get('/devices', requirePermission('devices.view'), listDevices);
router.post('/devices/:id/status', requirePermission('devices.disable'), setDeviceStatus);

/* Package Master. */
router.get('/station-types', requirePermission('packages.view'), listStationTypes);
router.get('/packages', requirePermission('packages.view'), listPackages);
router.get('/packages/:id', requirePermission('packages.view'), getPackage);
router.post('/packages', requirePermission('packages.create'), createPackage);
router.patch('/packages/:id', requirePermission('packages.edit'), updatePackage);
router.put('/packages/:id/features', requirePermission('packages.edit'), setPackageFeatures);
router.put('/packages/:id/prices', requirePermission('packages.edit'), setPackagePrices);

/* Feature Master. */
router.get('/features', requirePermission('features.view'), listFeatureMaster);
router.post('/features', requirePermission('features.create'), createFeature);
router.patch('/features/:key', requirePermission('features.edit'), updateFeature);

/* Add-ons. */
router.get('/addons', requirePermission('addons.view'), listAddons);
router.post('/addons', requirePermission('addons.edit'), createAddon);
router.patch('/addons/:id', requirePermission('addons.edit'), updateAddon);
router.delete('/addons/:id', requirePermission('addons.edit'), deleteAddon);

/* Administrators and roles. Reading is dmins.view; anything that changes
   who can do what is dmins.manage. The controller adds the refusals that
   permissions cannot express — self-lockout, last super admin, and granting
   authority you do not hold. */
/* Support tickets. One permission covers the desk: somebody who answers
   customers needs to read every ticket and reply to it, and splitting "read"
   from "reply" would only produce a support agent who can see a problem and
   not respond to it. */
router.get('/support/tickets', requirePermission('support.manage'), adminListTickets);
router.get('/support/tickets/:id', requirePermission('support.manage'), adminGetTicket);
router.post('/support/tickets/:id/reply', requirePermission('support.manage'),
  supportUpload.array('files', 5), handleUploadErrors, adminReply);
router.patch('/support/tickets/:id', requirePermission('support.manage'), adminUpdateTicket);
router.get('/support/attachments/:id', requirePermission('support.manage'), adminGetAttachment);

/* The master Game Catalog. Every café's "add a game" list is a read of this;
   only ManagerXP staff with catalogue.manage can write to it. */
router.get('/game-catalog', requirePermission('catalogue.view'), listCatalog);
router.post('/game-catalog', requirePermission('catalogue.manage'), createCatalogGame);
router.get('/game-catalog/:id', requirePermission('catalogue.view'), getCatalogGame);
router.patch('/game-catalog/:id', requirePermission('catalogue.manage'), updateCatalogGame);
router.delete('/game-catalog/:id', requirePermission('catalogue.manage'), deleteCatalogGame);
router.patch('/game-catalog/:id/logo', requirePermission('catalogue.manage'),
  catalogAssetUpload, handleCatalogUploadErrors, uploadCatalogLogo);
router.patch('/game-catalog/:id/cover', requirePermission('catalogue.manage'),
  catalogAssetUpload, handleCatalogUploadErrors, uploadCatalogCover);

/* One game, many stores. F1 25's Steam App ID and its EA launch config are
   different rows here, never fields squeezed onto the game itself. */
router.post('/game-catalog/:id/platforms', requirePermission('catalogue.manage'), createPlatform);
router.patch('/game-catalog/:id/platforms/:platformId', requirePermission('catalogue.manage'), updatePlatform);
router.delete('/game-catalog/:id/platforms/:platformId', requirePermission('catalogue.manage'), deletePlatform);

router.get('/admin-users', requirePermission('admins.view'), listAdminUsers);
router.post('/admin-users', requirePermission('admins.manage'), createAdminUser);
router.patch('/admin-users/:id', requirePermission('admins.manage'), updateAdminUser);
router.post('/admin-users/:id/reset', requirePermission('admins.manage'), resetAdminPassword);
router.get('/admin-users/:id/logins', requirePermission('admins.view'), listLoginEvents);

router.get('/roles', requirePermission('admins.view'), listRoles);
router.post('/roles', requirePermission('admins.manage'), createRole);
router.put('/roles/:id/permissions', requirePermission('admins.manage'), setRolePermissions);

/* Platform settings. Scoped to scope = 'platform' in the controller, so a
   café-facing caller can never reach them and this one can never reach a
   café's own configuration. */
router.get('/settings', requirePermission('settings.edit'), listPlatformSettings);
router.put('/settings', requirePermission('settings.edit'), updatePlatformSettings);
router.post('/settings/test-email', requirePermission('settings.edit'), sendTestEmail);

router.get('/audit', requirePermission('audit.view'), listAudit);

export default router;
