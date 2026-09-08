import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import './src/config/env.js';
import { initializeDatabase } from './src/config/database.js';
import authRoutes from './src/routes/auth.Routes.js';
import subscriptionPlanRouter from './src/routes/subscriptionPlan.Routes.js';
import cafeRouter from './src/routes/cafe.Routes.js';
import subscriptionsRouter from './src/routes/subscriptions.Routes.js';
import pcsRouter from './src/routes/pcs.Routes.js';
import softwareMasterRouter from './src/routes/softwareMaster.Routes.js';
import pcSoftwareRouter from './src/routes/pcSoftware.Routes.js';
import customerRouter from './src/routes/customer.Routes.js';
import walletRouter from './src/routes/wallet.Routes.js';
import sessionRouter from './src/routes/session.Routes.js';
import sessionMasterRouter from './src/routes/sessionMaster.Routes.js';
import gamingPriceRouter from './src/routes/gamingPrice.Routes.js';
import settingsRouter from './src/routes/settings.Routes.js';
import billingRouter from './src/routes/billing.Routes.js';
import packagesRouter from './src/routes/packages.Routes.js';
import membershipsRouter from './src/routes/memberships.Routes.js';
import productsRouter from './src/routes/products.Routes.js';
import ordersRouter from './src/routes/orders.Routes.js';
import staffRouter from './src/routes/staff.Routes.js';
import floorZonesRouter from './src/routes/floorZones.Routes.js';
import telemetryRouter from './src/routes/telemetry.Routes.js';
import auditRouter from './src/routes/audit.Routes.js';
import reportsRouter from './src/routes/reports.Routes.js';
import expensesRouter from './src/routes/expenses.Routes.js';
import pricingRulesRouter from './src/routes/pricingRules.Routes.js';
import accountResetRouter from './src/routes/accountReset.Routes.js';
import stationPowerRouter from './src/routes/stationPower.Routes.js';
import discountsRouter from './src/routes/discounts.Routes.js';
import reservationsRouter from './src/routes/reservations.Routes.js';
import publicBookingRouter from './src/routes/publicBooking.Routes.js';
import aiRouter from './src/modules/ai/ai.routes.js';
import paymentsRouter, { webhookRouter as paymentsWebhookRouter } from './src/routes/payments.Routes.js';
import platformRouter from './src/routes/platform.Routes.js';
import licensesRouter from './src/routes/licenses.Routes.js';
import updatesRouter from './src/routes/updates.Routes.js';
import refundsRouter from './src/routes/refunds.Routes.js';
import portalRouter from './src/routes/portal.Routes.js';
import adminRouter from './src/routes/admin.Routes.js';
import entitlementsRouter from './src/routes/entitlements.Routes.js';
import installationsRouter from './src/routes/installations.Routes.js';
import locationsRouter from './src/routes/locations.Routes.js';
import gamesRouter from './src/routes/games.Routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

/*
 * One reverse proxy in front of this server (nginx) — trust exactly that
 * one hop's X-Forwarded-* headers, not the whole chain a client could spoof
 * (that's what `true` would do). Without this, two things break silently:
 * express-rate-limit refuses to start (it sees X-Forwarded-For and assumes
 * a misconfiguration, since Express hasn't said it trusts a proxy), and
 * req.protocol always reports "http" — the scheme between nginx and Node —
 * even when the actual visitor is on https, which is what made download
 * links come out as http:// whenever API_PUBLIC_URL wasn't explicitly set.
 */
app.set('trust proxy', 1);

// Middleware
/*
 * Security headers. Tuned for a JSON API that lives on a different origin from
 * the website and the desktop apps:
 *   - No Content-Security-Policy: this server returns JSON and static uploads,
 *     not HTML, so a CSP here governs nothing and its defaults would only risk
 *     blocking the uploaded images the frontend embeds.
 *   - Cross-origin resource policy is opened up for the same reason — the
 *     frontend on another port loads avatars and logos served from /uploads,
 *     which the default 'same-origin' would refuse.
 * What remains is the useful, non-breaking set: nosniff, frameguard, no
 * referrer leakage, and the rest of helmet's header hardening.
 */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false
}));

app.use(cors());

/*
 * Payment webhooks are mounted ahead of express.json() on purpose. Providers
 * sign the raw request bytes, and a JSON parser consumes the stream before the
 * handler can hash it — leaving no way to tell a genuine payment from a forged
 * one. This one route needs the body untouched; everything below it does not.
 */
app.use('/api/payments', paymentsWebhookRouter);

/* An explicit ceiling on request bodies. The old default was already 100kb,
   but stating it makes the limit a decision rather than a default, and 1mb
   leaves generous room for the largest legitimate payload here (a software
   list, a settings blob) while refusing a body sent only to exhaust memory.
   Uploads do not pass through here — they go through multer. */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'src/uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/subscription-plans',subscriptionPlanRouter);
app.use('/api/cafes', cafeRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/pcs', pcsRouter);
app.use('/api/software-master', softwareMasterRouter);
app.use('/api/pc-software', pcSoftwareRouter);
app.use('/api/customers', customerRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/session-master', sessionMasterRouter);
app.use('/api/gaming-prices', gamingPriceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/bills', billingRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/memberships', membershipsRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/public/cafes', publicBookingRouter);
app.use('/api/staff', staffRouter);
app.use('/api/floor-zones', floorZonesRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/audit', auditRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/pricing-rules', pricingRulesRouter);
app.use('/api/account', accountResetRouter);
app.use('/api/stations', stationPowerRouter);
app.use('/api/discounts', discountsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/platform', platformRouter);
app.use('/api/licenses', licensesRouter);
app.use('/api/updates', updatesRouter);
app.use('/api/refunds', refundsRouter);
app.use('/api/portal', portalRouter);
app.use('/api/admin', adminRouter);
app.use('/api/entitlements', entitlementsRouter);
app.use('/api/installations', installationsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/games', gamesRouter);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server
const startServer = async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);

      // API_PUBLIC_URL is baked verbatim into every download link this
      // backend hands out (release installers, catalogue art) — a stray
      // http:// here ships broken links to every café, silently, since
      // uploads still succeed. Catch it at boot, not by users reporting a
      // "download button doesn't work" a release cycle later.
      const apiUrl = process.env.API_PUBLIC_URL;
      if (!apiUrl) {
        console.warn('⚠️  API_PUBLIC_URL is not set — download links will fall back to the request host, which is wrong behind a reverse proxy.');
      } else if (apiUrl.startsWith('http://') && process.env.NODE_ENV === 'production') {
        console.warn(`⚠️  API_PUBLIC_URL is "${apiUrl}" — plain http:// in production. Download links built from it won't force-download from an https:// page. Did you mean https://?`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();