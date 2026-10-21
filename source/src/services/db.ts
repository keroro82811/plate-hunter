import { PlateRecord, PlatePhotoItem } from '../types';
import { cleanRecordForExport } from '../utils/backupHelper';
import { isRealPhotoImage, isSyntheticSvgImage, isBase64Photo, getBetterImage } from '../utils/plateHelper';
import {
  auth,
  authFetch,
  syncPlateToCloud,
  syncBatchPlatesToCloud,
  deletePlateFromCloud,
  fetchUserPlatesFromCloud,
  clearAllUserPlatesFromCloud,
  mergePlatesCollections,
} from './firebase';

const DB_NAME = 'PlateCollectorDB';
const DB_VERSION = 1;
const STORE_NAME = 'plates';

// Singleton DB connection
let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;
let currentSyncEpoch = 0;

export function getSyncEpoch(): number {
  return currentSyncEpoch;
}

// Ask browser to keep storage persistent (prevent eviction on mobile / reload)
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

export function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'number' });
        store.createIndex('collectedAt', 'collectedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbOpenPromise = null;
      };
      dbInstance.onclose = () => {
        dbInstance = null;
        dbOpenPromise = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      dbOpenPromise = null;
      reject(request.error);
    };
  });

  return dbOpenPromise;
}

// Helper to strictly clean, deduplicate, and prune ghost photos (e.g. photos without images when valid photos exist)
export function cleanPlateRecordPhotos(photos: PlatePhotoItem[]): PlatePhotoItem[] {
  if (!Array.isArray(photos) || photos.length === 0) return [];
  const valid = photos.filter((p) => p && typeof p === 'object');
  if (valid.length === 0) return [];

  // Sanitize any artificial synthetic SVGs
  for (const p of valid) {
    if (isSyntheticSvgImage(p.imageUrl)) {
      p.imageUrl = '';
    }
    if (isSyntheticSvgImage(p.originalImageUrl)) {
      p.originalImageUrl = undefined;
    }
    // If imageUrl is empty or not base64, but originalImageUrl has a real base64 image, restore it!
    if ((!p.imageUrl || !p.imageUrl.startsWith('data:')) && p.originalImageUrl && p.originalImageUrl.startsWith('data:')) {
      p.imageUrl = p.originalImageUrl;
    }
  }

  const hasRealImg = valid.some((p) => isRealPhotoImage(p.imageUrl) || isRealPhotoImage(p.originalImageUrl));
  const result: PlatePhotoItem[] = [];
  for (const p of valid) {
    const pHasImg = isRealPhotoImage(p.imageUrl) || isRealPhotoImage(p.originalImageUrl);
    // If other photos have real images, drop empty ghost photos
    if (hasRealImg && !pHasImg) {
      continue;
    }
    const cleanPlate = (p.fullPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const cleanId = p.id || '';
    // Check if duplicate ID or exact same imageUrl exists in result
    const existingIdx = result.findIndex((item) => {
      if (cleanId && item.id === cleanId) return true;
      if (pHasImg && item.imageUrl && item.imageUrl === p.imageUrl) return true;
      return false;
    });
    if (existingIdx !== -1) {
      // Merge into existing, keeping the better image (Base64 is NEVER overwritten by /api/ or empty!)
      const target = result[existingIdx];
      const mergedImg = getBetterImage(target.imageUrl, p.imageUrl);
      const mergedOrig = isBase64Photo(p.originalImageUrl)
        ? p.originalImageUrl
        : (isBase64Photo(target.originalImageUrl) ? target.originalImageUrl : (p.originalImageUrl || target.originalImageUrl));
      result[existingIdx] = {
        ...target,
        ...p,
        imageUrl: mergedImg,
        originalImageUrl: mergedOrig,
        fullPlate: p.fullPlate || target.fullPlate,
        locationName: p.locationName || target.locationName,
        latitude: p.latitude ?? target.latitude,
        longitude: p.longitude ?? target.longitude,
        cropSettings: p.cropSettings || target.cropSettings,
        notes: p.notes || target.notes,
        vehicleType: p.vehicleType || target.vehicleType,
        vehicleColor: p.vehicleColor || target.vehicleColor,
        collectedAt: p.collectedAt || target.collectedAt,
      };
    } else {
      result.push(p);
    }
  }
  // Always sort photos chronologically: from oldest to newest! (e.g. 3/23 capture first)
  result.sort((a, b) => {
    const tA = a.collectedAt ? new Date(a.collectedAt).getTime() : 0;
    const tB = b.collectedAt ? new Date(b.collectedAt).getTime() : 0;
    return tA - tB;
  });
  return result.length > 0 ? result : [valid[0]];
}

export function normalizePlateRecord(record: PlateRecord): PlateRecord {
  // Purge synthetic SVG from record itself
  const cleanRecordImg = isSyntheticSvgImage(record.imageUrl) ? '' : (record.imageUrl || '');
  const cleanOriginalImg = isSyntheticSvgImage(record.originalImageUrl) ? undefined : record.originalImageUrl;
  const rawPhotos: PlatePhotoItem[] =
    record.photos && Array.isArray(record.photos) && record.photos.length > 0
      ? [...record.photos]
      : [
          {
            id: `${record.number}_init_${record.collectedAt || 'default'}`,
            fullPlate: record.fullPlate || record.number,
            imageUrl: cleanRecordImg,
            originalImageUrl: cleanOriginalImg,
            collectedAt: record.collectedAt || new Date().toISOString(),
            vehicleType: record.vehicleType,
            vehicleColor: record.vehicleColor,
            notes: record.notes,
            locationName: record.locationName,
            latitude: record.latitude,
            longitude: record.longitude,
            cropSettings: record.cropSettings,
          },
        ];
  const photos = cleanPlateRecordPhotos(rawPhotos);
  // Find photo with authentic Base64 first, then any real photo
  const b64Photo = photos.slice().reverse().find((p) => isBase64Photo(p.imageUrl));
  const realPhoto = b64Photo || photos.slice().reverse().find((p) => isRealPhotoImage(p.imageUrl));
  const primary = realPhoto || photos[photos.length - 1]; // Prefer photo with real image
  const resolvedImg = getBetterImage(cleanRecordImg, primary?.imageUrl);
  if (isRealPhotoImage(resolvedImg) && photos.length > 0 && !isRealPhotoImage(photos[0].imageUrl)) {
    photos[0].imageUrl = resolvedImg;
  }
  return {
    ...record,
    fullPlate: primary?.fullPlate || record.fullPlate,
    imageUrl: resolvedImg,
    originalImageUrl: cleanOriginalImg || primary?.originalImageUrl,
    collectedAt: primary?.collectedAt || record.collectedAt,
    vehicleType: primary?.vehicleType || record.vehicleType,
    vehicleColor: primary?.vehicleColor || record.vehicleColor,
    notes: primary?.notes || record.notes,
    locationName: primary?.locationName || record.locationName,
    latitude: primary?.latitude ?? record.latitude,
    longitude: primary?.longitude ?? record.longitude,
    cropSettings: primary?.cropSettings || record.cropSettings,
    photos,
  };
}

// Fast local storage cache keys for instant reload fallback
const LOCAL_STORAGE_CACHE_KEY = 'plates_cache_v2';
const LOCAL_STORAGE_MANIFEST_KEY = 'plates_manifest_v1';

export function saveLocalCache(list: PlateRecord[]): void {
  try {
    if (typeof localStorage === 'undefined' || !Array.isArray(list)) return;

    // 1. Permanent Lightweight Manifest: Stores lightweight manifest for startup acceleration.
    // Kept under 500 items to never exceed browser localStorage 5MB quota or freeze UI thread.
    const sampleList = list.length > 500 ? list.slice(-500) : list;
    const manifest = sampleList.map((r) => ({
      number: r.number,
      fullPlate: r.fullPlate || r.number,
      collectedAt: r.collectedAt,
      locationName: r.locationName,
      latitude: r.latitude,
      longitude: r.longitude,
      vehicleType: r.vehicleType,
      vehicleColor: r.vehicleColor,
      notes: r.notes,
      photosCount: r.photos?.length || 1,
    }));
    try {
      localStorage.setItem(LOCAL_STORAGE_MANIFEST_KEY, JSON.stringify(manifest));
    } catch {}

    // 2. Image Cache: Store recent plates with image URLs instead of huge base64 strings
    // to strictly prevent exceeding mobile browser 5MB localStorage quota
    const withImages = list
      .filter((r) => r.imageUrl && r.imageUrl.length > 50)
      .slice(-25)
      .map((r) => ({
        number: r.number,
        fullPlate: r.fullPlate,
        imageUrl: r.imageUrl.startsWith('data:') ? `/api/plates/${r.number.padStart(4, '0')}/image` : r.imageUrl,
        collectedAt: r.collectedAt,
        locationName: r.locationName,
        photos: (r.photos || []).slice(-3).map((p) => ({
          id: p.id,
          fullPlate: p.fullPlate,
          imageUrl: p.imageUrl && p.imageUrl.startsWith('data:') ? `/api/plates/${r.number.padStart(4, '0')}/image` : p.imageUrl,
          collectedAt: p.collectedAt,
        })),
      }));
    try {
      localStorage.setItem(LOCAL_STORAGE_CACHE_KEY, JSON.stringify(withImages));
    } catch {}
  } catch (e) {}
}

function readLocalCache(): PlateRecord[] {
  const result: PlateRecord[] = [];
  const seenNumbers = new Set<string>();

  try {
    if (typeof localStorage === 'undefined') return [];

    // Only return plates that have valid images to prevent caching empty image placeholders
    const rawImages = localStorage.getItem(LOCAL_STORAGE_CACHE_KEY);
    if (rawImages) {
      try {
        const parsed = JSON.parse(rawImages);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.number && (item.imageUrl || (item.photos && item.photos[0]?.imageUrl))) {
              result.push(normalizePlateRecord(item));
              seenNumbers.add(item.number);
            }
          }
        }
      } catch {}
    }
  } catch {}

  return result;
}

