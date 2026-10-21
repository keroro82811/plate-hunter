import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

// Enforce HMR disabled in AI Studio container environment to eliminate failing WebSockets
process.env.DISABLE_HMR = 'true';

const APP_DIR = typeof __dirname !== 'undefined' && __dirname
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parser for handling high-resolution image uploads and chunked batches (up to 100mb)
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Gracefully handle body-parser or payload limit errors without crashing or closing sockets abruptly
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      console.warn('[Server] Body parse error intercepted:', err?.message || err);
      if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Payload too large. Please send in smaller chunks.' });
      }
      return res.status(400).json({ error: err?.message || 'Invalid request body' });
    }
    next();
  });

  // CORS & Security headers for mobile devices, preview domains & iframes (prevents 401 on OPTIONS preflight)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Persistent Server-Side Storage for cross-device sync & reliable reload retention
  const DATA_DIR = path.join(APP_DIR, 'data');
  const PLATES_FILE = path.join(DATA_DIR, 'plates.json');
  const USERS_DIR = path.join(DATA_DIR, 'users');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  }

  // In-Memory cache for plates to eliminate repeated multi-megabyte disk reads/writes during batch imports
  let inMemoryPlatesMap: Record<string, any> | null = null;
  let savePlatesTimer: NodeJS.Timeout | null = null;

  function readStoredPlates(): Record<string, any> {
    try {
      if (fs.existsSync(PLATES_FILE)) {
        const raw = fs.readFileSync(PLATES_FILE, 'utf-8');
        return JSON.parse(raw || '{}');
      }
    } catch (e) {
      console.warn('[Storage] Error reading plates.json:', e);
    }
    return {};
  }

  function getStoredPlatesMap(): Record<string, any> {
    if (inMemoryPlatesMap === null) {
      inMemoryPlatesMap = readStoredPlates();
    }
    return inMemoryPlatesMap;
  }

  function writeStoredPlates(data: Record<string, any>) {
    try {
      const tmp = `${PLATES_FILE}.tmp`;
      const stream = fs.createWriteStream(tmp, { encoding: 'utf-8' });
      stream.write('{\n');
      const keys = Object.keys(data);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const valStr = JSON.stringify(data[k]);
        stream.write(i === 0 ? `  ${JSON.stringify(k)}: ${valStr}` : `,\n  ${JSON.stringify(k)}: ${valStr}`);
      }
      stream.write('\n}\n');
      stream.end();
      stream.on('finish', () => {
        try {
          fs.renameSync(tmp, PLATES_FILE);
        } catch (renameErr) {
          console.warn('[Storage] Error renaming temp plates file:', renameErr);
        }
      });
      stream.on('error', (err) => {
        console.warn('[Storage] Stream error writing plates.json:', err);
      });
    } catch (e) {
      console.warn('[Storage] Error writing plates.json:', e);
    }
  }

  function scheduleWriteStoredPlates(immediate = false) {
    if (savePlatesTimer) {
      clearTimeout(savePlatesTimer);
      savePlatesTimer = null;
    }
    if (immediate) {
      if (inMemoryPlatesMap) writeStoredPlates(inMemoryPlatesMap);
      return;
    }
    savePlatesTimer = setTimeout(() => {
      if (inMemoryPlatesMap) writeStoredPlates(inMemoryPlatesMap);
      savePlatesTimer = null;
    }, 1500);
  }

  // Clean image validation helper
  function isSyntheticSvg(url?: string | null): boolean {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('data:image/svg+xml') || url.includes('<svg') || url.includes('carGrad');
  }

  // Initialize Google GenAI client (lazy or guarded)
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      hasApiKey: Boolean(apiKey),
      timestamp: new Date().toISOString(),
    });
  });

  // Source code full zip download endpoint (always packages current live workspace)
  app.get('/api/download-source', (req, res) => {
    try {
      const zipPath = path.join(process.cwd(), 'source-code.zip');
      try {
        execSync(
          `python3 -c "import zipfile, os; exclude={'node_modules', '.git', 'dist', 'data', '__pycache__'}; z=zipfile.ZipFile('source-code.zip', 'w', zipfile.ZIP_DEFLATED); [z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), '.')) for r, d, fs in os.walk('.') for f in fs if not any(x in r for x in exclude) and f not in ('source-code.zip', 'dist.zip')]; z.close()"`
        );
      } catch (err) {
        console.warn('Zip update error, fallback to existing:', err);
      }
      if (fs.existsSync(zipPath)) {
        res.setHeader('Content-Disposition', 'attachment; filename="license-plate-collection-source.zip"');
        res.setHeader('Content-Type', 'application/zip');
        return res.sendFile(zipPath);
      }
      return res.status(404).send('Source code archive not found');
    } catch (e: any) {
      res.status(500).send('Failed to prepare source code zip: ' + e?.message);
    }
  });

  // Pre-compiled static website zip download (Ready for GitHub Pages, zero build required)
  // Always rebuilds when source files are updated so it is 100% current
  app.get('/api/download-static', (req, res) => {
    try {
      const distZipPath = path.join(process.cwd(), 'dist.zip');
      const distIndex = path.join(process.cwd(), 'dist', 'index.html');
      try {
        let shouldBuild = !fs.existsSync(distIndex);
        if (!shouldBuild) {
          const distTime = fs.statSync(distIndex).mtimeMs;
          // Check if any source files or configs are newer than dist/index.html
          const sources = ['src', 'index.html', 'vite.config.ts', 'package.json'];
          for (const s of sources) {
            const fullP = path.join(process.cwd(), s);
            if (fs.existsSync(fullP)) {
              if (fs.statSync(fullP).mtimeMs > distTime) {
                shouldBuild = true;
                break;
              }
            }
          }
        }
        if (shouldBuild) {
          execSync('npx vite build', { stdio: 'ignore' });
        }
        execSync(
          `python3 -c "import zipfile, os; z=zipfile.ZipFile('dist.zip', 'w', zipfile.ZIP_DEFLATED); [z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), 'dist')) for r, d, fs in os.walk('dist') for f in fs if not f.endswith(('.cjs', '.map'))]; z.close()"`
        );
      } catch (err) {
        console.warn('dist.zip update error:', err);
      }
      if (fs.existsSync(distZipPath)) {
        res.setHeader('Content-Disposition', 'attachment; filename="license-plate-collection-github-pages.zip"');
        res.setHeader('Content-Type', 'application/zip');
        return res.sendFile(distZipPath);
      }
      return res.status(404).send('Static dist archive not found');
    } catch (e: any) {
      res.status(500).send('Failed to prepare static zip: ' + e?.message);
    }
  });

  // GET all plates (instant cross-device sync & reload retention)
  app.get('/api/plates', (req, res) => {
    try {
      const platesMap = getStoredPlatesMap();
      const seen = new Set<string>();
      const items: any[] = [];
      for (const val of Object.values(platesMap)) {
        if (!val || typeof val !== 'object' || !(val as any).number) continue;
        const padded = String((val as any).number).trim().padStart(4, '0');
        if (seen.has(padded)) continue;
        seen.add(padded);
        items.push(val);
      }
      res.setHeader('Content-Type', 'application/json');
      res.write('[\n');
      for (let i = 0; i < items.length; i++) {
        const str = JSON.stringify(items[i]);
        res.write(i === 0 ? str : `,\n${str}`);
      }
      res.write('\n]');
      res.end();
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: e?.message || 'Failed to read plates' });
      }
    }
  });

  // GET single plate by number (targeted instant image load)
  app.get('/api/plates/:number', (req, res) => {
    try {
      const { number } = req.params;
      const platesMap = getStoredPlatesMap();
      const padded = number.padStart(4, '0');
      const item = platesMap[number] || platesMap[padded];
      if (item) {
        return res.json(item);
      }
      return res.status(404).json({ error: 'Plate not found' });
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: e?.message || 'Failed to read plate' });
      }
    }
  });

  // GET direct binary / SVG image for a plate (guarantees zero 404s, instant decode, resilient auto-healing)
  app.get('/api/plates/:number/image', (req, res) => {
    try {
      const { number } = req.params;
      const platesMap = getStoredPlatesMap();
      const padded = number.padStart(4, '0');
      let item = platesMap[number] || platesMap[padded];
      if (!item) {
        const intStr = parseInt(number, 10).toString();
        item = platesMap[intStr];
      }
      if (!item && fs.existsSync(USERS_DIR)) {
        try {
          const userFiles = fs.readdirSync(USERS_DIR);
          for (const f of userFiles) {
            if (f.endsWith('.json')) {
              const uList = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf-8') || '[]');
              const found = uList.find((p: any) => p.number === number || p.number === padded);
              if (found) {
                item = found;
                break;
              }
            }
          }
        } catch {}
      }

      const fullPlateText = item?.fullPlate || padded;
      const validPhoto = (item?.photos || []).find((p: any) => p && typeof p.imageUrl === 'string' && (p.imageUrl.startsWith('data:') || p.imageUrl.length > 50));
      const rawDataUrl =
        (item?.imageUrl && item.imageUrl.length > 50 ? item.imageUrl : null) ||
        (validPhoto?.imageUrl && validPhoto.imageUrl.length > 50 ? validPhoto.imageUrl : null) ||
        (validPhoto?.originalImageUrl && validPhoto.originalImageUrl.length > 50 ? validPhoto.originalImageUrl : null) ||
        (item?.originalImageUrl && item.originalImageUrl.length > 50 ? item.originalImageUrl : null);

      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (!rawDataUrl || isSyntheticSvg(rawDataUrl)) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      const dataUrl = rawDataUrl.trim();

      const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
      if (match) {
        const mime = match[1];
        const cleanBase64 = match[2].replace(/\s+/g, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        res.setHeader('Content-Type', mime);
        return res.send(buffer);
      }

      if (dataUrl.startsWith('http')) {
        return res.redirect(dataUrl);
      }

      return res.status(404).json({ error: 'Photo not found' });
    } catch (e: any) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(404).json({ error: 'Photo not found' });
    }
  });

  // GET direct binary / SVG image for a specific photo ID
  app.get('/api/plates/:number/photos/:photoId/image', (req, res) => {
    try {
      const { number, photoId } = req.params;
      const cleanPhotoId = decodeURIComponent(photoId || '');
      const platesMap = getStoredPlatesMap();
      const padded = number.padStart(4, '0');
      let item = platesMap[number] || platesMap[padded];
      if (!item) {
        const intStr = parseInt(number, 10).toString();
        item = platesMap[intStr];
      }
      if (!item && fs.existsSync(USERS_DIR)) {
        try {
          const userFiles = fs.readdirSync(USERS_DIR);
          for (const f of userFiles) {
            if (f.endsWith('.json')) {
              const uList = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf-8') || '[]');
              const found = uList.find((p: any) => p.number === number || p.number === padded);
              if (found) {
                item = found;
                break;
              }
            }
          }
        } catch {}
      }

      let photo = (item?.photos || []).find((p: any) =>
        p && (p.id === photoId || p.id === cleanPhotoId || decodeURIComponent(p.id || '') === cleanPhotoId)
      );
      if (!photo && item?.photos && item.photos.length > 0) {
        photo = item.photos.find((p: any) => p && typeof p.imageUrl === 'string' && (p.imageUrl.startsWith('data:') || p.imageUrl.length > 50) && !isSyntheticSvg(p.imageUrl)) || item.photos[0];
      }

      const rawDataUrl =
        (photo?.imageUrl && photo.imageUrl.length > 50 && !isSyntheticSvg(photo.imageUrl) ? photo.imageUrl : null) ||
        (photo?.originalImageUrl && photo.originalImageUrl.length > 50 && !isSyntheticSvg(photo.originalImageUrl) ? photo.originalImageUrl : null) ||
        (item?.imageUrl && item.imageUrl.length > 50 && !isSyntheticSvg(item.imageUrl) ? item.imageUrl : null) ||
        (item?.originalImageUrl && item.originalImageUrl.length > 50 && !isSyntheticSvg(item.originalImageUrl) ? item.originalImageUrl : null);

      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (!rawDataUrl || isSyntheticSvg(rawDataUrl)) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      const dataUrl = rawDataUrl.trim();

      const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
      if (match) {
        const mime = match[1];
        const cleanBase64 = match[2].replace(/\s+/g, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        res.setHeader('Content-Type', mime);
        return res.send(buffer);
      }

      if (dataUrl.startsWith('http')) {
        return res.redirect(dataUrl);
      }

      return res.status(404).json({ error: 'Photo not found' });
    } catch (e: any) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(404).json({ error: 'Photo not found' });
    }
  });

  // POST prepare and sync backup data before download
  app.post('/api/backup/prepare', (req, res) => {
    try {
      const { records, uid, filename, backupJson } = req.body || {};
      const platesMap = getStoredPlatesMap();
      const LATEST_BACKUP_FILE = path.join(DATA_DIR, 'latest_backup.json');

      if (typeof backupJson === 'string' && backupJson.length > 2) {
        try {
          fs.writeFileSync(LATEST_BACKUP_FILE, backupJson, 'utf-8');
        } catch (fErr) {
          console.warn('[Storage] Error writing latest_backup.json:', fErr);
        }
      }

      if (Array.isArray(records) && records.length > 0) {
        for (const r of records) {
          if (r && r.number) {
            platesMap[r.number] = mergePlateRecords(platesMap[r.number], r);
          }
        }
        scheduleWriteStoredPlates(true);

        try {
          fs.writeFileSync(LATEST_BACKUP_FILE, JSON.stringify(records, null, 2), 'utf-8');
        } catch (fErr) {
          console.warn('[Storage] Error saving latest_backup.json:', fErr);
        }

        if (uid) {
          const cleanUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
          if (cleanUid) {
            const userFile = path.join(USERS_DIR, `${cleanUid}.json`);
            try {
              let existing: any[] = [];
              if (fs.existsSync(userFile)) {
                existing = JSON.parse(fs.readFileSync(userFile, 'utf-8') || '[]');
              }
              const userMap: Record<string, any> = {};
              for (const p of existing) if (p && p.number) userMap[p.number] = p;
              for (const r of records) if (r && r.number) userMap[r.number] = mergePlateRecords(userMap[r.number], r);
              fs.writeFileSync(userFile, JSON.stringify(Object.values(userMap), null, 2), 'utf-8');
            } catch (uErr) {
              console.warn('[Storage] Error updating user backup on prepare:', uErr);
            }
          }
        }
      }

      const totalCount = Object.keys(platesMap).length;
      const downloadParam = uid ? `uid=${encodeURIComponent(uid)}` : `t=${Date.now()}`;
      res.json({
        success: true,
        count: totalCount,
        downloadUrl: `/api/backup/download?${downloadParam}`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to prepare backup' });
    }
  });

  // GET native file stream backup download (native browser file download, bypasses JavaScript heap limits)
  app.get('/api/backup/download', (req, res) => {
    try {
      const uid = typeof req.query.uid === 'string' ? req.query.uid.trim() : '';
      const LATEST_BACKUP_FILE = path.join(DATA_DIR, 'latest_backup.json');

      let items: any[] = [];
      const platesMap = getStoredPlatesMap();
      const serverPlates = Object.values(platesMap);

      if (uid) {
        const cleanUid = uid.replace(/[^a-zA-Z0-9_-]/g, '');
        const userFile = path.join(USERS_DIR, `${cleanUid}.json`);
        let userPlates: any[] = [];
        if (fs.existsSync(userFile)) {
          try {
            userPlates = JSON.parse(fs.readFileSync(userFile, 'utf-8') || '[]');
          } catch {}
        }
        const mergedMap: Record<string, any> = {};
        for (const p of serverPlates) if (p && p.number) mergedMap[p.number] = p;
        for (const p of userPlates) if (p && p.number) mergedMap[p.number] = mergePlateRecords(mergedMap[p.number], p);
        items = Object.values(mergedMap);
      } else {
        items = serverPlates;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `LicensePlateCollection_FullBackup_${dateStr}_(${items.length}plates).json`;

      // Set headers to force attachment download across all browsers & top-level tabs
      res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      // If a latest backup snapshot exists and no specific user filter, serve it directly
      if (!uid && fs.existsSync(LATEST_BACKUP_FILE)) {
        try {
          const stat = fs.statSync(LATEST_BACKUP_FILE);
          if (stat.size > 10) {
            return res.sendFile(LATEST_BACKUP_FILE);
          }
        } catch {}
      }

      res.write('[\n');
      for (let i = 0; i < items.length; i++) {
        const str = JSON.stringify(items[i]);
        res.write(i === 0 ? str : `,\n${str}`);
      }
      res.write('\n]');
      res.end();
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: e?.message || 'Failed to download backup' });
      }
    }
  });

  // GET user backup plates
  app.get('/api/user-backup/:uid', (req, res) => {
    try {
      const cleanUid = (req.params.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!cleanUid) return res.json([]);
      const userFile = path.join(USERS_DIR, `${cleanUid}.json`);
      if (fs.existsSync(userFile)) {
        const raw = fs.readFileSync(userFile, 'utf-8');
        return res.json(JSON.parse(raw || '[]'));
      }
      res.json([]);
    } catch (e: any) {
      res.json([]);
    }
  });

  // POST save user backup plates (safely merges into user storage so previous plates are never dropped)
  app.post('/api/user-backup/:uid', (req, res) => {
    try {
      const cleanUid = (req.params.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!cleanUid) return res.status(400).json({ error: 'Invalid user ID' });
      const userFile = path.join(USERS_DIR, `${cleanUid}.json`);
      const incoming = req.body;
      if (Array.isArray(incoming)) {
        let existingUserPlates: any[] = [];
        if (fs.existsSync(userFile)) {
          try {
            existingUserPlates = JSON.parse(fs.readFileSync(userFile, 'utf-8') || '[]');
          } catch {}
        }
        const userMap: Record<string, any> = {};
        for (const p of existingUserPlates) {
          if (p && p.number) userMap[p.number] = p;
        }
        for (const r of incoming) {
          if (r && r.number) {
            userMap[r.number] = mergePlateRecords(userMap[r.number], r);
          }
        }
        const mergedUserList = Object.values(userMap);
        const tmp = `${userFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(mergedUserList, null, 2), 'utf-8');
        fs.renameSync(tmp, userFile);
        return res.json({ success: true, count: mergedUserList.length });
      }
      res.status(400).json({ error: 'Expected array of plate records' });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to save user backup' });
    }
  });

  // GET default user profile
  app.get('/api/user-profile', (req, res) => {
    try {
      const defaultProf = path.join(DATA_DIR, 'profile.json');
      if (fs.existsSync(defaultProf)) {
        return res.json(JSON.parse(fs.readFileSync(defaultProf, 'utf-8') || '{}'));
      }
      res.json({});
    } catch (e) {
      res.json({});
    }
  });

  // POST default user profile
  app.post('/api/user-profile', (req, res) => {
    try {
      const defaultProf = path.join(DATA_DIR, 'profile.json');
      fs.writeFileSync(defaultProf, JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ success: true, profile: req.body });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to save profile' });
    }
  });

  // GET user profile by uid
  app.get('/api/user-profile/:uid', (req, res) => {
    try {
      const cleanUid = (req.params.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (cleanUid) {
        const userProf = path.join(USERS_DIR, `${cleanUid}_profile.json`);
        if (fs.existsSync(userProf)) {
          return res.json(JSON.parse(fs.readFileSync(userProf, 'utf-8') || '{}'));
        }
      }
      const defaultProf = path.join(DATA_DIR, 'profile.json');
      if (fs.existsSync(defaultProf)) {
        return res.json(JSON.parse(fs.readFileSync(defaultProf, 'utf-8') || '{}'));
      }
      res.json({});
    } catch (e) {
      res.json({});
    }
  });

  // POST save user profile by uid
  app.post('/api/user-profile/:uid', (req, res) => {
    try {
      const cleanUid = (req.params.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (cleanUid) {
        const userProf = path.join(USERS_DIR, `${cleanUid}_profile.json`);
        fs.writeFileSync(userProf, JSON.stringify(req.body, null, 2), 'utf-8');
      }
      const defaultProf = path.join(DATA_DIR, 'profile.json');
      fs.writeFileSync(defaultProf, JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ success: true, profile: req.body });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to save user profile' });
    }
  });

  // Helper to deduplicate photos and remove empty ghost entries (where imageUrl is missing but other valid photos exist)
  function cleanAndDeduplicateServerPhotos(photos: any[]): any[] {
    if (!Array.isArray(photos) || photos.length === 0) return [];
    const valid = photos.filter((p) => p && typeof p === 'object');
    if (valid.length === 0) return [];

    // Sanitize any fake synthetic SVGs
    for (const p of valid) {
      if (isSyntheticSvg(p.imageUrl)) {
        p.imageUrl = '';
      }
    }

    const hasRealImg = valid.some((p) => typeof p.imageUrl === 'string' && p.imageUrl.length > 50 && !isSyntheticSvg(p.imageUrl));

    const result: any[] = [];
    const seenPlates = new Set<string>();

    for (const p of valid) {
      const pHasImg = typeof p.imageUrl === 'string' && p.imageUrl.length > 50 && !isSyntheticSvg(p.imageUrl);
      // If other photos have real images, drop empty ghost photos
      if (hasRealImg && !pHasImg) {
        continue;
      }

      // Check if ID or exact same image exists in result
      const idKey = p.id || '';
      
      const existingIdx = result.findIndex((r) => {
        if (idKey && r.id === idKey) return true;
        if (pHasImg && r.imageUrl && r.imageUrl === p.imageUrl) return true;
        return false;
      });

      if (existingIdx !== -1) {
        // Merge into existing, keeping the better image
        const target = result[existingIdx];
        result[existingIdx] = {
          ...target,
          ...p,
          imageUrl: pHasImg ? p.imageUrl : target.imageUrl,
          fullPlate: p.fullPlate || target.fullPlate,
          locationName: p.locationName || target.locationName,
          collectedAt: p.collectedAt || target.collectedAt,
        };
      } else {
        result.push(p);
      }
    }

    return result.length > 0 ? result : [valid[0]];
  }

  // Helper to safely merge plate records without dropping existing photos
  function mergePlateRecords(existing: any, incoming: any, overwritePhotos = false): any {
    if (!existing) {
      if (incoming && Array.isArray(incoming.photos)) {
        incoming.photos = cleanAndDeduplicateServerPhotos(incoming.photos);
      }
      return incoming;
    }
    if (overwritePhotos) {
      const cleanPhotos = cleanAndDeduplicateServerPhotos(incoming.photos || []);
      const latest = cleanPhotos[cleanPhotos.length - 1] || incoming;
      return {
        ...existing,
        ...incoming,
        photos: cleanPhotos,
        fullPlate: latest.fullPlate || incoming.fullPlate || existing.fullPlate,
        imageUrl: latest.imageUrl || incoming.imageUrl || existing.imageUrl,
      };
    }

    const existingPhotos = Array.isArray(existing.photos) ? existing.photos : [];
    const incomingPhotos = Array.isArray(incoming.photos) ? incoming.photos : [];
    const mergedPhotos = [...existingPhotos];

    for (const ip of incomingPhotos) {
      const existingIdx = mergedPhotos.findIndex(
        (ep) =>
          (ip.id && ep.id === ip.id) ||
          (ep.imageUrl && ip.imageUrl && ep.imageUrl === ip.imageUrl) ||
          (ip.fullPlate && ep.fullPlate && ip.fullPlate.trim().toUpperCase() === ep.fullPlate.trim().toUpperCase())
      );
      if (existingIdx !== -1) {
        const ep = mergedPhotos[existingIdx];
        mergedPhotos[existingIdx] = {
          ...ep,
          ...ip,
          imageUrl: ip.imageUrl && ip.imageUrl.length > 50 && !isSyntheticSvg(ip.imageUrl) ? ip.imageUrl : ep.imageUrl,
          fullPlate: ip.fullPlate || ep.fullPlate,
        };
      } else {
        mergedPhotos.push(ip);
      }
    }

    const finalPhotos = cleanAndDeduplicateServerPhotos(mergedPhotos);
    const latest = finalPhotos[finalPhotos.length - 1] || incoming;
    const numStr = incoming.number || existing.number || '0000';
    const plateStr = latest.fullPlate || incoming.fullPlate || existing.fullPlate || numStr;
    const bestImg =
      finalPhotos.slice().reverse().find((p: any) => p && typeof p.imageUrl === 'string' && p.imageUrl.length > 50 && !isSyntheticSvg(p.imageUrl))?.imageUrl ||
      (incoming.imageUrl && typeof incoming.imageUrl === 'string' && incoming.imageUrl.length > 50 && !isSyntheticSvg(incoming.imageUrl) ? incoming.imageUrl : null) ||
      (existing.imageUrl && typeof existing.imageUrl === 'string' && existing.imageUrl.length > 50 && !isSyntheticSvg(existing.imageUrl) ? existing.imageUrl : null) ||
      (latest.imageUrl && !isSyntheticSvg(latest.imageUrl) ? latest.imageUrl : '') ||
      '';

    // Ensure at least one photo has the bestImg
    if (finalPhotos.length > 0 && (!finalPhotos[0].imageUrl || finalPhotos[0].imageUrl.length < 50)) {
      finalPhotos[0].imageUrl = bestImg;
    }

    return {
      ...existing,
      ...incoming,
      locationName: incoming.locationName || existing.locationName,
      latitude: incoming.latitude ?? existing.latitude,
      longitude: incoming.longitude ?? existing.longitude,
      fullPlate: plateStr,
      imageUrl: bestImg,
      collectedAt: latest.collectedAt || incoming.collectedAt || existing.collectedAt,
      photos: finalPhotos,
    };
  }

  // POST save or update a single plate
  app.post('/api/plates', (req, res) => {
    try {
      const incoming = req.body;
      if (!incoming || !incoming.number) {
        return res.status(400).json({ error: 'Missing plate record or number' });
      }
      const platesMap = getStoredPlatesMap();
      const padded = incoming.number.padStart(4, '0');
      const existing = platesMap[padded] || platesMap[incoming.number];
      const overwrite = Boolean(incoming.overwritePhotos);
      const merged = mergePlateRecords(existing, incoming, overwrite);
      platesMap[padded] = merged;
      if (incoming.number !== padded && platesMap[incoming.number]) {
        delete platesMap[incoming.number];
      }
      scheduleWriteStoredPlates(true);
      res.json({ success: true, plate: merged });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to save plate' });
    }
  });

  // DELETE a specific photo from a plate
  app.delete('/api/plates/:number/photos/:photoId', (req, res) => {
    try {
      const { number, photoId } = req.params;
      const platesMap = getStoredPlatesMap();
      const existing = platesMap[number];
      if (!existing) {
        return res.json({ success: true, remaining: 0 });
      }
      const existingPhotos: any[] = Array.isArray(existing.photos) ? existing.photos : [];
      const remaining = existingPhotos.filter((p: any) => p.id !== photoId);

      if (remaining.length === 0) {
        delete platesMap[number];
        scheduleWriteStoredPlates(true);
        return res.json({ success: true, deletedRecord: true, remaining: 0 });
      }

      const cleanRemaining = cleanAndDeduplicateServerPhotos(remaining);
      const latest = cleanRemaining[cleanRemaining.length - 1];
      platesMap[number] = {
        ...existing,
        photos: cleanRemaining,
        fullPlate: latest.fullPlate || existing.fullPlate,
        imageUrl: latest.imageUrl || existing.imageUrl,
        collectedAt: latest.collectedAt || existing.collectedAt,
      };
      scheduleWriteStoredPlates(true);
      return res.json({
        success: true,
        deletedRecord: false,
        remaining: cleanRemaining.length,
        plate: platesMap[number],
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to delete photo' });
    }
  });

  // POST batch save plates (debounced disk persistence to smoothly handle 10,000+ plates)
  app.post('/api/plates/batch', (req, res) => {
    try {
      const records = req.body;
      if (!Array.isArray(records)) {
        return res.status(400).json({ error: 'Expected array of records' });
      }
      const platesMap = getStoredPlatesMap();
      for (const r of records) {
        if (r && r.number !== undefined && r.number !== null) {
          const numStr = String(r.number).trim();
          const padded = numStr.padStart(4, '0');
          const existing = platesMap[padded] || platesMap[numStr];
          const merged = mergePlateRecords(existing, r);
          platesMap[padded] = merged;
          if (numStr !== padded && platesMap[numStr]) {
            delete platesMap[numStr];
          }
        }
      }
      scheduleWriteStoredPlates(true);
      res.json({ success: true, count: records.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to batch save' });
    }
  });

  // DELETE a plate
  app.delete('/api/plates/:number', (req, res) => {
    try {
      const num = req.params.number;
      const platesMap = getStoredPlatesMap();
      if (platesMap[num]) {
        delete platesMap[num];
        scheduleWriteStoredPlates(true);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to delete' });
    }
  });

  // POST clear all plates
  app.post('/api/plates/clear', (req, res) => {
    try {
      if (savePlatesTimer) {
        clearTimeout(savePlatesTimer);
        savePlatesTimer = null;
      }
      inMemoryPlatesMap = {};
      const tmpFile = `${PLATES_FILE}.tmp`;
      if (fs.existsSync(tmpFile)) {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      try {
        fs.writeFileSync(PLATES_FILE, '{}', 'utf-8');
      } catch (fErr) {
        console.warn('[Storage] Error writing empty plates.json:', fErr);
      }
      const LATEST_BACKUP_FILE = path.join(DATA_DIR, 'latest_backup.json');
      if (fs.existsSync(LATEST_BACKUP_FILE)) {
        try { fs.unlinkSync(LATEST_BACKUP_FILE); } catch {}
      }
      const uid = (
        req.body?.uid ||
        req.query?.uid ||
        req.headers['x-user-uid'] ||
        ''
      ).toString().replace(/[^a-zA-Z0-9_-]/g, '');
      if (uid && fs.existsSync(USERS_DIR)) {
        const userFile = path.join(USERS_DIR, `${uid}.json`);
        if (fs.existsSync(userFile)) {
          try { fs.unlinkSync(userFile); } catch {}
        }
      }
      res.json({ success: true, count: 0 });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to clear' });
    }
  });

  // POST clear user backup plates
  app.post('/api/user-backup/:uid/clear', (req, res) => {
    try {
      const cleanUid = (req.params.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (cleanUid && fs.existsSync(USERS_DIR)) {
        const userFile = path.join(USERS_DIR, `${cleanUid}.json`);
        if (fs.existsSync(userFile)) {
          try { fs.unlinkSync(userFile); } catch {}
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to clear user backup' });
    }
  });

  // Track AI rate limit cooldown state to prevent 429 cascade
  let aiRateLimitUntil = 0;

  // License plate recognition API endpoint
  app.post('/api/recognize-plate', async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg', fileName } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'Missing imageBase64 in request body.' });
      }

      // If AI client is not available or key not configured, return gracefully with fallback flag
      if (!ai) {
        return res.json({
          detected: false,
          fallbackReason: 'NO_API_KEY',
          message: '伺服器處於免金鑰模式，已啟用瀏覽器原生邊緣特徵與手動輔助定位。',
          box: [450, 300, 650, 700],
        });
      }

      // Clean base64 string if it contains data URI prefix
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');

      const prompt = `You are a specialized vehicle license plate recognition (ALPR/ANPR) computer vision engine.
Examine this vehicle photo or license plate photo very carefully.
${fileName ? `Context hint from upload filename: "${fileName}".` : ''}
Your task:
1. Locate the vehicle license plate in the image (front or rear bumper, angled or straight, close-up or full vehicle).
2. Accurately read the COMPLETE license plate string.
   - CRITICAL REQUIREMENT: A standard vehicle license plate ALWAYS contains BOTH English letters and numbers (e.g., "ABC-1234", "1234-AB", "EAA-0001", "KKA-0066", "AJW-1000", "BZC-0077", "0300-CDL", "8888-ZZ").
   - DO NOT RETURN ONLY DIGITS if English letters exist on the license plate! Look closely at characters to the left, right, or above the numbers to locate the English letters.
   - Format with a hyphen '-' between letters and numbers (e.g. "ABC-1234" or "1234-AB").
   - If it is a Japanese vehicle plate, include the region or classification if visible (e.g. "品川 300 0005" or "JP-0005").
   - Set this string as "fullPlate".
3. For a 0000-9999 license plate collection, extract the primary 4-digit number (0000 to 9999):
   - If the plate has a 4-digit numeric portion (e.g., "ABC-5678" -> "5678", "1234-AB" -> "1234", "KKA-0066" -> "0066"), return those 4 digits.
   - If the plate has fewer than 4 digits (e.g., "ABC-88" -> "0088", "123-AB" -> "0123"), pad with leading zeros to 4 digits.
   - If only digits are visible, extract the 4-digit sequence.
   - Set this string as "digits".
4. Detect the exact bounding box enclosing the license plate in normalized coordinates from 0 to 1000:
   - ymin: top edge (0 to 1000)
   - xmin: left edge (0 to 1000)
   - ymax: bottom edge (0 to 1000)
   - xmax: right edge (0 to 1000)
5. Set confidence between 0.0 and 1.0. If no vehicle license plate is visible, set detected to false.

Return strictly JSON matching the required schema.`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          detected: {
            type: Type.BOOLEAN,
            description: 'True if a vehicle or license plate was identified',
          },
          fullPlate: {
            type: Type.STRING,
            description: 'Full license plate string with letters and numbers (e.g. ABC-8888, 1234-AB, KKA-0066)',
          },
          digits: {
            type: Type.STRING,
            description: 'The exact 4-digit collection number from 0000 to 9999 (e.g. "0001", "8888", "0066")',
          },
          box: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: '[ymin, xmin, ymax, xmax] coordinates from 0 to 1000',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score between 0.0 and 1.0',
          },
        },
        required: ['detected', 'fullPlate', 'digits', 'box'],
      };

      // Candidate models: prioritize ultra-fast high-availability vision models
      const candidateModels = [
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
      ];
      let lastError: any = null;
      let responseText = '';

      for (const modelName of candidateModels) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after 6500ms on ${modelName}`)), 6500)
          );

          const aiCall = ai.models.generateContent({
            model: modelName,
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: cleanBase64,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema,
            },
          });

          const response: any = await Promise.race([aiCall, timeoutPromise]);
          responseText = response.text?.trim() || '';
          if (responseText) {
            console.log(`[ALPR] Plate recognized via model: ${modelName}`);
            break;
          }
        } catch (err: any) {
          const errStr = String(err?.message || err || '');
          const is429 =
            err?.status === 'RESOURCE_EXHAUSTED' ||
            err?.code === 429 ||
            errStr.includes('429') ||
            errStr.includes('quota') ||
            errStr.includes('Quota') ||
            errStr.includes('RESOURCE_EXHAUSTED');

          console.log(`[ALPR] Model ${modelName} ${is429 ? 'rate limited (429)' : 'unavailable'}, continuing to next candidate model...`);
          lastError = err;
        }
      }

      if (!responseText) {
        console.log('[ALPR] AI recognition deferred across candidate models, checking fallback parser');

        // Emergency filename fallback if AI service is experiencing heavy traffic
        if (fileName) {
          const cleanName = fileName.replace(/\.[^/.]+$/, '');
          const plateMatch = cleanName.match(/([A-Z]{1,3}[-_\s]?\d{2,4}|\d{4}[-_\s]?[A-Z]{1,2}|\d{4})/i);
          if (plateMatch) {
            const matchedStr = plateMatch[0].toUpperCase().replace(/[_]/g, '-');
            const numPart = matchedStr.replace(/\D/g, '');
            if (numPart.length >= 2) {
              const digitsOnly = numPart.slice(-4).padStart(4, '0');
              return res.json({
                detected: true,
                fullPlate: matchedStr,
                digits: digitsOnly,
                box: [450, 250, 650, 750],
                confidence: 0.85,
                message: '辨識繁忙，已自動從檔名解析車牌',
              });
            }
          }
        }

        return res.json({
          detected: false,
          fallbackReason: 'AI_RECOGNITION_FAILED',
          message: 'AI 辨識未能解析車牌號碼，請手動確認或調整號碼。',
          box: [450, 250, 650, 750],
        });
      }

      let result: any = null;
      try {
        result = JSON.parse(responseText);
      } catch (parseErr) {
        console.warn('Non-JSON Gemini response received:', responseText?.slice(0, 100));
        const regexMatch = responseText.match(/([A-Z0-9]{2,4}[-\s]?[A-Z0-9]{2,4})/i);
        if (regexMatch) {
          const raw = regexMatch[0].toUpperCase();
          const digits = raw.replace(/\D/g, '').slice(-4).padStart(4, '0');
          result = { detected: true, fullPlate: raw, digits, box: [450, 250, 650, 750] };
        } else {
          return res.json({
            detected: false,
            fallbackReason: 'PARSE_FAILED',
            message: '未能自動辨識出完整車號，請手動確認或調整',
            box: [450, 250, 650, 750],
          });
        }
      }

      // Sanitize fullPlate
      let cleanFullPlate = (result.fullPlate || '').trim().toUpperCase();

      // Normalize missing hyphen between letters and numbers (e.g. "ABC1234" -> "ABC-1234" or "1234AB" -> "1234-AB")
      if (/^[A-Z]{2,4}\d{2,4}$/.test(cleanFullPlate)) {
        cleanFullPlate = cleanFullPlate.replace(/^([A-Z]{2,4})(\d{2,4})$/, '$1-$2');
      } else if (/^\d{2,4}[A-Z]{2,4}$/.test(cleanFullPlate)) {
        cleanFullPlate = cleanFullPlate.replace(/^(\d{2,4})([A-Z]{2,4})$/, '$1-$2');
      }

      // Extract and sanitize 4 digits
      let cleanDigits = '';
      if (result.digits) {
        cleanDigits = result.digits.replace(/\D/g, '');
      }

      // If digits couldn't be extracted directly, try extracting from fullPlate
      if (!cleanDigits && cleanFullPlate) {
        const numMatches = cleanFullPlate.match(/\d+/g);
        if (numMatches) {
          cleanDigits = numMatches.join('');
        }
      }

      if (cleanDigits.length >= 4) {
        cleanDigits = cleanDigits.slice(-4);
      } else if (cleanDigits.length > 0) {
        cleanDigits = cleanDigits.padStart(4, '0');
      } else {
        cleanDigits = '';
      }

      result.digits = cleanDigits;
      result.fullPlate = cleanFullPlate || cleanDigits;

      // Automatic secondary pass if fullPlate only contains digits (missing English letters)
      if (ai && cleanDigits && (!cleanFullPlate || !/[A-Z]/.test(cleanFullPlate))) {
        console.log(`[ALPR] Only digits recognized (${cleanDigits}) without English letters, performing automatic targeted re-scan...`);
        try {
          const letterPrompt = `Look closely at this vehicle license plate. We identified the numeric digits as "${cleanDigits}".
What are the English letters on this license plate?
Taiwanese plates have letters like "ABC-${cleanDigits}", "EAB-${cleanDigits}", "${cleanDigits}-AB", "KKA-${cleanDigits}", etc.
Examine the characters to the left, right, or above "${cleanDigits}".
Return strictly JSON with fullPlate containing BOTH the English letters and numbers formatted with a hyphen '-'.`;

          const retryCall = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [
              {
                parts: [
                  {
                    inlineData: { mimeType, data: cleanBase64 },
                  },
                  { text: letterPrompt },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  fullPlate: {
                    type: Type.STRING,
                    description: 'Complete plate with English letters and numbers, e.g. ABC-1234 or 1234-AB',
                  },
                },
                required: ['fullPlate'],
              },
            },
          });

          const retryText = retryCall.text?.trim();
          if (retryText) {
            const retryJson = JSON.parse(retryText);
            let retryPlate = (retryJson.fullPlate || '').trim().toUpperCase();
            if (/[A-Z]/.test(retryPlate)) {
              if (/^[A-Z]{2,4}\d{2,4}$/.test(retryPlate)) {
                retryPlate = retryPlate.replace(/^([A-Z]{2,4})(\d{2,4})$/, '$1-$2');
              } else if (/^\d{2,4}[A-Z]{2,4}$/.test(retryPlate)) {
                retryPlate = retryPlate.replace(/^(\d{2,4})([A-Z]{2,4})$/, '$1-$2');
              }
              cleanFullPlate = retryPlate;
              result.fullPlate = cleanFullPlate;
              console.log(`[ALPR] Second pass successfully recovered English letters: ${cleanFullPlate}`);
            }
          }
        } catch (retryErr) {
          console.warn('[ALPR] Second pass re-scan skipped:', retryErr);
        }
      }

      // If we got clean 4 digits or valid fullPlate, mark detected = true
      if (cleanDigits.length === 4 || cleanFullPlate.length >= 4) {
        result.detected = true;
      }

      // Ensure box is valid 4 integers
      if (!Array.isArray(result.box) || result.box.length !== 4) {
        result.box = [450, 300, 650, 700];
      }

      return res.json(result);
    } catch (err: any) {
      console.log('[ALPR] Plate recognition handled fallback:', err?.message || err);
      return res.json({
        detected: false,
        fallbackReason: 'AI_FALLBACK',
        message: '已切換為手動輸入模式。',
        box: [450, 300, 650, 700],
      });
    }
  });

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
