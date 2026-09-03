import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { issueVerificationCode } from './emailVerification.Controller.js';

// Register user
export const register = async (req, res) => {
  try {
    const { email, phoneNumber, name, address, password } = req.body;

    // Check if user already exists
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (email, phone_number, name, address, password, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, phone_number, name, address, role, created_at`,
      [email, phoneNumber, name, JSON.stringify(address), hashedPassword, 'user']
    );

    const user = result.rows[0];

    /*
     * The café this account is scoped to.
     *
     * Ordered and limited on purpose. An owner can hold more than one café —
     * a second branch registered separately — and this used to take whichever
     * row the database handed back first. That order is physical, not logical:
     * an UPDATE rewrites a row to the end of the heap, so the same person could
     * be scoped to café 42 one day and 43 the next. The only visible symptom
     * would be a console quietly showing another branch's stations and takings.
     *
     * Oldest café wins: stable, and the one they set up first. Moving between
     * several is the portal's organization switcher, not an accident of row
     * order.
     */
    const cafeResult = await pool.query(
      'SELECT cafe_id FROM cafes WHERE user_id = $1 ORDER BY cafe_id ASC LIMIT 1',
      [user.id]
    );

    user.cafe_id = cafeResult.rows.length > 0 ? cafeResult.rows[0].cafe_id : null;

    /*
     * The address is not trusted yet. A code goes out now and the account
     * cannot be signed into until it comes back — see `login` below.
     *
     * No token is issued here, deliberately: handing out a session at the same
     * moment we claim the address is unproven would make the verification
     * decorative.
     */
    const verification = await issueVerificationCode(user);

    res.status(201).json({
      success: true,
      message: verification.sent
        ? `Account created. We sent a six-digit code to ${user.email} — enter it to finish signing up.`
        : `Account created, but the verification email could not be sent (${verification.message}). Try “Resend code”.`,
      data: {
        user,
        // What the frontend keys off to show the code screen instead of a dashboard.
        verification_required: true,
        verification_sent: verification.sent,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Login user or admin
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    /*
     * The ADMIN_EMAIL / ADMIN_PASSWORD branch is gone.
     *
     * It compared the submitted password to an environment variable with `===`
     * — in plaintext, not constant time, against a credential that sat in a
     * file on disk and in the process environment of anything that could read
     * it. It also minted a token with no `id` and no `cafe_id`, which is what
     * left the desktop console signed in and unable to name its own café.
     *
     * Administrators are `admin_users` rows with bcrypt hashes and
     * audience-scoped tokens, and sign in through /api/admin/auth/login. This
     * path had become a second door to the same building with a worse lock.
     *
     * Anyone still using it falls through to the ordinary user login below and
     * is refused there unless they have a real account — which is the correct
     * answer, and the same one an unknown address gets.
     */

    // Regular user login
    const result = await pool.query(
      'SELECT id, email, phone_number, name, address, password, role, email_verified FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Remove password from response
    delete user.password;

    /*
     * An address that has never been confirmed cannot open a session.
     *
     * Checked after the password so this cannot be used to discover which
     * addresses are registered — only somebody who already knows the password
     * learns that the account is pending. The response says exactly what to do
     * and the frontend reads `verification_required` to open the code screen,
     * rather than showing a dead end.
     */
    if (user.email_verified === false) {
      return res.status(403).json({
        success: false,
        message: 'Verify your email address to finish setting up this account. Check your inbox for the six-digit code.',
        data: { verification_required: true, email: user.email }
      });
    }

    /*
     * The café this account is scoped to.
     *
     * Ordered and limited on purpose. An owner can hold more than one café —
     * a second branch registered separately — and this used to take whichever
     * row the database handed back first. That order is physical, not logical:
     * an UPDATE rewrites a row to the end of the heap, so the same person could
     * be scoped to café 42 one day and 43 the next. The only visible symptom
     * would be a console quietly showing another branch's stations and takings.
     *
     * Oldest café wins: stable, and the one they set up first. Moving between
     * several is the portal's organization switcher, not an accident of row
     * order.
     */
    const cafeResult = await pool.query(
      'SELECT cafe_id FROM cafes WHERE user_id = $1 ORDER BY cafe_id ASC LIMIT 1',
      [user.id]
    );

    user.cafe_id = cafeResult.rows.length > 0 ? cafeResult.rows[0].cafe_id : null;

    /*
     * The café goes in the token, not only in the response body.
     *
     * It was previously looked up here and attached to `user` for the frontend,
     * while the JWT carried nothing — so every guard that reads req.actor saw
     * no café and any tenant-scoped query had nothing to scope by. The backend
     * cannot trust a café id sent up from a client, so it has to be a claim.
     */
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, cafe_id: user.cafe_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      data: {
        user,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all users for admin dashboard
export const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, phone_number, name, address, role, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Verify token and return user info
export const verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const result = await pool.query(
      'SELECT id, email, phone_number, name, address, role, created_at FROM users WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    /*
     * The café this account is scoped to.
     *
     * Ordered and limited on purpose. An owner can hold more than one café —
     * a second branch registered separately — and this used to take whichever
     * row the database handed back first. That order is physical, not logical:
     * an UPDATE rewrites a row to the end of the heap, so the same person could
     * be scoped to café 42 one day and 43 the next. The only visible symptom
     * would be a console quietly showing another branch's stations and takings.
     *
     * Oldest café wins: stable, and the one they set up first. Moving between
     * several is the portal's organization switcher, not an accident of row
     * order.
     */
    const cafeResult = await pool.query(
      'SELECT cafe_id FROM cafes WHERE user_id = $1 ORDER BY cafe_id ASC LIMIT 1',
      [user.id]
    );

    user.cafe_id = cafeResult.rows.length > 0 ? cafeResult.rows[0].cafe_id : null;

    res.status(200).json({
      success: true,
      message: 'Token verified successfully',
      data: {
        user,
        token
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Quick verification endpoint for checking recent auth
export const verify = async (req, res) => {
  try {
    // This endpoint is called when desktop app wants to verify if user just logged in
    // It can use session cookies or other methods
    // For now, we'll return error - actual implementation depends on your session strategy
    
    return res.status(401).json({
      success: false,
      message: 'Session verification failed. Please use token method.'
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};