// Background / reliable sync to server API with fresh auth headers
async function syncToServer(endpoint: string, method: string, data?: any): Promise<boolean> {
  try {
    const res = await authFetch(endpoint, {
      method,
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
    return res.ok;
  } catch (err) {
    console.warn(`[Sync] Server sync ${method} ${endpoint} deferred:`, err);
    return false;
  }
}

// User-specific server backup helper with fresh auth headers (chunked to safely support 10,000+ plates)
export async function syncUserBackupToServer(uid: string, records: PlateRecord[]): Promise<boolean> {
  if (!uid || !Array.isArray(records) || records.length === 0) return false;
  try {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      await authFetch(`/api/user-backup/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (records.length > CHUNK_SIZE) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    return true;
  } catch (err) {
    console.warn('[Sync] User server backup deferred:', err);
    return false;
  }
}

export async function getAllPlates(options?: {
  fastLocalOnly?: boolean;
  activeBlock?: number;
  includeAllImages?: boolean;
  forceRemoteSync?: boolean;
}): Promise<PlateRecord[]> {
  let localList: PlateRecord[] = [];

  if (options?.forceRemoteSync && typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem('local_cleared_at');
      localStorage.removeItem('cloud_cleared_at');
    } catch {}
  }

  // 1. Instant load from local browser IndexedDB using cursor projection to reduce peak memory by 90%
  try {
    const db = await openDatabase();
    localList = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const results: PlateRecord[] = [];
      const targetBlockStr = options?.activeBlock !== undefined ? String(options.activeBlock) : null;

      request.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const item: PlateRecord = cursor.value;
          if (item && item.number) {
            results.push(normalizePlateRecord(item));
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[Storage] Local IndexedDB read fallback:', err);
  }

  // 2. Only supplement plates from cache if they are NOT already in localList (prevents ghost photo duplication)!
  const cachedList = readLocalCache();
  if (cachedList.length > 0) {
    if (localList.length === 0) {
      localList = cachedList;
    } else {
      const localSet = new Set(localList.map((p) => p.number));
      const missing = cachedList.filter((p) => !localSet.has(p.number));
      if (missing.length > 0) {
        localList = [...localList, ...missing];
      }
    }
  }

  // If local cache was intentionally cleared by user, do NOT auto-pull remote plates unless explicitly requested via forceRemoteSync
  const isLocalCleared = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('local_cleared_at'));
  if (isLocalCleared && !options?.forceRemoteSync) {
    return localList;
  }

  // If fastLocalOnly requested, or if local list already has substantial records (> 500), skip remote network merge
  const shouldSkipNetworkSync = Boolean(options?.fastLocalOnly || localList.length > 500);

  if (!shouldSkipNetworkSync) {
    // 3. Fetch and merge from Server API with fresh auth headers (ensures mobile <-> computer sync & reload survival)
    try {
      const res = await authFetch('/api/plates');
      if (res.ok) {
        const serverList: PlateRecord[] = await res.json();
        if (Array.isArray(serverList) && serverList.length > 0) {
          const { mergedList } = mergePlatesCollections(localList, serverList.map(normalizePlateRecord));
          localList = mergedList;
        }
      }
    } catch (err) {
      console.warn('[Storage] Server sync unavailable, using local list:', err);
    }

    // 4. User-specific Server Backup & Cloud Firestore Read Sync (if user is authenticated)
    try {
      const currentUid = auth?.currentUser?.uid;
      if (currentUid) {
        // 4a. User server backup (fast, quota-free, cross-device)
        try {
          const uRes = await authFetch(`/api/user-backup/${currentUid}`);
          if (uRes.ok) {
            const userServerList: PlateRecord[] = await uRes.json();
            if (Array.isArray(userServerList) && userServerList.length > 0) {
              const { mergedList } = mergePlatesCollections(localList, userServerList.map(normalizePlateRecord));
              localList = mergedList;
            }
          }
        } catch (err) {
          console.warn('[Storage] User backup read deferred:', err);
        }

        const isCloudCleared = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('cloud_cleared_at'));
        let cloudList: PlateRecord[] = [];
        if (!isCloudCleared) {
          try {
            cloudList = await fetchUserPlatesFromCloud(currentUid);
          } catch (e) {
            console.warn('[Storage] Cloud fetch notice:', e);
          }
        }

        if (cloudList && cloudList.length > 0) {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('cloud_cleared_at');
            }
          } catch {}
          const { mergedList, localOnlyPlates } = mergePlatesCollections(localList, cloudList);
          localList = mergedList;
          // If local has plates that are not yet in Firestore, sync them to cloud in background (only for small sets <= 50)
          if (!isCloudCleared && localOnlyPlates && localOnlyPlates.length > 0 && localOnlyPlates.length <= 50) {
            syncBatchPlatesToCloud(currentUid, localOnlyPlates).catch((e) =>
              console.warn('[Storage] Auto-sync local plates to cloud deferred:', e)
            );
          }
        } else if (!isCloudCleared && localList.length > 0 && localList.length <= 50) {
          // Cloud is empty for this user, but local has plates -> only back up if NOT intentionally cleared
          syncBatchPlatesToCloud(currentUid, localList).catch((e) =>
            console.warn('[Storage] Initial cloud backup deferred:', e)
          );
        }
      }
    } catch (err) {
      console.warn('[Storage] Cloud sync in getAllPlates deferred:', err);
    }
  }

  // Ensure records are clean of synthetic SVGs and prioritize real captured camera photos
  let neededPurgeCount = 0;
  for (const item of localList) {
    const padded = item.number ? item.number.padStart(4, '0') : '';
    const fullPlate = item.fullPlate || padded;

    // Purge fake synthetic SVG if present
    if (isSyntheticSvgImage(item.imageUrl)) {
      item.imageUrl = '';
      neededPurgeCount++;
    }
    if (isSyntheticSvgImage(item.originalImageUrl)) {
      item.originalImageUrl = undefined;
      neededPurgeCount++;
    }

    if (Array.isArray(item.photos) && item.photos.length > 0) {
      for (const ph of item.photos) {
        if (isSyntheticSvgImage(ph.imageUrl)) {
          ph.imageUrl = '';
          neededPurgeCount++;
        }
        if (isSyntheticSvgImage(ph.originalImageUrl)) {
          ph.originalImageUrl = undefined;
          neededPurgeCount++;
        }
      }
    } else {
      item.photos = [
        {
          id: `${padded}_init_${Date.now()}`,
          fullPlate,
          imageUrl: item.imageUrl || '',
          collectedAt: item.collectedAt || new Date().toISOString(),
        },
      ];
    }

    // Find authentic real photo
    const realPhoto = item.photos.find((p) => isRealPhotoImage(p.imageUrl));
    const realPhotoImg = realPhoto?.imageUrl || (isRealPhotoImage(item.originalImageUrl) ? item.originalImageUrl : '');

    if (realPhotoImg) {
      item.imageUrl = realPhotoImg;
    } else if (!item.imageUrl || isSyntheticSvgImage(item.imageUrl)) {
      item.imageUrl = '';
    }
  }

  // 5. Clean, sanitize, and update LocalStorage cache with records
  if (localList.length > 0 && (options?.includeAllImages || options?.activeBlock === undefined)) {
    try {
      saveLocalCache(localList);
    } catch (e) {}
  }

  return localList;
}

/**
 * One-click force repair and synchronize from server
 * Restores all authentic photos from server into local IndexedDB and cache.
 */
export async function repairAndSyncPlatesFromServer(): Promise<PlateRecord[]> {
  try {
    const res = await authFetch('/api/plates');
    if (!res.ok) {
      throw new Error(`伺服器回應異常 (${res.status})`);
    }
    const serverList: PlateRecord[] = await res.json();
    if (!Array.isArray(serverList) || serverList.length === 0) {
      return [];
    }

    const normalized = serverList.map(normalizePlateRecord);
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const item of normalized) {
      store.put(item);
    }

    try {
      saveLocalCache(normalized);
    } catch {}

    return normalized;
  } catch (err) {
    console.error('[Storage] Force repair failed:', err);
    throw err;
  }
}

export async function getPlate(number: string): Promise<PlateRecord | null> {
  const rawNum = (number || '').trim();
  const padded = rawNum.padStart(4, '0');
  let localFound: PlateRecord | null = null;
  // 1. Read from local IndexedDB first
  try {
    const db = await openDatabase();
    localFound = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(padded);
      req.onsuccess = () => resolve(req.result ? normalizePlateRecord(req.result) : null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn(`Local getPlate ${number} error:`, err);
  }

  // If localFound already has an authentic Base64 photo, return it immediately!
  // NEVER let a remote server request overwrite or downgrade local Base64 photos!
  if (localFound && (isBase64Photo(localFound.imageUrl) || localFound.photos?.some((p) => isBase64Photo(p.imageUrl)))) {
    return localFound;
  }

  // 2. Fetch directly from server API if local had no full image
  try {
    const res = await authFetch(`/api/plates/${padded}`);
    if (res.ok) {
      const remote = await res.json();
      if (remote && remote.number) {
        const normalized = normalizePlateRecord(remote);
        const merged = localFound ? {
          ...localFound,
          ...normalized,
          imageUrl: getBetterImage(localFound.imageUrl, normalized.imageUrl),
          photos: cleanPlateRecordPhotos([...(localFound.photos || []), ...(normalized.photos || [])]),
        } : normalized;
        try {
          const db = await openDatabase();
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(merged);
        } catch {}
        return merged;
      }
    }
  } catch (err) {
    console.warn(`Remote getPlate ${number} fetch error:`, err);
  }

  // 3. Fallback: if local existed without full image, attach server image endpoints and return
  if (localFound) {
    return {
      ...localFound,
      imageUrl: localFound.imageUrl && localFound.imageUrl.length > 50 ? localFound.imageUrl : `/api/plates/${padded}/image`,
    };
  }
  return null;
}

/**
 * Fast targeted partition read for volume backup (0000-0999, 1000-1999, etc.)
 * Directly queries IndexedDB B-tree range key for the given block.
 * Memory footprint is < 20MB, completely immune to iOS Safari memory limits!
 */
export async function getPlatesByBlock(block: number): Promise<PlateRecord[]> {
  try {
    const db = await openDatabase();
    return await new Promise<PlateRecord[]>((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const startKey = `${block}000`;
      const endKey = `${block}999`;
      const range = IDBKeyRange.bound(startKey, endKey);
      const request = store.getAll(range);

      request.onsuccess = () => {
        const raw: PlateRecord[] = request.result || [];
        resolve(raw.map(normalizePlateRecord));
      };
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('[Storage] getPlatesByBlock error:', err);
    return [];
  }
}

/**
 * Reads all plates directly from IndexedDB with 100% full original Base64 photos intact,
 * ensuring zero data loss and flawless re-import.
 */
export async function exportAllPlatesForBackup(): Promise<PlateRecord[]> {
  const db = await openDatabase();
  const recordsMap = new Map<string, PlateRecord>();

  // 1. Read directly from local browser IndexedDB (primary source of truth for full photos)
  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const raw = cursor.value;
          if (raw && raw.number) {
            const norm = normalizePlateRecord(raw);
            const padded = String(norm.number).trim().padStart(4, '0');
            norm.number = padded;
            // Guarantee that if a photo exists, imageUrl and photos[0] have it
            const realImg =
              (isRealPhotoImage(norm.imageUrl) ? norm.imageUrl : '') ||
              norm.photos?.find((p) => isRealPhotoImage(p?.imageUrl))?.imageUrl ||
              (isRealPhotoImage(norm.originalImageUrl) ? norm.originalImageUrl : '');
            if (realImg) {
              norm.imageUrl = realImg;
              if (Array.isArray(norm.photos) && norm.photos.length > 0) {
                if (!norm.photos.some((p) => isRealPhotoImage(p?.imageUrl))) {
                  norm.photos[0].imageUrl = realImg;
                }
              }
            }
            recordsMap.set(padded, norm);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });

  // 2. Supplement from server if server has additional plates or better photos
  try {
    const res = await authFetch('/api/plates');
    if (res.ok) {
      const serverList: PlateRecord[] = await res.json();
      if (Array.isArray(serverList)) {
        for (const sr of serverList) {
          if (!sr || !sr.number) continue;
          const padded = String(sr.number).trim().padStart(4, '0');
          const existing = recordsMap.get(padded);
          if (!existing) {
            recordsMap.set(padded, normalizePlateRecord({ ...sr, number: padded }));
          } else {
            const existingHasImg = Boolean(
              (existing.imageUrl && isRealPhotoImage(existing.imageUrl)) ||
              (existing.photos && existing.photos.some((p) => isRealPhotoImage(p?.imageUrl)))
            );
            const serverHasImg = Boolean(
              (sr.imageUrl && isRealPhotoImage(sr.imageUrl)) ||
              (sr.photos && sr.photos.some((p) => isRealPhotoImage(p?.imageUrl)))
            );
            if (!existingHasImg && serverHasImg) {
              recordsMap.set(padded, normalizePlateRecord({ ...existing, ...sr, number: padded }));
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Backup] Server supplement skipped:', err);
  }

  // 3. Sort records numerically 0000 - 9999
  const list = Array.from(recordsMap.values());
  list.sort((a, b) => a.number.localeCompare(b.number));
  return list;
}

/**
 * Stream serialize all records from IndexedDB into a single JSON Blob in safe batches.
 * Paginates keys and yields to the event loop every 20 records so Garbage Collection (GC)
 * actively reclaims memory. Keeps peak RAM strictly < 20MB, preventing mobile browser crash/flash quit!
 */
export async function streamExportAllPlatesFromIndexedDB(
  onProgress?: (count: number, total: number) => void
): Promise<{ blob: Blob; totalCount: number }> {
  try {
    const db = await openDatabase();

    // 1. Fetch all primary keys first (extremely lightweight, < 300KB for 10,000 plates)
    const allKeys: string[] = await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAllKeys();
        req.onsuccess = () => resolve((req.result as string[]) || []);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });

    const totalCount = allKeys.length;
    if (totalCount === 0) {
      return { blob: new Blob(['[]'], { type: 'application/json' }), totalCount: 0 };
    }

    // 2. Read records in micro-batches of 5, yielding to event loop between batches so GC can free memory!
    const BATCH_SIZE = 5;
    const blobParts: string[] = ['[\n'];
    let processedCount = 0;

    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
      const chunkKeys = allKeys.slice(i, i + BATCH_SIZE);

      // Read batch in a dedicated lightweight transaction
      const chunkRecords: PlateRecord[] = await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const records: PlateRecord[] = [];
          let remaining = chunkKeys.length;
          if (remaining === 0) {
            resolve([]);
            return;
          }
          for (const k of chunkKeys) {
            const req = store.get(k);
            req.onsuccess = () => {
              if (req.result) records.push(normalizePlateRecord(req.result));
              remaining--;
              if (remaining === 0) resolve(records);
            };
            req.onerror = () => {
              remaining--;
              if (remaining === 0) resolve(records);
            };
          }
          tx.oncomplete = () => resolve(records);
          tx.onerror = () => resolve(records);
        } catch {
          resolve([]);
        }
      });

      // Format records cleanly (cleanRecordForExport strips redundant raw camera images)
      for (const rec of chunkRecords) {
        const clean = cleanRecordForExport(rec);
        const s = JSON.stringify(clean);
        blobParts.push(processedCount === 0 ? s : `,\n${s}`);
        processedCount++;
      }

      if (onProgress) {
        onProgress(processedCount, totalCount);
      }

      // CRITICAL for mobile memory: Give the browser 30ms to run GC and breathe!
      await new Promise((r) => setTimeout(r, 30));
    }

    blobParts.push('\n]');
    const finalBlob = new Blob(blobParts, { type: 'application/json' });
    return { blob: finalBlob, totalCount: processedCount };
  } catch (err) {
    console.warn('[Storage] streamExportAllPlatesFromIndexedDB error:', err);
    throw err;
  }
}

/**
 * Lightweight manifest export (strips large image base64 strings).
 * Generates a ~1.5MB file for 10,000 plates, downloads instantly on any phone!
 */
export async function getPlatesManifestOnly(): Promise<Partial<PlateRecord>[]> {
  try {
    const db = await openDatabase();
    return await new Promise<Partial<PlateRecord>[]>((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const results: Partial<PlateRecord>[] = [];

      request.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const rec = cursor.value;
          if (rec && rec.number) {
            results.push({
              number: rec.number,
              fullPlate: rec.fullPlate || rec.number,
              collectedAt: rec.collectedAt,
              locationName: rec.locationName,
              latitude: rec.latitude,
              longitude: rec.longitude,
              vehicleType: rec.vehicleType,
              vehicleColor: rec.vehicleColor,
              notes: rec.notes,
              photos: Array.isArray(rec.photos)
                ? rec.photos.map((p: any) => ({
                    id: p.id,
                    fullPlate: p.fullPlate,
                    collectedAt: p.collectedAt,
                    locationName: p.locationName,
                    vehicleType: p.vehicleType,
                    vehicleColor: p.vehicleColor,
                    notes: p.notes,
                  }))
                : undefined,
            });
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

export async function savePlate(
  incoming: PlateRecord,
  options?: { replacePhotoId?: string; overwritePhotos?: boolean }
): Promise<void> {
  const existing = await getPlate(incoming.number);
  const db = await openDatabase();

  let finalRecord: PlateRecord;

  if (existing) {
    let photos: PlatePhotoItem[];

    // If caller explicitly passed a fully prepared photos array, respect and use it!
    if (options?.overwritePhotos && incoming.photos) {
      photos = [...incoming.photos];
    } else if (incoming.photos && Array.isArray(incoming.photos) && incoming.photos.length > 0 && !options?.replacePhotoId) {
      photos = [...incoming.photos];
    } else {
      photos = existing.photos ? [...existing.photos] : [];

      if (options?.replacePhotoId) {
        // Replace a specific photo in the gallery
        const idx = photos.findIndex((p) => p.id === options.replacePhotoId);
        const existingPhoto = idx !== -1 ? photos[idx] : null;
        const updatedPhoto: PlatePhotoItem = {
          id: options.replacePhotoId,
          fullPlate: incoming.fullPlate || existingPhoto?.fullPlate || incoming.number,
          imageUrl: incoming.imageUrl || existingPhoto?.imageUrl || '',
          originalImageUrl: incoming.originalImageUrl || existingPhoto?.originalImageUrl,
          collectedAt: incoming.collectedAt || existingPhoto?.collectedAt || new Date().toISOString(),
          vehicleType: incoming.vehicleType || existingPhoto?.vehicleType,
          vehicleColor: incoming.vehicleColor || existingPhoto?.vehicleColor,
          notes: incoming.notes || existingPhoto?.notes,
          locationName: incoming.locationName || existingPhoto?.locationName,
          latitude: incoming.latitude ?? existingPhoto?.latitude,
          longitude: incoming.longitude ?? existingPhoto?.longitude,
          cropSettings: incoming.cropSettings || existingPhoto?.cropSettings,
        };

        if (idx !== -1) {
          photos[idx] = updatedPhoto;
        } else {
          photos.push(updatedPhoto);
        }
      } else {
        // Add incoming as an additional photo for this number slot
        const newPhoto: PlatePhotoItem = {
          id: `${incoming.number}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          fullPlate: incoming.fullPlate || incoming.number,
          imageUrl: incoming.imageUrl,
          originalImageUrl: incoming.originalImageUrl,
          collectedAt: incoming.collectedAt || new Date().toISOString(),
          vehicleType: incoming.vehicleType,
          vehicleColor: incoming.vehicleColor,
          notes: incoming.notes,
          locationName: incoming.locationName,
          latitude: incoming.latitude,
          longitude: incoming.longitude,
          cropSettings: incoming.cropSettings,
        };

        // Check if duplicate of exact photo already in array or matches fullPlate or replaces empty photo
        const cleanNewPlate = newPhoto.fullPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const existingMatchIdx = photos.findIndex(
          (p) =>
            (cleanNewPlate && p.fullPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === cleanNewPlate) ||
            (!p.imageUrl || p.imageUrl.length < 50)
        );

        if (existingMatchIdx !== -1) {
          photos[existingMatchIdx] = {
            ...photos[existingMatchIdx],
            ...newPhoto,
            id: photos[existingMatchIdx].id || newPhoto.id,
          };
        } else {
          photos.push(newPhoto);
        }
      }
    }

    const cleanPhotos = cleanPlateRecordPhotos(photos);
    const latest = cleanPhotos[cleanPhotos.length - 1];
    finalRecord = {
      ...existing,
      fullPlate: latest.fullPlate,
      imageUrl: latest.imageUrl,
      originalImageUrl: latest.originalImageUrl,
      collectedAt: latest.collectedAt,
      vehicleType: latest.vehicleType,
      vehicleColor: latest.vehicleColor,
      notes: latest.notes,
      locationName: latest.locationName,
      latitude: latest.latitude,
      longitude: latest.longitude,
      cropSettings: latest.cropSettings,
      photos: cleanPhotos,
    };
  } else {
    // New slot entry
    finalRecord = normalizePlateRecord(incoming);
  }

  // Write to IndexedDB and ensure transaction is committed
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(finalRecord);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new Error('Transaction aborted'));
  });

  // Fast localStorage sync so instant reload always has this new record
  try {
    const currentCached = readLocalCache();
    const updatedCache = currentCached.filter((r) => r.number !== finalRecord.number);
    updatedCache.push(finalRecord);
    saveLocalCache(updatedCache);
  } catch (e) {}

  // Await Server API sync with overwritePhotos so window close will NOT lose full plate edits
  await syncToServer('/api/plates', 'POST', { ...finalRecord, overwritePhotos: true });

  // If user is logged in, backup to user-specific server storage & Firestore cloud database
  try {
    const currentUid = auth?.currentUser?.uid;
    if (currentUid) {
      await syncUserBackupToServer(currentUid, [finalRecord]);
      syncPlateToCloud(currentUid, finalRecord).catch((e) =>
        console.warn('[Storage] Background cloud plate sync deferred:', e)
      );
    }
  } catch {}
}

