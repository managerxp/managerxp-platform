import pool from '../config/database.js';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { categoryJoin, categoryExpr, categoryIsOverridden } from '../config/softwareCategory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure storage for multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    // Create uploads directory if it doesn't exist
    fs.mkdir(uploadDir, { recursive: true })
      .then(() => cb(null, uploadDir))
      .catch(err => cb(err));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter for images and videos
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'software_icon') {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for icon!'), false);
    }
  } else if (file.fieldname === 'software_video') {
    // Accept video files
    const allowedVideoTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'];
    if (allowedVideoTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (MP4, MPEG, MOV, AVI) are allowed!'), false);
    }
  } else {
    cb(new Error('Unexpected field'), false);
  }
};

// Configure multer for file uploads
export const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for videos
  }
}).fields([
  { name: 'software_icon', maxCount: 1 },
  { name: 'software_video', maxCount: 1 }
]);

// Helper function to optimize image
async function optimizeImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize(500, 500, { // Resize to 500x500 max
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toFile(outputPath);
    
    // Delete original file
    await fs.unlink(inputPath);
    return true;
  } catch (error) {
    console.error('Error optimizing image:', error);
    return false;
  }
}

// Helper function to validate video
async function validateVideo(filePath) {
  try {
    const type = await fileTypeFromFile(filePath);
    if (type && type.mime.startsWith('video/')) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

/*
 * A category is the café's own word for a kind of play — "PC", "PS5", "Pool",
 * "Darts". Trimmed and length-capped here rather than trusted from the client,
 * and an empty string becomes NULL so "no category" has one representation
 * instead of two.
 */
const cleanCategory = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, 60) : null;
};

