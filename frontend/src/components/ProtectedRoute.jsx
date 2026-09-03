import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Route guard.
 *
 * `adminOnly`      — the company-side admin console; owner accounts only.
 * `requirePermission` — a café permission key (e.g. 'billing.counter'). Café
 *                    owners hold everything; staff are checked against the
 *                    list their role was issued.
 * `staffAllowed`   — set false to keep a route for owners even when a staff
 *                    member technically has the permission.
 *
 * This is presentation only. Every endpoint behind these routes checks the
 * same rules server-side, so hiding a route is a courtesy, not the control.
 */
const ProtectedRoute = ({
  children,
  adminOnly = false,
  requirePermission = null,
  staffAllowed = true,
}) => {
  const { isAuthenticated, user, kind, can } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Staff sign in at their own door, so send them back to the right one.
    const target = requirePermission || kind === 'staff' ? '/store-login' : '/login';
    return <Navigate to={target} state={{ from: location }} replace />;
  }

  if (adminOnly && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  if (!staffAllowed && kind === 'staff') {
    return <Navigate to="/store" replace />;
  }

  if (requirePermission && !can(requirePermission)) {
    // Land somewhere that explains why, rather than bouncing to the homepage
    // with no reason given.
    return <Navigate to="/store" state={{ denied: requirePermission }} replace />;
  }

  return children;
};

export default ProtectedRoute;
