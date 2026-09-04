import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AdminSidebar from '../components/admin/AdminSidebar';
import UserManagementPage from '../components/admin/UserManagementPage';
import SubscriptionPlansPage from '../components/admin/SubscriptionPlansPage';
import SoftwareMasterManagement from '../components/admin/pcSoftwareMasterManagement';
import OverviewPage from '../components/admin/OverviewPage';
import CustomersPage from '../components/admin/CustomersPage';
import SubscriptionsPage from '../components/admin/SubscriptionsPage';
import PaymentLinksPage from '../components/admin/PaymentLinksPage';
import PlanPricingPanel from '../components/admin/PlanPricingPanel';
import LicensesPage from '../components/admin/LicensesPage';

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const [activeMenu, setActiveMenu] = useState('overview');

  /*
   * "Send payment link" on a customer card jumps to the links page with that
   * café already chosen. Carried in state rather than a route param because
   * this dashboard has no routing of its own, and making the admin re-find the
   * customer in a dropdown they just clicked is the kind of small friction
   * that stops links being sent.
   */
  const [prefillCafe, setPrefillCafe] = useState(null);

  const openLinkFor = (cafe) => {
    setPrefillCafe(cafe);
    setActiveMenu('links');
  };

  return (
    <section className="h-screen overflow-hidden bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="h-[calc(100svh-3rem)] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
          <div className="grid h-full lg:grid-cols-[260px_1fr]">
            <AdminSidebar
              user={user}
              activeMenu={activeMenu}
              onMenuChange={setActiveMenu}
              onLogout={logout}
            />

            <div className="min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-7">
              {activeMenu === 'overview' && <OverviewPage />}
              {activeMenu === 'customers' && <CustomersPage onCreateLink={openLinkFor} />}
              {activeMenu === 'subscriptions' && <SubscriptionsPage />}
              {activeMenu === 'links' && (
                <PaymentLinksPage
                  prefillCafe={prefillCafe}
                  onPrefillUsed={() => setPrefillCafe(null)}
                />
              )}
              {activeMenu === 'licenses' && <LicensesPage />}
              {activeMenu === 'plans' && (
                <>
                  <PlanPricingPanel />
                  <SubscriptionPlansPage />
                </>
              )}
              {activeMenu === 'software' && <SoftwareMasterManagement />}
              {activeMenu === 'users' && <UserManagementPage />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AdminDashboard;
