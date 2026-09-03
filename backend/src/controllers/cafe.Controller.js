import pool from '../config/database.js'; 

// Create cafe with branches
export const createCafe = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { name, user_id, user_designation, description, branches } = req.body;
    
    await client.query('BEGIN');
    
    // Insert cafe
    const cafeResult = await client.query(
      `INSERT INTO cafes (name, user_id, user_designation, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, user_id, user_designation, description]
    );
    
    const cafe = cafeResult.rows[0];
    
    // Insert branches if provided
    const insertedBranches = [];
    if (branches && branches.length > 0) {
      for (const branch of branches) {
        const branchResult = await client.query(
          `INSERT INTO branches (cafe_id, street, city, state, country, zip_code)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [cafe.cafe_id, branch.street, branch.city, branch.state, branch.country, branch.zip_code]
        );
        insertedBranches.push(branchResult.rows[0]);
      }
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: 'Cafe created successfully',
      data: {
        cafe,
        branches: insertedBranches
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating cafe:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating cafe',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Update cafe and its branches
export const updateCafe = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { cafe_id } = req.params;
    const { name, user_id, user_designation, description, branches, is_active } = req.body;
    
    await client.query('BEGIN');
    
    // Update cafe
    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;
    
    if (name !== undefined) {
      updateFields.push(`name = $${paramCounter++}`);
      updateValues.push(name);
    }
    if (user_id !== undefined) {
      updateFields.push(`user_id = $${paramCounter++}`);
      updateValues.push(user_id);
    }
    if (user_designation !== undefined) {
      updateFields.push(`user_designation = $${paramCounter++}`);
      updateValues.push(user_designation);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCounter++}`);
      updateValues.push(description);
    }
    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramCounter++}`);
      updateValues.push(is_active);
    }
    
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    
    if (updateFields.length > 1) {
      const query = `
        UPDATE cafes 
        SET ${updateFields.join(', ')}
        WHERE cafe_id = $${paramCounter}
        RETURNING *
      `;
      updateValues.push(cafe_id);
      
      const cafeResult = await client.query(query, updateValues);
      
      if (cafeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Cafe not found'
        });
      }
      
      var updatedCafe = cafeResult.rows[0];
    } else {
      // If no fields to update, just fetch the cafe
      const cafeResult = await client.query(
        'SELECT * FROM cafes WHERE cafe_id = $1',
        [cafe_id]
      );
      
      if (cafeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Cafe not found'
        });
      }
      
      var updatedCafe = cafeResult.rows[0];
    }
    
    // Update branches if provided
    const updatedBranches = [];
    if (branches && branches.length > 0) {
      // Delete existing branches
      await client.query(
        'DELETE FROM branches WHERE cafe_id = $1',
        [cafe_id]
      );
      
      // Insert new branches
      for (const branch of branches) {
        const branchResult = await client.query(
          `INSERT INTO branches (cafe_id, street, city, state, country, zip_code)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [cafe_id, branch.street, branch.city, branch.state, branch.country, branch.zip_code]
        );
        updatedBranches.push(branchResult.rows[0]);
      }
    }
    
    await client.query('COMMIT');
    
    res.status(200).json({
      success: true,
      message: 'Cafe updated successfully',
      data: {
        cafe: updatedCafe,
        branches: updatedBranches
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating cafe:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating cafe',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Delete cafe (soft delete or hard delete)
export const deleteCafe = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { cafe_id } = req.params;
    const { permanent } = req.query; // If permanent=true, hard delete
    
    if (permanent === 'true') {
      // Hard delete - will cascade to branches due to ON DELETE CASCADE
      const result = await client.query(
        'DELETE FROM cafes WHERE cafe_id = $1 RETURNING *',
        [cafe_id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Cafe not found'
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'Cafe permanently deleted successfully',
        data: result.rows[0]
      });
    } else {
      // Soft delete - just mark as inactive
      const result = await client.query(
        `UPDATE cafes 
         SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE cafe_id = $1 AND is_active = true
         RETURNING *`,
        [cafe_id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Cafe not found or already inactive'
        });
      }
      
      // Also soft delete branches
      await client.query(
        `UPDATE branches 
         SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE cafe_id = $1`,
        [cafe_id]
      );
      
      res.status(200).json({
        success: true,
        message: 'Cafe deactivated successfully',
        data: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error deleting cafe:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting cafe',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Get all cafes with their branches
/*
 * Which cafés the caller may see.
 *
 * A café's name and address are not secrets in themselves, but the list of
 * every café on the platform is: it tells any operator who else is a ManagerXP
 * customer, and how many. That is our commercial information, not theirs.
 *
 * A platform administrator sees everything — running the platform is the job.
 * Anyone else sees the café their token names, and nothing else. Returning an
 * empty list rather than a 403 for a café-less principal keeps the shape of
 * the answer the same however the caller is authenticated.
 */
const cafeScope = (actor) => {
  if (!actor) return { sql: 'FALSE', params: [] };
  /* Only the vendor's own token widens this. Checking `role === 'admin'` here
     would have been useless: café owners live in the same users table and at
     least one of them carries that role, so it would have shown one customer
     every other customer on the platform. */
  if (actor.isPlatformAdmin) {
    return { sql: null, params: [] };            // no restriction
  }
  if (actor.cafe_id) {
    return { sql: 'c.cafe_id = $$', params: [actor.cafe_id] };
  }
  return { sql: 'FALSE', params: [] };
};

export const getAllCafes = async (req, res) => {
  try {
    const { include_inactive, city, state, country } = req.query;

    let cafesQuery = `
      SELECT 
        c.*,
        json_agg(
          json_build_object(
            'branch_id', b.branch_id,
            'street', b.street,
            'city', b.city,
            'state', b.state,
            'country', b.country,
            'zip_code', b.zip_code,
            'is_active', b.is_active,
            'created_at', b.created_at,
            'updated_at', b.updated_at
          ) ORDER BY b.branch_id
        ) as branches
      FROM cafes c
      LEFT JOIN branches b ON c.cafe_id = b.cafe_id
    `;
    
    const queryParams = [];
    const conditions = [];
    let paramCounter = 1;

    /* Applied first and never optional — a filter the caller cannot influence,
       unlike everything below it. */
    const scope = cafeScope(req.actor);
    if (scope.sql === 'FALSE') {
      return res.status(200).json({ success: true, data: [], count: 0 });
    }
    if (scope.sql) {
      conditions.push(scope.sql.replace('$$', `$${paramCounter++}`));
      queryParams.push(...scope.params);
    }

    // Filter by active status
    if (include_inactive !== 'true') {
      conditions.push(`c.is_active = true`);
    }

    // Filter branches by location
    if (city) {
      conditions.push(`b.city = $${paramCounter++}`);
      queryParams.push(city);
    }
    if (state) {
      conditions.push(`b.state = $${paramCounter++}`);
      queryParams.push(state);
    }
    if (country) {
      conditions.push(`b.country = $${paramCounter++}`);
      queryParams.push(country);
    }
    
    if (conditions.length > 0) {
      cafesQuery += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    cafesQuery += ` GROUP BY c.cafe_id ORDER BY c.created_at DESC`;
    
    const result = await pool.query(cafesQuery, queryParams);
    
    // Filter out cafes with no branches if location filter was applied
    let cafes = result.rows;
    if (city || state || country) {
      cafes = cafes.filter(cafe => cafe.branches && cafe.branches[0] !== null);
    }
    
    res.status(200).json({
      success: true,
      count: cafes.length,
      data: cafes
    });
  } catch (error) {
    console.error('Error fetching cafes:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cafes',
      error: error.message
    });
  }
};

// Get single cafe with its branches
export const getCafeById = async (req, res) => {
  try {
    const { cafe_id } = req.params;

    /* Someone else's café is answered as though it does not exist, not as
       "you may not see that" — the second confirms it is there and that the
       id is worth guessing at. Same rule the tenant routes follow. */
    const actor = req.actor || {};
    if (!actor.isPlatformAdmin && String(actor.cafe_id || '') !== String(cafe_id)) {
      return res.status(404).json({ success: false, message: 'Cafe not found' });
    }

    const query = `
      SELECT 
        c.*,
        COALESCE(
          json_agg(
            json_build_object(
              'branch_id', b.branch_id,
              'street', b.street,
              'city', b.city,
              'state', b.state,
              'country', b.country,
              'zip_code', b.zip_code,
              'is_active', b.is_active,
              'created_at', b.created_at,
              'updated_at', b.updated_at
            ) ORDER BY b.branch_id
          ) FILTER (WHERE b.branch_id IS NOT NULL),
          '[]'
        ) as branches
      FROM cafes c
      LEFT JOIN branches b ON c.cafe_id = b.cafe_id
      WHERE c.cafe_id = $1
      GROUP BY c.cafe_id
    `;
    
    const result = await pool.query(query, [cafe_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cafe not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching cafe:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cafe',
      error: error.message
    });
  }
};

// Add branch to existing cafe
// export const addBranch = async (req, res) => {
//   try {
//     const { cafe_id } = req.params;
//     const { street, city, state, country, zip_code } = req.body;
    
//     // Check if cafe exists
//     const cafeCheck = await pool.query(
//       'SELECT cafe_id FROM cafes WHERE cafe_id = $1',
//       [cafe_id]
//     );
    
//     if (cafeCheck.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Cafe not found'
//       });
//     }
    
//     const result = await pool.query(
//       `INSERT INTO branches (cafe_id, street, city, state, country, zip_code)
//        VALUES ($1, $2, $3, $4, $5, $6)
//        RETURNING *`,
//       [cafe_id, street, city, state, country, zip_code]
//     );
    
//     res.status(201).json({
//       success: true,
//       message: 'Branch added successfully',
//       data: result.rows[0]
//     });
//   } catch (error) {
//     console.error('Error adding branch:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error adding branch',
//       error: error.message
//     });
//   }
// };

// // Update branch
// export const updateBranch = async (req, res) => {
//   try {
//     const { branch_id } = req.params;
//     const { street, city, state, country, zip_code, is_active } = req.body;
    
//     const updateFields = [];
//     const updateValues = [];
//     let paramCounter = 1;
    
//     if (street !== undefined) {
//       updateFields.push(`street = $${paramCounter++}`);
//       updateValues.push(street);
//     }
//     if (city !== undefined) {
//       updateFields.push(`city = $${paramCounter++}`);
//       updateValues.push(city);
//     }
//     if (state !== undefined) {
//       updateFields.push(`state = $${paramCounter++}`);
//       updateValues.push(state);
//     }
//     if (country !== undefined) {
//       updateFields.push(`country = $${paramCounter++}`);
//       updateValues.push(country);
//     }
//     if (zip_code !== undefined) {
//       updateFields.push(`zip_code = $${paramCounter++}`);
//       updateValues.push(zip_code);
//     }
//     if (is_active !== undefined) {
//       updateFields.push(`is_active = $${paramCounter++}`);
//       updateValues.push(is_active);
//     }
    
//     if (updateFields.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No fields to update'
//       });
//     }
    
//     updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
//     updateValues.push(branch_id);
    
//     const query = `
//       UPDATE branches 
//       SET ${updateFields.join(', ')}
//       WHERE branch_id = $${paramCounter}
//       RETURNING *
//     `;
    
//     const result = await pool.query(query, updateValues);
    
//     if (result.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Branch not found'
//       });
//     }
    
//     res.status(200).json({
//       success: true,
//       message: 'Branch updated successfully',
//       data: result.rows[0]
//     });
//   } catch (error) {
//     console.error('Error updating branch:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error updating branch',
//       error: error.message
//     });
//   }
// };

// // Delete branch
// export const deleteBranch = async (req, res) => {
//   try {
//     const { branch_id } = req.params;
//     const { permanent } = req.query;
    
//     if (permanent === 'true') {
//       const result = await pool.query(
//         'DELETE FROM branches WHERE branch_id = $1 RETURNING *',
//         [branch_id]
//       );
      
//       if (result.rows.length === 0) {
//         return res.status(404).json({
//           success: false,
//           message: 'Branch not found'
//         });
//       }
      
//       res.status(200).json({
//         success: true,
//         message: 'Branch permanently deleted successfully',
//         data: result.rows[0]
//       });
//     } else {
//       const result = await pool.query(
//         `UPDATE branches 
//          SET is_active = false, updated_at = CURRENT_TIMESTAMP
//          WHERE branch_id = $1 AND is_active = true
//          RETURNING *`,
//         [branch_id]
//       );
      
//       if (result.rows.length === 0) {
//         return res.status(404).json({
//           success: false,
//           message: 'Branch not found or already inactive'
//         });
//       }
      
//       res.status(200).json({
//         success: true,
//         message: 'Branch deactivated successfully',
//         data: result.rows[0]
//       });
//     }
//   } catch (error) {
//     console.error('Error deleting branch:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error deleting branch',
//       error: error.message
//     });
//   }
// };