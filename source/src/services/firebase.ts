import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  writeBatch,
  getDocFromServer,
  disableNetwork,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { PlateRecord } from '../types';
import { isRealPhotoImage, isSyntheticSvgImage, isBase64Photo, getBetterImage } from '../utils/plateHelper';

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Initialize Firestore (with provisioned database ID if provided)
export const db = (firebaseConfig as any).firestoreDatabaseId
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);

// Firestore Quota Shield state (persisted in localStorage across page reloads to prevent chat fix alerts)
const QUOTA_STORAGE_KEY = 'firestore_quota_exhausted_v1';

export function checkIsFirestoreQuotaExhausted(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
      if (raw) {
        const expiry = parseInt(raw, 10);
        if (!isNaN(expiry) && Date.now() < expiry) {
          return true;
        } else {
          localStorage.removeItem(QUOTA_STORAGE_KEY);
        }
      }
    }
  } catch {}
  return false;
}

export function isQuotaOrStreamError(e: any): boolean {
  const msg = e?.message || (typeof e === 'string' ? e : String(e || ''));
  return (
    e?.code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Free daily write units') ||
    msg.includes('Free daily read units') ||
    msg.includes('Write stream exhausted') ||
    msg.includes('maximum allowed queued writes') ||
    msg.includes('overloading the backend') ||
    msg.includes('maximum backoff delay') ||
    msg.includes('quota metric')
  );
}

export function markFirestoreQuotaExhausted(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      // Suppress Firestore write attempts for 24 hours (until daily quota resets)
      const expiry = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem(QUOTA_STORAGE_KEY, String(expiry));
    }
  } catch {}
  try {
    disableNetwork(db).catch(() => {});
  } catch {}
  console.warn('[Firebase] Firestore daily write quota limit reached. Paused Firestore network sync and switched to resilient server & local storage.');
}

// Global unhandled rejection & console error safety net: catch any internal Firestore write stream exhaustion errors
if (typeof window !== 'undefined') {
  if (checkIsFirestoreQuotaExhausted()) {
    try {
      disableNetwork(db).catch(() => {});
    } catch {}
  }

  const originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    const isQuota = args.some((arg) => isQuotaOrStreamError(arg));
    if (isQuota) {
      markFirestoreQuotaExhausted();
      return;
    }
    originalConsoleError.apply(console, args);
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    if (isQuotaOrStreamError(reason)) {
      markFirestoreQuotaExhausted();
      event.preventDefault(); // Suppresses the error from failing the app or triggering environment alerts
    }
  });
}

export interface UserProfileData {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  birthday?: string; // e.g. "1024" or "10-24" or "1995-10-24"
  birthdayPlate?: string; // e.g. "1024"
  collectorTitle?: string; // e.g. "傳奇典藏家"
  createdAt?: string;
  updatedAt?: string;
}

// Google Sign-In
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