// CREATE - Add new software
export const createSoftware = async (req, res) => {
  try {
    const { software_name } = req.body;
    const category = cleanCategory(req.body.category);

    if (!software_name) {
      return res.status(400).json({
        success: false,
        message: 'Software name is required'
      });
    }

    let iconPath = null;
    let videoPath = null;
    
    // Process uploaded icon
    if (req.files && req.files.software_icon) {
      const iconFile = req.files.software_icon[0];
      const optimizedFilename = `optimized-${path.basename(iconFile.filename)}`;
      const optimizedPath = path.join(iconFile.destination, optimizedFilename);
      
      await optimizeImage(iconFile.path, optimizedPath);
      iconPath = `/uploads/${optimizedFilename}`;
    }
    
    // Process uploaded video
    if (req.files && req.files.software_video) {
      const videoFile = req.files.software_video[0];
      const isValid = await validateVideo(videoFile.path);
      
      if (!isValid) {
        // Delete invalid video
        await fs.unlink(videoFile.path);
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid video file format' 
        });
      }
      videoPath = `/uploads/${videoFile.filename}`;
    }
    
    const result = await pool.query(
      `INSERT INTO software_master (software_name, software_icon, software_video, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [software_name, iconPath, videoPath, category]
    );
    
    res.status(201).json({
      success: true,
      message: 'Software created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating software:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
};

// READ - Get all software (with pagination)
export const getAllSoftware = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    /*
     * The published catalogue plus this café's own house activities.
     *
     * cafe_id IS NULL is the catalogue ManagerXP publishes and every café
     * draws from — shared on purpose, and where the admin side maintains the
     * artwork. A row carrying a cafe_id is somebody's pool table, and only
     * its owner has any business seeing it.
     */
    const cafeId = req.actor?.cafe_id ?? null;
    const scope = `sm.is_active = true AND (sm.cafe_id IS NULL OR sm.cafe_id = $1)`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM software_master sm WHERE ${scope}`,
      [cafeId]
    );
    const totalCount = parseInt(countResult.rows[0].count);

    /* Category resolves through this branch's own filing — see
       config/softwareCategory.js. cafe_id is echoed back so the console can
       tell a published title from this branch's own activity. */
    const result = await pool.query(
      `SELECT sm.software_id, sm.software_name, sm.software_icon, sm.software_video,
              ${categoryExpr()} AS category,
              ${categoryIsOverridden()} AS category_is_local,
              sm.is_house, sm.is_active, sm.cafe_id, sm.created_at, sm.updated_at
       FROM software_master sm
       ${categoryJoin(1)}
       WHERE ${scope}
       ORDER BY sm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [cafeId, limit, offset]
    );
    
    res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Error fetching software:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

/*
 * The distinct categories in use, with how many active games sit in each.
 *
 * Derived rather than stored: the categories that exist are exactly the ones
 * somebody typed on a game, so the list cannot drift out of step with reality
 * and there is no orphaned "Darts" left behind after the last dartboard goes.
 */
export const getSoftwareCategories = async (req, res) => {
  try {
    // Same visibility rule as the list — otherwise the category counts quietly
    // reveal that other cafés exist and roughly what they run.
    /* Grouped on the *resolved* category, so a title this branch re-filed
       counts under the branch's own name and not the published one. */
    const result = await pool.query(
      `SELECT ${categoryExpr()} AS category, COUNT(*)::int AS software_count
         FROM software_master sm
         ${categoryJoin(1)}
        WHERE sm.is_active = true
          AND ${categoryExpr()} IS NOT NULL
          AND (sm.cafe_id IS NULL OR sm.cafe_id = $1)
        GROUP BY ${categoryExpr()}
        ORDER BY 1 ASC`,
      [req.actor?.cafe_id ?? null]
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching software categories:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/* ==========================================================================
   HOUSE ACTIVITIES — the café's own

   A café sells time on things ManagerXP never published: a pool table, a
   dartboard, a racing rig. Those cannot go through the admin catalogue, and
   before this there was no way to price them at all — the price master could
   only reference titles somebody else had created.

   These endpoints are open to any signed-in café user, and are deliberately
   narrow: a café may create its own activities and change its own, and may
   not touch a published title beyond filing it into a category.
   ========================================================================== */

/** Create an activity owned by this café. No uploads — it is a name and a shelf. */
export const createHouseActivity = async (req, res) => {
  try {
    const name = String(req.body.software_name || '').trim();
    const category = cleanCategory(req.body.category);

    if (!name) {
      return res.status(400).json({ success: false, message: 'A name is required' });
    }
    if (name.length > 255) {
      return res.status(400).json({ success: false, message: 'That name is too long' });
    }

    /* A duplicate name would give the till two identical tiles with different
       prices behind them, which is a mis-charge waiting to happen. */
    /* Only against what this café can see. Checking the whole table would let
       one café's "Pool Table" block every other café from ever creating one,
       and would confirm the name is in use somewhere they cannot look. */
    const cafeId = req.actor?.cafe_id ?? null;
    const clash = await pool.query(
      `SELECT software_id FROM software_master
        WHERE LOWER(software_name) = LOWER($1) AND is_active = true
          AND (cafe_id IS NULL OR cafe_id = $2)`,
      [name, cafeId]
    );
    if (clash.rows.length) {
      return res.status(409).json({
        success: false,
        message: `${name} is already in the catalogue`
      });
    }

    const result = await pool.query(
      `INSERT INTO software_master (software_name, category, is_house, cafe_id)
       VALUES ($1, $2, TRUE, $3)
       RETURNING *`,
      [name, category, cafeId]
    );

    res.status(201).json({ success: true, message: 'Activity added', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating house activity:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** Rename or recategorise an activity the café created. Published titles are refused. */
export const updateHouseActivity = async (req, res) => {
  try {
    const { id } = req.params;
    // Scoped in the lookup: another café's activity is simply not there.
    const existing = await pool.query(
      `SELECT * FROM software_master
        WHERE software_id = $1 AND (cafe_id IS NULL OR cafe_id = $2)`,
      [id, req.actor?.cafe_id ?? null]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }
    if (!existing.rows[0].is_house) {
      return res.status(403).json({
        success: false,
        message: 'That title is published by ManagerXP and cannot be edited here'
      });
    }

    const name = req.body.software_name === undefined
      ? existing.rows[0].software_name
      : String(req.body.software_name).trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'A name is required' });
    }

    const category = req.body.category === undefined
      ? existing.rows[0].category
      : cleanCategory(req.body.category);

    const result = await pool.query(
      `UPDATE software_master
          SET software_name = $1, category = $2, updated_at = CURRENT_TIMESTAMP
        WHERE software_id = $3 AND cafe_id IS NOT DISTINCT FROM $4
        RETURNING *`,
      [name, category, id, req.actor?.cafe_id ?? null]
    );

    res.status(200).json({ success: true, message: 'Activity updated', data: result.rows[0] });
  } catch (error) {
    console.error('Error updating house activity:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** Retire an activity the café created. Soft, so existing bills keep their name. */
export const deleteHouseActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const cafeId = req.actor?.cafe_id ?? null;
    const existing = await pool.query(
      `SELECT * FROM software_master
        WHERE software_id = $1 AND (cafe_id IS NULL OR cafe_id = $2)`,
      [id, cafeId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }
    if (!existing.rows[0].is_house) {
      return res.status(403).json({
        success: false,
        message: 'That title is published by ManagerXP and cannot be removed here'
      });
    }

    const result = await pool.query(
      `UPDATE software_master SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE software_id = $1 AND cafe_id IS NOT DISTINCT FROM $2 RETURNING *`,
      [id, cafeId]
    );
    res.status(200).json({ success: true, message: 'Activity retired', data: result.rows[0] });
  } catch (error) {
    console.error('Error retiring house activity:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/*
 * Set the category on any title, published or house.
 *
 * Deliberately wider than the rest: a category is not part of a title's
 * identity, it is how this café arranges its own till. Telling an operator to
 * raise a ticket with ManagerXP because their PS5 tiles are under the wrong
 * tab would be absurd. Name, artwork and existence stay admin-only.
 */
export const setSoftwareCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = cleanCategory(req.body.category);

    const cafeId = req.actor?.cafe_id ?? null;

    const title = await pool.query(
      `SELECT software_id, software_name, category, is_house, cafe_id
         FROM software_master
        WHERE software_id = $1 AND is_active = true
          AND (cafe_id IS NULL OR cafe_id = $2)`,
      [id, cafeId]
    );
    if (!title.rows.length) {
      return res.status(404).json({ success: false, message: 'Title not found' });
    }
    const row = title.rows[0];

    /*
     * Where the category is written depends on who owns the title.
     *
     * This branch's own activity: straight onto the row, because nobody else
     * can see it. A published title: into this branch's overrides, because
     * the row is shared and writing to it re-files the same title on every
     * other café — which is exactly what this used to do.
     *
     * Clearing the category on a published title removes the override rather
     * than storing a blank, so the branch falls back to the published default
     * instead of ending up with a title filed under nothing.
     */
    if (row.is_house && row.cafe_id !== null) {
      await pool.query(
        `UPDATE software_master SET category = $1, updated_at = CURRENT_TIMESTAMP
          WHERE software_id = $2 AND cafe_id IS NOT DISTINCT FROM $3`,
        [category, id, cafeId]
      );
    } else if (cafeId === null) {
      return res.status(403).json({
        success: false,
        message: 'Sign in to a café to file titles into your own categories'
      });
    } else if (category) {
      await pool.query(
        `INSERT INTO software_category_overrides (cafe_id, software_id, category, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (cafe_id, software_id)
         DO UPDATE SET category = EXCLUDED.category, updated_at = CURRENT_TIMESTAMP`,
        [cafeId, id, category]
      );
    } else {
      await pool.query(
        `DELETE FROM software_category_overrides WHERE cafe_id = $1 AND software_id = $2`,
        [cafeId, id]
      );
    }

    const fresh = await pool.query(
      `SELECT sm.software_id, sm.software_name,
              ${categoryExpr()} AS category,
              ${categoryIsOverridden()} AS category_is_local,
              sm.is_house
         FROM software_master sm
         ${categoryJoin(2)}
        WHERE sm.software_id = $1`,
      [id, cafeId]
    );

    res.status(200).json({ success: true, message: 'Category updated', data: fresh.rows[0] });
  } catch (error) {
    console.error('Error setting category:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// READ - Get single software by ID
export const getSoftwareById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT sm.software_id, sm.software_name, sm.software_icon, sm.software_video,
              ${categoryExpr()} AS category,
              ${categoryIsOverridden()} AS category_is_local,
              sm.is_house, sm.is_active, sm.cafe_id, sm.created_at, sm.updated_at
       FROM software_master sm
       ${categoryJoin(2)}
       WHERE sm.software_id = $1 AND sm.is_active = true
         AND (sm.cafe_id IS NULL OR sm.cafe_id = $2)`,
      [id, req.actor?.cafe_id ?? null]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Software not found' 
      });
    }
    
    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching software:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// Helper function to delete old files