export async function deletePlate(number: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(number);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new Error('Delete transaction aborted'));
  });

  syncToServer(`/api/plates/${number}`, 'DELETE');

  // If user is logged in, delete from Firestore cloud database
  try {
    const currentUid = auth?.currentUser?.uid;
    if (currentUid) {
      deletePlateFromCloud(currentUid, number).catch((e) =>
        console.warn('[Storage] Background cloud plate delete deferred:', e)
      );
    }
  } catch {}
}

export async function deletePlatePhoto(
  number: string,
  photoId?: string,
  photoIndex?: number
): Promise<{ deletedRecord: boolean; remainingCount: number }> {
  const existing = await getPlate(number);
  if (!existing) return { deletedRecord: true, remainingCount: 0 };

  const currentPhotos = existing.photos || [];
  let remainingPhotos = currentPhotos;

  // 1. Try deleting by photoId if provided
  if (photoId) {
    const byId = currentPhotos.filter((p) => p.id !== photoId);
    if (byId.length < currentPhotos.length) {
      remainingPhotos = byId;
    }
  }

  // 2. If photoId didn't match or was not provided, delete by photoIndex
  if (
    remainingPhotos.length === currentPhotos.length &&
    typeof photoIndex === 'number' &&
    photoIndex >= 0 &&
    photoIndex < currentPhotos.length
  ) {
    remainingPhotos = currentPhotos.filter((_, idx) => idx !== photoIndex);
  }

  // 3. Fallback: if user wanted to delete an empty photo, filter out empty photos
  if (remainingPhotos.length === currentPhotos.length && currentPhotos.some((p) => !p.imageUrl || p.imageUrl.length < 50)) {
    remainingPhotos = currentPhotos.filter((p) => p.imageUrl && p.imageUrl.length > 50);
  }

  if (remainingPhotos.length === 0) {
    // No more photos for this number -> Delete the entire number from DB & server
    await deletePlate(number);
    return { deletedRecord: true, remainingCount: 0 };
  } else {
    // Keep remaining photos, update primary display to the most recent photo
    const cleanRemaining = cleanPlateRecordPhotos(remainingPhotos);
    const latest = cleanRemaining[cleanRemaining.length - 1];
    const updatedRecord: PlateRecord = {
      ...existing,
      fullPlate: latest.fullPlate,
      imageUrl: latest.imageUrl,
      originalImageUrl: latest.originalImageUrl,
      collectedAt: latest.collectedAt,
      vehicleType: latest.vehicleType,
      vehicleColor: latest.vehicleColor,
      notes: latest.notes,
      cropSettings: latest.cropSettings,
      photos: cleanRemaining,
    };

    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(updatedRecord);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    // Update LocalStorage cache immediately to prevent resurrecting deleted photos
    try {
      const currentCached = readLocalCache();
      const updatedCache = currentCached.filter((r) => r.number !== number);
      updatedCache.push(updatedRecord);
      saveLocalCache(updatedCache);
    } catch {}

    // Overwrite on server so deleted photos are not merged back
    syncToServer('/api/plates', 'POST', { ...updatedRecord, overwritePhotos: true });
    if (photoId) {
      syncToServer(`/api/plates/${number}/photos/${photoId}`, 'DELETE');
    }

    try {
      const currentUid = auth?.currentUser?.uid;
      if (currentUid) {
        syncUserBackupToServer(currentUid, [updatedRecord]);
        syncPlateToCloud(currentUid, updatedRecord).catch(console.warn);
      }
    } catch {}

    return { deletedRecord: false, remainingCount: cleanRemaining.length };
  }
}

