/*
 * Installation and device registration, for the CafeXP desktop apps.
 *
 * Two different principals reach this router, which is why the guards differ
 * per route:
 *
 *   A café PERSON — the owner signing in to the server app. They may register
 *   the installation and its stations, because they are the customer and this
 *   is their café.
 *
 *   The MACHINE — authenticating with the credential it was issued. It carries
 *   no user token at all, so /authorize is unguarded by design: the public_id
 *   and credential in the body *are* the authentication, checked in the
 *   handler against a bcrypt hash.
 */
import express from 'express';
import {
  registerInstallation, authorizeInstallation, registerDevice, listMine
} from '../controllers/installations.Controller.js';
import { requireStaff } from '../middleware/authGuards.js';

const router = express.Router();

/* The machine's own door. No user token — see the note above. */
router.post('/authorize', authorizeInstallation);

/* Everything else needs a signed-in café principal. */
const staff = requireStaff('Sign in to CafeXP first');

router.post('/register', staff, registerInstallation);
router.post('/devices', staff, registerDevice);
router.get('/mine', staff, listMine);

export default router;
