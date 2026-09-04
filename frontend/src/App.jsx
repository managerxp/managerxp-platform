import React, { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import CookieConsent from './components/CookieConsent'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
// Home stays eager: it is the landing page, and deferring it would add a round
// trip to the one route most visitors hit first. Everything else loads on
// demand, which is what kept the entry chunk at 540 kB.
import Home from './Pages/Home'

const Products = lazy(() => import('./Pages/Products'))
const About = lazy(() => import('./Pages/About'))
const Contact = lazy(() => import('./Pages/Contact'))
const PrivacyPolicy = lazy(() => import('./Pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('./Pages/TermsOfService'))
const BookDemoPage = lazy(() => import('./Pages/BookDemo'))
const Login = lazy(() => import('./Pages/Login'))
const ForgotPassword = lazy(() => import('./Pages/ForgotPassword'))
const GoogleCallback = lazy(() => import('./Pages/GoogleCallback'))

const StoreLogin = lazy(() => import('./Pages/StoreLogin'))

// Signed-in surfaces are large and never needed by a first-time visitor, so they
// load on demand instead of shipping with the marketing bundle.
const AdminDashboard = lazy(() => import('./Pages/AdminDashboard'))
const CafeManager = lazy(() => import('./components/cafeManager'))
const GamerXpLogin = lazy(() => import('./Pages/GamingXplogin'))
const StoreConsole = lazy(() => import('./Pages/StoreConsole'))
const PayLink = lazy(() => import('./Pages/PayLink'))
const BookSlot = lazy(() => import('./Pages/BookSlot'))

// CafeXP customer portal. Its own shell, its own token, its own chunk — a
// visitor reading the marketing site should never download it.
const Signup = lazy(() => import('./Pages/SignupPage'))
const AcceptInvite = lazy(() => import('./Pages/AcceptInvite'))
const PortalShell = lazy(() => import('./components/portal/PortalShell'))
const PortalDashboard = lazy(() => import('./Pages/portal/Dashboard'))
const PortalOrganization = lazy(() => import('./Pages/portal/Organization'))
const PortalBranches = lazy(() => import('./Pages/portal/Branches'))
const PortalUsers = lazy(() => import('./Pages/portal/Users'))
const PortalInstallations = lazy(() => import('./Pages/portal/Installations'))
const PortalDevices = lazy(() => import('./Pages/portal/Devices'))
const PortalDownloads = lazy(() => import('./Pages/portal/Downloads'))
const PortalSubscription = lazy(() => import('./Pages/portal/Subscription'))

// The five small pages share one module, so each picks its own named export
// out of it. They also share one chunk, which is the point: nobody visits
// Profile without the rest being a click away.
const fromSimple = (name) =>
  lazy(() => import('./Pages/portal/Simple').then((m) => ({ default: m[name] })))
const PortalBilling = fromSimple('Billing')
const PortalHelp = fromSimple('Help')

// ManagerXP admin console — the SaaS control plane. Its own token, its own
// audience claim, its own chunk.
const ManagerXpShell = lazy(() => import('./components/managerxp/ManagerXpShell'))
const MxDashboard = lazy(() => import('./Pages/managerxp/Dashboard'))
const MxSupport = lazy(() => import('./Pages/managerxp/Support'))
const MxOrganizations = lazy(() => import('./Pages/managerxp/Organizations'))
const MxOrganizationDetail = lazy(() => import('./Pages/managerxp/OrganizationDetail'))
const fromPackages = (name) =>
  lazy(() => import('./Pages/managerxp/Packages').then((m) => ({ default: m[name] })))
const MxPackages = fromPackages('PackageList')
const MxPackageEditor = fromPackages('PackageEditor')
const fromCatalogue = (name) =>
  lazy(() => import('./Pages/managerxp/Catalogue').then((m) => ({ default: m[name] })))
const MxFeatures = fromCatalogue('Features')
const MxAddons = fromCatalogue('Addons')
const MxAudit = fromCatalogue('AuditLogs')
const MxNotBuilt = fromCatalogue('NotBuilt')
const MxGameCatalog = lazy(() => import('./Pages/managerxp/GameCatalog'))
const MxBranches = lazy(() => import('./Pages/managerxp/Branches'))
const fromSubs = (name) =>
  lazy(() => import('./Pages/managerxp/Subscriptions').then((m) => ({ default: m[name] })))
const MxSubscriptions = fromSubs('SubscriptionList')
const MxSubscriptionEditor = fromSubs('SubscriptionEditor')
const fromEstate = (name) =>
  lazy(() => import('./Pages/managerxp/Estate').then((m) => ({ default: m[name] })))
const MxInstallations = fromEstate('Installations')
const MxDevices = fromEstate('Devices')
const fromBilling = (name) =>
  lazy(() => import('./Pages/managerxp/Billing').then((m) => ({ default: m[name] })))
const MxInvoices = fromBilling('Invoices')
const MxPayments = fromBilling('Payments')
const MxGateways = lazy(() => import('./Pages/managerxp/Gateways'))
const MxPaymentLinks = lazy(() => import('./Pages/managerxp/PaymentLinks'))
const MxSettings = lazy(() => import('./Pages/managerxp/Settings'))
const MxAdminReset = lazy(() => import('./Pages/managerxp/AdminReset'))
const fromTeam = (name) =>
  lazy(() => import('./Pages/managerxp/Team').then((m) => ({ default: m[name] })))
const MxAdminUsers = fromTeam('AdminUsers')
const MxRoles = fromTeam('Roles')
// Support is a real ticketing surface now, not one of the Simple placeholders.
const PortalSupport = lazy(() => import('./Pages/portal/Support'))
const PortalProfile = fromSimple('Profile')
const PortalSecurity = fromSimple('Security')

const RouteFallback = () => (
  <div className="flex min-h-[60vh] items-center justify-center bg-black">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-red-500" />
  </div>
)

// /portal/<anything> → /dashboard/<the same thing>, preserving the query string
// so an invitation or a deep link survives the move.
const PortalRedirect = () => {
  const { pathname, search } = useLocation()
  return <Navigate to={pathname.replace(/^\/portal/, '/dashboard') + search} replace />
}

// Router keeps the previous scroll offset across navigations; reset it so each
// page starts at the top.
const ScrollToTop = () => {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

const AppLayout = () => {
  const location = useLocation()
  // Signed-in and auth surfaces carry their own chrome, so the marketing
  // navbar and footer would only get in the way.
  const hideNavAndFooter = ['/login', '/signup', '/cafexp-login', '/gamingxp-login', '/store-login', '/store',
    '/start-trial', '/accept-invite', '/auth/google', '/privacy-policy', '/terms-of-service']
    .includes(location.pathname)
    || location.pathname.startsWith('/pay/')
    || location.pathname.startsWith('/book/')
    // The dashboard and the admin console have their own sidebar and header;
    // the marketing chrome on top of them would be two navigations competing
    // for the same screen.
    || location.pathname.startsWith('/dashboard')
    || location.pathname.startsWith('/portal')
    || location.pathname.startsWith('/admin')
  const hideFooter = hideNavAndFooter

  return (
    <div className="flex flex-col min-h-screen bg-black">
      <ScrollToTop />
      {!hideNavAndFooter && <Navbar />}
      <main className={`flex-grow ${hideNavAndFooter ? '' : 'mt-16'}`}>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route path="/demo" element={<BookDemoPage/>} />
          <Route path="/login" element={<Login />} />
          {/* Where the browser returns from a Google sign-in — reads the token
              the backend put in the URL fragment and adopts the session. */}
          <Route path="/auth/google" element={<GoogleCallback />} />
          {/* One reset door for both a café owner and a customer — the
              backend works out which table (or both) the email belongs to,
              so there is no reason for two separate pages here either. */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          {/* One signup page. "Start free trial" and "Sign up" are the same
              act — an account always comes with a business and a trial — so
              /start-trial redirects here rather than being a second form. */}
          <Route path="/signup" element={<Signup />} />
          <Route path="/cafexp-login" element={<GamerXpLogin />} />
          {/* The old path, kept as a redirect. A café console that has not
              been updated still opens this, and so does anything anybody
              bookmarked — neither should land on a 404 because the route was
              renamed. */}
          <Route path="/gamingxp-login" element={<Navigate to="/cafexp-login" replace />} />

          {/* CafeXP sign-up and invitations: public, because the person using
              them does not have an account yet. */}
          <Route path="/start-trial" element={<Navigate to="/signup" replace />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          {/*
            The dashboard *is* the CafeXP portal — one signed-in surface, not a
            dashboard that links off to a separate portal. Login, signup and
            accepting an invitation all land here; the only difference between
            them is how many questions get asked on the way in.

            PortalShell is the guard as well as the chrome: it redirects to
            /login when there is no token, so no page renders before the check.
            The inner Suspense keeps the sidebar mounted while a page's chunk
            loads — without it the nearest boundary is the one around the whole
            app, and every navigation would blank the shell.
          */}
          <Route
            path="/dashboard"
            element={(
              <PortalShell>
                <Suspense fallback={<RouteFallback />}>
                  <Outlet />
                </Suspense>
              </PortalShell>
            )}
          >
            <Route index element={<PortalDashboard />} />
            <Route path="organization" element={<PortalOrganization />} />
            <Route path="branches" element={<PortalBranches />} />
            <Route path="users" element={<PortalUsers />} />
            <Route path="installations" element={<PortalInstallations />} />
            <Route path="devices" element={<PortalDevices />} />
            <Route path="downloads" element={<PortalDownloads />} />
            <Route path="subscription" element={<PortalSubscription />} />
            <Route path="billing" element={<PortalBilling />} />
            <Route path="support" element={<PortalSupport />} />
            <Route path="help" element={<PortalHelp />} />
            <Route path="profile" element={<PortalProfile />} />
            <Route path="security" element={<PortalSecurity />} />
          </Route>

          {/* Café staff sign in at their own door — /login is the account owner. */}
          <Route path="/store-login" element={<StoreLogin />} />
          {/* Public: a customer pays from an emailed link, with no account. */}
          <Route path="/pay/:token" element={<PayLink />} />
          {/* The public booking page a café shares with its customers —
              managerxp.com/book/:slug. No login, the slug is the only key. */}
          <Route path="/book/:slug" element={<BookSlot />} />
          <Route
            path="/store"
            element={(
              <ProtectedRoute>
                <StoreConsole />
              </ProtectedRoute>
            )}
          />
          {/* The portal lived at /portal for one build. Anyone holding such a
              link — a bookmark, an invitation email — lands on the same page
              at its real address rather than a blank 404. */}
          <Route path="/portal/*" element={<PortalRedirect />} />

          <Route
            path="/add-cafe"
            element={(
              <ProtectedRoute>
                <CafeManager />
              </ProtectedRoute>
            )}
          />
          {/*
            The ManagerXP admin console — the SaaS control plane.

            ManagerXpShell is the guard as well as the chrome: it redirects to
            /admin/login when there is no administrator token, and an
            administrator token is a different credential from a café owner's,
            with its own audience claim. A customer's token cannot open this,
            whatever role value it carries.
          */}
          {/* There is one login page. /admin/login existed for one build and
              redirects, so a bookmark still works and nobody ends up on a
              second door wondering why their password is refused. */}
          <Route path="/admin/login" element={<Navigate to="/login" replace />} />
          {/* Public: an administrator setting their password has no session yet. */}
          <Route path="/admin/reset" element={<MxAdminReset />} />
          <Route
            path="/admin"
            element={(
              <ManagerXpShell>
                <Suspense fallback={<RouteFallback />}>
                  <Outlet />
                </Suspense>
              </ManagerXpShell>
            )}
          >
            <Route index element={<MxDashboard />} />
            {/* Two lenses on one table: "Cafe Owners" leads with the person,
                "Organizations" with the business. Both open the same record. */}
            <Route path="cafe-owners" element={<MxOrganizations lens="owner" />} />
            <Route path="organizations" element={<MxOrganizations />} />
            <Route path="organizations/:id" element={<MxOrganizationDetail />} />
            <Route path="packages" element={<MxPackages />} />
            <Route path="packages/:id" element={<MxPackageEditor />} />
            <Route path="features" element={<MxFeatures />} />
            <Route path="addons" element={<MxAddons />} />
            <Route path="audit-logs" element={<MxAudit />} />

            {/* Sections whose backend is not built. Each says what is missing
                rather than showing an empty table that reads as "no data". */}
            <Route path="branches" element={<MxBranches />} />
            <Route path="subscriptions" element={<MxSubscriptions />} />
            <Route path="subscriptions/:id" element={<MxSubscriptionEditor />} />
            <Route path="payments" element={<MxPayments />} />
            <Route path="payment-links" element={<MxPaymentLinks />} />
            <Route path="gateways" element={<MxGateways />} />
            <Route path="invoices" element={<MxInvoices />} />
            <Route path="installations" element={<MxInstallations />} />
            <Route path="devices" element={<MxDevices />} />
            {/* Software Master was removed — the Game Catalog is now the one
                place a title is authored. Redirected rather than dropped so an
                existing bookmark lands there instead of an empty shell. */}
            <Route path="software" element={<Navigate to="/admin/game-catalog" replace />} />
            <Route path="game-catalog" element={<MxGameCatalog />} />
            <Route path="support" element={<MxSupport />} />
            <Route path="announcements" element={<MxNotBuilt title="Announcements" what="Announcements are not built yet." />} />
            <Route path="admin-users" element={<MxAdminUsers />} />
            <Route path="roles" element={<MxRoles />} />
            <Route path="settings" element={<MxSettings />} />
          </Route>

          {/* The previous admin console, kept reachable while its licence and
              payment-link screens have no equivalent in the new one. */}
          <Route
            path="/admin-legacy"
            element={(
              <ProtectedRoute adminOnly>
                <AdminDashboard />
              </ProtectedRoute>
            )}
          />
        </Routes>
        </Suspense>
      </main>
      {!hideFooter && <Footer />}
      <CookieConsent />
    </div>
  )
}

const App = () => {
  return (
    <Router>
      {/*
        Six of the fifteen animated components animated unconditionally — the
        `prefersReducedMotion()` helper existed but they never called it. Rather
        than retrofit each one and rely on the next component remembering,
        `reducedMotion="user"` makes every framer-motion element in the tree
        honour the operating system setting. Transform and layout animations
        become instant; opacity is left alone, because a fade carries meaning
        without moving anything.
      */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <AppLayout />
        </AuthProvider>
      </MotionConfig>
    </Router>
  )
}

export default App