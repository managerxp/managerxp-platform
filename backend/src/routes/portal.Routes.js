import express from 'express';
import {
  signup, me, dashboard,
  getOrganization, updateOrganization, createOrganization,
  listBranches, createBranch, updateBranch,
  subscription, listDevices, listInstallations, revokeInstallation,
  listUsers, inviteUser, acceptInvite
} from '../controllers/portal.Controller.js';
import { requirePortalUser, withOrganization, withBranch, requireOwner } from '../middleware/tenancy.js';
import {
  portalListTickets, portalCreateTicket, portalGetTicket, portalReply, portalCloseTicket,
  portalGetAttachment
} from '../controllers/support.Controller.js';
import { supportUpload, handleUploadErrors } from '../middleware/supportUpload.js';

const router = express.Router();

/* ==========================================================================
   PUBLIC

   Signup creates the account, the business, the branch and the trial in one
   transaction. Accepting an invitation is public for the same reason a
   password reset is: the person has no account to sign in with yet, and the
   single-use token in the request is what authenticates them.
   ========================================================================== */
router.post('/signup', signup);
router.post('/invites/accept', acceptInvite);

/* ==========================================================================
   AUTHENTICATED

   Everything below is scoped by membership. `withOrganization` resolves which
   business this is and refuses any id the user is not a member of;
   `withBranch` does the same for a location, and allows an "all branches"
   view for anyone entitled to more than one.
   ========================================================================== */
router.use(requirePortalUser);

// Spans every organization the user belongs to, so it takes no org scope.
router.get('/me', me);

router.get('/dashboard', withOrganization(), withBranch(), dashboard);

/* No org scope, because the caller has none yet — that is the point of it.
   The handler refuses an account that already belongs to a business. */
router.post('/organizations', createOrganization);

router.get('/organization', withOrganization(), getOrganization);
router.patch('/organization', withOrganization(), requireOwner, updateOrganization);

router.get('/branches', withOrganization(), listBranches);
router.post('/branches', withOrganization(), requireOwner, createBranch);
router.patch('/branches/:branchId', withOrganization(), requireOwner, updateBranch);

router.get('/subscription', withOrganization({ allowSuspended: true }), subscription);

router.get('/devices', withOrganization(), withBranch(), listDevices);
router.get('/installations', withOrganization(), withBranch(), listInstallations);
router.post('/installations/:installationId/revoke', withOrganization(), requireOwner, revokeInstallation);

router.get('/users', withOrganization(), listUsers);
router.post('/users/invite', withOrganization(), requireOwner, inviteUser);

/* Support. Scoped to the business, not to the person who typed it — a café
   with two owners and a manager needs all of them to be able to follow up.
   `allowSuspended` on purpose: a customer whose account is suspended over an
   unpaid invoice is exactly who most needs to reach support. */
router.get('/support/tickets', withOrganization({ allowSuspended: true }), portalListTickets);
/* `supportUpload` only engages for multipart bodies — a plain JSON ticket with
   no screenshot passes straight through it untouched. */
router.post('/support/tickets', withOrganization({ allowSuspended: true }), withBranch(),
  supportUpload.array('files', 5), handleUploadErrors, portalCreateTicket);
router.get('/support/tickets/:id', withOrganization({ allowSuspended: true }), portalGetTicket);
router.post('/support/tickets/:id/reply', withOrganization({ allowSuspended: true }),
  supportUpload.array('files', 5), handleUploadErrors, portalReply);
router.post('/support/tickets/:id/close', withOrganization({ allowSuspended: true }), portalCloseTicket);
/* Files are handed out here, never from a static folder — the handler checks
   the file belongs to this café before a byte is sent. */
router.get('/support/attachments/:id', withOrganization({ allowSuspended: true }), portalGetAttachment);

export default router;
