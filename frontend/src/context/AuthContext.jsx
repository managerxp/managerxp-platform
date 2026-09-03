import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { portalAuth } from '../lib/portalApi';
import { adminAuth } from '../lib/adminApi';

const AuthContext = createContext(null);

const API_BASE_URL = import.meta.env.VITE_API_URL;

const normalizeUser = (user) => {
  if (!user) return null;

  let normalizedAddress = user.address;
  if (typeof user.address === 'string') {
    try {
      normalizedAddress = JSON.parse(user.address);
    } catch {
      normalizedAddress = user.address;
    }
  }

  return {
    ...user,
    address: normalizedAddress,
    cafe_id: user.cafe_id || null,
  };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('mxp_user');
    return saved ? normalizeUser(JSON.parse(saved)) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('mxp_token'));
  const [isLoading, setIsLoading] = useState(false);

  /*
   * Two kinds of principal sign in here, and they are not interchangeable:
   *
   *   owner — /api/auth/login, a `users` row. Carries a role but no staff_id,
   *           which the backend treats as full authority.
   *   staff — /api/staff/login, a `staff` row. Carries staff_id and an explicit
   *           permission list that the backend checks on every request.
   *
   * `kind` is kept alongside the token so the UI can tell them apart without
   * having to decode the JWT, and `permissions` is stored so a screen can hide
   * what this person cannot do rather than let them hit a 403.
   */
  const [kind, setKind] = useState(() => localStorage.getItem('mxp_kind') || null);
  const [permissions, setPermissions] = useState(() => {
    const saved = localStorage.getItem('mxp_permissions');
    try { return saved ? JSON.parse(saved) : []; } catch { return []; }
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('mxp_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('mxp_user');
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('mxp_token', token);
    } else {
      localStorage.removeItem('mxp_token');
    }
  }, [token]);

  useEffect(() => {
    if (kind) localStorage.setItem('mxp_kind', kind);
    else localStorage.removeItem('mxp_kind');
  }, [kind]);

  /*
   * The CafeXP portal verifies the same JWT this context already holds, so an
   * owner who signs in here is signed in there too. Mirroring the token is
   * what makes that true in practice — without it the portal would bounce a
   * signed-in owner to a login page they had just come from.
   *
   * Staff tokens are deliberately not mirrored, and displace any portal
   * session that was there. A staff token carries a staff_id and belongs to
   * one café's till, not to the account that owns the subscription; the
   * portal's own guard would reject it, and copying it in would only produce a
   * confusing failure one screen later.
   *
   * Absence of a token here is *not* a reason to clear the portal's. Signing
   * up through Start Trial establishes a portal session without ever touching
   * this context, and clearing on every mount would sign that customer out the
   * first time they refreshed. Only `logout` ends a portal session.
   *
   * This effect covers rehydration — an existing session restored from
   * localStorage on page load. It cannot cover signing in, because effects run
   * after commit and the dashboard checks for the token *during* its first
   * render; `login` therefore writes it synchronously as well.
   */
  useEffect(() => {
    if (token && kind === 'owner') portalAuth.setToken(token);
    else if (token && kind === 'staff') portalAuth.signOut();
  }, [token, kind]);

  useEffect(() => {
    localStorage.setItem('mxp_permissions', JSON.stringify(permissions || []));
  }, [permissions]);

  /**
   * The single sign-in door.
   *
   * One form for both principals. The server decides which this is — a
   * ManagerXP administrator or a café owner — and says so in `kind`; this
   * stores the right token and tells the caller where to send them.
   *
   * The two are never both held at once. Holding an admin token and an owner
   * token simultaneously would make "who am I" ambiguous on every subsequent
   * screen, so signing in as one clears the other.
   */
  const signIn = async (payload) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        // `verification_required`/`email` ride on a 403 when the address has
        // never been confirmed — carried on the thrown error, the same way
        // portalApi/adminApi attach `.data`, so the login screen can open the
        // code step instead of just showing red text.
        const err = new Error(result.message || 'Login failed');
        err.data = result.data;
        throw err;
      }

      if (result.data?.kind === 'admin') {
        portalAuth.signOut();
        adminAuth.setToken(result.data.token);
        adminAuth.setAdmin(result.data.admin);
        // The café-owner context stays empty: an administrator is not a
        // customer and must not appear as one anywhere in the app.
        setUser(null);
        setToken(null);
        setKind(null);
        setPermissions([]);
        return { kind: 'admin', admin: result.data.admin };
      }

      adminAuth.signOut();
      const nextUser = normalizeUser(result.data?.user);
      const nextToken = result.data?.token;
      if (nextToken) portalAuth.setToken(nextToken);

      setUser(nextUser);
      setToken(nextToken || null);
      setKind('owner');
      setPermissions([]);

      return { kind: 'owner', user: nextUser };
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (payload) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Login failed');
      }

      const nextUser = normalizeUser(result.data?.user);
      const nextToken = result.data?.token;

      // Written before the caller navigates: the dashboard reads this during
      // its first render, which happens before any effect of ours can run.
      if (nextToken) portalAuth.setToken(nextToken);

      setUser(nextUser);
      setToken(nextToken || null);
      setKind('owner');
      // An owner has no permission list because it needs none.
      setPermissions([]);

      return nextUser;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Finish a "Sign in with Google" round trip.
   *
   * The backend has already done the real work — verified the Google identity,
   * found or made the account, and minted an ordinary owner token — and handed
   * both back through the callback URL. This just adopts them the same way
   * `login` does, so a Google session is indistinguishable from a password one
   * everywhere downstream.
   */
  const completeGoogleLogin = (nextToken, rawUser) => {
    if (!nextToken) throw new Error('No sign-in token was returned');
    const nextUser = normalizeUser(rawUser);
    adminAuth.signOut();
    portalAuth.setToken(nextToken);
    setUser(nextUser);
    setToken(nextToken);
    setKind('owner');
    setPermissions([]);
    return nextUser;
  };

  /**
   * Store sign-in: a café's own staff (cashier, attendant, manager).
   * Their permissions come back with the token and are enforced server-side —
   * what is stored here only decides what the UI bothers to offer.
   */
  const staffLogin = async (payload) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/staff/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Sign in failed');
      }

      const staff = result.data?.staff;
      const nextUser = normalizeUser({
        ...staff,
        // The rest of the app reads `name`/`email`/`role`, so present a staff
        // record in the same shape rather than special-casing every consumer.
        name: staff?.staff_name,
        role: staff?.role_name,
      });

      // A till sign-in is a different principal; it ends any portal session
      // rather than inheriting one.
      portalAuth.signOut();

      setUser(nextUser);
      setToken(result.data?.token || null);
      setKind('staff');
      setPermissions(result.data?.permissions || []);

      return nextUser;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (payload) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Signup failed');
      }

      const nextUser = normalizeUser(result.data?.user);
      const nextToken = result.data?.token;

      if (nextToken) portalAuth.setToken(nextToken);

      setUser(nextUser);
      setToken(nextToken || null);
      setKind('owner');
      setPermissions([]);

      return nextUser;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * The two halves of finishing a signup or an interrupted first login:
   * entering the code, and asking for a new one. Both are public endpoints —
   * no token exists yet at this point, that is the entire reason they exist.
   */
  const verifyEmail = async (email, code) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not verify that code');
    }
    return result.data;
  };

  const resendVerification = async (email) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();
    // Always answers the same shape on success — the endpoint itself never
    // leaks whether the address had anything pending.
    if (!response.ok) throw new Error(result.message || 'Could not send a new code');
    return result;
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setKind(null);
    setPermissions([]);
    // Also ends the portal session, including the organization and branch
    // scope — signing out should not leave the next person's portal pointed at
    // this one's business.
    portalAuth.signOut();
    adminAuth.signOut();
  };

  const updateUser = (updates) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = typeof updates === 'function' ? updates(prev) : { ...prev, ...updates };
      return normalizeUser(next);
    });
  };

  /**
   * Whether this principal may do something.
   *
   * The owner token holds no permission list because the backend grants it
   * everything, so an owner answers true to any key. Every other answer comes
   * from the list the server issued — and the server checks again regardless,
   * so this only decides what the UI offers.
   */
  const can = useCallback(
    (permissionKey) => {
      if (!user || !token) return false;
      if (kind === 'owner') return true;
      if (!permissionKey) return true;
      return (permissions || []).includes(permissionKey);
    },
    [user, token, kind, permissions]
  );

  const value = useMemo(
    () => ({
      user,
      token,
      kind,
      permissions,
      isOwner: kind === 'owner',
      isStaff: kind === 'staff',
      isAuthenticated: Boolean(user && token),
      isLoading,
      signIn,
      login,
      completeGoogleLogin,
      staffLogin,
      register,
      verifyEmail,
      resendVerification,
      logout,
      updateUser,
      can,
    }),
    [user, token, kind, permissions, isLoading, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
