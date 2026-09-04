import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const fetchWithFallback = async (paths) => {
  let lastError;

  for (const path of paths) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`);
      if (!response.ok) {
        lastError = new Error(`Request failed with status ${response.status}`);
        continue;
      }

      const payload = await response.json();
      if (!payload.success) {
        lastError = new Error(payload.message || 'Request failed');
        continue;
      }

      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to fetch data');
};

const StatCard = ({ label, value, tone }) => (
  <div
    className={`rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${tone}`}
  >
    <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">{label}</p>
    <p className="mt-3 text-2xl sm:text-3xl font-semibold text-white">{value}</p>
  </div>
);

const ProfileSection = ({ user, onUpdate, isLoading, error }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone_number: user?.phone_number || user?.phoneNumber || '',
    addressLine: typeof user?.address === 'string'
      ? user.address
      : user?.address?.street || user?.address?.line1 || '',
  });

  useEffect(() => {
    setFormData({
      name: user?.name || '',
      email: user?.email || '',
      phone_number: user?.phone_number || user?.phoneNumber || '',
      addressLine: typeof user?.address === 'string'
        ? user.address
        : user?.address?.street || user?.address?.line1 || '',
    });
  }, [user]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = (e) => {
    e.preventDefault();
    onUpdate(formData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData({
      name: user?.name || '',
      email: user?.email || '',
      phone_number: user?.phone_number || user?.phoneNumber || '',
      addressLine: typeof user?.address === 'string'
        ? user.address
        : user?.address?.street || user?.address?.line1 || '',
    });
    setIsEditing(false);
  };

  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-950/90 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-6 sm:p-7 hover:bg-white/5 transition-colors group"
      >
        <h2 className="text-xl font-semibold text-white">Profile Information</h2>
        <div className="flex items-center space-x-3">
          {!isExpanded && (
            <span className="text-xs text-neutral-400">
              {user?.name || 'Not set'}
            </span>
          )}
          <span className="text-neutral-400 group-hover:text-red-400 transition-colors">
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      <div
        className={`transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
        }`}
      >
        <div className="border-t border-neutral-800 p-6 sm:p-7">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            </div>
          )}
          
          {error && (
            <div className="mb-4 rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-3">
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          {!isLoading && (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-medium text-neutral-300">
                    Full Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-white outline-none transition focus:border-red-500 focus:ring-1 focus:ring-red-500 disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="Enter your full name"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-neutral-300">
                    Email Address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-white outline-none transition focus:border-red-500 focus:ring-1 focus:ring-red-500 disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="Enter your email"
                  />
                </div>

                <div>
                  <label htmlFor="phone_number" className="mb-2 block text-sm font-medium text-neutral-300">
                    Phone Number
                  </label>
                  <input
                    id="phone_number"
                    name="phone_number"
                    value={formData.phone_number}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-white outline-none transition focus:border-red-500 focus:ring-1 focus:ring-red-500 disabled:opacity-70 disabled:cursor-not-allowed"
                    placeholder="Enter your phone number"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="addressLine" className="mb-2 block text-sm font-medium text-neutral-300">
                    Address
                  </label>
                  <textarea
                    id="addressLine"
                    name="addressLine"
                    value={formData.addressLine}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    rows={3}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-white outline-none transition focus:border-red-500 focus:ring-1 focus:ring-red-500 disabled:opacity-70 disabled:cursor-not-allowed resize-none"
                    placeholder="Enter your address"
                  />
                </div>
              </div>

              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-500 transition-all duration-300"
                >
                  Edit Profile
                </button>
              ) : (
                <div className="flex space-x-3">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-500 transition-all duration-300"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 rounded-xl border border-neutral-700 px-6 py-2.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-800 transition-all duration-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

const SubscriptionCard = ({ subscription }) => {
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getDaysRemaining = (endDate) => {
    if (!endDate) return null;
    const end = new Date(endDate);
    const now = new Date();
    const diffTime = end - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const daysRemaining = getDaysRemaining(subscription?.end_date);
  const isExpiringSoon = daysRemaining !== null && daysRemaining <= 7 && daysRemaining > 0;
  const isExpired = daysRemaining !== null && daysRemaining <= 0;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-950 to-black p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{subscription?.name || 'No Active Plan'}</h3>
          <p className="text-xs text-neutral-400 mt-1">{subscription?.subs_software}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            subscription?.is_active && !isExpired
              ? 'border-green-700/70 bg-green-900/30 text-green-200'
              : 'border-neutral-700 bg-neutral-900 text-neutral-400'
          }`}
        >
          {subscription?.is_active && !isExpired ? 'Active' : isExpired ? 'Expired' : 'Inactive'}
        </span>
      </div>

      {subscription && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-xs text-neutral-400">Max PCs</p>
              <p className="text-sm font-semibold text-white">{subscription.max_pcs || 0}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">Max Branches</p>
              <p className="text-sm font-semibold text-white">{subscription.max_branches || 0}</p>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-400">Start Date</span>
              <span className="text-white">{formatDate(subscription.start_date)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-neutral-400">End Date</span>
              <span className="text-white">{formatDate(subscription.end_date)}</span>
            </div>
          </div>

          {daysRemaining !== null && !isExpired && (
            <div className={`mt-3 rounded-lg p-2 text-center text-xs font-medium ${
              isExpiringSoon 
                ? 'bg-yellow-900/30 text-yellow-200 border border-yellow-700/50'
                : 'bg-green-900/20 text-green-200'
            }`}>
              {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining
            </div>
          )}

          {subscription.is_freetrial && (
            <div className="mt-3 rounded-lg bg-blue-900/20 p-2 text-center">
              <p className="text-xs text-blue-200">Free Trial Plan</p>
              <p className="text-xs text-neutral-400 mt-1">{subscription.description}</p>
            </div>
          )}

          {subscription.games_allowed && (
            <div className="mt-3">
              <p className="text-xs text-neutral-400 mb-1">Games Allowed</p>
              <p className="text-xs text-white">{subscription.games_allowed}</p>
            </div>
          )}
        </>
      )}

      {!subscription && (
        <div className="text-center py-6">
          <p className="text-sm text-neutral-400">No active subscription found</p>
          <button className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-all duration-300">
            Subscribe Now
          </button>
        </div>
      )}
    </div>
  );
};

