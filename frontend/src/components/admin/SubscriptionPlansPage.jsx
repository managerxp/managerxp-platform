import React, { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const initialForm = {
  subs_software: 'gamingxp',
  name: '',
  description: '',
  max_branches: 1,
  is_single_pc_price: false,
  max_pcs: 1,
  games_allowed: [],
  is_telmetry_enabled: false,
  no_of_days: '',
  is_active: true,
};

const SubscriptionPlansPage = () => {
  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [gameInput, setGameInput] = useState('');

  const fetchPlans = async () => {
    setLoadingPlans(true);
    setPlansError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription-plans`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to fetch subscription plans');
      }

      setPlans(result.data || []);
    } catch (error) {
      setPlansError(error.message || 'Unable to load subscription plans');
    } finally {
      setLoadingPlans(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const onChange = (e) => {
    const { name, type, checked, value } = e.target;
    
    if (type === 'checkbox') {
      setForm((prev) => ({
        ...prev,
        [name]: checked,
      }));
    } else if (name === 'max_branches' || name === 'max_pcs' || name === 'no_of_days') {
      setForm((prev) => ({
        ...prev,
        [name]: parseInt(value) || 0,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleSoftwareChange = (e) => {
    const value = e.target.value;
    setForm((prev) => ({
      ...prev,
      subs_software: value,
      // Reset dependent fields when software changes
      games_allowed: value === 'gamingxp' ? prev.games_allowed : [],
      is_telmetry_enabled: value === 'gamingxp' ? prev.is_telmetry_enabled : false,
    }));
  };

  const addGame = () => {
    if (gameInput.trim() && !form.games_allowed.includes(gameInput.trim())) {
      setForm((prev) => ({
        ...prev,
        games_allowed: [...prev.games_allowed, gameInput.trim()],
      }));
      setGameInput('');
    }
  };

  const removeGame = (gameToRemove) => {
    setForm((prev) => ({
      ...prev,
      games_allowed: prev.games_allowed.filter(game => game !== gameToRemove),
    }));
  };

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
    setGameInput('');
  };

  const onEdit = (plan) => {
    setEditingId(plan.sub_id);
    setForm({
      subs_software: plan.subs_software || 'gamingxp',
      name: plan.name || '',
      description: plan.description || '',
      max_branches: Number(plan.max_branches || 1),
      is_single_pc_price: Boolean(plan.is_single_pc_price),
      max_pcs: Number(plan.max_pcs || 1),
      games_allowed: plan.games_allowed || [],
      is_telmetry_enabled: Boolean(plan.is_telmetry_enabled),
      no_of_days: Number(plan.no_of_days || ''),
      is_active: Boolean(plan.is_active),
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setPlansError('');

    try {
      const isEdit = Boolean(editingId);
      const url = isEdit
        ? `${API_BASE_URL}/api/subscription-plans/${editingId}`
        : `${API_BASE_URL}/api/subscription-plans`;

      const response = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || (isEdit ? 'Failed to update plan' : 'Failed to add plan'));
      }

      await fetchPlans();
      resetForm();
    } catch (error) {
      setPlansError(error.message || 'Unable to save subscription plan');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id) => {
    const ok = window.confirm('Delete this subscription plan?');
    if (!ok) return;

    setPlansError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription-plans/${id}`, {
        method: 'DELETE',
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to delete subscription plan');
      }

      await fetchPlans();
    } catch (error) {
      setPlansError(error.message || 'Unable to delete subscription plan');
    }
  };

  return (
    <div className="bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header Section */}
        <div className="mb-8 flex items-center justify-between border-b border-red-500/30 pb-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent">
              Subscription Plans
            </h1>
            <p className="text-gray-400 mt-1 text-sm">Manage your subscription plans and configurations</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-red-500/10 px-3 py-1 rounded-full border border-red-500/30">
              <span className="text-red-400 text-sm font-medium">Total: {plans.length}</span>
            </div>
            <button
              type="button"
              onClick={fetchPlans}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Form Section */}
        <form onSubmit={onSubmit} className="mb-8 bg-gradient-to-br from-neutral-900 to-black border border-red-500/20 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-semibold mb-4 text-red-400">
            {editingId ? 'Edit Subscription Plan' : 'Create New Subscription Plan'}
          </h2>
          
          <div className="grid md:grid-cols-2 gap-4">
            {/* Software Selection */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">Software Type *</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 hover:border-red-500 cursor-pointer transition-all">
                  <input
                    type="radio"
                    name="subs_software"
                    value="gamingxp"
                    checked={form.subs_software === 'gamingxp'}
                    onChange={handleSoftwareChange}
                    className="text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm">GamingXP</span>
                </label>
                <label className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 hover:border-red-500 cursor-pointer transition-all">
                  <input
                    type="radio"
                    name="subs_software"
                    value="cafexp"
                    checked={form.subs_software === 'cafexp'}
                    onChange={handleSoftwareChange}
                    className="text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm">CafeXP</span>
                </label>
              </div>
            </div>

            {/* Plan Name */}
            <div>
              <label htmlFor="plan-name" className="block text-sm font-medium text-gray-300 mb-2">Plan Name *</label>
              <input
                id="plan-name"
                name="name"
                value={form.name}
                onChange={onChange}
                placeholder="e.g., Premium, Basic, Pro"
                className="w-full bg-neutral-900 border border-red-500/30 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
                required
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label htmlFor="plan-description" className="block text-sm font-medium text-gray-300 mb-2">Description</label>
              <textarea
                id="plan-description"
                name="description"
                value={form.description}
                onChange={onChange}
                placeholder="Describe the features and benefits of this plan..."
                rows="3"
                className="w-full bg-neutral-900 border border-red-500/30 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            {/* Max Branches */}
            <div>
              <label htmlFor="plan-max-branches" className="block text-sm font-medium text-gray-300 mb-2">Maximum Branches *</label>
              <input
                id="plan-max-branches"
                name="max_branches"
                type="number"
                min="1"
                value={form.max_branches}
                onChange={onChange}
                className="w-full bg-neutral-900 border border-red-500/30 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
                required
              />
            </div>

            {/* Number of Days */}
            <div>
              <label htmlFor="plan-no-of-days" className="block text-sm font-medium text-gray-300 mb-2">Number of Days</label>
              <input
                id="plan-no-of-days"
                name="no_of_days"
                type="number"
                min="0"
                value={form.no_of_days}
                onChange={onChange}
                placeholder="e.g., 30, 365"
                className="w-full bg-neutral-900 border border-red-500/30 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            {/* Single PC Price Option */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer mt-7">
                <input
                  type="checkbox"
                  name="is_single_pc_price"
                  checked={form.is_single_pc_price}
                  onChange={onChange}
                  className="w-4 h-4 text-red-500 focus:ring-red-500 rounded"
                />
                <span className="text-sm text-gray-300">Single PC Pricing</span>
              </label>
            </div>

            {/* Max PCs - Only show if single PC price is NOT checked */}
            {!form.is_single_pc_price && (
              <div>
                <label htmlFor="plan-max-pcs" className="block text-sm font-medium text-gray-300 mb-2">Maximum PCs *</label>
                <input
                  id="plan-max-pcs"
                  name="max_pcs"
                  type="number"
                  min="1"
                  value={form.max_pcs}
                  onChange={onChange}
                  className="w-full bg-neutral-900 border border-red-500/30 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
                  required
                />
              </div>
            )}

            {/* Games Allowed - Only for GamingXP */}
            {form.subs_software === 'gamingxp' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">Allowed Games</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={gameInput}
                    onChange={(e) => setGameInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addGame()}
                    placeholder="Enter game name and press Enter"
                    aria-label="Add a game to this plan"
                    className="flex-1 bg-neutral-900 border border-red-500/30 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={addGame}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-all"
                  >
                    Add Game
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.games_allowed.map((game, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-sm"
                    >
                      {game}
                      <button
                        type="button"
                        onClick={() => removeGame(game)}
                        className="text-red-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Telemetry - Only for GamingXP */}
            {form.subs_software === 'gamingxp' && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="is_telmetry_enabled"
                    checked={form.is_telmetry_enabled}
                    onChange={onChange}
                    className="w-4 h-4 text-red-500 focus:ring-red-500 rounded"
                  />
                  <span className="text-sm text-gray-300">Enable Telemetry</span>
                </label>
              </div>
            )}

            {/* Active Status */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={form.is_active}
                  onChange={onChange}
                  className="w-4 h-4 text-red-500 focus:ring-red-500 rounded"
                />
                <span className="text-sm text-gray-300">Active Plan</span>
              </label>
            </div>

            {/* Form Actions */}
            <div className="md:col-span-2 flex gap-3 pt-4 border-t border-red-500/20">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-all"
              >
                {saving ? 'Saving...' : editingId ? 'Update Plan' : 'Create Plan'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-6 py-2 border border-red-500/30 hover:border-red-500 rounded-lg text-sm font-medium transition-all"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Error Message */}
        {plansError && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
            <p className="text-red-400 text-sm">{plansError}</p>
          </div>
        )}

        {/* Loading State */}
        {loadingPlans && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            <p className="ml-3 text-gray-400">Loading subscription plans...</p>
          </div>
        )}

        {/* Plans Table */}
        {!loadingPlans && !plansError && (
          <div className="overflow-x-auto rounded-xl border border-red-500/20 bg-gradient-to-br from-neutral-900 to-black">
            <table className="min-w-full">
              <thead className="bg-red-500/5 border-b border-red-500/20">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">ID</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Software</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Description</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Branches</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">PCs</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Days</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Games</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Telemetry</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Status</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-500/10">
                {plans.map((plan) => (
                  <tr key={plan.sub_id} className="hover:bg-red-500/5 transition-colors">
                    <td className="px-6 py-4 text-sm">{plan.sub_id}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        plan.subs_software === 'gamingxp' 
                          ? 'bg-purple-500/20 text-purple-300' 
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {plan.subs_software === 'gamingxp' ? 'GamingXP' : 'CafeXP'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">{plan.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-400 max-w-xs truncate">
                      {plan.description || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm">{plan.max_branches}</td>
                    <td className="px-6 py-4 text-sm">
                      {plan.is_single_pc_price ? 'Single PC' : plan.max_pcs}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {plan.no_of_days || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {plan.games_allowed && plan.games_allowed.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {plan.games_allowed.slice(0, 2).map((game, idx) => (
                            <span key={idx} className="text-xs bg-red-500/10 px-2 py-0.5 rounded">
                              {game}
                            </span>
                          ))}
                          {plan.games_allowed.length > 2 && (
                            <span className="text-xs text-gray-400">+{plan.games_allowed.length - 2}</span>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {plan.is_telmetry_enabled ? (
                        <span className="text-green-400">Enabled</span>
                      ) : (
                        <span className="text-gray-500">Disabled</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        plan.is_active 
                          ? 'bg-green-500/20 text-green-300' 
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {plan.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(plan)}
                          className="px-3 py-1 text-xs font-medium border border-red-500/30 hover:border-red-500 rounded transition-all"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(plan.sub_id)}
                          className="px-3 py-1 text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {plans.length === 0 && (
                  <tr>
                    <td colSpan="10" className="px-6 py-12 text-center text-gray-400">
                      <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      No subscription plans found. Create your first plan above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubscriptionPlansPage;