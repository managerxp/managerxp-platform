/*
 * File uploads for support tickets.
 *
 * Kept apart from the software-catalogue uploader for one reason that matters:
 * that one writes into `src/uploads`, which express serves statically to
 * anybody who knows a URL. A game's cover art belongs there. A café's
 * screenshot — which may show their takings, a customer's details or an error
 * log — does not. These land outside every static mount and are only ever
 * handed back by a handler that has checked who is asking.
 *
 * Three further precautions:
 *   - the name on disk is random, so the uploader's filename can never steer a
 *     path (`../../server.js` is just a label we store in a column)
 *   - the extension is derived from our own allow-list, not from the upload
 *   - anything not on that list is refused, so a .exe never reaches the disk
 */
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Outside `src/`, so no static middleware can ever be pointed at it by
   accident. */
export const SUPPORT_UPLOAD_DIR = path.join(__dirname, '../../storage/support');

/* What a support ticket legitimately carries: pictures of the problem, a PDF
   invoice, a log file. Deliberately no archives and nothing executable. */
const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv'
};

export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB each

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(SUPPORT_UPLOAD_DIR, { recursive: true });
      cb(null, SUPPORT_UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    /* Random name, extension from the allow-list rather than the upload. The
       original name is kept in the database for display only. */
    const ext = ALLOWED[file.mimetype] || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED[file.mimetype]) return cb(null, true);
  /* Refused with a sentence the person can act on, rather than a silent drop
     that leaves them wondering where their screenshot went. */
  cb(new Error(`${file.originalname}: only images, PDFs and text files can be attached`));
};

export const supportUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: MAX_FILES }
});

/**
 * Turn multer's refusals into the JSON shape the rest of the API uses.
 *
 * Without this an oversized file surfaces as an unhandled error and the caller
 * gets a 500 with no explanation of what was wrong with their file.
 */
export const handleUploadErrors = (err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Each file must be under ${Math.round(MAX_BYTES / (1024 * 1024))} MB`
      : err.code === 'LIMIT_FILE_COUNT'
        ? `Attach at most ${MAX_FILES} files`
        : 'That file could not be accepted';
    return res.status(400).json({ success: false, message });
  }
  return res.status(400).json({ success: false, message: err.message || 'That file could not be accepted' });
};
