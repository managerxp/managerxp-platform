// components/CafeManager.jsx
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../context/AuthContext';

const API_BASE_URL = `${import.meta.env.VITE_API_URL}/api`;

const CafeManager = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    user_id: user?.id || '',
    user_designation: '',
    description: '',
    address: {
      street: '',
      city: '',
      state: '',
      country: '',
      zip_code: ''
    }
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name.includes('address.')) {
      const addressField = name.split('.')[1];
      setFormData({
        ...formData,
        address: {
          ...formData.address,
          [addressField]: value
        }
      });
    } else {
      setFormData({
        ...formData,
        [name]: value
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const branches = [{
        street: formData.address.street,
        city: formData.address.city,
        state: formData.address.state,
        country: formData.address.country,
        zip_code: formData.address.zip_code
      }];

      const cafeData = {
        name: formData.name,
        user_id: parseInt(formData.user_id),
        user_designation: formData.user_designation,
        description: formData.description,
        branches: branches
      };

      await axios.post(`${API_BASE_URL}/cafes`, cafeData);
      toast.success('Cafe created successfully!');
      
      // Navigate to user dashboard after successful creation
      setTimeout(() => {
        navigate('/dashboard');
      }, 1500);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create cafe');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <ToastContainer position="top-right" theme="dark" />
      
      {/* Form Container */}
      <div className="w-full px-6 py-6 lg:px-8">
        <div className="max-w-2xl mx-auto bg-gradient-to-br from-gray-900 to-black rounded-2xl border border-red-500/30 shadow-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Cafe Name */}
            <div>
              <label htmlFor="cafe-name" className="block text-red-400 font-semibold mb-1.5">Cafe Name *</label>
              <input
                type="text"
                id="cafe-name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500 transition-colors"
                placeholder="Enter cafe name"
              />
            </div>

            {/* Designation */}
            <div>
              <label htmlFor="cafe-user-designation" className="block text-red-400 font-semibold mb-1.5">Designation *</label>
              <input
                type="text"
                id="cafe-user-designation"
                name="user_designation"
                value={formData.user_designation}
                onChange={handleInputChange}
                required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                placeholder="e.g., Manager, Owner"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="cafe-description" className="block text-red-400 font-semibold mb-1.5">Description</label>
              <textarea
                id="cafe-description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows="2"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                placeholder="Describe your cafe..."
              />
            </div>

            {/* Branch Address Section */}
            <div className="border-t border-gray-700 pt-3">
              <h3 className="text-sm font-semibold text-white mb-3">Branch Address</h3>
              
              <div className="space-y-3">
                {/* Street Address */}
                <div>
                  <label htmlFor="cafe-address-street" className="block text-gray-300 mb-1.5 text-sm">Street Address *</label>
                  <input
                    type="text"
                    id="cafe-address-street"
                    name="address.street"
                    value={formData.address.street}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                    placeholder="Street address"
                  />
                </div>

                {/* City and State */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cafe-address-city" className="block text-gray-300 mb-1.5 text-sm">City *</label>
                    <input
                      type="text"
                      id="cafe-address-city"
                      name="address.city"
                      value={formData.address.city}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label htmlFor="cafe-address-state" className="block text-gray-300 mb-1.5 text-sm">State *</label>
                    <input
                      type="text"
                      id="cafe-address-state"
                      name="address.state"
                      value={formData.address.state}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                      placeholder="State"
                    />
                  </div>
                </div>

                {/* Country and Zip Code */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cafe-address-country" className="block text-gray-300 mb-1.5 text-sm">Country *</label>
                    <input
                      type="text"
                      id="cafe-address-country"
                      name="address.country"
                      value={formData.address.country}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                      placeholder="Country"
                    />
                  </div>
                  <div>
                    <label htmlFor="cafe-address-zip-code" className="block text-gray-300 mb-1.5 text-sm">Zip Code *</label>
                    <input
                      type="text"
                      id="cafe-address-zip-code"
                      name="address.zip_code"
                      value={formData.address.zip_code}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
                      placeholder="Zip code"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Form Buttons */}
            <div className="flex gap-2 pt-3 border-t border-gray-700">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {loading ? 'Creating Cafe...' : 'Create Cafe'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/user-dashboard')}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors font-semibold text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CafeManager;