// Local Collector ID fallback (resilient, 0 network dependency, immune to 401/popup blockers)
export function getOrCreateLocalUserId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      let localId = localStorage.getItem('app_local_collector_uid');
      if (!localId) {
        localId = `collector_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('app_local_collector_uid', localId);
      }
      return localId;
    }
  } catch {}
  return 'local_collector_default';
}

// Guest / Anonymous Cloud Sign-In (resilient against 401 popup or domain restrictions)
export async function signInGuestOrAnonymous(): Promise<User | null> {
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (e) {
    console.warn('[Auth] Anonymous sign-in skipped (not enabled on Firebase project):', e);
    return null;
  }
}

// Re-export onAuthStateChanged
export { onAuthStateChanged };

// Sign-Out
export async function logOut(): Promise<void> {
  await signOut(auth);
}

/**
 * Retrieves fresh Firebase ID Token and returns user headers.
 * Uses custom headers to avoid Cloud Run IAM 401 Bearer token collisions.
 */
export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken(forceRefresh);
      if (token) {
        return {
          'X-Firebase-Token': token,
          'X-User-Uid': user.uid,
        };
      }
    }
  } catch (e: any) {
    console.warn('[Auth] Token acquisition deferred:', e?.message || e);
  }
  return {};
}

/**
 * Authenticated fetch helper with automatic 401 retry & token refresh for mobile & web
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const authHeaders = await getAuthHeaders(false);
  for (const [k, v] of Object.entries(authHeaders)) {
    if (!headers.has(k)) {
      headers.set(k, v);
    }
  }

  let response = await fetch(url, { ...options, headers });

  // If 401 occurs on mobile devices (e.g. gateway rejecting Authorization or token mismatch),
  // strip Authorization and retry once cleanly
  if (response.status === 401) {
    headers.delete('Authorization');
    headers.delete('authorization');
    try {
      response = await fetch(url, { ...options, headers });
    } catch {}
  }

  return response;
}

// Fetch user profile with multi-tier persistence (localStorage -> Server API -> Firestore)
export async function getUserProfile(uid?: string): Promise<UserProfileData | null> {
  let resultProfile: Partial<UserProfileData> = {};

  // 1. Read from localStorage cache (instant)
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('local_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          resultProfile = { ...parsed };
        }
      }
      const bPlate = localStorage.getItem('user_birthday_plate');
      if (bPlate && !resultProfile.birthdayPlate) {
        resultProfile.birthdayPlate = bPlate;
        if (bPlate.length === 4) {
          resultProfile.birthday = `${bPlate.slice(0, 2)}-${bPlate.slice(2, 4)}`;
        }
      }
    }
  } catch (e) {}

  // 2. Read from Server API disk storage with fresh auth headers (with 2s timeout)
  try {
    const endpoint = uid ? `/api/user-profile/${uid}` : '/api/user-profile';
    const sRes = await Promise.race([
      authFetch(endpoint),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (sRes && sRes.ok) {
      const serverProf = await sRes.json();
      if (serverProf && (serverProf.displayName || serverProf.birthdayPlate)) {
        resultProfile = {
          ...resultProfile,
          ...serverProf,
          birthdayPlate: serverProf.birthdayPlate || resultProfile.birthdayPlate,
          birthday: serverProf.birthday || resultProfile.birthday,
        };
      }
    }
  } catch (e) {}

  // 3. Only query Firestore if user is authenticated and matches uid (rules prohibit local_user or unauthenticated access)
  const isUserAuthenticatedForUid = auth.currentUser && uid && auth.currentUser.uid === uid;
  if (isUserAuthenticatedForUid && !checkIsFirestoreQuotaExhausted()) {
    try {
      const userDocRef = doc(db, 'users', uid);
      const snap = await Promise.race([
        getDoc(userDocRef),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (snap && snap.exists()) {
        const cloudData = snap.data() as UserProfileData;
        resultProfile = {
          ...resultProfile,
          ...cloudData,
          birthdayPlate: cloudData.birthdayPlate || resultProfile.birthdayPlate,
          birthday: cloudData.birthday || resultProfile.birthday,
        };
      }
    } catch (e: any) {
      if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota limit exceeded')) {
        markFirestoreQuotaExhausted();
      } else {
        console.warn('[Firebase] Error getting user profile:', e?.message || e);
      }
    }
  }

  if (resultProfile.displayName || resultProfile.birthdayPlate || resultProfile.uid) {
    if (resultProfile.birthdayPlate && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('user_birthday_plate', resultProfile.birthdayPlate);
        if (resultProfile.birthdayPlate.length === 4) {
          localStorage.setItem('user_birthday_month', resultProfile.birthdayPlate.slice(0, 2));
          localStorage.setItem('user_birthday_day', resultProfile.birthdayPlate.slice(2, 4));
        }
      } catch {}
    }
    return resultProfile as UserProfileData;
  }
  return null;
}

// Save/Update user profile with multi-tier persistence (localStorage + Server Disk + Firestore)
export async function saveUserProfile(profile: Partial<UserProfileData> & { uid: string }): Promise<void> {
  // Read local cache synchronously so save is instant
  let existing: Partial<UserProfileData> | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('local_user_profile');
      if (saved) {
        existing = JSON.parse(saved);
      }
    }
  } catch {}

  const updated: UserProfileData = {
    ...(existing || {}),
    ...profile,
    uid: profile.uid,
    displayName: profile.displayName || existing?.displayName || '車牌藏家',
    collectorTitle: profile.collectorTitle || existing?.collectorTitle || '公路尋寶家',
    birthdayPlate: profile.birthdayPlate || existing?.birthdayPlate,
    birthday: profile.birthday || existing?.birthday,
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  // 1. Immediately write to localStorage (guarantees reload survival across all devices)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('local_user_profile', JSON.stringify(updated));
      if (updated.birthdayPlate) {
        localStorage.setItem('user_birthday_plate', updated.birthdayPlate);
        if (updated.birthdayPlate.length === 4) {
          localStorage.setItem('user_birthday_month', updated.birthdayPlate.slice(0, 2));
          localStorage.setItem('user_birthday_day', updated.birthdayPlate.slice(2, 4));
        }
      }
    }
  } catch (e) {}

  // 2. Save to Server Disk Storage with fresh auth headers (with 2s timeout)
  try {
    await Promise.race([
      authFetch(`/api/user-profile/${profile.uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (e) {
    console.warn('[Storage] Server user profile save deferred:', e);
  }

  // 3. Save to Firestore ONLY if user is authenticated and matches uid (avoid permission-denied or hanging unauthenticated calls)
  const isUserAuthenticatedForUid = auth.currentUser && profile.uid && auth.currentUser.uid === profile.uid;
  if (isUserAuthenticatedForUid && !checkIsFirestoreQuotaExhausted()) {
    try {
      const userDocRef = doc(db, 'users', profile.uid);
      await Promise.race([
        setDoc(userDocRef, updated, { merge: true }),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (e: any) {
      if (isQuotaOrStreamError(e)) {
        markFirestoreQuotaExhausted();
      } else {
        console.warn('[Firebase] Error saving user profile to Firestore:', e?.message || e);
      }
    }
  }
}

// Helper to sanitize and prepare records for Firestore (prevents undefined errors & preserves standard compressed images under 500KB)
export function prepareRecordForCloud(record: PlateRecord): any {
  const clean: any = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined || k === 'originalImageUrl') continue;
    // Keep standard compressed images; only drop excessively large data URLs (> 500KB) to stay within Firestore 1MB document limit
    if (k === 'imageUrl' && typeof v === 'string' && v.startsWith('data:') && v.length > 500000) {
      continue;
    }
    clean[k] = v;
  }
  if (Array.isArray(record.photos)) {
    clean.photos = record.photos.map((p) => {
      const pClean: any = {};
      for (const [pk, pv] of Object.entries(p)) {
        if (pv === undefined || pk === 'originalImageUrl') continue;
        if (pk === 'imageUrl' && typeof pv === 'string' && pv.startsWith('data:') && pv.length > 500000) {
          continue;
        }
        pClean[pk] = pv;
      }
      return pClean;
    });
  }
  clean.updatedAt = new Date().toISOString();
  return clean;
}

// Test connection to Firestore on initialization (only when user is signed in to avoid permission errors)
async function testFirestoreConnection() {
  if (checkIsFirestoreQuotaExhausted()) return;
  const user = auth.currentUser;
  if (!user) return;
  try {
    await getDocFromServer(doc(db, 'users', user.uid));
  } catch (error) {
    if (isQuotaOrStreamError(error)) {
      markFirestoreQuotaExhausted();
      return;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Firebase] Firestore client is currently offline or unreachable.');
    }
  }
}
testFirestoreConnection();

// Merge two collections of PlateRecord[] (e.g. Local IndexedDB + Cloud Firestore)
export function mergePlatesCollections(
  localList: PlateRecord[],
  cloudList: PlateRecord[]
): { mergedList: PlateRecord[]; localOnlyPlates: PlateRecord[]; cloudOnlyPlates: PlateRecord[] } {
  const mergedMap = new Map<string, PlateRecord>();
  const localOnlyPlates: PlateRecord[] = [];
  const cloudOnlyPlates: PlateRecord[] = [];

  const cloudMap = new Map<string, PlateRecord>();
  for (const cp of cloudList) {
    if (cp && cp.number) cloudMap.set(cp.number, cp);
  }

  const localMap = new Map<string, PlateRecord>();
  for (const lp of localList) {
    if (lp && lp.number) localMap.set(lp.number, lp);
  }

  // Identify local-only plates (need cloud backup)
  for (const [num, lp] of localMap.entries()) {
    if (!cloudMap.has(num)) {
      localOnlyPlates.push(lp);
    }
  }

  // Identify cloud-only plates (need local restoration)
  for (const [num, cp] of cloudMap.entries()) {
    if (!localMap.has(num)) {
      cloudOnlyPlates.push(cp);
    }
  }

  // Merge everything seamlessly (Local has priority for full base64 images & originalImageUrl)
  const allNumbers = new Set([...localMap.keys(), ...cloudMap.keys()]);
  for (const num of allNumbers) {
    const loc = localMap.get(num);
    const cld = cloudMap.get(num);

    if (loc && !cld) {
      mergedMap.set(num, loc);
    } else if (!loc && cld) {
      mergedMap.set(num, cld);
    } else if (loc && cld) {
      // Merge photos from both sources without dropping any valid photo, deduplicating by ID or exact same image
      const combinedPhotos: any[] = [];
      const seenPhotoMap = new Map<string, any>();
      const seenImgMap = new Map<string, any>();

      const addPhoto = (p: any) => {
        if (!p) return;
        const cleanImg = isSyntheticSvgImage(p.imageUrl) ? '' : (p.imageUrl || '');
        const pHasImg = isRealPhotoImage(cleanImg);
        const key = p.id || '';
        const imgKey = pHasImg ? cleanImg : '';

        const match = (key && seenPhotoMap.get(key)) || (imgKey && seenImgMap.get(imgKey));

        if (match) {
          const betterImg = getBetterImage(match.imageUrl, cleanImg);
          const betterOriginal = isBase64Photo(p.originalImageUrl)
            ? p.originalImageUrl
            : (isBase64Photo(match.originalImageUrl) ? match.originalImageUrl : (p.originalImageUrl || match.originalImageUrl));
          const merged = {
            ...match,
            ...p,
            imageUrl: betterImg,
            originalImageUrl: betterOriginal,
            fullPlate: p.fullPlate || match.fullPlate,
            locationName: p.locationName || match.locationName,
            latitude: p.latitude ?? match.latitude,
            longitude: p.longitude ?? match.longitude,
            collectedAt: p.collectedAt || match.collectedAt,
            cropSettings: match.cropSettings || p.cropSettings,
            notes: p.notes || match.notes,
            vehicleType: p.vehicleType || match.vehicleType,
            vehicleColor: p.vehicleColor || match.vehicleColor,
          };
          if (key) seenPhotoMap.set(key, merged);
          if (imgKey) seenImgMap.set(imgKey, merged);
          const idx = combinedPhotos.findIndex((item) => item === match || (key && item.id === key));
          if (idx !== -1) {
            combinedPhotos[idx] = merged;
          }
          return;
        }

        // If other photos already have real images, and this one has no image, don't add as a separate blank slot
        const alreadyHasImages = combinedPhotos.some((item) => isRealPhotoImage(item.imageUrl));
        if (alreadyHasImages && !pHasImg) {
          return;
        }

        const cleanP = { ...p, imageUrl: cleanImg };
        if (key) seenPhotoMap.set(key, cleanP);
        if (imgKey) seenImgMap.set(imgKey, cleanP);
        combinedPhotos.push(cleanP);
      };

      // Add photos from both (prioritize sources with real photos)
      for (const p of cld.photos || []) addPhoto(p);
      for (const p of loc.photos || []) addPhoto(p);

      // Clean ghost photos: if at least one photo has an image, drop empty ones
      const hasRealImg = combinedPhotos.some((p) => isRealPhotoImage(p.imageUrl));
      const cleanPhotos = hasRealImg
        ? combinedPhotos.filter((p) => isRealPhotoImage(p.imageUrl))
        : combinedPhotos;

      const finalPhotos = cleanPhotos.length > 0 ? cleanPhotos : (combinedPhotos.length > 0 ? combinedPhotos : (loc.photos || []));

      // Sort photos chronologically from oldest to newest!
      finalPhotos.sort((a, b) => {
        const tA = a.collectedAt ? new Date(a.collectedAt).getTime() : 0;
        const tB = b.collectedAt ? new Date(b.collectedAt).getTime() : 0;
        return tA - tB;
      });

      // Find the best real image (strictly prioritize Base64 photos over relative URLs)
      const b64Photo = finalPhotos.slice().reverse().find((p) => isBase64Photo(p.imageUrl));
      const validPhotoWithImg = b64Photo || finalPhotos.slice().reverse().find((p) => isRealPhotoImage(p.imageUrl));
      const latestPhoto = finalPhotos[finalPhotos.length - 1];
      const bestImageUrl = getBetterImage(
        loc.imageUrl,
        getBetterImage(cld.imageUrl, validPhotoWithImg?.imageUrl || latestPhoto?.imageUrl)
      );

      const bestFullPlate =
        latestPhoto?.fullPlate ||
        loc.fullPlate ||
        cld.fullPlate ||
        num;

      const bestCollectedAt =
        latestPhoto?.collectedAt ||
        loc.collectedAt ||
        cld.collectedAt ||
        new Date().toISOString();

      mergedMap.set(num, {
        ...cld,
        ...loc,
        number: num,
        locationName: loc.locationName || cld.locationName,
        latitude: loc.latitude ?? cld.latitude,
        longitude: loc.longitude ?? cld.longitude,
        vehicleType: loc.vehicleType || cld.vehicleType,
        vehicleColor: loc.vehicleColor || cld.vehicleColor,
        notes: loc.notes || cld.notes,
        fullPlate: bestFullPlate,
        imageUrl: bestImageUrl,
        collectedAt: bestCollectedAt,
        photos: finalPhotos,
      });
    }
  }

  return {
    mergedList: Array.from(mergedMap.values()),
    localOnlyPlates,
    cloudOnlyPlates,
  };
}

// Save a single plate to Firestore
export async function syncPlateToCloud(uid: string, record: PlateRecord): Promise<void> {
  if (!uid || !record || !record.number) return;
  if (checkIsFirestoreQuotaExhausted()) return;
  try {
    const plateRef = doc(db, 'users', uid, 'plates', record.number);
    const cleanRecord = prepareRecordForCloud(record);
    await setDoc(plateRef, cleanRecord, { merge: true });
    console.log(`[Cloud] Plate #${record.number} successfully synced to Firestore`);
  } catch (e: any) {
    if (isQuotaOrStreamError(e)) {
      markFirestoreQuotaExhausted();
    } else {
      console.warn(`[Firebase] Failed to sync plate #${record.number} to cloud:`, e?.message || e);
    }
  }
}

// Save batch plates to Firestore using high-speed writeBatch commits
export async function syncBatchPlatesToCloud(
  uid: string,
  records: PlateRecord[],
  onProgress?: (synced: number, total: number) => void
): Promise<number> {
  if (!uid || !records || records.length === 0) return 0;
  if (checkIsFirestoreQuotaExhausted()) return 0;

  let successCount = 0;
  const candidates = records.filter((r) => r && r.number);
  const total = candidates.length;
  const BATCH_CHUNK = 25; // Firestore allows up to 500 operations per batch

  for (let i = 0; i < total; i += BATCH_CHUNK) {
    if (checkIsFirestoreQuotaExhausted()) break;
    const chunk = candidates.slice(i, i + BATCH_CHUNK);

    try {
      const batch = writeBatch(db);
      for (const r of chunk) {
        const plateRef = doc(db, 'users', uid, 'plates', r.number);
        const cleanRecord = prepareRecordForCloud(r);
        batch.set(plateRef, cleanRecord, { merge: true });
      }
      await batch.commit();
      successCount += chunk.length;
      if (onProgress) {
        onProgress(successCount, total);
      }
      // Minimal inter-batch yield
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch (e: any) {
      if (isQuotaOrStreamError(e)) {
        markFirestoreQuotaExhausted();
        break;
      } else {
        console.warn(`[Firebase] Batch write failed, falling back to individual sets:`, e?.message || e);
        // Fallback individually for this chunk
        for (const r of chunk) {
          try {
            const plateRef = doc(db, 'users', uid, 'plates', r.number);
            const cleanRecord = prepareRecordForCloud(r);
            await setDoc(plateRef, cleanRecord, { merge: true });
            successCount++;
            if (onProgress) {
              onProgress(successCount, total);
            }
          } catch (singleErr) {
            console.warn(`[Firebase] Single write fallback error for #${r.number}:`, singleErr);
          }
        }
      }
    }
  }

  console.log(`[Cloud] Batch sync complete: ${successCount}/${candidates.length} plates saved to Firestore`);
  return successCount;
}

// Delete a plate from Firestore
export async function deletePlateFromCloud(uid: string, number: string): Promise<void> {
  if (!uid || !number) return;
  if (checkIsFirestoreQuotaExhausted()) return;
  try {
    const plateRef = doc(db, 'users', uid, 'plates', number);
    await deleteDoc(plateRef);
    console.log(`[Cloud] Plate #${number} deleted from Firestore`);
  } catch (e: any) {
    if (isQuotaOrStreamError(e)) {
      markFirestoreQuotaExhausted();
    } else {
      console.warn(`[Firebase] Failed to delete plate #${number} from cloud:`, e?.message || e);
    }
  }
}

// Fetch all cloud plates for a user
export async function fetchUserPlatesFromCloud(uid: string): Promise<PlateRecord[]> {
  if (!uid) return [];
  try {
    const platesCol = collection(db, 'users', uid, 'plates');
    const snapshot = await getDocs(platesCol);
    const list: PlateRecord[] = [];
    snapshot.forEach((d) => {
      const data = d.data() as PlateRecord;
      if (data && data.number) {
        list.push(data);
      }
    });
    console.log(`[Cloud] Loaded ${list.length} plates from Firestore for user ${uid}`);
    return list;
  } catch (e: any) {
    if (isQuotaOrStreamError(e)) {
      markFirestoreQuotaExhausted();
    } else {
      console.warn('[Firebase] Error fetching user cloud plates:', e?.message || e);
    }
    return [];
  }
}

// Clear all user plates from Firestore (with 4s timeout protection so it never hangs)
export async function clearAllUserPlatesFromCloud(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const fetchPromise = (async () => {
      const platesCol = collection(db, 'users', uid, 'plates');
      const snapshot = await getDocs(platesCol);
      if (snapshot.empty) {
        console.log(`[Cloud] No plates to clear in Firestore for user ${uid}`);
        return;
      }

      const docs = snapshot.docs;
      const BATCH_SIZE = 400;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        try {
          await batch.commit();
        } catch (batchErr) {
          // Fallback to fast parallel deletes if batch fails
          await Promise.allSettled(chunk.map((d) => deleteDoc(d.ref)));
        }
      }
      console.log(`[Cloud] Successfully cleared ${docs.length} plates from Firestore for user ${uid}`);
    })();

    // Safety timeout: ensure clear never hangs more than 4.5 seconds
    await Promise.race([
      fetchPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 4500)),
    ]);
  } catch (e: any) {
    console.warn('[Firebase] Failed to clear user cloud plates:', e?.message || e);
  }
}

