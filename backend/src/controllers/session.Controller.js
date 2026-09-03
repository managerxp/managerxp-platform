import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { getSetting } from '../config/settings.js';
import { createBillForSession, recalculate } from './billing.Controller.js';
import { resolveGamingPrice, amountForSeconds } from '../config/sessionPricing.js';
import { activeMembershipDiscount } from '../config/membershipPricing.js';
import { checkCredit, customerStanding, floorFor } from '../config/customerTier.js';

/*
 * Play sessions.
 *
 * A session is one customer (or guest) on one station. Time is derived from
 * timestamps rather than counted by a ticker, so a restart of any process
 * never loses or invents time:
 *
 *   elapsed = now - started_at - paused_seconds - (paused_at ? now - paused_at : 0)
 *
 * `paused_seconds` accumulates completed pauses; `paused_at` marks a pause
 * still in progress. On end, the elapsed figure is billed at the rate that was
 * captured when the session started, so later price changes never rewrite
 * history.
 */

const OPEN_STATUSES = ['active', 'paused'];

/**
 * The fallback hourly rate lives in app_settings, so it can be changed without
 * a code edit or a restart. The literal here only covers a database that has
 * not been seeded yet.
 */
const defaultRatePerHour = () => getSetting('session.default_rate_per_hour', 60);

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Seconds actually elapsed, evaluated at `at` (defaults to now) — the true
    wall-clock duration, before the start-of-session grace below. Used where
    that truth matters regardless of billing, such as cancelSession's record
    of how long a station was held. */
const elapsedSeconds = (row, at) => {
  const now = at ? new Date(at) : new Date();
  const started = new Date(row.started_at);
  let seconds = Math.floor((now - started) / 1000) - (row.paused_seconds || 0);
  if (row.paused_at) {
    seconds -= Math.floor((now - new Date(row.paused_at)) / 1000);
  }
  return Math.max(0, seconds);
};

/*
 * A buffer at the start of every session for the game or launcher to
 * actually load — free, and not shown ticking. The countdown (or count-up,
 * for open-ended play) sits at its starting value until this elapses, then
 * moves normally; a session ended inside it is charged nothing, whatever it
 * was priced at (see endSession). Cancelling was already always free, so it
 * needs no change here.
 *
 * Per café, and settable from Settings without a code change or a restart —
 * see settings.js's getSetting cache. Five minutes if a café has never set
 * one, matching what this was hardcoded to before it became configurable.
 */
const DEFAULT_GRACE_MINUTES = 5;
const graceSecondsFor = async (cafeId) => {
  const minutes = await getSetting('session.grace_minutes', DEFAULT_GRACE_MINUTES, cafeId);
  return Math.max(0, Number(minutes) || 0) * 60;
};

/** What's actually billed and shown ticking — elapsedSeconds() net of the
    start-of-session grace above. */
const gracedSeconds = (row, at, graceSeconds) => Math.max(0, elapsedSeconds(row, at) - graceSeconds);

const shape = async (row) => {
  const graceSeconds = await graceSecondsFor(row.cafe_id);
  const elapsed = (row.status === 'ended' || row.status === 'cancelled')
    ? (row.billable_seconds || 0)
    : gracedSeconds(row, undefined, graceSeconds);
  const plannedSeconds = row.planned_minutes ? row.planned_minutes * 60 : null;
  const running = amountForSeconds(row, elapsed);
  const walletBalance = num(row.wallet_balance);

  return {
    /* The price this session was sold at, as captured when it started. A later
       edit to the Gaming Price Master cannot reach back and change it. */
    gaming_price_id: row.gaming_price_id || null,
    pricing_unit: row.pricing_unit || 'HOUR',
    flat_amount: num(row.flat_amount),
    price_label: row.price_label || null,
    /* One block's price and length. A BLOCK session can be extended by another
       of these — the station shows an Extend affordance when this is set, and
       adding one is a bill line, not a wallet debit (settled at end). */
    block_unit_amount: num(row.block_unit_amount),
    block_unit_minutes: row.block_unit_minutes || null,
    can_extend: (row.pricing_unit === 'BLOCK') && row.block_unit_minutes > 0,
    /* What the customer's own gaming rate actually is, discount included —
       not a separate figure the UI has to compute by re-reading the plan. */
    membership_discount_percent: Number(row.membership_discount_percent) || 0,
    membership_label: row.membership_label || null,
    /* The time-of-day window this session was priced under, as it was at
       start. Shown so staff can answer "why is this one ₹500" without
       having to reconstruct which rules were live an hour ago. */
    pricing_rule_id: row.pricing_rule_id || null,
    pricing_rule_label: row.pricing_rule_label || null,
    base_rate_per_hour: num(row.base_rate_per_hour),
    base_flat_amount: num(row.base_flat_amount),
    category: row.pc_category || null,
    cancelled_by: row.cancelled_by || null,
    cancelled_at: row.cancelled_at || null,

    /* What this session was launched with, if anything — most sessions are
       still open-ended counter play with no particular title attached. */
    game_id: row.game_id || null,
    game_name: row.game_name || null,
    game_platform_id: row.game_platform_id || null,
    platform: row.platform || null,
    game_account_id: row.game_account_id || null,
    game_account_name: row.account_name || null,

    session_id: row.session_id,
    pc_id: row.pc_id,
    pc_name: row.pc_name || null,
    customer_id: row.customer_id,
    customer_name: row.customer_name || row.guest_name || null,
    is_guest: !row.customer_id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    status: row.status,
    planned_minutes: row.planned_minutes,
    rate_per_hour: num(row.rate_per_hour),
    started_at: row.started_at,
    paused_at: row.paused_at,
    ended_at: row.ended_at,
    elapsed_seconds: elapsed,
    remaining_seconds: plannedSeconds === null ? null : Math.max(0, plannedSeconds - elapsed),
    /* How much of the start-of-session load buffer is left, so a station that
       launches the game mid-buffer can hold its own local countdown at the
       full amount for the same remaining stretch rather than ticking through
       what the server is still treating as free. */
    grace_seconds: graceSeconds,
    /* What the session would cost if it ended right now — produced by the same
       function that bills it, so the running figure and the final charge can
       never disagree about the arithmetic. */
    running_amount: running,
    amount_charged: num(row.amount_charged),
    payment_status: row.payment_status,
    end_reason: row.end_reason,
    started_by: row.started_by,
    ended_by: row.ended_by,
    wallet_balance: walletBalance,
    /* The wallet cannot cover what this session already owes. Only meaningful
       for a registered customer settling from a wallet — a guest pays at the
       counter, so "low balance" is not a state they can be in. The game is
       never stopped for this; it is what the admin floor flags so staff can
       ask the customer to top up, and what an unpaid close is expected after. */
    low_balance: !!row.customer_id && walletBalance !== null
      && running > walletBalance && (row.status === 'active' || row.status === 'paused')
  };
};

