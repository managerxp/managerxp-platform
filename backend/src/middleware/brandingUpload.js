/*
 * Café branding uploads that aren't a fixed-shape catalog image — the kiosk
 * welcome screen's wallpaper, which can be a short video. Same public
 * `src/uploads` folder catalogAssetUpload.js already writes to (server.js's
 * `/uploads` static route), just with its own file-type and size rules: a
 * wallpaper is neither square nor a fixed aspect, so it is stored as
 * uploaded rather than run through sharp.
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
    cb(null, `branding-wallpaper-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  /* SVG starts with "image/" like any real raster type, but it's XML and
     can carry a <script> that runs when the file is opened directly —
     refused outright rather than trusted the way a real photo/PNG is. */
  if (file.mimetype === 'image/svg+xml') {
    return cb(new Error('SVG files are not accepted here'), false);
  }
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) return cb(null, true);
  cb(new Error('Only image or video files can be used here'), false);
};

export const brandingUpload = multer({
  storage, fileFilter, limits: { fileSize: 30 * 1024 * 1024 }
}).single('wallpaper');

/*
 * Re-encoded through sharp so what actually lands on disk is a freshly
 * generated image, never a copy of whatever bytes the upload claimed to be
 * — the same reason catalogAssetUpload.js's optimizeLogo/optimizeCover do
 * this for catalog art. A file that isn't genuinely decodable as an image,
 * whatever its declared MIME type or extension said, fails here instead of
 * being stored. Video has no equivalent step — a video container can't
 * carry executable script the way SVG's XML can, so it's kept as uploaded.
 */
export const optimizeWallpaper = async (filePath) => {
  const meta = await sharp(filePath).metadata();
  const format = meta.format === 'png' || meta.format === 'gif' ? 'png' : 'jpeg';
  const outputPath = filePath.replace(/\.[^./\\]+$/, '') + '-safe' + (format === 'png' ? '.png' : '.jpg');
  await sharp(filePath)[format]({ quality: 90 }).toFile(outputPath);
  await fs.unlink(filePath).catch(() => {});
  return path.basename(outputPath);
};

export const handleBrandingUploadErrors = (err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'The file must be under 30 MB' });
  }
  return res.status(400).json({ success: false, message: err.message || 'That file could not be accepted' });
};
