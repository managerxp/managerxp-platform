import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';
import { customerStanding, outstandingFor } from '../config/customerTier.js';
import { issueVerificationCode } from './emailVerification.Controller.js';

function normalizeAddress(address) {
  if (address && typeof address === 'object') {
    return address;
  }

  if (typeof address === 'string') {
    const trimmedAddress = address.trim();

    if (!trimmedAddress) {
      return null;
    }

    try {
      return JSON.parse(trimmedAddress);
    } catch {
      return { value: trimmedAddress };
    }
  }

  return null;
}

// Register function
export const register = async (req, res) => {
  try {
    const {
      customer_name,
      email,
      phone_number,
      password,
      address,
      pc_name
    } = req.body;

    const normalizedAddress = normalizeAddress(address);

    // Validate required fields
    if (!customer_name || !email || !phone_number || !password || !normalizedAddress) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: customer_name, email, phone_number, password, address'
      });
    }

    /*
     * Which café this account belongs to.
     *
     * This endpoint is public — a station signs a customer up with no staff
     * token — so nothing in the request can be trusted to declare its own
     * café. What can be trusted is the station's own name, looked up against
     * the `pcs` row a café's own console created; a customer is scoped to
     * whichever café that row belongs to, never to a café_id supplied
     * directly by the caller.
     *
     * Refused rather than silently created with no café: an account nobody's
     * console can ever see is worse than a signup that failed with a plain
     * reason. This is the bug that let a self-registered customer disappear —
     * created, working, and invisible to every café's customer list because
     * nothing had ever told the backend which café's station it came from.
     */
    let cafeId = null;
    if (pc_name) {
      const pc = await pool.query(
        `SELECT cafe_id FROM pcs WHERE name = $1 AND cafe_id IS NOT NULL LIMIT 1`, [pc_name]);
      cafeId = pc.rows[0]?.cafe_id ?? null;
    }
    if (!cafeId) {
      return res.status(400).json({
        success: false,
        message: "This station isn't recognized by any café yet. Ask a staff member for help."
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate phone number (basic validation)
    if (phone_number.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be at least 10 characters'
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const checkUserQuery = 'SELECT email FROM customers WHERE email = $1';
    const existingUser = await pool.query(checkUserQuery, [email]);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert new customer
    const insertQuery = `
      INSERT INTO customers (customer_name, email, phone_number, password, address, cafe_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING customer_id, customer_name, email, phone_number, address, cafe_id, created_at, updated_at
    `;

    const values = [customer_name, email, phone_number, hashedPassword, normalizedAddress, cafeId];
    const result = await pool.query(insertQuery, values);

    const newCustomer = result.rows[0];

    /*
     * The address is not trusted yet. A code goes out now and this account
     * cannot be signed into until it comes back — see `login` below. No token
     * is issued here: handing out a session at the same moment we claim the
     * address is unproven would make the verification decorative.
     */
    const verification = await issueVerificationCode(
      { id: newCustomer.customer_id, email: newCustomer.email, name: newCustomer.customer_name },
      'customer'
    );

    // Remove password from response
    delete newCustomer.password;

    res.status(201).json({
      success: true,
      message: verification.sent
        ? `Account created. We sent a six-digit code to ${newCustomer.email} — enter it to finish signing up.`
        : `Account created, but the verification email could not be sent (${verification.message}). Try “Resend code”.`,
      data: {
        user: newCustomer,
        // What the client app keys off to show the code screen instead of
        // the dashboard — no token yet.
        verification_required: true,
        verification_sent: verification.sent,
        email: newCustomer.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle unique constraint violation
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Login function
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const findUserQuery = `
      SELECT customer_id, customer_name, email, phone_number, password, address, created_at, updated_at, email_verified
      FROM customers
      WHERE email = $1
    `;

    const result = await pool.query(findUserQuery, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    /*
     * An address that has never been confirmed cannot open a session.
     *
     * Checked after the password so this cannot be used to discover which
     * addresses are registered — only somebody who already knows the password
     * learns that the account is pending. The client reads
     * `verification_required` to open the code screen instead of a dead end.
     */
    if (user.email_verified === false) {
      return res.status(403).json({
        success: false,
        message: 'Verify your email address to finish setting up this account. Check your inbox for the six-digit code.',
        data: { verification_required: true, email: user.email }
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        customer_id: user.customer_id, 
        email: user.email,
        customer_name: user.customer_name
      },
      // No fallback secret: env.js requires JWT_SECRET at boot, and signing
      // with a well-known literal would make every customer token forgeable.
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Remove password from response
    delete user.password;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: user,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/*
 * Staff-facing directory endpoints.
 *
 * These expose other people's contact details, so both are behind a staff
 * token. Passwords are never selected.
 */

const CUSTOMER_FIELDS = `
  c.customer_id, c.customer_name, c.email, c.phone_number,
  c.address, c.created_at, c.updated_at,
  c.customer_type, c.discount_percent, c.credit_limit, c.tier_note
`;

/* Wallet balance plus total time actually played — everything a single
   customer's own profile or a staff detail view wants, in one row. The
   subquery only ever runs for one customer at a time (never a list), so its
   cost is a non-issue against the index on sessions(customer_id, started_at).
   VOID sessions have no billable_seconds worth counting; a paused or active
   one has not finished being timed yet, so 'ended' is the only status whose
   figure is final. */
const CUSTOMER_DETAIL_SELECT = `
  ${CUSTOMER_FIELDS},
  w.balance AS wallet_balance,
  w.currency AS wallet_currency,
  (SELECT COALESCE(SUM(s.billable_seconds), 0) FROM sessions s
     WHERE s.customer_id = c.customer_id AND s.status = 'ended') AS total_play_seconds
`;

const shapeCustomer = (row) => ({
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  email: row.email,
  phone_number: row.phone_number,
  address: row.address,
  created_at: row.created_at,
  updated_at: row.updated_at,

  /* Normal or regular, and what being a regular buys them. A normal
     customer's figures are held at zero by a database constraint, so the
     till can read these without first checking the type. */
  customer_type: row.customer_type || 'NORMAL',
  is_regular: (row.customer_type || 'NORMAL') === 'REGULAR',
  // A test/internal account — see schema.customerTiers.js. Every revenue
  // figure the platform computes excludes one of these.
  is_staff: (row.customer_type || 'NORMAL') === 'STAFF',
  discount_percent: Number(row.discount_percent) || 0,
  credit_limit: Number(row.credit_limit) || 0,
  can_pay_later: (row.customer_type || 'NORMAL') === 'REGULAR' && Number(row.credit_limit) > 0,
  tier_note: row.tier_note || null,
  /* Only present where the caller asked for it — listing every customer's
     outstanding balance would be a query per row. */
  outstanding: row.outstanding === undefined ? undefined : Number(row.outstanding),

  // Present whenever the wallet row exists; null means no wallet opened yet.
  wallet_balance: row.wallet_balance === null || row.wallet_balance === undefined
    ? null
    : Number(row.wallet_balance),
  wallet_currency: row.wallet_currency || null,

  // Only present where the caller asked for it (CUSTOMER_DETAIL_SELECT) —
  // a per-row subquery on every listing would be a query per customer.
  total_play_seconds: row.total_play_seconds === undefined || row.total_play_seconds === null
    ? undefined
    : Number(row.total_play_seconds)
});

/*
 * Staff registering a walk-in at the counter.
 *
 * Deliberately looser than self-registration: the person is standing there, so
 * an address is optional and the only hard requirements are a name and a way to
 * find them again. The wallet is opened in the same transaction, because a
 * counter-registered customer is usually about to be topped up.
 */
// POST /api/customers   { customer_name, phone_number, email?, password?, address? }
export const createCustomer = async (req, res) => {
  const client = await pool.connect();
  try {
    /* From the token, never the request. A café id a client can send is a
       café id it can send somebody else's. */
    const cafeId = req.actor?.cafe_id ?? null;
    const name = (req.body?.customer_name || '').trim();
    const phone = (req.body?.phone_number || '').trim();
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';
    const address = normalizeAddress(req.body?.address);
    const openingBalance = Number(req.body?.opening_balance || 0);

    if (!name) {
      return res.status(400).json({ success: false, message: 'A name is required' });
    }
    if (!phone || phone.length < 10) {
      return res.status(400).json({ success: false, message: 'A mobile number of at least 10 digits is required' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'That email address is not valid' });
    }
    // A password is only needed if they will sign in on a station themselves.
    if (password && password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      return res.status(400).json({ success: false, message: 'Opening balance must be zero or more' });
    }

    // The customers table requires an email, so stand one in when staff did not
    // collect one. The mobile number keeps it unique and recognisable.
    const loginEmail = email || `${phone.replace(/\D/g, '')}@walkin.local`;

    const clash = await client.query(
      `SELECT customer_id FROM customers
        WHERE (email = $1 OR phone_number = $2) AND cafe_id IS NOT DISTINCT FROM $3`,
      [loginEmail, phone, cafeId]
    );
    if (clash.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A customer with that email or mobile number already exists'
      });
    }

    await client.query('BEGIN');

    const hashed = await bcrypt.hash(password || Math.random().toString(36).slice(2) + Date.now(), 10);
    /*
     * Verified immediately, not left to the column's own default.
     *
     * Self-registration proves an address by sending a code to it; this path
     * has no such address to prove — staff enter one in person, or there is
     * none at all and a `@walkin.local` placeholder stands in (see above),
     * which could never receive a real code anyway. Staff having created the
     * account in person is the verification here, the same reasoning that
     * already lets "Sign in with Google" skip it for café owners.
     */
    const inserted = await client.query(
      `INSERT INTO customers (customer_name, email, phone_number, password, address, cafe_id, email_verified)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       RETURNING ${CUSTOMER_FIELDS.replace(/c\./g, '')}`,
      [name, loginEmail, phone, hashed, address, cafeId]
    );
    const customer = inserted.rows[0];

    const wallet = await client.query(
      `INSERT INTO wallets (customer_id, balance) VALUES ($1, $2)
       RETURNING wallet_id, balance, currency`,
      [customer.customer_id, openingBalance.toFixed(2)]
    );

    if (openingBalance > 0) {
      await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, customer_id, direction, amount, balance_after, category, note, performed_by)
         VALUES ($1,$2,'credit',$3,$4,'topup','Opening balance at registration',$5)`,
        [wallet.rows[0].wallet_id, customer.customer_id,
         openingBalance.toFixed(2), openingBalance.toFixed(2),
         req.user?.email || 'staff']
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Customer added',
      data: shapeCustomer({
        ...customer,
        wallet_balance: wallet.rows[0].balance,
        wallet_currency: wallet.rows[0].currency
      }),
      // Staff need to be told when the customer cannot sign in yet.
      note: password
        ? null
        : 'No password was set — this customer cannot sign in on a station until one is added.'
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating customer:', error);
    res.status(500).json({ success: false, message: 'Error creating customer' });
  } finally {
    client.release();
  }
};

// GET /api/customers?search=&limit=&offset=
export const getCustomers = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const search = (req.query.search || '').trim();

    /* Scoped first and unconditionally. A café's customer list is names,
       phone numbers and addresses of real people; it is never a search
       filter that can be widened by leaving a parameter off. */
    const params = [req.actor?.cafe_id ?? null];
    let where = 'WHERE c.cafe_id IS NOT DISTINCT FROM $1';

    if (search) {
      // One box searches name, email and phone — how staff actually look
      // someone up at the counter.
      params.push(`%${search}%`);
      where += ` AND (c.customer_name ILIKE $2 OR c.email ILIKE $2 OR c.phone_number ILIKE $2)`;
    }

    const listParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT ${CUSTOMER_FIELDS},
              w.balance AS wallet_balance,
              w.currency AS wallet_currency
       FROM customers c
       LEFT JOIN wallets w ON w.customer_id = c.customer_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM customers c ${where}`,
      params
    );

    res.status(200).json({
      success: true,
      data: result.rows.map(shapeCustomer),
      pagination: { limit, offset, total: totalResult.rows[0].count }
    });
  } catch (error) {
    console.error('Error listing customers:', error);
    res.status(500).json({ success: false, message: 'Error fetching customers' });
  }
};

/*
 * GET /api/customers/me
 *
 * The signed-in customer's own profile, live — including how long they've
 * actually played, which the login/register response never carried and the
 * client only ever cached from that one moment. A customer token is the only
 * kind that carries customer_id (see readToken's note in authGuards.js), so
 * a staff token here simply has nothing to look itself up by.
 */
export const getMyProfile = async (req, res) => {
  try {
    const id = req.actor?.customer_id;
    if (!id) return res.status(403).json({ success: false, message: 'Customers only' });

    const result = await pool.query(
      `SELECT ${CUSTOMER_DETAIL_SELECT}
       FROM customers c
       LEFT JOIN wallets w ON w.customer_id = c.customer_id
       WHERE c.customer_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.status(200).json({ success: true, data: shapeCustomer(result.rows[0]) });
  } catch (error) {
    console.error('Error fetching own profile:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
};

// GET /api/customers/:id
export const getCustomerById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const result = await pool.query(
      `SELECT ${CUSTOMER_DETAIL_SELECT}
       FROM customers c
       LEFT JOIN wallets w ON w.customer_id = c.customer_id
       WHERE c.customer_id = $1 AND c.cafe_id IS NOT DISTINCT FROM $2`,
      [id, req.actor?.cafe_id ?? null]
    );

    /* Another café's customer reads as absent rather than forbidden — a 403
       here would confirm which customer ids exist elsewhere. */
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.status(200).json({ success: true, data: shapeCustomer(result.rows[0]) });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ success: false, message: 'Error fetching customer' });
  }
};

/*
 * PATCH /api/customers/:id/tier
 *
 * Promote a customer to a regular, or put them back to normal.
 *
 * Kept apart from a general customer update because it is not the same kind
 * of edit: correcting a phone number is admin, granting somebody a standing
 * discount and the right to owe the café money is a commercial decision. It
 * is audited as one, and it needs its own permission rather than riding on
 * whoever can fix a typo.
 */
export const setCustomerTier = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const type = String(req.body?.customer_type || '').toUpperCase();
    if (!['NORMAL', 'REGULAR', 'STAFF'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be NORMAL, REGULAR or STAFF' });
    }

    /* Demoting clears the privileges rather than leaving them set but
       inactive — the database refuses that shape anyway, and a stale 10%
       reappearing if somebody is re-promoted months later is a surprise
       nobody asked for. */
    const discount = type === 'REGULAR' ? Number(req.body?.discount_percent ?? 0) : 0;
    const credit = type === 'REGULAR' ? Number(req.body?.credit_limit ?? 0) : 0;
    const note = type === 'REGULAR' && req.body?.tier_note
      ? String(req.body.tier_note).slice(0, 255) : null;

    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      return res.status(400).json({ success: false, message: 'Discount must be between 0 and 100' });
    }
    if (!Number.isFinite(credit) || credit < 0) {
      return res.status(400).json({ success: false, message: 'A credit limit cannot be negative' });
    }

    const cafeId = req.actor?.cafe_id ?? null;
    const before = (await pool.query(
      `SELECT customer_name, customer_type, discount_percent, credit_limit
         FROM customers WHERE customer_id = $1 AND cafe_id IS NOT DISTINCT FROM $2`,
      [id, cafeId]
    )).rows[0];
    if (!before) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    /* Dropping a limit below what they already owe is refused rather than
       silently leaving them over it — the café should settle the tab first,
       and being told so is more useful than a customer who is mysteriously
       barred at the till later. */
    if (type === 'REGULAR' && credit > 0) {
      const owed = await outstandingFor(pool, id, cafeId);
      if (owed > credit) {
        return res.status(409).json({
          success: false,
          message: `They already owe ${owed}. Settle that first, or set a limit of at least ${owed}.`
        });
      }
    }

    const updated = await pool.query(
      `UPDATE customers
          SET customer_type = $1, discount_percent = $2, credit_limit = $3,
              tier_note = $4, updated_at = CURRENT_TIMESTAMP
        WHERE customer_id = $5 AND cafe_id IS NOT DISTINCT FROM $6
        RETURNING *`,
      [type, discount, credit, note, id, cafeId]
    );

    await recordAudit(req, {
      action: 'customer.tier',
      category: 'customers',
      entity: 'customer',
      entity_id: id,
      // Granting credit is a financial decision; an owner should see it.
      sensitive: type === 'REGULAR' && credit > 0,
      summary: type === 'REGULAR'
        ? `Made ${before.customer_name} a regular — ${discount}% off, ${credit} credit limit`
        : type === 'STAFF'
          ? `Marked ${before.customer_name} as a staff/test account — excluded from revenue`
          : `Returned ${before.customer_name} to a normal customer`,
      meta: {
        from: { type: before.customer_type, discount: before.discount_percent, credit: before.credit_limit },
        to: { type, discount, credit }
      }
    });

    res.status(200).json({
      success: true,
      message: type === 'REGULAR' ? 'Customer is now a regular'
        : type === 'STAFF' ? 'Customer marked as staff — excluded from revenue reports'
        : 'Customer set back to normal',
      data: shapeCustomer(updated.rows[0])
    });
  } catch (error) {
    console.error('Error setting customer tier:', error);
    res.status(500).json({ success: false, message: 'Could not change the customer type' });
  }
};

/** GET /api/customers/:id/credit — what they owe and what is left to them. */
export const getCustomerCredit = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cafeId = req.actor?.cafe_id ?? null;
    const standing = await customerStanding(pool, id);
    const owed = await outstandingFor(pool, id, cafeId);
    res.status(200).json({
      success: true,
      data: {
        customer_type: standing.type,
        discount_percent: standing.percent,
        discount_label: standing.label,
        credit_limit: standing.creditLimit,
        outstanding: owed,
        remaining: Math.max(0, Number((standing.creditLimit - owed).toFixed(2))),
        can_pay_later: standing.canPayLater && owed < standing.creditLimit
      }
    });
  } catch (error) {
    console.error('Error reading customer credit:', error);
    res.status(500).json({ success: false, message: 'Could not read their credit standing' });
  }
};
