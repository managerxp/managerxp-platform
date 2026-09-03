/*
 * Logo and cover-art uploads for the master Game Catalog.
 *
 * Public, statically-served images — the same `src/uploads` folder every
 * other piece of box art in this app already uses — never the private,
 * per-request ticket-attachment store.
 */
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(UPLOAD_DIR, { recursive: true }).then(() => cb(null, UPLOAD_DIR)).catch(cb);
  },
  filename: (req, file, cb) => {
    cb(null, `catalog-${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) return cb(null, true);
  cb(new Error('Only image files can be used here'), false);
};

export const catalogAssetUpload = multer({
  storage, fileFilter, limits: { fileSize: 8 * 1024 * 1024 }
}).single('image');

/* A logo is square — the icon a station shows next to the game's name. */
export const optimizeLogo = async (inputPath, outputPath) => {
  await sharp(inputPath).resize(256, 256, { fit: 'cover', position: 'center' })
    .png({ quality: 90 }).toFile(outputPath);
  await fs.unlink(inputPath).catch(() => {});
};

/* A cover is wide — box art / a store capsule shape, not a badge. */
export const optimizeCover = async (inputPath, outputPath) => {
  await sharp(inputPath).resize(600, 280, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 85 }).toFile(outputPath);
  await fs.unlink(inputPath).catch(() => {});
};

export const handleCatalogUploadErrors = (err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'The image must be under 8 MB' });
  }
  return res.status(400).json({ success: false, message: err.message || 'That image could not be accepted' });
};