const CafeCard = ({ cafe }) => {
  const branchCount = useMemo(
    () => Array.isArray(cafe.branches) ? cafe.branches.filter(Boolean).length : 0,
    [cafe.branches]
  );

  return (
    <article className="group rounded-2xl border border-neutral-800 bg-black/55 p-5 transition-all duration-300 hover:border-red-700/60 hover:shadow-[0_14px_30px_rgba(185,28,28,0.18)] hover:-translate-y-1">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold text-white leading-tight line-clamp-1 flex-1">
          {cafe.name}
        </h3>
        <span
          className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            cafe.is_active
              ? 'border-red-700/70 bg-red-900/30 text-red-200'
              : 'border-neutral-700 bg-neutral-900 text-neutral-400'
          }`}
        >
          {cafe.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {cafe.description && (
        <p className="mt-2 text-sm text-neutral-300 line-clamp-2">
          {cafe.description}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-neutral-400">
        <span>{branchCount} branch{branchCount !== 1 ? 'es' : ''}</span>
        <span className="font-mono text-neutral-500">ID: {cafe.cafe_id}</span>
      </div>
    </article>
  );
};

const UserDashboard = () => {
  const { user, token, isAuthenticated, updateUser } = useAuth();
  const navigate = useNavigate();

  const [profileLoading, setProfileLoading] = useState(true);
  const [cafesLoading, setCafesLoading] = useState(true);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [cafesError, setCafesError] = useState('');
  const [subscriptionError, setSubscriptionError] = useState('');
  const [cafes, setCafes] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);

  const abortControllerRef = useRef(null);

  useEffect(() => {
    let ignore = false;

    const loadProfile = async () => {
      setProfileLoading(true);
      setProfileError('');

      try {
        const payload = await fetchWithFallback(['/api/auth/users']);
        if (ignore) return;

        const users = Array.isArray(payload.data) ? payload.data : [];
        const matchedUser = users.find((entry) => (
          (user?.id && entry.id === user.id) ||
          (user?.email && entry.email === user.email)
        ));

        if (matchedUser && !ignore) {
          updateUser(matchedUser);
        }
      } catch (error) {
        if (!ignore) {
          setProfileError(error.message || 'Failed to load your profile');
        }
      } finally {
        if (!ignore) {
          setProfileLoading(false);
        }
      }
    };

    if (user?.email) {
      loadProfile();
    }

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    // Cancel previous request if exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    const loadCafes = async () => {
      setCafesLoading(true);
      setCafesError('');

      try {
        const payload = await fetchWithFallback(['/api/cafe', '/api/cafes']);
        setCafes(Array.isArray(payload.data) ? payload.data : []);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setCafesError(error.message || 'Failed to load cafes');
        }
      } finally {
        setCafesLoading(false);
      }
    };

    loadCafes();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Load subscriptions for all cafes
  useEffect(() => {
    const loadSubscriptions = async () => {
      if (!cafes.length) {
        setSubscriptionLoading(false);
        return;
      }

      setSubscriptionLoading(true);
      setSubscriptionError('');
      
      const subscriptionPromises = cafes.map(async (cafe) => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/subscriptions/cafe/${cafe.cafe_id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!response.ok) {
            return null;
          }
          const payload = await response.json();
          if (payload.success && Array.isArray(payload.data) && payload.data.length > 0) {
            return {
              cafeId: cafe.cafe_id,
              cafeName: cafe.name,
              subscription: payload.data[0] // Get the first/active subscription
            };
          }
          return null;
        } catch (error) {
          console.error(`Failed to load subscription for cafe ${cafe.cafe_id}:`, error);
          return null;
        }
      });

      try {
        const results = await Promise.all(subscriptionPromises);
        const validSubscriptions = results.filter(result => result !== null);
        setSubscriptions(validSubscriptions);
      } catch (error) {
        setSubscriptionError(error.message || 'Failed to load subscriptions');
      } finally {
        setSubscriptionLoading(false);
      }
    };

    loadSubscriptions();
  }, [cafes, token]);

  const userCafes = useMemo(
    () => cafes.filter((cafe) => String(cafe.user_id) === String(user?.id)),
    [cafes, user?.id]
  );

  const personalCafeCount = useMemo(
    () => userCafes.length,
    [userCafes]
  );

  const activeCafeCount = useMemo(
    () => userCafes.filter((cafe) => cafe.is_active).length,
    [userCafes]
  );

  const handleProfileUpdate = useCallback((formData) => {
    updateUser((prev) => ({
      ...prev,
      name: formData.name,
      email: formData.email,
      phone_number: formData.phone_number,
      address: formData.addressLine,
    }));
  }, [updateUser]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  return (
    <section className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Enhanced Background Effects */}
      <div className="pointer-events-none fixed inset-0 will-change-transform">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(220,38,38,0.35),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(127,29,29,0.25),transparent_50%),radial-gradient(circle_at_40%_90%,rgba(220,38,38,0.15),transparent_45%)]" />
        <div className="absolute top-0 -left-40 w-80 h-80 bg-red-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 -right-40 w-80 h-80 bg-red-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {/* Welcome Section - Enhanced */}
          <div className="group overflow-hidden rounded-3xl border border-red-900/30 bg-gradient-to-br from-neutral-950/80 via-black to-red-950/30 backdrop-blur-xl hover:border-red-800/50 transition-all duration-500">
            <div className="absolute inset-0 bg-gradient-to-br from-red-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative grid gap-6 p-8 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:p-12">
              <div className="space-y-3 z-10">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-400">Welcome Back</p>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-red-100 to-white bg-clip-text text-transparent">
                  {user?.name?.split(' ')[0] || 'User'}
                </h1>
                <p className="text-sm sm:text-base text-neutral-400 leading-relaxed max-w-lg">
                  Manage your profile and explore your cafe network with ManagerXP
                </p>
              </div>

              <div className="rounded-2xl border border-red-800/40 bg-gradient-to-br from-black/80 to-red-950/40 backdrop-blur p-6 z-10">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-300 mb-5">Quick Stats</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                    <span className="text-xs text-neutral-400">My Cafes</span>
                    <span className="text-lg font-bold text-white">{cafesLoading ? '...' : personalCafeCount}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-red-900/20 hover:bg-red-900/30 transition-colors">
                    <span className="text-xs text-neutral-400">Active Cafes</span>
                    <span className="text-lg font-bold text-red-200">{cafesLoading ? '...' : activeCafeCount}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                    <span className="text-xs text-neutral-400">My Cafes</span>
                    <span className="text-lg font-bold text-white">{cafesLoading ? '...' : personalCafeCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Conditional Display: Cafe Network + Add Cafe (no cafe) OR Current Subscriptions (has cafe) */}
          {!user?.cafe_id ? (
            // Show Cafe Network with Add Cafe button when user has no cafe
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.5fr]">
              {/* Profile Section - Accordion Style */}
              <ProfileSection
                user={user}
                onUpdate={handleProfileUpdate}
                isLoading={profileLoading}
                error={profileError}
              />

              {/* Cafes Section - Enhanced */}
              <div className="group rounded-3xl border border-neutral-800/60 bg-gradient-to-br from-neutral-950/60 to-black/80 backdrop-blur-xl overflow-hidden hover:border-neutral-700/80 transition-all duration-500">
                <div className="relative p-8 sm:p-10 border-b border-neutral-800/40">
                  <div className="absolute inset-0 bg-gradient-to-r from-red-600/10 to-transparent opacity-0 group-hover:opacity-50 transition-opacity duration-500" />
                  <div className="relative flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">Network</p>
                      <h2 className="text-2xl font-bold text-white">Cafe Network</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-red-700/60 bg-gradient-to-r from-red-900/40 to-red-800/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-200">
                        {userCafes.length} Listed
                      </span>
                      <button
                        onClick={() => navigate('/add-cafe')}
                        className="rounded-xl bg-gradient-to-r from-red-600 to-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 hover:shadow-red-600/50 hover:from-red-500 hover:to-red-400 transition-all duration-300 whitespace-nowrap transform hover:scale-105"
                      >
                        + Add Cafe
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-8 sm:p-10">
                  {cafesLoading && (
                    <div className="flex items-center justify-center py-16">
                      <div className="relative w-12 h-12">
                        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-red-500 border-r-red-500/50"></div>
                      </div>
                    </div>
                  )}

                  {cafesError && (
                    <div className="rounded-xl border border-red-800/60 bg-red-950/30 px-5 py-4">
                      <p className="text-sm text-red-200">{cafesError}</p>
                    </div>
                  )}

                  {!cafesLoading && !cafesError && (
                    <>
                      {userCafes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                            <span className="text-2xl">🏪</span>
                          </div>
                          <p className="text-neutral-400 mb-1">No cafes yet</p>
                          <p className="text-xs text-neutral-500">Create your first cafe to get started</p>
                        </div>
                      ) : (
                        <div className="grid gap-5 sm:grid-cols-2">
                          {userCafes.map((cafe) => (
                            <CafeCard key={cafe.cafe_id} cafe={cafe} />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Show Current Subscriptions when user has a cafe
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.5fr]">
              {/* Profile Section - Accordion Style */}
              <ProfileSection
                user={user}
                onUpdate={handleProfileUpdate}
                isLoading={profileLoading}
                error={profileError}
              />

              {/* Subscription Plans Section - Enhanced */}
              <div className="group rounded-3xl border border-neutral-800/60 bg-gradient-to-br from-neutral-950/60 to-black/80 backdrop-blur-xl overflow-hidden hover:border-neutral-700/80 transition-all duration-500">
                <div className="relative p-8 sm:p-10 border-b border-neutral-800/40">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-transparent opacity-0 group-hover:opacity-50 transition-opacity duration-500" />
                  <div className="relative flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-1">Plans</p>
                      <h2 className="text-2xl font-bold text-white">Current Subscriptions</h2>
                    </div>
                    <span className="rounded-full border border-blue-700/60 bg-gradient-to-r from-blue-900/40 to-blue-800/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-blue-200">
                      {subscriptions.length} Active
                    </span>
                  </div>
                </div>

                <div className="p-8 sm:p-10">
                  {subscriptionLoading && (
                    <div className="flex items-center justify-center py-16">
                      <div className="relative w-12 h-12">
                        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/50"></div>
                      </div>
                    </div>
                  )}

                  {subscriptionError && (
                    <div className="rounded-xl border border-red-800/60 bg-red-950/30 px-5 py-4">
                      <p className="text-sm text-red-200">{subscriptionError}</p>
                    </div>
                  )}

                  {!subscriptionLoading && !subscriptionError && (
                    <>
                      {subscriptions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                            <span className="text-2xl">📋</span>
                          </div>
                          <p className="text-neutral-400 mb-1">No active subscriptions</p>
                          <button
                            onClick={() => navigate('/subscriptions')}
                            className="mt-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 transition-all duration-300 transform hover:scale-105"
                          >
                            Browse Plans
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {subscriptions.map((sub) => (
                            <div key={sub.cafeId} className="group relative rounded-2xl border border-neutral-800/60 bg-gradient-to-br from-neutral-900/50 to-black/70 p-6 hover:border-blue-700/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-600/20">
                              <div className="absolute -top-3 -left-3 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg z-10">
                                {sub.cafeName}
                              </div>
                              <SubscriptionCard subscription={sub.subscription} />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default UserDashboard;