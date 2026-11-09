import pool from '../config/database.js';
import { CONSENT_ACTIONS } from '../config/schema.consent.js';

/*
 * POST /api/public/consent
 *
 * Records one consent decision from the website's consent panel. Public (a
 * visitor has no account), so everything is validated here and nothing the
 * visitor sends is trusted beyond its shape.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[\w.-]{1,32}$/;

export const recordConsent = async (req, res) => {
  try {
    const { consentId, version, action, choices, page } = req.body || {};

    if (typeof consentId !== 'string' || !UUID_RE.test(consentId)) {
      return res.status(400).json({ success: false, message: 'Invalid consent id.' });
    }
    if (typeof version !== 'string' || !VERSION_RE.test(version)) {
      return res.status(400).json({ success: false, message: 'Invalid policy version.' });
    }
    if (!CONSENT_ACTIONS.includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid consent action.' });
    }
    const flags = ['preferences', 'analytics', 'marketing'];
    if (!choices || typeof choices !== 'object' || flags.some((k) => typeof choices[k] !== 'boolean')) {
      return res.status(400).json({ success: false, message: 'Each consent category must be true or false.' });
    }

    const userAgent = String(req.get('user-agent') || '').slice(0, 255) || null;
    const pagePath = typeof page === 'string' ? page.slice(0, 200) : null;

    await pool.query(
      `INSERT INTO consent_records
         (consent_id, policy_version, necessary, preferences, analytics, marketing, action, page, user_agent)
       VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8)`,
      [consentId, version, choices.preferences, choices.analytics, choices.marketing, action, pagePath, userAgent]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Recording consent failed:', error);
    res.status(500).json({ success: false, message: 'Could not record your choice. It is still saved in this browser.' });
  }
};