const SELECT_SESSION = `
  SELECT s.*, p.name AS pc_name, p.category AS pc_category,
         c.customer_name, w.balance AS wallet_balance,
         g.name AS game_name, gp.platform, ga.account_name
  FROM sessions s
  LEFT JOIN pcs p ON p.pc_id = s.pc_id
  LEFT JOIN customers c ON c.customer_id = s.customer_id
  LEFT JOIN wallets w ON w.customer_id = s.customer_id
  LEFT JOIN games g ON g.id = s.game_id
  LEFT JOIN game_platforms gp ON gp.id = s.game_platform_id
  LEFT JOIN game_accounts ga ON ga.id = s.game_account_id
`;

const fetchSession = async (client, id) => {
  const result = await client.query(`${SELECT_SESSION} WHERE s.session_id = $1`, [id]);
  return result.rows[0] || null;
};

/* ==========================================================================
   START
   ========================================================================== */
// POST /api/sessions
export const startSession = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      pc_id, customer_id, guest_name, guest_phone,
      planned_minutes, rate_per_hour, cafe_id, gaming_price_id
    } = req.body || {};

    const pcId = parseInt(pc_id, 10);
    if (!Number.isInteger(pcId)) {
      return res.status(400).json({ success: false, message: 'A station is required' });
    }

    const customerId = customer_id ? parseInt(customer_id, 10) : null;
    const guestName = guest_name ? String(guest_name).trim().slice(0, 255) : null;

    if (!customerId && !guestName) {
      return res.status(400).json({
        success: false,
        message: 'Choose a customer, or give the guest a name'
      });
    }

    let minutes = planned_minutes === null || planned_minutes === undefined || planned_minutes === ''
      ? null
      : parseInt(planned_minutes, 10);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      return res.status(400).json({ success: false, message: 'Duration must be between 1 and 1440 minutes' });
    }

    const pc = await client.query(
      'SELECT pc_id, cafe_id, name, category, status FROM pcs WHERE pc_id = $1', [pcId]
    );
    if (pc.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const station = pc.rows[0];

    /* A station taken out of service cannot take a customer, whatever the
       screen that sent this request last believed. */
    if (station.status && station.status !== 'AVAILABLE') {
      const why = station.status === 'MAINTENANCE'
        ? 'under maintenance'
        : 'not in service';
      return res.status(409).json({
        success: false,
        message: `${station.name || 'That station'} is ${why} and cannot take a session`
      });
    }

    /*
     * Pricing comes from the Gaming Price Master, not from the request.
     *
     * `gaming_price_id` is the path everything new uses: the server loads the
     * price, checks it is still on sale and still matches the station's type,
     * and snapshots it onto the session. Nothing about the amount is taken
     * from the caller, so a modified request cannot set its own rate.
     *
     * The `rate_per_hour` path below it is the original behaviour, kept for
     * open-ended play at the counter that no catalogue price covers. It is not
     * a way around the master — it produces an hourly session exactly as it
     * always did.
     */
    let pricing;
    if (gaming_price_id !== undefined && gaming_price_id !== null && gaming_price_id !== '') {
      const resolved = await resolveGamingPrice(client, gaming_price_id, {
        stationCategory: station.category,
        // The café decides its own peak and happy hours, so which windows are
        // even considered is scoped to the token's café, never the request's.
        cafeId: req.actor?.cafe_id ?? null
      });
      if (resolved.error) {
        return res.status(400).json({ success: false, message: resolved.error });
      }
      pricing = resolved.snapshot;
      /* A fixed block defines its own length. Whatever duration the screen
         sent alongside the price, the paid-for block is what the customer
         gets, so the countdown and the charge cannot describe different spans
         of time. */
      if (pricing.pricing_unit === 'BLOCK' && pricing.block_minutes) {
        minutes = pricing.block_minutes;
      }
    } else {
      const rate = rate_per_hour === undefined || rate_per_hour === null || rate_per_hour === ''
        ? await defaultRatePerHour()
        : Number(rate_per_hour);
      if (!Number.isFinite(rate) || rate < 0) {
        return res.status(400).json({ success: false, message: 'Rate must be zero or more' });
      }
      pricing = {
        gaming_price_id: null,
        pricing_unit: 'HOUR',
        rate_per_hour: rate,
        flat_amount: null,
        price_label: null
      };
    }
    const rate = pricing.rate_per_hour;

    if (customerId) {
      const customer = await client.query('SELECT customer_id FROM customers WHERE customer_id = $1', [customerId]);
      if (customer.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }
    }

    /* Snapshotted alongside the price, for the same reason: a membership
       bought after this session already started must not discount time that
       has already passed, and one cancelled mid-session must not raise it. */
    const membership = await activeMembershipDiscount(client, customerId);

    const open = await client.query(
      `SELECT session_id FROM sessions WHERE pc_id = $1 AND status = ANY($2)`,
      [pcId, OPEN_STATUSES]
    );
    if (open.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'That station already has a session running',
        data: { session_id: open.rows[0].session_id }
      });
    }

    /*
     * A customer starting their own session, unwatched by staff, is not the
     * same trust situation as a staff member starting one for someone they
     * can see. `require_prepaid` is the flag only that self-service path
     * sends: it must be able to name a fully-known price up front (a BLOCK or
     * a FLAT — never the open-ended, metered HOUR path, which has no total to
     * check a wallet against) and the customer must be able to cover it.
     * Getting this wrong is how a café ends up with an unattended session
     * nobody can collect for.
     *
     * "Cover it" is wallet balance first, and — for a regular customer the
     * café has explicitly given a credit limit — whatever's left of that
     * limit on top. That is the exact same allowance checkCredit already
     * grants at the till for "let them leave without paying now"; a café
     * that set a limit so a regular customer never gets turned away at
     * checkout meant the same thing here, at the start of a session they are
     * about to sit down and pay for the same way. A limit of zero (the
     * default) or a non-regular customer falls straight through to the
     * wallet-only rule, unchanged from before.
     */
    if (req.body?.require_prepaid) {
      if (!customerId) {
        return res.status(400).json({
          success: false,
          message: 'A guest session cannot start itself — a registered account is required.'
        });
      }
      if (pricing.pricing_unit !== 'BLOCK' && pricing.pricing_unit !== 'FLAT') {
        return res.status(400).json({
          success: false,
          message: 'Self-service start requires a fixed-price plan.'
        });
      }
      const due = amountForSeconds(
        { pricing_unit: pricing.pricing_unit, flat_amount: pricing.flat_amount,
          membership_discount_percent: membership.percent },
        0
      );
      const wallet = await client.query('SELECT balance FROM wallets WHERE customer_id = $1', [customerId]);
      const balance = wallet.rows[0] ? Number(wallet.rows[0].balance) : 0;
      if (balance < due) {
        const shortfall = Number((due - balance).toFixed(2));
        const credit = await checkCredit(client, customerId, shortfall, station.cafe_id);
        if (!credit.ok) {
          return res.status(402).json({
            success: false,
            message: `Your wallet holds ₹${balance.toFixed(0)}, and this needs ₹${due.toFixed(0)}. Top up to start.`
          });
        }
      }
    }

    /*
     * GAME + PLATFORM + ACCOUNT
     *
     * Optional: most sessions are still open-ended counter play or a
     * customer who hasn't picked a title yet. When a game is named, its
     * platform and (for a venue-account game) an account must be resolved
     * and, for the account, reserved — atomically, inside the same
     * transaction as the session row itself, so a crash between reserving
     * an account and creating the session can never strand that account
     * IN_USE with nothing using it, and two stations racing for the last
     * account can never both win.
     */
    let gameId = null, gamePlatformId = null, gameAccountId = null;
    const { game_id, game_platform_id, game_account_id, use_venue_account } = req.body || {};

    await client.query('BEGIN');

    if (game_id !== undefined && game_id !== null && game_id !== '') {
      gameId = parseInt(game_id, 10);
      if (!Number.isInteger(gameId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid game' });
      }

      const cafeGame = (await client.query(
        `SELECT cg.*, g.name AS game_name FROM cafe_games cg JOIN games g ON g.id = cg.game_id
          WHERE cg.game_id = $1 AND cg.cafe_id IS NOT DISTINCT FROM $2 AND cg.enabled = TRUE`,
        [gameId, station.cafe_id]
      )).rows[0];
      if (!cafeGame) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'This game is not available at this café' });
      }

      // Which platform: an explicit choice (validated against what this
      // station actually has installed), or the only one it has installed.
      const installedPlatforms = (await client.query(
        `SELECT gp.id, gp.platform FROM station_game_platforms sgp
           JOIN game_platforms gp ON gp.id = sgp.game_platform_id
          WHERE sgp.pc_id = $1 AND sgp.installed = TRUE AND gp.game_id = $2 AND gp.status = 'ACTIVE'`,
        [pcId, gameId]
      )).rows;

      if (game_platform_id !== undefined && game_platform_id !== null && game_platform_id !== '') {
        gamePlatformId = parseInt(game_platform_id, 10);
        if (!installedPlatforms.some((p) => p.id === gamePlatformId)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'That platform of this game is not installed on this station' });
        }
      } else if (installedPlatforms.length === 1) {
        gamePlatformId = installedPlatforms[0].id;
      } else if (installedPlatforms.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `${cafeGame.game_name} is not installed on this station` });
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'This station has more than one version of this game installed — choose which platform to launch'
        });
      }

      const accountMode = cafeGame.account_mode;
      const wantsVenue = accountMode === 'VENUE_ACCOUNT'
        || (accountMode === 'CUSTOMER_OR_VENUE' && !!use_venue_account);

      if (wantsVenue) {
        /* A specific licence the customer (or staff) picked from a list, or —
           the common case — whichever one is free. `FOR UPDATE SKIP LOCKED`
           is what makes "whichever is free" safe under real concurrency: a
           second session racing for the same pool skips a row another
           transaction is already claiming rather than blocking on it or,
           worse, claiming it too. */
        const reserved = (game_account_id !== undefined && game_account_id !== null && game_account_id !== '')
          ? (await client.query(
              `UPDATE game_accounts SET status = 'IN_USE', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND cafe_id = $2 AND game_platform_id = $3 AND status = 'AVAILABLE'
               RETURNING id`,
              [parseInt(game_account_id, 10), station.cafe_id, gamePlatformId]
            )).rows[0]
          : (await client.query(
              `UPDATE game_accounts SET status = 'IN_USE', updated_at = CURRENT_TIMESTAMP
                 WHERE id = (
                   SELECT id FROM game_accounts
                    WHERE cafe_id = $1 AND game_platform_id = $2 AND status = 'AVAILABLE'
                    ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
                 )
               RETURNING id`,
              [station.cafe_id, gamePlatformId]
            )).rows[0];

        if (!reserved) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: accountMode === 'VENUE_ACCOUNT'
              ? 'No venue account is available for this game right now'
              : 'No venue account is free right now — the customer can still log in with their own account'
          });
        }
        gameAccountId = reserved.id;
      } else if (accountMode === 'VENUE_ACCOUNT') {
        // Unreachable given the branch above, kept only so a future account
        // mode added here fails loudly instead of silently launching with no
        // account resolved.
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Could not resolve an account for this game' });
      }
    }

    const inserted = await client.query(
      `INSERT INTO sessions
         (cafe_id, pc_id, customer_id, guest_name, guest_phone,
          planned_minutes, rate_per_hour, started_by,
          gaming_price_id, pricing_unit, flat_amount, price_label,
          membership_discount_percent, membership_label,
          pricing_rule_id, pricing_rule_label, base_rate_per_hour, base_flat_amount,
          block_unit_amount, block_unit_minutes,
          game_id, game_platform_id, game_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING session_id`,
      [
        cafe_id || station.cafe_id || null,
        pcId,
        customerId,
        customerId ? null : guestName,
        customerId ? null : (guest_phone ? String(guest_phone).trim().slice(0, 20) : null),
        minutes,
        rate,
        req.actor?.label || null,
        pricing.gaming_price_id,
        pricing.pricing_unit,
        pricing.flat_amount,
        pricing.price_label,
        membership.percent,
        membership.label,
        pricing.pricing_rule_id ?? null,
        pricing.pricing_rule_label ?? null,
        pricing.base_rate_per_hour ?? null,
        pricing.base_flat_amount ?? null,
        /* Only a block has a unit to extend by; everything else extends by
           bare minutes with no charge, exactly as before. */
        pricing.pricing_unit === 'BLOCK' ? pricing.flat_amount : null,
        pricing.pricing_unit === 'BLOCK' ? (pricing.block_minutes ?? minutes) : null,
        gameId, gamePlatformId, gameAccountId
      ]
    );

    // The account row now knows which session claimed it, not only that it
    // is claimed — needed to release it again when that session ends.
    if (gameAccountId) {
      await client.query('UPDATE game_accounts SET current_session_id = $1 WHERE id = $2',
        [inserted.rows[0].session_id, gameAccountId]);
    }

    await client.query('COMMIT');

    const session = await fetchSession(client, inserted.rows[0].session_id);

    await recordAudit(req, {
      action: 'session.start',
      category: 'sessions',
      entity: 'session',
      entity_id: session.session_id,
      summary: `Started a session on ${session.pc_name || 'a station'} for ` +
        `${session.customer_name || session.guest_name || 'a guest'}` +
        (minutes ? ` — ${minutes} minutes` : ' — open-ended') +
        (pricing.pricing_unit === 'BLOCK'
          ? ` · ${pricing.flat_amount} fixed`
          : ` at ${rate}/hr`),
      meta: {
        pc_id: pcId,
        customer_id: customerId,
        guest_name: customerId ? null : guestName,
        planned_minutes: minutes,
        rate_per_hour: rate
      }
    });

    res.status(201).json({ success: true, message: 'Session started', data: await shape(session) });
  } catch (error) {
    // Harmless when nothing was ever begun — every early-return path above
    // that opens a transaction rolls back explicitly before returning; this
    // only catches an actual thrown error partway through one.
    await client.query('ROLLBACK').catch(() => {});
    // The partial unique index is the real guard against a double-book.
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'That station already has a session running' });
    }
    console.error('Error starting session:', error);
    res.status(500).json({ success: false, message: 'Error starting session' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   LIST / READ
   ========================================================================== */
// GET /api/sessions?status=&pc_id=&customer_id=&limit=&offset=
export const listSessions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const filters = [];
    const params = [];

    if (req.query.status) {
      const statuses = String(req.query.status).split(',').map((s) => s.trim());
      params.push(statuses);
      filters.push(`s.status = ANY($${params.length})`);
    }
    if (req.query.pc_id) {
      params.push(parseInt(req.query.pc_id, 10));
      filters.push(`s.pc_id = $${params.length}`);
    }
    if (req.query.customer_id) {
      params.push(parseInt(req.query.customer_id, 10));
      filters.push(`s.customer_id = $${params.length}`);
    }
    if (req.query.since) {
      params.push(req.query.since);
      filters.push(`s.started_at >= $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const listParams = [...params, limit, offset];

    const result = await pool.query(
      `${SELECT_SESSION} ${where}
       ORDER BY s.started_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM sessions s ${where}`,
      params
    );

    res.status(200).json({
      success: true,
      data: await Promise.all(result.rows.map(shape)),
      pagination: { limit, offset, total: total.rows[0].count }
    });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ success: false, message: 'Error fetching sessions' });
  }
};

// GET /api/sessions/:id
export const getSession = async (req, res) => {
  const client = await pool.connect();
  try {
    const session = await fetchSession(client, parseInt(req.params.id, 10));
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.status(200).json({ success: true, data: await shape(session) });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ success: false, message: 'Error fetching session' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PAUSE / RESUME / EXTEND / TRANSFER
   ========================================================================== */
/**
 * Every open-session change funnels through here, so this is also the one
 * place the audit entry has to be written for pause, resume, extend and
 * transfer. `action` names the verb for the trail.
 */
const mutate = async (req, res, handler, action) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid session id' });
    }

    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM sessions WHERE session_id = $1 FOR UPDATE', [id]);
    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const outcome = await handler(client, locked.rows[0], req);
    if (outcome && outcome.error) {
      await client.query('ROLLBACK');
      return res.status(outcome.status || 400).json({ success: false, message: outcome.error });
    }

    await client.query('COMMIT');

    const fresh = await fetchSession(client, id);

    if (action) {
      await recordAudit(req, {
        action: `session.${action}`,
        category: 'sessions',
        entity: 'session',
        entity_id: id,
        sensitive: action === 'transfer',
        summary: `${outcome?.message || 'Session updated'} — session ${id} on ` +
          `${fresh.pc_name || 'a station'} for ${fresh.customer_name || fresh.guest_name || 'a guest'}`,
        meta: { status: fresh.status, planned_minutes: fresh.planned_minutes }
      });
    }

    res.status(200).json({
      success: true,
      message: outcome?.message || 'Session updated',
      data: await shape(fresh)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating session:', error);
    res.status(500).json({ success: false, message: 'Error updating session' });
  } finally {
    client.release();
  }
};

// POST /api/sessions/:id/pause
export const pauseSession = (req, res) => mutate(req, res, async (client, row) => {
  if (row.status !== 'active') {
    return { error: `Only an active session can be paused (this one is ${row.status})`, status: 409 };
  }
  await client.query(
    `UPDATE sessions SET status = 'paused', paused_at = CURRENT_TIMESTAMP,
                         updated_at = CURRENT_TIMESTAMP
     WHERE session_id = $1`,
    [row.session_id]
  );
  return { message: 'Session paused' };
}, 'pause');

// POST /api/sessions/:id/resume
export const resumeSession = (req, res) => mutate(req, res, async (client, row) => {
  if (row.status !== 'paused') {
    return { error: `Only a paused session can be resumed (this one is ${row.status})`, status: 409 };
  }
  // Bank the completed pause, then clear the marker.
  await client.query(
    `UPDATE sessions
     SET status = 'active',
         paused_seconds = paused_seconds + GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - paused_at))::int),
         paused_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE session_id = $1`,
    [row.session_id]
  );
  return { message: 'Session resumed' };
}, 'resume');

/*
 * POST /api/sessions/:id/extend
 *
 * One shape from the outside — `{ minutes }` — for every session, and it
 * always adds exactly that many minutes. Nothing here rounds the time: a
 * request for 15 must land at 15, not at the nearest block multiple — an
 * earlier version of this rounded up to a whole block (e.g. 15 min on a
 * 10-min-block session became 20), which reads as the timer being wrong,
 * not as a pricing detail.
 *
 * A BLOCK session's price is still fixed per whole block, so a partial-block
 * request is billed proportionally — the block's own per-minute rate times
 * the minutes actually added — rather than snapping the time to match a
 * whole-block price. `blocks` is still accepted directly for the station's
 * own single-tap "+1 block" button, which already knows the exact block
 * price up front and has no reason to go through minutes at all.
 *
 * Either way nothing is charged now: the extra rides on the same bill and is
 * settled when the session ends, so a short wallet never blocks the
 * extension — it just means more to settle later.
 */
export const extendSession = (req, res) => mutate(req, res, async (client, row, request) => {
  if (row.status === 'ended') {
    return { error: 'That session has already ended', status: 409 };
  }

  if (row.pricing_unit === 'BLOCK') {
    const unitMinutes = parseInt(row.block_unit_minutes, 10);
    const unitAmount = Number(row.block_unit_amount);
    if (!Number.isInteger(unitMinutes) || unitMinutes < 1 || !Number.isFinite(unitAmount)) {
      return { error: 'This session has no block to extend by', status: 409 };
    }

    let addMinutes;
    let addAmount;
    if (request.body?.blocks !== undefined) {
      const blocks = parseInt(request.body.blocks, 10);
      if (!Number.isInteger(blocks) || blocks < 1 || blocks > 24) {
        return { error: 'Extend by between 1 and 24 blocks' };
      }
      addMinutes = unitMinutes * blocks;
      addAmount = Number((unitAmount * blocks).toFixed(2));
    } else {
      addMinutes = parseInt(request.body?.minutes, 10);
      if (!Number.isInteger(addMinutes) || addMinutes < 1 || addMinutes > 1440) {
        return { error: 'Extend by between 1 and 1440 minutes' };
      }
      addAmount = Number(((unitAmount / unitMinutes) * addMinutes).toFixed(2));
    }

    await client.query(
      `UPDATE sessions
          SET planned_minutes = planned_minutes + $1,
              flat_amount = COALESCE(flat_amount, 0) + $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE session_id = $3`,
      [addMinutes, addAmount, row.session_id]
    );
    return { message: `Extended by ${addMinutes} min — ${addAmount} on the bill` };
  }

  const minutes = parseInt(request.body?.minutes, 10);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return { error: 'Extend by between 1 and 1440 minutes' };
  }
  if (row.planned_minutes === null) {
    return { error: 'This session is open-ended, so there is nothing to extend', status: 409 };
  }
  await client.query(
    `UPDATE sessions SET planned_minutes = planned_minutes + $1, updated_at = CURRENT_TIMESTAMP
     WHERE session_id = $2`,
    [minutes, row.session_id]
  );
  return { message: `Extended by ${minutes} minutes` };
}, 'extend');

// POST /api/sessions/:id/transfer  { pc_id }
export const transferSession = (req, res) => mutate(req, res, async (client, row, request) => {
  if (row.status === 'ended') {
    return { error: 'That session has already ended', status: 409 };
  }
  const target = parseInt(request.body?.pc_id, 10);
  if (!Number.isInteger(target)) return { error: 'Choose a station to move to' };
  if (target === row.pc_id) return { error: 'The session is already on that station' };

  const pc = await client.query('SELECT pc_id FROM pcs WHERE pc_id = $1', [target]);
  if (pc.rows.length === 0) return { error: 'Station not found', status: 404 };

  const busy = await client.query(
    `SELECT session_id FROM sessions WHERE pc_id = $1 AND status = ANY($2)`,
    [target, OPEN_STATUSES]
  );
  if (busy.rows.length > 0) {
    return { error: 'That station already has a session running', status: 409 };
  }

  await client.query(
    `UPDATE sessions SET pc_id = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2`,
    [target, row.session_id]
  );
  return { message: 'Session transferred' };
}, 'transfer');

/* ==========================================================================
   END  (settles against the wallet)
   ========================================================================== */
// POST /api/sessions/:id/end  { charge?: boolean, reason?: string }
export const endSession = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid session id' });
    }

    const shouldCharge = req.body?.charge !== false;   // charging is the default
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 32) : 'staff';

    await client.query('BEGIN');

    const locked = await client.query('SELECT * FROM sessions WHERE session_id = $1 FOR UPDATE', [id]);
    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const row = locked.rows[0];
    if (row.status === 'ended') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That session has already ended' });
    }
    if (row.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That session was cancelled' });
    }

    /* Duration from the server's own timestamps and the amount from the
       session's own snapshot. Neither is taken from the request: what the
       browser believed the timer said has no bearing on what is charged. */
    const billableSeconds = gracedSeconds(row, undefined, await graceSecondsFor(row.cafe_id));
    const rate = Number(row.rate_per_hour || 0);
    /* Still inside the grace period: whatever this was priced at, the
       customer never really started playing, so it costs nothing — not just
       the pro-rated HOUR case gracedSeconds already zeroes out, but a
       BLOCK/FLAT session too, which amountForSeconds bills whole regardless
       of seconds played and would otherwise charge in full for zero play. */
    const amount = billableSeconds > 0 ? amountForSeconds(row, billableSeconds) : 0;

    let paymentStatus = 'not_applicable';
    let walletTransactionId = null;

    if (!shouldCharge) {
      paymentStatus = 'waived';
    } else if (row.customer_id && amount > 0) {
      // Settle against the wallet using the same locked-row discipline as the
      // wallet endpoints themselves.
      const wallet = await client.query(
        'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE',
        [row.customer_id]
      );

      if (wallet.rows.length === 0) {
        paymentStatus = 'unpaid';
      } else {
        const balance = Number(wallet.rows[0].balance);
        // A regular customer's wallet may cover this by going negative, up
        // to their own credit_limit — see customerTier.js. Everyone else's
        // floor is zero, same behaviour as before.
        const standing = await customerStanding(client, row.customer_id);
        const floor = floorFor(standing);
        const next = Number((balance - amount).toFixed(2));
        if (next >= floor) {
          await client.query(
            'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = $2',
            [next, wallet.rows[0].wallet_id]
          );
          const ledger = await client.query(
            `INSERT INTO wallet_transactions
               (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
             VALUES ($1,$2,'debit',$3,$4,$5,$6,$7)
             RETURNING transaction_id`,
            [
              wallet.rows[0].wallet_id,
              row.customer_id,
              amount,
              next,
              next < 0 ? 'credit_used' : 'gaming',
              `Session #${row.session_id}`,
              req.actor?.label || null
            ]
          );
          walletTransactionId = ledger.rows[0].transaction_id;
          paymentStatus = 'paid';
        } else {
          // Even their full credit limit doesn't cover it — ending is still
          // never blocked; staff settle the remainder like any other tab.
          paymentStatus = 'unpaid';
        }
      }
    } else if (!row.customer_id && amount > 0) {
      paymentStatus = 'unpaid';       // guests pay at the counter
    }

    // Every charged session leaves a bill behind, whether or not the wallet
    // covered it — that is the record staff settle against and report on.
    let billId = null;
    if (shouldCharge && amount > 0) {
      const station = await client.query('SELECT name FROM pcs WHERE pc_id = $1', [row.pc_id]);
      const pcName = station.rows[0] ? station.rows[0].name : null;

      billId = await createBillForSession(client, {
        session_id: row.session_id,
        cafe_id: row.cafe_id,
        customer_id: row.customer_id,
        guest_name: row.guest_name,
        pc_name: pcName,
        amount: amount,
        billable_seconds: billableSeconds,
        membership_label: row.membership_label
      }, req.actor?.label);

      // If the wallet already covered it, record that against the bill so it
      // does not look outstanding.
      if (paymentStatus === 'paid') {
        await client.query(
          `INSERT INTO payments (bill_id, customer_id, method, amount, reference,
                                 wallet_transaction_id, received_by)
           VALUES ($1,$2,'wallet',$3,$4,$5,$6)`,
          [
            billId, row.customer_id, amount,
            `Session #${row.session_id}`, walletTransactionId, req.actor?.label || null
          ]
        );
        /*
         * Recalculate rather than force PAID.
         *
         * createBillForSession joins the session's existing bill when one is
         * already open — food ordered mid-session via "save for later" lands
         * there before the gaming line does. This wallet debit only ever
         * covers the gaming amount, so writing paid_amount = amount and
         * status = 'PAID' directly (the old code) clobbered whatever was
         * already paid and marked the whole bill settled even when unpaid
         * food was still sitting on it — the wallet paid for the table time,
         * not the burger. Recalculate derives paid_amount from the sum of
         * every payment row and only calls it PAID once that covers the
         * bill's actual total, so a bill with outstanding food correctly
         * lands PARTIAL instead.
         */
        await recalculate(client, billId);
      }
    }

    await client.query(
      `UPDATE sessions
       SET status = 'ended',
           ended_at = CURRENT_TIMESTAMP,
           paused_at = NULL,
           billable_seconds = $1,
           amount_charged = $2,
           payment_status = $3,
           wallet_transaction_id = $4,
           end_reason = $5,
           ended_by = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $7`,
      [billableSeconds, amount, paymentStatus, walletTransactionId, reason, req.actor?.label || null, id]
    );

    // A venue account this session was using goes back into the pool the
    // moment the session itself stops being open — never left IN_USE for a
    // session that is no longer running.
    if (row.game_account_id) {
      await client.query(
        `UPDATE game_accounts SET status = 'AVAILABLE', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND current_session_id = $2`,
        [row.game_account_id, id]
      );
    }

    await client.query('COMMIT');

    const fresh = await fetchSession(client, id);

    await recordAudit(req, {
      action: 'session.end',
      category: 'sessions',
      entity: 'session',
      entity_id: id,
      amount: Number(amount),
      // An unpaid or waived close is exactly the kind of thing an owner wants
      // flagged when they scan the trail.
      sensitive: paymentStatus !== 'paid',
      summary: `Ended session ${id} on ${fresh.pc_name || 'a station'} for ` +
        `${fresh.customer_name || fresh.guest_name || 'a guest'} — ` +
        `${Math.round(billableSeconds / 60)} min, ${amount} charged, ${paymentStatus}` +
        (reason ? ` (${reason})` : ''),
      meta: {
        billable_seconds: billableSeconds,
        payment_status: paymentStatus,
        end_reason: reason,
        wallet_transaction_id: walletTransactionId
      }
    });

    res.status(200).json({
      success: true,
      message: paymentStatus === 'paid' ? 'Session ended and charged'
        : paymentStatus === 'unpaid' ? 'Session ended — payment outstanding'
        : 'Session ended',
      data: await shape(fresh)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error ending session:', error);
    res.status(500).json({ success: false, message: 'Error ending session' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   CANCEL
   ========================================================================== */
/*
 * A session started by mistake — wrong station, wrong customer, wrong price.
 *
 * Cancelling is not deleting. The row stays, with who cancelled it and when,
 * because it is the evidence that a station was held and released; a café
 * where mistakes leave no trace is a café where a missing hour cannot be
 * explained. It bills nothing and leaves no bill behind.
 *
 * POST /api/sessions/:id/cancel
 */
export const cancelSession = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid session id' });
    }
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 255) : null;

    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM sessions WHERE session_id = $1 FOR UPDATE', [id]
    );
    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const row = locked.rows[0];
    if (row.status === 'ended') {
      /* An ended session has been billed. Reversing that is a refund, which
         has its own path and its own trail — not a quiet status change. */
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'That session has already ended and been billed. Refund the bill instead.'
      });
    }
    if (row.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'That session is already cancelled' });
    }

    /* The time played is recorded even though nothing is charged for it —
       how long a station was held is the fact somebody will want later. */
    const heldSeconds = elapsedSeconds(row);

    await client.query(
      `UPDATE sessions
          SET status = 'cancelled',
              ended_at = CURRENT_TIMESTAMP,
              cancelled_at = CURRENT_TIMESTAMP,
              cancelled_by = $1,
              paused_at = NULL,
              billable_seconds = $2,
              amount_charged = 0,
              payment_status = 'not_applicable',
              end_reason = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE session_id = $4`,
      [req.actor?.label || null, heldSeconds, reason || 'cancelled', id]
    );

    if (row.game_account_id) {
      await client.query(
        `UPDATE game_accounts SET status = 'AVAILABLE', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND current_session_id = $2`,
        [row.game_account_id, id]
      );
    }

    await client.query('COMMIT');

    const fresh = await fetchSession(client, id);

    await recordAudit(req, {
      action: 'session.cancel',
      category: 'sessions',
      entity: 'session',
      entity_id: id,
      /* Always worth an owner's attention: a cancelled session is a station
         that was occupied and produced no money. */
      sensitive: true,
      summary: `Cancelled session ${id} on ${fresh.pc_name || 'a station'} for ` +
        `${fresh.customer_name || fresh.guest_name || 'a guest'} after ` +
        `${Math.round(heldSeconds / 60)} min — nothing charged` +
        (reason ? ` (${reason})` : ''),
      meta: { held_seconds: heldSeconds, reason: reason }
    });

    res.status(200).json({
      success: true,
      message: 'Session cancelled — nothing charged',
      data: await shape(fresh)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error cancelling session:', error);
    res.status(500).json({ success: false, message: 'Error cancelling session' });
  } finally {
    client.release();
  }
};

// GET /api/sessions/defaults — read from settings, never a baked-in constant
export const getDefaults = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        rate_per_hour: await getSetting('session.default_rate_per_hour', 60),
        warn_minutes: await getSetting('session.warn_minutes', 15),
        critical_minutes: await getSetting('session.critical_minutes', 5)
      }
    });
  } catch (error) {
    console.error('Error reading session defaults:', error);
    res.status(500).json({ success: false, message: 'Error reading defaults' });
  }
};
