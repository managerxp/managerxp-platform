/*
 * Installer uploads for a published client release — the release workflow
 * (the same GitHub Actions caller `requireReleaseAgent` already trusts for
 * POST /api/platform/releases) uploads the .exe it just built here first,
 * then registers it with that existing endpoint using the URL this hands
 * back.
 *
 * Deliberately its own upload dir and its own size limit, not
 * catalogAssetUpload's: that one caps at 8 MB for box art; an
 * Electron+Chromium installer runs 60-150+ MB, an entirely different kind
 * of file with no reason to share a ceiling with cover images.
 */
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASES_DIR = path.join(__dirname, '../uploads/releases');

/* One subfolder per component (client/server) — client-app's own
   auto-update mechanism (electron-updater's generic provider) resolves a
   release by fetching "<feedUrl>/latest.yml" then the installer named
   inside it, both from the SAME directory. electron-builder names that
   manifest "latest.yml" regardless of product, so client's and server's
   would collide in one flat folder — this is what keeps them apart, and
   what makes "everything under .../releases/client/" a valid feed
   directory a station's updater can actually be pointed at. */
const componentDir = (req) => {
  const component = req.body?.component === 'server' ? 'server' : 'client';
  return path.join(RELEASES_DIR, component);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = componentDir(req);
    fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir)).catch(cb);
  },
  // The real filename, not a random token — for the installer this is what
  // a café owner sees as the downloaded file (CafeXP-Client-Setup-1.2.3.exe,
  // named that way by the release workflow already); for the manifest it
  // must be exactly "latest.yml", which electron-updater's generic provider
  // hardcodes the name of and will not find under anything else.
  filename: (req, file, cb) => cb(null, path.basename(file.originalname))
});

const fileFilter = (req, file, cb) => {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.exe') || name === 'latest.yml') return cb(null, true);
  cb(new Error('Only a Windows .exe installer or its latest.yml manifest can be uploaded here'), false);
};

export const releaseUpload = multer({
  storage, fileFilter, limits: { fileSize: 300 * 1024 * 1024 }
}).single('file');

export const handleReleaseUploadErrors = (err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'The installer must be under 300 MB' });
  }
  return res.status(400).json({ success: false, message: err.message || 'That file could not be accepted' });
};

/*
 * Only the newest installer per channel is ever offered to a station, so
 * older ones are dead weight (60-150 MB each) that nothing deletes. Called
 * right after a release is published: removes every other .exe in that
 * component's folder, keeping exactly the names passed in. latest.yml is
 * never touched — it is overwritten by each upload anyway.
 */
export const pruneOldInstallers = async (component, keepNames) => {
  const dir = path.join(RELEASES_DIR, component === 'server' ? 'server' : 'client');
  const keep = new Set(keepNames.filter(Boolean).map((n) => path.basename(n)));
  let removed = 0;
  for (const name of await fs.readdir(dir).catch(() => [])) {
    if (!name.toLowerCase().endsWith('.exe') || keep.has(name)) continue;
    await fs.unlink(path.join(dir, name)).then(() => { removed += 1; }).catch(() => {});
  }
  return removed;
};
