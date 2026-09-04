import React, { useState, useEffect } from 'react';
import { Zap, Rocket, ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const FreeTrialRibbon = () => {
  const [trialData, setTrialData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [hasExistingTrial, setHasExistingTrial] = useState(false);
  const { user, token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTrialData = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/subscription-plans/gamingxp-free-trial`);
        const result = await response.json();
        if (result.success && result.data.length > 0) {
          setTrialData(result.data[0]);
        }
      } catch (error) {
        console.error("Failed to fetch trial data:", error);
      }
    };

    fetchTrialData();
  }, []);

  // Check if user already has a free trial subscription
  useEffect(() => {
    const checkExistingTrial = async () => {
      if (!user?.cafe_id || !token) return;

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/subscriptions?cafe_id=${user.cafe_id}&is_active=true`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
          // Check if any subscription is a free trial
          const existingFreeTrial = result.data.some(
            (sub) => sub.sub_id === trialData?.sub_id && sub.is_active
          );
          setHasExistingTrial(existingFreeTrial);
        }
      } catch (error) {
        console.error('Failed to check existing trial:', error);
      }
    };

    if (trialData?.sub_id) {
      checkExistingTrial();
    }
  }, [user?.cafe_id, token, trialData?.sub_id]);

  const handleFreeTrialClick = async () => {
    // Check if user is logged in
    if (!user || !token) {
      setMessage({ type: 'error', text: 'Login required' });
      setTimeout(() => {
        navigate('/login');
      }, 2000);
      return;
    }

    // Check if user has a cafe
    if (!user.cafe_id) {
      setMessage({ type: 'error', text: 'Add cafe first then take free trial' });
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 3000);
      return;
    }

    // Check if user already has a free trial
    if (hasExistingTrial) {
      setMessage({ type: 'error', text: 'User already took free trial' });
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 3000);
      return;
    }

    // Proceed with free trial subscription
    setIsSubmitting(true);
    try {
      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + (trialData?.no_of_days || 15));

      const response = await fetch(`${API_BASE_URL}/api/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          cafe_id: user.cafe_id,
          sub_id: trialData.sub_id,
          max_pcs: trialData.max_pcs,
          start_date: today.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          is_active: true
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to start free trial');
      }

      setMessage({ type: 'success', text: 'Free trial started successfully!' });
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } catch (error) {
      console.error('Error starting free trial:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to start free trial' });
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 3000);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Extract dynamic values with fallbacks
  const days = trialData?.no_of_days || 15;
  const maxPcs = trialData?.max_pcs || 5;
  const softwareName = trialData?.subs_software?.toUpperCase() || 'GAMINGXP';

  return (
    <div className="relative w-full py-16 overflow-hidden bg-black">
      
      {/* Message Display */}
      {message.text && (
        <div
          className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg font-semibold text-white ${
            message.type === 'error' ? 'bg-red-600' : 'bg-green-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Background Slanted Ribbon Shape */}
      <div className="absolute inset-0 z-0">
        {/* The main dark background with skew */}
        <div 
          className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-black to-neutral-950 
                     border-y border-white/10
                     transform -skew-y-1 scale-110" 
        />
        
        {/* Ambient Red Glow */}
        <div className="absolute inset-0 opacity-60 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(220,38,38,0.15),transparent)]" />

        {/* Glowing Racing Lines */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-red-600/70 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-red-500/40 to-transparent" />
      </div>

      {/* Content Container */}
      <div className="relative z-10 max-w-4xl mx-auto px-5 sm:px-6 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12">

        {/* Text Section */}
        <div className="flex items-center gap-4 sm:gap-5 text-left">
          <div className="p-3 sm:p-3.5 rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm shrink-0">
            <Zap className="w-6 h-6 text-red-500 animate-pulse" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl md:text-3xl font-semibold text-white tracking-tight text-balance">
              START YOUR <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-red-700">{days}-DAY</span> TRIAL
            </h3>
            <p className="text-[11px] sm:text-xs text-neutral-400 font-mono uppercase tracking-wider mt-1">
              Access {softwareName} on up to {maxPcs} PCs — No credit card required
            </p>
          </div>
        </div>

        {/* Vertical Divider (Visible on Desktop) */}
        <div className="hidden md:block h-12 w-[1px] bg-gradient-to-b from-transparent via-neutral-700 to-transparent" />

        {/* Button Section */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-6 w-full md:w-auto shrink-0">
          <button
            onClick={handleFreeTrialClick}
            disabled={isSubmitting || hasExistingTrial}
            className="group relative flex items-center justify-center gap-3 px-8 py-3.5
                       text-sm font-semibold rounded-full text-white overflow-hidden
                       transition-all duration-300
                       bg-red-600/10 border border-red-500/30
                       hover:bg-red-600/20 hover:border-red-500/60
                       active:scale-95 motion-reduce:active:scale-100
                       shadow-[0_0_25px_-10px_rgba(220,38,38,0.4)]
                       backdrop-blur-md
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {/* Shine Animation */}
            <div aria-hidden="true" className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12 rounded-full" />

            <Rocket className="w-4 h-4 relative z-10 text-red-400 group-hover:text-white transition-colors" />
            <span className="relative z-10">{isSubmitting ? 'STARTING...' : hasExistingTrial ? 'FREE TRIAL USED' : 'START FREE TRIAL'}</span>
          </button>

          {/* Secondary Ghost Button */}
          <Link
            to="/products"
            className="group flex items-center justify-center gap-2 px-4 py-3 text-neutral-500 text-xs font-mono transition-colors hover:text-white border border-transparent hover:border-white/10 rounded-full"
          >
            VIEW PLANS
            <ArrowRight className="w-3 h-3 sm:opacity-0 sm:-translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default FreeTrialRibbon;