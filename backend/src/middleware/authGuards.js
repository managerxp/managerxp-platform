import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/*
 * Auth guards for the wallet routes.
 *
 * Both the customer app and the admin console sign their tokens with the same
 * JWT_SECRET, so the payload shape tells them apart:
 *   customer token -> { customer_id, email, customer_name }
 *   staff token    -> { id, email, role }
 */

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const describe = (payload) =>
  payload.role
    ? `staff:${payload.email || payload.id}`
    : `customer:${payload.email || payload.customer_id}`;

/**
 * Reading a wallet: a customer may only read their own; any staff token may
 * read anyone's.
 */
export const canReadWallet = (req, res, next) => {
  const payload = readToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const targetId = parseInt(req.params.customerId, 10);
  const isStaff = !!payload.role;
  const isOwner = Number(payload.customer_id) === targetId;

  // Shared by wallet and billing, so the wording stays resource-agnostic.
  if (!isStaff && !isOwner) {
    return res.status(403).json({ success: false, message: 'You can only view your own records' });
  }

  req.actor = { ...payload, isStaff, label: describe(payload) };
  next();
};

/**
 * Any valid token. Populates req.actor so the controller can decide ownership
 * itself — used where the record's owner is not in the URL.
 */
/**
 * Is this token the vendor's, rather than a café's?
 *
 * `role === 'admin'` is not the answer and never was: café owners live in the
 * same `users` table and one of them has that role today. The only reliable
 * mark is an `admin_users` token carrying the managerxp-admin audience, which
 * a café token cannot be made to satisfy.
 *
 * Exported so controllers scoping their own reads ask the same question as the
 * guards do, instead of each inventing a looser version of it.
 */
export const isPlatformAdminToken = (req) => {
  const payload = readToken(req);
  if (!payload || !payload.admin_user_id) return false;
  try {
    jwt.verify(
      (req.headers.authorization || '').slice(7).trim(),
      process.env.JWT_SECRET,
      { audience: 'managerxp-admin' }
    );
    return true;
  } catch {
    return false;
  }
};

export const requireAuth = (req, res, next) => {
  const payload = readToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  req.actor = {
    ...payload,
    isStaff: !!payload.role,
    /* Carried on the actor so a controller can widen a scope for the vendor
       without re-deriving what "vendor" means. */
    isPlatformAdmin: isPlatformAdminToken(req),
    label: describe(payload)
  };
  next();
};

/**
 * Staff-only routes. Used for anything that exposes other people's data or
 * changes their balance.
 */
export const requireStaff = (message) => (req, res, next) => {
  const payload = readToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (!payload.role) {
    return res.status(403).json({
      success: false,
      message: message || 'Café staff access required'
    });
  }

  req.actor = { ...payload, isStaff: true, label: describe(payload) };
  next();
};

/**
 * Moving money: staff only. A customer must never be able to credit their own
 * wallet, so the customer app is deliberately read-only here.
 */
export const canMoveMoney = requireStaff('Only café staff can adjust a wallet');

/**
 * The ManagerXP platform administrator — the vendor, not a café.
 *
 * This is a different axis of authority to everything else in this file. A
 * café owner has total power over their own café and none at all here; the
 * platform admin sells subscriptions, suspends installs and sees every
 * tenant's billing.
 *
 * The distinction matters because `requirePermission` treats any token with a
 * `role` and no `staff_id` as full authority — correct for a café owner inside
 * their café, catastrophic if reused here, since it would let one customer
 * cancel another's subscription. So this checks the role *value*, not merely
 * its presence: signup issues 'user', and only the platform login issues
 * 'admin'.
 */
export const requirePlatformAdmin = (req, res, next) => {
  const payload = readToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  /*
   * A ManagerXP administrator token is the same authority in its newer form.
   *
   * Administrators used to be a `users` row with role = 'admin'; they are now
   * an `admin_users` row with an audience-scoped token. These endpoints
   * predate that and still check the old shape, so without this an
   * administrator who signed in through the single door would be refused by
   * the very screens they are the administrator of.
   *
   * The audience claim is what makes this safe to accept: a café owner's
   * token carries no audience and cannot be made to satisfy it, so this
   * widens who may pass by exactly one principal — the vendor.
   */
  if (payload.admin_user_id) {
    try {
      jwt.verify(
        (req.headers.authorization || '').slice(7).trim(),
        process.env.JWT_SECRET,
        { audience: 'managerxp-admin' }
      );
      req.actor = {
        ...payload,
        isStaff: true,
        isPlatformAdmin: true,
        label: `platform:${payload.email}`
      };
      return next();
    } catch {
      return res.status(403).json({ success: false, message: 'Not available for this account' });
    }
  }

  /*
   * Anything that is not a ManagerXP admin token is refused.
   *
   * This used to accept any `users` row whose role happened to be 'admin' —
   * the same table every café owner lives in. That made platform authority a
   * single UPDATE away from any customer account, and it meant one account
   * could be both a café owner and the vendor at once.
   *
   * Administrators now live in `admin_users` and sign in through the single
   * door, which hands them an audience-scoped token; the branch above accepts
   * exactly that and nothing else. The old shape is gone rather than
   * deprecated, because a fallback nobody needs is a fallback nobody checks.
   *
   * Deliberately not "you are not an admin" — that confirms the endpoint
   * exists and is worth attacking. It is simply not available to them.
   */
  return res.status(403).json({ success: false, message: 'Not available for this account' });
};

/**
 * The one automated caller allowed to publish a client release: the GitHub
 * release workflow, right after it builds an installer. Not a JWT — CI has
 * no interactive session to hold one, and baking a person's admin login into
 * a permanent GitHub Secret is worse than a token whose only power is one
 * route.
 *
 * On a match, proceeds straight to the route handler. Otherwise calls
 * `next('route')` — not plain `next()` — which skips the REST of this same
 * route's own handler array (createRelease would otherwise run
 * unauthenticated) and moves on to the next registered route matching this
 * path: the ordinary admin-gated `/releases` route further down in
 * platform.Routes.js. That route still runs requirePlatformAdmin exactly as
 * before, so a missing or wrong token here ends up refused exactly like
 * today, never let through.
 */
export const requireReleaseAgent = (req, res, next) => {
  const configured = process.env.RELEASE_PUBLISH_TOKEN;
  const header = req.headers.authorization || '';

  if (configured && header.startsWith('Bearer ')) {
    const provided = Buffer.from(header.slice(7).trim());
    const expected = Buffer.from(configured);
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      req.actor = { isStaff: true, isPlatformAdmin: true, isReleaseAgent: true, label: 'release-agent' };
      return next();
    }
  }

  next('route');
};

/**
 * Require a specific permission.
 *
 * The café-owner token predates the staff system and carries no permission
 * list; it is treated as full authority. A staff token carries its role's keys,
 * so the check is a membership test rather than a query on every request.
 */
export const requirePermission = (permissionKey) => (req, res, next) => {
  const payload = readToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (!payload.role) {
    return res.status(403).json({ success: false, message: 'Café staff access required' });
  }

  const isOwnerToken = !payload.staff_id;
  const granted = Array.isArray(payload.permissions) ? payload.permissions : [];

  if (!isOwnerToken && !granted.includes(permissionKey)) {
    return res.status(403).json({
      success: false,
      message: `Your role does not allow this (${permissionKey})`,
      data: { required: permissionKey }
    });
  }

  req.actor = {
    ...payload,
    isStaff: true,
    isOwner: isOwnerToken,
    permissions: granted,
    label: describe(payload)
  };
  next();
};
