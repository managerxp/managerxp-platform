import pool from '../config/database.js';

// Create a new subscription
export const createSubscription = async (req, res) => {
  try {
    const {
      cafe_id,
      sub_id,
      max_pcs,
      start_date,
      end_date,
      is_active = true
    } = req.body;

    // A café token may only ever create a subscription for its own café —
    // never trust the body's cafe_id on its own.
    if (Number(cafe_id) !== Number(req.actor.cafe_id)) {
      return res.status(403).json({ success: false, message: 'You can only manage your own café\'s subscription' });
    }

    // Validate required fields
    if (!cafe_id || !sub_id || !max_pcs || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: cafe_id, sub_id, max_pcs, start_date, end_date'
      });
    }

    // Validate dates
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    
    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    // Check if cafe exists
    const cafeCheck = await pool.query(
      'SELECT cafe_id FROM cafes WHERE cafe_id = $1',
      [cafe_id]
    );
    
    if (cafeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cafe not found'
      });
    }

    // Check if subscription plan exists
    const planCheck = await pool.query(
      'SELECT sub_id FROM subscription_plans WHERE sub_id = $1',
      [sub_id]
    );
    
    if (planCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Check for overlapping active subscriptions for the same cafe
    const overlapCheck = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE cafe_id = $1 
       AND is_active = true 
       AND (
         (start_date <= $2 AND end_date >= $2) OR
         (start_date <= $3 AND end_date >= $3) OR
         (start_date >= $2 AND end_date <= $3)
       )`,
      [cafe_id, start_date, end_date]
    );

    if (overlapCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cafe already has an active subscription during this period'
      });
    }

    // Insert the subscription
    const query = `
      INSERT INTO subscriptions (
        cafe_id, 
        sub_id, 
        max_pcs, 
        start_date, 
        end_date, 
        is_active,
        created_at,
        updated_at
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    
    const values = [cafe_id, sub_id, max_pcs, start_date, end_date, is_active];
    const result = await pool.query(query, values);
    
    return res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error creating subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all subscriptions with cafe and plan details
export const getAllSubscriptions = async (req, res) => {
  try {
    const { is_active, page = 1, limit = 10 } = req.query;
    // A café token only ever gets its own subscriptions, regardless of what
    // cafe_id a caller passes in the query string.
    const cafe_id = req.actor.cafe_id;
    if (!cafe_id) {
      return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: Number(limit), total: 0, totalPages: 0 } });
    }

    let query = `
      SELECT 
        s.subscription_id,
        s.cafe_id,
        c.name as cafe_name,
        s.sub_id,
        sp.name as plan_name,
        sp.subs_software as software,
        s.max_pcs,
        s.start_date,
        s.end_date,
        s.is_active,
        s.created_at,
        s.updated_at,
        CASE 
          WHEN s.end_date < CURRENT_TIMESTAMP THEN 'expired'
          WHEN s.is_active = false THEN 'inactive'
          ELSE 'active'
        END as status
      FROM subscriptions s
      LEFT JOIN cafes c ON s.cafe_id = c.cafe_id
      LEFT JOIN subscription_plans sp ON s.sub_id = sp.sub_id
      WHERE 1=1
    `;
    
    const queryParams = [];
    let paramIndex = 1;
    
    // Add filters
    if (cafe_id) {
      query += ` AND s.cafe_id = $${paramIndex}`;
      queryParams.push(cafe_id);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      query += ` AND s.is_active = $${paramIndex}`;
      queryParams.push(is_active === 'true');
      paramIndex++;
    }
    
    // Add pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY s.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), offset);
    
    const result = await pool.query(query, queryParams);
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM subscriptions s
      WHERE 1=1
    `;
    
    const countParams = [];
    let countIndex = 1;
    
    if (cafe_id) {
      countQuery += ` AND s.cafe_id = $${countIndex}`;
      countParams.push(cafe_id);
      countIndex++;
    }
    
    if (is_active !== undefined) {
      countQuery += ` AND s.is_active = $${countIndex}`;
      countParams.push(is_active === 'true');
      countIndex++;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);
    
    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get a single subscription by ID
export const getSubscriptionById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        s.subscription_id,
        s.cafe_id,
        c.name as cafe_name,
        c.email as cafe_email,
        c.phone as cafe_phone,
        s.sub_id,
        sp.name as plan_name,
        sp.subs_software as software,
        sp.description as plan_description,
        sp.max_branches,
        sp.games_allowed,
        sp.is_freeTrial,
        s.max_pcs,
        s.start_date,
        s.end_date,
        s.is_active,
        s.created_at,
        s.updated_at,
        CASE 
          WHEN s.end_date < CURRENT_TIMESTAMP THEN 'expired'
          WHEN s.is_active = false THEN 'inactive'
          ELSE 'active'
        END as status,
        EXTRACT(DAY FROM (s.end_date - CURRENT_TIMESTAMP)) as days_remaining
      FROM subscriptions s
      LEFT JOIN cafes c ON s.cafe_id = c.cafe_id
      LEFT JOIN subscription_plans sp ON s.sub_id = sp.sub_id
      WHERE s.subscription_id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error fetching subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete a subscription (soft delete or hard delete)
export const deleteSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;
    
    // Check if subscription exists
    const checkQuery = 'SELECT subscription_id FROM subscriptions WHERE subscription_id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }
    
    let result;
    
    if (permanent === 'true') {
      // Permanent hard delete
      const deleteQuery = 'DELETE FROM subscriptions WHERE subscription_id = $1 RETURNING *';
      result = await pool.query(deleteQuery, [id]);
      
      return res.status(200).json({
        success: true,
        message: 'Subscription permanently deleted',
        data: result.rows[0]
      });
    } else {
      // Soft delete (just deactivate)
      const updateQuery = `
        UPDATE subscriptions 
        SET is_active = false, 
            updated_at = CURRENT_TIMESTAMP 
        WHERE subscription_id = $1 
        RETURNING *
      `;
      result = await pool.query(updateQuery, [id]);
      
      return res.status(200).json({
        success: true,
        message: 'Subscription deactivated successfully',
        data: result.rows[0]
      });
    }
    
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete expired subscriptions (bulk delete)
export const deleteExpiredSubscriptions = async (req, res) => {
  try {
    const { permanent = false } = req.query;
    
    if (permanent === 'true') {
      // Permanently delete expired subscriptions
      const deleteQuery = `
        DELETE FROM subscriptions 
        WHERE end_date < CURRENT_TIMESTAMP 
        AND is_active = true
        RETURNING *
      `;
      const result = await pool.query(deleteQuery);
      
      return res.status(200).json({
        success: true,
        message: `${result.rows.length} expired subscriptions permanently deleted`,
        data: result.rows
      });
    } else {
      // Soft delete expired subscriptions (deactivate)
      const updateQuery = `
        UPDATE subscriptions 
        SET is_active = false, 
            updated_at = CURRENT_TIMESTAMP 
        WHERE end_date < CURRENT_TIMESTAMP 
        AND is_active = true
        RETURNING *
      `;
      const result = await pool.query(updateQuery);
      
      return res.status(200).json({
        success: true,
        message: `${result.rows.length} expired subscriptions deactivated`,
        data: result.rows
      });
    }
    
  } catch (error) {
    console.error('Error deleting expired subscriptions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

//get subscriptions by cafe id
export const getSubscriptionsByCafeId = async (req, res) => {
  try {
    const { cafe_id } = req.params;
    if (Number(cafe_id) !== Number(req.actor.cafe_id)) {
      return res.status(403).json({ success: false, message: 'You can only view your own café\'s subscription' });
    }
    const query = `
      SELECT s.*, 
      s1.*
       FROM subscriptions s JOIN subscription_plans s1 ON s.sub_id = s1.sub_id
      WHERE s.cafe_id = $1 AND s.end_date >= CURRENT_TIMESTAMP
    `;
    const result = await pool.query(query, [cafe_id]);
    
    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching subscriptions by cafe id:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/*
 * GET /api/subscriptions/addons/catalog
 *
 * Every add-on ManagerXP currently sells, for a signed-in café to browse —
 * not just the ones already on this café's plan. This is what the console's
 * "not included in your plan" screens read from to name a price rather than
 * just saying a feature is missing. Read-only: there is no self-service
 * checkout yet, so this never touches this café's own subscription.
 */
export const listAddonCatalog = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.addon_id, a.code, a.name, a.description, a.price, a.currency, a.billing_period,
             COALESCE(
               json_agg(json_build_object('feature_key', f.feature_key, 'label', f.label))
                 FILTER (WHERE f.feature_key IS NOT NULL),
               '[]'
             ) AS features
      FROM addons a
      LEFT JOIN addon_features af ON af.addon_id = a.addon_id
      LEFT JOIN features f ON f.feature_key = af.feature_key
      WHERE a.is_active = TRUE
      GROUP BY a.addon_id
      ORDER BY a.name
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing add-on catalog:', error);
    res.status(500).json({ success: false, message: 'Could not load add-ons' });
  }
};