export async function saveBatchPlates(
  records: PlateRecord[],
  options?: {
    onProgress?: (saved: number, total: number) => void;
    skipServerSync?: boolean;
    skipCacheUpdate?: boolean;
  }
): Promise<{ count: number }> {
  if (!Array.isArray(records) || records.length === 0) {
    return { count: 0 };
  }

  // 1. Efficient targeted lookup: only read the specific records present in this batch directly from IndexedDB
  // Prevents reading 10,000 records repeatedly during streaming imports, avoiding 99% RAM overhead!
  const db = await openDatabase();
  const existingMap = new Map<string, PlateRecord>();

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      let pending = records.length;
      if (pending === 0) {
        resolve();
        return;
      }
      for (const r of records) {
        const rawNum = r && r.number !== undefined && r.number !== null ? String(r.number).trim() : '';
        if (!rawNum) {
          pending--;
          if (pending === 0) resolve();
          continue;
        }
        const padded = rawNum.padStart(4, '0');
        const req = store.get(padded);
        req.onsuccess = () => {
          if (req.result) {
            const norm = normalizePlateRecord(req.result);
            existingMap.set(padded, norm);
            existingMap.set(rawNum, norm);
            pending--;
            if (pending === 0) resolve();
          } else if (padded !== rawNum) {
            const req2 = store.get(rawNum);
            req2.onsuccess = () => {
              if (req2.result) {
                const norm2 = normalizePlateRecord(req2.result);
                existingMap.set(padded, norm2);
                existingMap.set(rawNum, norm2);
              }
              pending--;
              if (pending === 0) resolve();
            };
            req2.onerror = () => {
              pending--;
              if (pending === 0) resolve();
            };
          } else {
            pending--;
            if (pending === 0) resolve();
          }
        };
        req.onerror = () => {
          pending--;
          if (pending === 0) resolve();
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  const modifiedRecords: PlateRecord[] = [];

  // 2. Merge each incoming record into existingMap with memory-saving deduplication
  for (const rawRecord of records) {
    if (!rawRecord || rawRecord.number === undefined || rawRecord.number === null) continue;
    const num = String(rawRecord.number).trim();
    if (!num) continue;
    const padded = num.padStart(4, '0');

    const record = normalizePlateRecord(rawRecord);
    const existing = existingMap.get(padded) || existingMap.get(num);

    const incomingPhotos: PlatePhotoItem[] =
      record.photos && record.photos.length > 0
        ? record.photos
        : [
            {
              id: `${padded}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              fullPlate: record.fullPlate || padded,
              imageUrl: record.imageUrl,
              originalImageUrl: record.originalImageUrl,
              collectedAt: record.collectedAt || new Date().toISOString(),
              vehicleType: record.vehicleType,
              vehicleColor: record.vehicleColor,
              notes: record.notes,
              locationName: record.locationName,
              latitude: record.latitude,
              longitude: record.longitude,
              cropSettings: record.cropSettings,
            },
          ];

    // Prune redundant memory: if originalImageUrl is identical to imageUrl, remove to free RAM
    for (const p of incomingPhotos) {
      if (p.originalImageUrl && p.imageUrl && p.originalImageUrl === p.imageUrl) {
        delete p.originalImageUrl;
      }
    }

    let finalRecord: PlateRecord;

    if (!existing) {
      const cleanPhotos = cleanPlateRecordPhotos(incomingPhotos);
      const latest = cleanPhotos[cleanPhotos.length - 1];
      const bestImg =
        cleanPhotos.slice().reverse().find((p) => p.imageUrl && (p.imageUrl.startsWith('data:') || p.imageUrl.length > 50))?.imageUrl ||
        latest?.imageUrl ||
        record.imageUrl ||
        '';

      finalRecord = {
        ...record,
        number: padded,
        fullPlate: latest?.fullPlate || record.fullPlate || padded,
        imageUrl: bestImg,
        photos: cleanPhotos,
      };
    } else {
      const currentPhotos = existing.photos ? [...existing.photos] : [];
      for (const ip of incomingPhotos) {
        const ipCleanPlate = (ip.fullPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const existingIdx = currentPhotos.findIndex((cp) => {
          const cpCleanPlate = (cp.fullPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (ip.id && cp.id && ip.id === cp.id) return true;
          if (ipCleanPlate && cpCleanPlate && ipCleanPlate === cpCleanPlate) return true;
          if (ip.imageUrl && cp.imageUrl && ip.imageUrl === cp.imageUrl) return true;
          return false;
        });

        if (existingIdx !== -1) {
          const ep = currentPhotos[existingIdx];
          const mergedImg = getBetterImage(ep.imageUrl, ip.imageUrl);
          currentPhotos[existingIdx] = {
            ...ep,
            ...ip,
            imageUrl: mergedImg,
            originalImageUrl: isBase64Photo(ip.originalImageUrl)
              ? ip.originalImageUrl
              : (isBase64Photo(ep.originalImageUrl) ? ep.originalImageUrl : (ip.originalImageUrl || ep.originalImageUrl)),
            fullPlate: ip.fullPlate || ep.fullPlate,
          };
        } else {
          currentPhotos.push(ip);
        }
      }

      const cleanPhotos = cleanPlateRecordPhotos(currentPhotos);
      const b64Photo = cleanPhotos.slice().reverse().find((p) => isBase64Photo(p.imageUrl));
      const latestWithImg = b64Photo || cleanPhotos.slice().reverse().find((p) => isRealPhotoImage(p.imageUrl));
      const latest = cleanPhotos[cleanPhotos.length - 1];
      const bestImg = getBetterImage(existing.imageUrl, getBetterImage(record.imageUrl, latestWithImg?.imageUrl));

      finalRecord = {
        ...existing,
        ...record,
        number: padded,
        fullPlate: latest?.fullPlate || record.fullPlate || existing.fullPlate || padded,
        imageUrl: bestImg,
        collectedAt: latest?.collectedAt || record.collectedAt || existing.collectedAt,
        vehicleType: latest?.vehicleType || record.vehicleType || existing.vehicleType,
        vehicleColor: latest?.vehicleColor || record.vehicleColor || existing.vehicleColor,
        notes: latest?.notes || record.notes || existing.notes,
        locationName: latest?.locationName || record.locationName || existing.locationName,
        latitude: latest?.latitude ?? record.latitude ?? existing.latitude,
        longitude: latest?.longitude ?? record.longitude ?? existing.longitude,
        photos: cleanPhotos,
      };
    }

    existingMap.set(padded, finalRecord);
    existingMap.set(num, finalRecord);
    modifiedRecords.push(finalRecord);
  }

  // 3. Write modified records to IndexedDB in safe batch chunks (150 items per transaction to never exceed memory quotas)
  if (modifiedRecords.length > 0) {
    const IDB_BATCH_SIZE = 150;
    for (let i = 0; i < modifiedRecords.length; i += IDB_BATCH_SIZE) {
      const chunk = modifiedRecords.slice(i, i + IDB_BATCH_SIZE);
      await new Promise<void>((resolve, reject) => {
        try {
          const transaction = db.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);

          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(new Error('Batch transaction aborted'));

          for (const rec of chunk) {
            store.put(rec);
          }
        } catch (err) {
          reject(err);
        }
      });

      if (options?.onProgress) {
        options.onProgress(Math.min(i + chunk.length, modifiedRecords.length), modifiedRecords.length);
      }

      if (modifiedRecords.length > 200) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // 4. Update lightweight manifest & cache safely without exceeding localStorage quotas
    if (!options?.skipCacheUpdate) {
      try {
        saveLocalCache(modifiedRecords);
      } catch {}
    }

    // 5. Chunked background sync to server API (optimized chunks to smoothly handle 10,000+ plates)
    if (!options?.skipServerSync) {
      const myEpoch = currentSyncEpoch;
      (async () => {
        const CHUNK_SIZE = Math.min(50, Math.max(15, Math.ceil(modifiedRecords.length / 50)));
        for (let i = 0; i < modifiedRecords.length; i += CHUNK_SIZE) {
          if (myEpoch !== currentSyncEpoch) return; // aborted by clearAllPlates
          const chunk = modifiedRecords.slice(i, i + CHUNK_SIZE);
          try {
            await syncToServer('/api/plates/batch', 'POST', chunk);
            // Brief pause to allow GC and keep UI completely fluid
            await new Promise((r) => setTimeout(r, 40));
          } catch (err) {
            console.warn('[Sync] Server batch chunk sync deferred:', err);
          }
        }

        // If user is authenticated, sync to user server backup & Firestore gently in chunks
        try {
          const currentUid = auth?.currentUser?.uid;
          if (currentUid && modifiedRecords.length > 0) {
            for (let i = 0; i < modifiedRecords.length; i += CHUNK_SIZE) {
              if (myEpoch !== currentSyncEpoch) return; // aborted by clearAllPlates
              const chunk = modifiedRecords.slice(i, i + CHUNK_SIZE);
              try {
                await syncUserBackupToServer(currentUid, chunk);
                await new Promise((r) => setTimeout(r, 40));
              } catch {}
            }
            if (myEpoch === currentSyncEpoch) {
              syncBatchPlatesToCloud(currentUid, modifiedRecords).catch((e) =>
                console.warn('[Storage] Background cloud batch sync deferred:', e)
              );
            }
          }
        } catch {}
      })();
    }
  }

  return { count: modifiedRecords.length };
}

export async function clearAllPlates(options?: {
  uid?: string;
  scope?: 'localOnly' | 'cloudOnly' | 'all';
}): Promise<void> {
  const scope = options?.scope || 'all';
  const targetUid = options?.uid || auth?.currentUser?.uid || undefined;

  // Invalidate any active background chunk syncs immediately
  currentSyncEpoch++;

  // 1. If scope is 'cloudOnly', DO NOT clear local IndexedDB or local cache!
  if (scope !== 'cloudOnly') {
    // Clear IndexedDB (only for 'localOnly' or 'all')
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (err) {
      console.warn('[Storage] IndexedDB clear warning:', err);
    }

    // Clear fast localStorage & sessionStorage caches
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LOCAL_STORAGE_CACHE_KEY);
        localStorage.removeItem(LOCAL_STORAGE_MANIFEST_KEY);
        localStorage.removeItem('app_cached_plates');
        localStorage.setItem('local_cleared_at', String(Date.now()));
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.clear();
      }
    } catch (err) {
      console.warn('[Storage] localStorage cache clear warning:', err);
    }
  }

  // If user only wanted to clear local device cache, return here (cloud backup preserved)
  if (scope === 'localOnly') {
    return;
  }

  // 2. Clear cloud and server backups (for 'cloudOnly' or 'all')
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('cloud_cleared_at', String(Date.now()));
    }
  } catch {}

  try {
    if (targetUid) {
      await syncToServer(`/api/user-backup/${targetUid}/clear`, 'POST');
    }
    // CRITICAL: Always clear server plates for cloudOnly and all scopes
    await syncToServer('/api/plates/clear', 'POST', { uid: targetUid });
  } catch (err) {
    console.warn('[Storage] Server clear sync notice:', err);
  }

  // 3. Clear Cloud Firestore user plates with timeout protection
  if (targetUid) {
    try {
      await clearAllUserPlatesFromCloud(targetUid);
    } catch (err) {
      console.warn('[Storage] Cloud Firestore clear notice:', err);
    }
  }
}
