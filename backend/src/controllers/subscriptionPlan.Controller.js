import pool from '../config/database.js'; 

// Create a new subscription plan
export const createSubscriptionPlan = async (req, res) => {
  try {
    const {
      subs_software,
      name,
      max_branches,
      is_single_pc_price = false,
      max_pcs,
      games_allowed,
      is_telmetry_enabled = false,
      no_of_days,
      is_active = true,
      description
    } = req.body;

    // Validate required fields
    if (!subs_software || !name || !max_branches || !max_pcs) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: subs_software, name, max_branches, max_pcs are required'
      });
    }

    // Validate games_allowed is valid JSON if provided
    let gamesAllowedJson = games_allowed || [];
    if (typeof games_allowed === 'string') {
      try {
        gamesAllowedJson = JSON.parse(games_allowed);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON format for games_allowed'
        });
      }
    }

    const query = `
      INSERT INTO subscription_plans (
        subs_software, name, max_branches, is_single_pc_price, 
        max_pcs, games_allowed, is_telmetry_enabled, no_of_days, is_active, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      subs_software,
      name,
      max_branches,
      is_single_pc_price,
      max_pcs,
      JSON.stringify(gamesAllowedJson),
      is_telmetry_enabled,
      no_of_days,
      is_active,
      description
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all subscription plans
export const getAllSubscriptionPlans = async (req, res) => {
  try {
    const { is_active, subs_software } = req.query;
    
    let query = `
      SELECT 
        sub_id, subs_software, name, max_branches, is_single_pc_price,
        max_pcs, games_allowed, is_telmetry_enabled, no_of_days, is_active, description,
        created_at, updated_at
      FROM subscription_plans
      WHERE 1=1
    `;
    
    const values = [];
    let paramCounter = 1;
    
    // Add filters if provided
    if (is_active !== undefined) {
      query += ` AND is_active = $${paramCounter}`;
      values.push(is_active === 'true');
      paramCounter++;
    }
    
    if (subs_software) {
      query += ` AND subs_software = $${paramCounter}`;
      values.push(subs_software);
      paramCounter++;
    }
    
    // Add ordering
    query += ` ORDER BY created_at DESC`;
    
    const result = await pool.query(query, values);
    
    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get single subscription plan by ID
export const getSubscriptionPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        sub_id, subs_software, name, max_branches, is_single_pc_price,
        max_pcs, games_allowed, is_telmetry_enabled, no_of_days, is_active, description,
        created_at, updated_at
      FROM subscription_plans
      WHERE sub_id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update subscription plan
export const updateSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Check if plan exists
    const checkQuery = 'SELECT * FROM subscription_plans WHERE sub_id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    // Build dynamic update query
    const allowedFields = [
      'subs_software', 'name', 'max_branches', 'is_single_pc_price',
      'max_pcs', 'games_allowed', 'is_telmetry_enabled', 'no_of_days', 'is_active', 'description'
    ];
    
    const updateFields = [];
    const values = [];
    let paramCounter = 1;
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Handle JSON field specially
        if (field === 'games_allowed' && typeof updates[field] === 'string') {
          try {
            updates[field] = JSON.parse(updates[field]);
          } catch (error) {
            return res.status(400).json({
              success: false,
              message: 'Invalid JSON format for games_allowed'
            });
          }
        }
        
        updateFields.push(`${field} = $${paramCounter}`);
        values.push(updates[field]);
        paramCounter++;
      }
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }
    
    // Add updated_at timestamp
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    
    const query = `
      UPDATE subscription_plans 
      SET ${updateFields.join(', ')}
      WHERE sub_id = $${paramCounter}
      RETURNING *
    `;
    
    values.push(id);
    
    const result = await pool.query(query, values);
    
    res.status(200).json({
      success: true,
      message: 'Subscription plan updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete subscription plan (soft delete)
export const deleteSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query; // Optional flag for permanent deletion
    
    // Check if plan exists
    const checkQuery = 'SELECT * FROM subscription_plans WHERE sub_id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    if (permanent === 'true') {
      // Permanent deletion
      const deleteQuery = 'DELETE FROM subscription_plans WHERE sub_id = $1 RETURNING *';
      const result = await pool.query(deleteQuery, [id]);
      
      res.status(200).json({
        success: true,
        message: 'Subscription plan permanently deleted',
        data: result.rows[0]
      });
    } else {
      // Soft delete (set is_active to false)
      const updateQuery = `
        UPDATE subscription_plans 
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE sub_id = $1 
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [id]);
      
      res.status(200).json({
        success: true,
        message: 'Subscription plan deactivated successfully',
        data: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error deleting subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get free trial plans for GamingXP
export const getGamingXPFreeTrialPlan = async (req, res) => {
  try {
    const query = `
      SELECT 
        sub_id, subs_software, name, max_branches, is_single_pc_price,
        max_pcs, games_allowed, is_telmetry_enabled, no_of_days, is_active, 
        is_freeTrial, description, created_at, updated_at
      FROM subscription_plans
      -- 'gamingxp' was the old name for CafeXP; accept both so a plan
      -- created before the rename is still found.
      WHERE is_freeTrial = true AND subs_software IN ('cafexp', 'gamingxp')
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    
    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching GamingXP free trial plan:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