async function deleteOldFiles(filePaths) {
  for (const filePath of filePaths) {
    if (filePath) {
      const fullPath = path.join(__dirname, '..', filePath);
      try {
        await fs.access(fullPath);
        await fs.unlink(fullPath);
      } catch (err) {
        console.log(`File not found: ${fullPath}`);
      }
    }
  }
}

// UPDATE - Update software
export const updateSoftware = async (req, res) => {
  try {
    const { id } = req.params;
    const { software_name, is_active } = req.body;
    
    // Check if software exists
    const existingSoftware = await pool.query(
      'SELECT * FROM software_master WHERE software_id = $1',
      [id]
    );
    
    if (existingSoftware.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Software not found' 
      });
    }
    
    const oldData = existingSoftware.rows[0];
    let iconPath = oldData.software_icon;
    let videoPath = oldData.software_video;
    
    // Process new icon if uploaded
    if (req.files && req.files.software_icon) {
      const iconFile = req.files.software_icon[0];
      const optimizedFilename = `optimized-${path.basename(iconFile.filename)}`;
      const optimizedPath = path.join(iconFile.destination, optimizedFilename);
      
      await optimizeImage(iconFile.path, optimizedPath);
      iconPath = `/uploads/${optimizedFilename}`;
      
      // Delete old icon if exists
      if (oldData.software_icon) {
        await deleteOldFiles([oldData.software_icon]);
      }
    }
    
    // Process new video if uploaded
    if (req.files && req.files.software_video) {
      const videoFile = req.files.software_video[0];
      const isValid = await validateVideo(videoFile.path);
      
      if (!isValid) {
        await fs.unlink(videoFile.path);
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid video file format' 
        });
      }
      videoPath = `/uploads/${videoFile.filename}`;
      
      // Delete old video if exists
      if (oldData.software_video) {
        await deleteOldFiles([oldData.software_video]);
      }
    }
    
    /* Only touched when the caller actually sent the field. COALESCE cannot
       express this: clearing a category is a legitimate edit that sends null,
       and COALESCE would silently keep the old value instead. */
    const category = req.body.category === undefined
      ? oldData.category
      : cleanCategory(req.body.category);

    const result = await pool.query(
      `UPDATE software_master
       SET software_name = COALESCE($1, software_name),
           software_icon = $2,
           software_video = $3,
           is_active = COALESCE($4, is_active),
           category = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE software_id = $6
       RETURNING *`,
      [software_name || oldData.software_name, iconPath, videoPath,
       is_active !== undefined ? is_active : oldData.is_active, category, id]
    );
    
    res.status(200).json({
      success: true,
      message: 'Software updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating software:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// DELETE - Soft delete software (set is_active to false)
export const deleteSoftware = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE software_master 
       SET is_active = false, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE software_id = $1 AND is_active = true
       RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Software not found or already deleted' 
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Software deleted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting software:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// PERMANENT DELETE - Hard delete software and files
export const permanentDeleteSoftware = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get software data before deletion
    const software = await pool.query(
      'SELECT * FROM software_master WHERE software_id = $1',
      [id]
    );
    
    if (software.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Software not found' 
      });
    }
    
    // Delete associated files
    const filesToDelete = [];
    if (software.rows[0].software_icon) {
      filesToDelete.push(software.rows[0].software_icon);
    }
    if (software.rows[0].software_video) {
      filesToDelete.push(software.rows[0].software_video);
    }
    await deleteOldFiles(filesToDelete);
    
    // Delete from database
    await pool.query('DELETE FROM software_master WHERE software_id = $1', [id]);
    
    res.status(200).json({
      success: true,
      message: 'Software permanently deleted successfully'
    });
  } catch (error) {
    console.error('Error permanently deleting software:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};