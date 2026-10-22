import React, { useState, useEffect, useMemo, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { Header } from './components/Header';
import { CollectionGrid } from './components/CollectionGrid';
import { UploaderModal } from './components/UploaderModal';
import { PlateDetailModal } from './components/PlateDetailModal';
import { StatsDashboard, ActiveTab } from './components/StatsDashboard';
import { BackupModal } from './components/BackupModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BatchUploaderModal } from './components/BatchUploaderModal';
import { ProfileModal } from './components/ProfileModal';
import { PlateRecord, AppTheme } from './types';
import { getAllPlates, savePlate, deletePlate, deletePlatePhoto, getPlate, saveBatchPlates, syncUserBackupToServer, getPlatesByBlock } from './services/db';
import { SAMPLE_PLATES } from './components/SamplePlates';
import { calculateSquareCrop, createCroppedSquareImage, loadImage } from './utils/cropper';
import { computeBadges, ComputedBadge } from './services/achievements';
import {
  auth,
  authFetch,
  onAuthStateChanged,
  getUserProfile,
  saveUserProfile,
  UserProfileData,
  syncBatchPlatesToCloud,
} from './services/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { Camera, Sparkles, Award, Trophy, ChevronRight, X, Download, ArrowUp, Check } from 'lucide-react';
import { testGeminiConnection } from './services/geminiVision';

export default function App() {
  const [plates, setPlates] = useState<PlateRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [saveSuccessToast, setSaveSuccessToast] = useState<{
    message: string;
    plateNumber?: string;
  } | null>(null);

  // Authentication & Collector Profile state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileData | null>(() => {
    try {
      const saved = localStorage.getItem('local_user_profile');
      let prof: UserProfileData | null = saved ? JSON.parse(saved) : null;
      const bPlate = localStorage.getItem('user_birthday_plate');
      const bMonth = localStorage.getItem('user_birthday_month');
      const bDay = localStorage.getItem('user_birthday_day');
      const fallbackPlate = bPlate || (bMonth && bDay ? `${bMonth.padStart(2, '0')}${bDay.padStart(2, '0')}` : null);
      if (fallbackPlate && fallbackPlate.length === 4) {
        if (!prof) {
          prof = { uid: 'local_user', displayName: '車牌藏家', birthdayPlate: fallbackPlate };
        } else {
          prof.birthdayPlate = prof.birthdayPlate || fallbackPlate;
        }
        if (!prof.birthday) {
          prof.birthday = `${fallbackPlate.slice(0, 2)}-${fallbackPlate.slice(2, 4)}`;
        }
      }
      return prof;
    } catch {
      return null;
    }
  });

  // Load server-persisted user profile on initial mount
  useEffect(() => {
    getUserProfile().then((prof) => {
      setUserProfile((prev) => {
        const localBPlate = (() => {
          try {
            const bp = localStorage.getItem('user_birthday_plate');
            if (bp && bp.length === 4) return bp;
            const bm = localStorage.getItem('user_birthday_month');
            const bd = localStorage.getItem('user_birthday_day');
            if (bm && bd) return `${bm.padStart(2, '0')}${bd.padStart(2, '0')}`;
          } catch {}
          return '';
        })();
        const merged: any = { ...(prev || {}) };
        if (prof) {
          for (const [k, v] of Object.entries(prof)) {
            if (v !== undefined && v !== null && v !== '') {
              merged[k] = v;
            }
          }
        }
        if (!merged.birthdayPlate && (prev?.birthdayPlate || localBPlate)) {
          merged.birthdayPlate = prev?.birthdayPlate || localBPlate;
          merged.birthday = prev?.birthday || (localBPlate.length === 4 ? `${localBPlate.slice(0, 2)}-${localBPlate.slice(2, 4)}` : undefined);
        }
        try {
          if (merged.birthdayPlate) {
            localStorage.setItem('user_birthday_plate', merged.birthdayPlate);
            if (merged.birthdayPlate.length === 4) {
              localStorage.setItem('user_birthday_month', merged.birthdayPlate.slice(0, 2));
              localStorage.setItem('user_birthday_day', merged.birthdayPlate.slice(2, 4));
            }
            localStorage.setItem('local_user_profile', JSON.stringify(merged));
          }
        } catch {}
        return merged as UserProfileData;
      });
    }).catch(() => {});
  }, []);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Active thousand block (0 = 0000-0999, 1 = 1000-1999, ... 9 = 9000-9999)
  const [activeThousandBlock, setActiveThousandBlockState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('plate_active_block');
      if (saved !== null) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 0 && val <= 9) return val;
      }
    } catch (e) {}
    return 0;
  });

  const setActiveThousandBlock = useCallback((block: number) => {
    setActiveThousandBlockState(block);
    try {
      localStorage.setItem('plate_active_block', String(block));
    } catch (e) {}
  }, []);

  const [highlightedNumber, setHighlightedNumber] = useState<string | null>(null);

  // Newly unlocked badge celebration toast
  const [newlyUnlockedBadge, setNewlyUnlockedBadge] = useState<ComputedBadge | null>(null);

  // Modals state
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [isBatchUploaderOpen, setIsBatchUploaderOpen] = useState(false);
  const [batchInitialFiles, setBatchInitialFiles] = useState<File[]>([]);
  const [uploaderTargetNumber, setUploaderTargetNumber] = useState<string | undefined>(undefined);
  const [uploaderReplacePhotoId, setUploaderReplacePhotoId] = useState<string | undefined>(undefined);
  const [selectedRecord, setSelectedRecord] = useState<PlateRecord | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | undefined>(undefined);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [statsInitialTab, setStatsInitialTab] = useState<ActiveTab>('badges');
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // App Theme: 'carbon' | 'cyber' | 'parchment'
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      const saved = localStorage.getItem('license_plate_theme');
      if (saved === 'cyber' || saved === 'parchment' || saved === 'carbon') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'carbon';
  });

  const handleSelectTheme = (newTheme: AppTheme) => {
    setTheme(newTheme);
    try {
      localStorage.setItem('license_plate_theme', newTheme);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Map for instant O(1) lookup
  const plateMap = useMemo(() => {
    const map = new Map<string, PlateRecord>();
    for (const p of plates) {
      map.set(p.number, p);
    }
    return map;
  }, [plates]);

  // Compute Badges & Rank (including birthday plate badge if configured)
  const badgeData = useMemo(() => {
    return computeBadges(plateMap, { birthdayPlate: userProfile?.birthdayPlate });
  }, [plateMap, userProfile?.birthdayPlate]);

  // Load all plates from IndexedDB, Server API, and Cloud Firestore
  const loadPlates = useCallback(async (options?: { fastLocalOnly?: boolean; activeBlock?: number }) => {
    try {
      const records = await getAllPlates({ ...options, includeAllImages: true });
      setPlates(records);
      setSelectedRecord((prev) => {
        if (!prev) return null;
        return records.find((r) => r.number === prev.number) || null;
      });
    } catch (err) {
      console.warn('Failed to load plates:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fast switch thousand block: updates active block and pulls full photos for this block from IndexedDB in < 5ms
  const handleChangeThousandBlock = useCallback(async (newBlock: number) => {
    setActiveThousandBlock(newBlock);
    try {
      const blockPlates = await getPlatesByBlock(newBlock);
      if (blockPlates.length > 0) {
        setPlates((prev) => {
          const mergedMap = new Map(prev.map((p) => [p.number, p]));
          for (const p of blockPlates) {
            mergedMap.set(p.number, p);
          }
          return Array.from(mergedMap.values());
        });
      }
    } catch (err) {
      console.warn('Failed to load block plates:', err);
    }
  }, []);

  useEffect(() => {
    loadPlates();
  }, [loadPlates]);

  // Listen to Firebase Auth state change & restore user profile and cloud plates
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const profile = await getUserProfile(user.uid);
          setUserProfile((prev) => {
            const localBPlate = (() => {
              try {
                const bp = localStorage.getItem('user_birthday_plate');
                if (bp && bp.length === 4) return bp;
                const bm = localStorage.getItem('user_birthday_month');
                const bd = localStorage.getItem('user_birthday_day');
                if (bm && bd) return `${bm.padStart(2, '0')}${bd.padStart(2, '0')}`;
              } catch {}
              return '';
            })();
            const merged: any = { ...(prev || {}) };
            if (profile) {
              for (const [k, v] of Object.entries(profile)) {
                if (v !== undefined && v !== null && v !== '') {
                  merged[k] = v;
                }
              }
            }
            if (!merged.birthdayPlate && (prev?.birthdayPlate || localBPlate)) {
              merged.birthdayPlate = prev?.birthdayPlate || localBPlate;
              merged.birthday = prev?.birthday || (localBPlate.length === 4 ? `${localBPlate.slice(0, 2)}-${localBPlate.slice(2, 4)}` : undefined);
            }
            try {
              localStorage.setItem('local_user_profile', JSON.stringify(merged));
              if (merged.birthdayPlate) {
                localStorage.setItem('user_birthday_plate', merged.birthdayPlate);
                if (merged.birthdayPlate.length === 4) {
                  localStorage.setItem('user_birthday_month', merged.birthdayPlate.slice(0, 2));
                  localStorage.setItem('user_birthday_day', merged.birthdayPlate.slice(2, 4));
                }
              }
            } catch (e) {}
            // If cloud profile didn't have birthdayPlate, automatically persist it now!
            if (merged.birthdayPlate && (!profile?.birthdayPlate || profile.birthdayPlate !== merged.birthdayPlate)) {
              saveUserProfile({ ...merged, uid: user.uid }).catch(console.warn);
            }
            return merged as UserProfileData;
          });
        } catch (e) {
          console.warn('[Auth] Error fetching user profile:', e);
        }
        // Immediately fetch and sync cloud plates into local storage & UI state
        await loadPlates();

        // Only auto-backup small collections (<= 50) on initial login.
        // For large 10,000-plate collections, users can use "強制同步至雲端" to prevent memory spikes on page refresh
        const currentPlates = await getAllPlates({ fastLocalOnly: true });
        if (currentPlates.length > 0 && currentPlates.length <= 50) {
          syncUserBackupToServer(user.uid, currentPlates).catch(console.warn);
          syncBatchPlatesToCloud(user.uid, currentPlates).catch(console.warn);
        }
      }
    });
    return () => unsubscribe();
  }, [loadPlates]);

  // Force sync all plates to Cloud & Server (safely in chunks with progress reporting)
  const handleForceSyncAllToCloud = useCallback(
    async (onProgress?: (msg: string) => void) => {
      if (plates.length === 0) return { count: 0, isCloud: !!currentUser };
      if (onProgress) onProgress(`準備備份 ${plates.length} 面車牌...`);

      if (currentUser) {
        try {
          if (onProgress) onProgress('正在同步伺服器備份...');
          await syncUserBackupToServer(currentUser.uid, plates);
        } catch (e) {
          console.warn('[Sync] Server backup failed:', e);
        }

        try {
          await syncBatchPlatesToCloud(currentUser.uid, plates, (synced, total) => {
            if (onProgress) onProgress(`雲端資料庫寫入中 (${synced} / ${total})...`);
          });
        } catch (e) {
          console.warn('[Sync] Cloud batch failed:', e);
        }
      }

      try {
        const CHUNK_SIZE = 50;
        for (let i = 0; i < plates.length; i += CHUNK_SIZE) {
          const chunk = plates.slice(i, i + CHUNK_SIZE);
          if (onProgress && !currentUser) {
            onProgress(`本機伺服器保存中 (${Math.min(i + CHUNK_SIZE, plates.length)} / ${plates.length})...`);
          }
          await authFetch('/api/plates/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunk),
          });
          if (plates.length > CHUNK_SIZE) {
            await new Promise((r) => setTimeout(r, 20));
          }
        }
      } catch {}

      return { count: plates.length, isCloud: !!currentUser };
    },
    [currentUser, plates]
  );

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Monitor scroll position to show quick back-to-top floating button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 350);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-sync when user returns to this window or tab (e.g. uploaded from phone), debounced and modal-safe
  useEffect(() => {
    let lastSyncTime = 0;
    const handleFocus = () => {
      if (document.visibilityState === 'hidden') return;
      // Don't reload if an uploader modal is active
      if (isUploaderOpen || isBatchUploaderOpen) return;
      const now = Date.now();
      if (now - lastSyncTime < 5000) return;
      lastSyncTime = now;
      loadPlates();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [loadPlates, isUploaderOpen, isBatchUploaderOpen]);

  // Handle Save from Uploader
  const handleSavePlate = async (record: PlateRecord, options?: { replacePhotoId?: string }) => {
    // Record current unlocked badge IDs to detect new unlocks
    const prevUnlockedIds = new Set(
      badgeData.badges.filter((b) => b.unlocked).map((b) => b.id)
    );

    await savePlate(record, options);
    await loadPlates();
    setUploaderReplacePhotoId(undefined);

    // Calculate new badge status
    const tempMap = new Map(plateMap);
    tempMap.set(record.number, record);
    const newBadgeResult = computeBadges(tempMap, { birthdayPlate: userProfile?.birthdayPlate });
    const newlyUnlocked = newBadgeResult.badges.find(
      (b) => b.unlocked && !prevUnlockedIds.has(b.id)
    );

    if (newlyUnlocked) {
      setNewlyUnlockedBadge(newlyUnlocked);
      try {
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.7 },
          colors: ['#fbbf24', '#f59e0b', '#38bdf8', '#10b981'],
        });
      } catch (e) {}
    }

    // Navigate to the recorded number's thousand block
    const block = parseInt(record.number[0], 10);
    if (!isNaN(block)) {
      setActiveThousandBlock(block);
      setHighlightedNumber(record.number);
      setTimeout(() => setHighlightedNumber(null), 3000);
    }
  };

  // Handle Batch Save from BatchUploader
  const handleSaveBatchPlates = async (records: PlateRecord[]) => {
    if (records.length === 0) return;

    // Record current unlocked badge IDs to detect new unlocks
    const prevUnlockedIds = new Set(
      badgeData.badges.filter((b) => b.unlocked).map((b) => b.id)
    );

    await saveBatchPlates(records);
    await loadPlates();

    // Calculate new badge status
    const tempMap = new Map(plateMap);
    for (const r of records) {
      tempMap.set(r.number, r);
    }
    const newBadgeResult = computeBadges(tempMap, { birthdayPlate: userProfile?.birthdayPlate });
    const newlyUnlocked = newBadgeResult.badges.find(
      (b) => b.unlocked && !prevUnlockedIds.has(b.id)
    );

    if (newlyUnlocked) {
      setNewlyUnlockedBadge(newlyUnlocked);
    }

    try {
      confetti({
        particleCount: Math.min(120, 40 + records.length * 15),
        spread: 80,
        origin: { y: 0.7 },
        colors: ['#fbbf24', '#f59e0b', '#38bdf8', '#10b981', '#a855f7'],
      });
    } catch (e) {}

    // Focus on the first item's block
    const firstNum = records[0].number;
    const block = parseInt(firstNum[0], 10);
    if (!isNaN(block)) {
      setActiveThousandBlock(block);
      setHighlightedNumber(firstNum);
      setTimeout(() => setHighlightedNumber(null), 3500);
    }
  };

  // Handle Delete Entire Number
  const handleDeletePlate = async (number: string) => {
    await deletePlate(number);
    await loadPlates();
    if (selectedRecord?.number === number) {
      setSelectedRecord(null);
      setSelectedPhotoId(undefined);
    }
  };

  // Handle Delete Single Photo
  const handleDeletePlatePhoto = async (number: string, photoId?: string, photoIndex?: number) => {
    const { deletedRecord } = await deletePlatePhoto(number, photoId, photoIndex);
    await loadPlates();
    if (deletedRecord) {
      setSelectedRecord(null);
      setSelectedPhotoId(undefined);
    } else {
      const updated = await getPlate(number);
      setSelectedRecord(updated);
    }
  };

  // Handle Update FullPlate text for a Photo (e.g. user updating "4000" to "ABC-4000")
  const handleUpdatePhotoFullPlate = async (number: string, photoId: string, newFullPlate: string) => {
    const existing = await getPlate(number);
    if (!existing) return;
    const cleanPlate = newFullPlate.trim().toUpperCase() || number;
    const updatedPhotos = (existing.photos || []).map((p) =>
      p.id === photoId ? { ...p, fullPlate: cleanPlate } : p
    );
    const latest = updatedPhotos[updatedPhotos.length - 1];
    const updatedRecord: PlateRecord = {
      ...existing,
      fullPlate: latest?.fullPlate || cleanPlate,
      photos: updatedPhotos,
    };
    await savePlate(updatedRecord, { overwritePhotos: true });
    setSelectedRecord(updatedRecord);
    await loadPlates();
    setSaveSuccessToast({
      message: `車牌字號已成功更新為 ${cleanPlate}！`,
      plateNumber: number,
    });
    setTimeout(() => setSaveSuccessToast(null), 4000);
  };

  // Handle Update Location for a Photo
  const handleUpdatePhotoLocation = async (number: string, photoId: string, newLocation: string) => {
    const existing = await getPlate(number);
    if (!existing) return;
    const updatedPhotos = (existing.photos || []).map((p) =>
      p.id === photoId ? { ...p, locationName: newLocation || undefined } : p
    );
    const latest = updatedPhotos[updatedPhotos.length - 1];
    const updatedRecord: PlateRecord = {
      ...existing,
      locationName: latest?.locationName,
      photos: updatedPhotos,
    };
    await savePlate(updatedRecord, { overwritePhotos: true });
    setSelectedRecord(updatedRecord);
    await loadPlates();
  };

  // Handle Click on Grid Slot
  const handleSelectSlot = async (numStr: string, photoId?: string) => {
    let existing = plateMap.get(numStr);
    const hasPhoto = Boolean(
      (existing?.imageUrl && existing.imageUrl.length > 50) ||
      (existing?.photos && existing.photos.some((p) => p.imageUrl && p.imageUrl.length > 50))
    );
    if (!existing || !hasPhoto) {
      try {
        const full = await getPlate(numStr);
        if (full) {
          existing = full;
          // Synchronize into App state so other components have full image
          setPlates((prev) => {
            const idx = prev.findIndex((p) => p.number === numStr);
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = full;
              return next;
            }
            return [...prev, full];
          });
        }
      } catch {}
    }
    if (existing) {
      const paddedNum = existing.number.padStart(4, '0');
      const realPhotoImg = existing.photos?.find((p) => p.imageUrl && (p.imageUrl.startsWith('data:') || p.imageUrl.length > 50))?.imageUrl;

      const safePhotos = (existing.photos && existing.photos.length > 0)
        ? existing.photos.map((ph) => ({
            ...ph,
            imageUrl:
              (ph.imageUrl && ph.imageUrl.trim()) ||
              (ph.originalImageUrl && ph.originalImageUrl.trim()) ||
              (existing.imageUrl && (existing.imageUrl.startsWith('data:') || existing.imageUrl.length > 50) ? existing.imageUrl.trim() : '') ||
              realPhotoImg ||
              (ph.id ? `/api/plates/${paddedNum}/photos/${encodeURIComponent(ph.id)}/image` : `/api/plates/${paddedNum}/image`),
          }))
        : existing.photos;

      const bestImg =
        (existing.imageUrl && (existing.imageUrl.startsWith('data:') || existing.imageUrl.length > 50) ? existing.imageUrl.trim() : null) ||
        realPhotoImg ||
        safePhotos?.find((p) => p.imageUrl && (p.imageUrl.startsWith('data:') || p.imageUrl.length > 50))?.imageUrl ||
        (existing.originalImageUrl && existing.originalImageUrl.trim()) ||
        safePhotos?.[0]?.imageUrl ||
        `/api/plates/${paddedNum}/image`;

      const safeRecord: PlateRecord = {
        ...existing,
        imageUrl: bestImg,
        photos: safePhotos,
      };

      setSelectedPhotoId(photoId);
      setSelectedRecord(safeRecord);
    }
  };

  // Handle Jump to Number from Search (supports both full license plates & 4-digit numbers)
  const handleJumpToNumber = (rawQuery: string) => {
    const query = rawQuery.trim().toUpperCase();
    if (!query) return;

    // 1. Try exact or partial match across collected full plates
    let matchedPlate: { record: PlateRecord; photoId?: string } | null = null;
    const cleanQuery = query.replace(/[^A-Z0-9]/g, '');

    for (const record of plateMap.values()) {
      const recPlate = (record.fullPlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (recPlate && (recPlate === cleanQuery || recPlate.includes(cleanQuery))) {
        matchedPlate = { record };
        break;
      }
      if (record.photos && record.photos.length > 0) {
        const matchingPhoto = record.photos.find((p) => {
          const pPlate = (p.fullPlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          return pPlate && (pPlate === cleanQuery || pPlate.includes(cleanQuery));
        });
        if (matchingPhoto) {
          matchedPlate = { record, photoId: matchingPhoto.id };
          break;
        }
      }
    }

    if (matchedPlate) {
      const numStr = matchedPlate.record.number;
      const block = parseInt(numStr[0], 10);
      if (!isNaN(block)) {
        setActiveThousandBlock(block);
      }
      setHighlightedNumber(numStr);
      setSelectedPhotoId(matchedPlate.photoId);
      setSelectedRecord(matchedPlate.record);
      setTimeout(() => setHighlightedNumber(null), 4000);
      return;
    }

    // 2. Fallback to 4-digit number extraction
    const numDigits = query.replace(/\D/g, '');
    if (numDigits.length > 0) {
      const formatted = numDigits.padStart(4, '0').slice(-4);
      const block = parseInt(formatted[0], 10);
      if (!isNaN(block)) {
        setActiveThousandBlock(block);
        setHighlightedNumber(formatted);
        const existing = plateMap.get(formatted);
        if (existing) {
          setSelectedPhotoId(undefined);
          setSelectedRecord(existing);
        }
        setTimeout(() => setHighlightedNumber(null), 4000);
      }
    } else {
      setSaveSuccessToast({
        message: `未找到符合「${rawQuery}」的已收錄車牌`,
      });
      setTimeout(() => setSaveSuccessToast(null), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Sticky Header */}
      <Header
        totalCollected={plates.length}
        unlockedBadgeCount={badgeData.unlockedCount}
        totalBadgeCount={badgeData.totalCount}
        currentTheme={theme}
        userProfile={userProfile}
        currentUser={currentUser}
        onSelectTheme={handleSelectTheme}
        onOpenUpload={(num) => {
          setUploaderTargetNumber(num);
          setIsUploaderOpen(true);
        }}
        onOpenBatchUpload={() => setIsBatchUploaderOpen(true)}
        onOpenStats={(tab = 'badges') => {
          setStatsInitialTab(tab);
          setIsStatsOpen(true);
        }}
        onOpenBackup={() => setIsBackupOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onJumpToNumber={handleJumpToNumber}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-6 space-y-3 sm:space-y-6">
        {/* 0000-9999 Grid Explorer */}
        <CollectionGrid
          plateMap={plateMap}
          activeThousandBlock={activeThousandBlock}
          onChangeThousandBlock={handleChangeThousandBlock}
          onSelectSlot={handleSelectSlot}
          highlightNumber={highlightedNumber}
        />
      </main>

      {/* Floating Badge Unlock Celebration Toast */}
      {newlyUnlockedBadge && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className="bg-slate-900 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl flex items-center gap-3.5 max-w-sm">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-400/40 flex items-center justify-center shrink-0">
              <Award className="w-6 h-6 animate-bounce" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 font-mono">
                  NEW BADGE UNLOCKED!
                </span>
              </div>
              <h4 className="text-sm font-bold text-white truncate">
                {newlyUnlockedBadge.title}
              </h4>
              {newlyUnlockedBadge.tagline ? (
                <p className="text-xs text-slate-400 truncate">
                  {newlyUnlockedBadge.tagline}
                </p>
              ) : null}
              <button
                onClick={() => {
                  setNewlyUnlockedBadge(null);
                  setStatsInitialTab('badges');
                  setIsStatsOpen(true);
                }}
                className="mt-1 text-[11px] text-amber-300 hover:text-amber-200 font-semibold flex items-center gap-1"
              >
                <span>前往徽章展櫃查看</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <button
              onClick={() => setNewlyUnlockedBadge(null)}
              className="p-1 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}


      {/* Floating Back to Top Button (appears when user scrolls down past 350px) */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          title="快速回到頁面最頂端"
          aria-label="回到最上面"
          className="fixed bottom-6 right-6 z-40 p-3 rounded-full bg-amber-400 text-slate-950 font-bold shadow-xl shadow-amber-500/30 hover:bg-amber-300 hover:scale-110 active:scale-95 transition-all duration-200 border border-amber-300 flex items-center justify-center animate-in fade-in slide-in-from-bottom-3"
        >
          <ArrowUp className="w-5 h-5 stroke-[3]" />
        </button>
      )}

      {/* Modals */}
      <UploaderModal
        isOpen={isUploaderOpen}
        onClose={() => {
          setIsUploaderOpen(false);
          setUploaderReplacePhotoId(undefined);
        }}
        onSave={handleSavePlate}
        existingPlateMap={plateMap}
        initialTargetNumber={uploaderTargetNumber}
        replacePhotoId={uploaderReplacePhotoId}
        onSwitchToBatch={(files?: File[]) => {
          setIsUploaderOpen(false);
          setUploaderReplacePhotoId(undefined);
          if (files && files.length > 0) {
            setBatchInitialFiles(files);
          } else {
            setBatchInitialFiles([]);
          }
          setIsBatchUploaderOpen(true);
        }}
      />

      <BatchUploaderModal
        isOpen={isBatchUploaderOpen}
        onClose={() => {
          setIsBatchUploaderOpen(false);
          setBatchInitialFiles([]);
        }}
        onSaveBatch={handleSaveBatchPlates}
        existingPlateMap={plateMap}
        initialFiles={batchInitialFiles}
      />

      <PlateDetailModal
        record={selectedRecord}
        initialPhotoId={selectedPhotoId}
        onClose={() => {
          setSelectedRecord(null);
          setSelectedPhotoId(undefined);
        }}
        onReplace={(num, photoId) => {
          setUploaderTargetNumber(num);
          setUploaderReplacePhotoId(photoId);
          setIsUploaderOpen(true);
        }}
        onAddPhoto={(num) => {
          setUploaderTargetNumber(num);
          setUploaderReplacePhotoId(undefined);
          setIsUploaderOpen(true);
        }}
        onDelete={handleDeletePlate}
        onDeletePhoto={handleDeletePlatePhoto}
        onUpdateLocation={handleUpdatePhotoLocation}
        onUpdateFullPlate={handleUpdatePhotoFullPlate}
      />

      <ErrorBoundary fallbackTitle="典藏櫃載入異常">
        <StatsDashboard
          isOpen={isStatsOpen}
          onClose={() => setIsStatsOpen(false)}
          plateMap={plateMap}
          onSelectPlate={handleSelectSlot}
          initialTab={statsInitialTab}
          birthdayPlate={userProfile?.birthdayPlate}
        />
      </ErrorBoundary>

      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        plateList={plates}
        currentUser={currentUser}
        onReload={loadPlates}
      />

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentUser={currentUser}
        userProfile={userProfile}
        onUpdateProfile={(updated) => {
          setUserProfile(updated);
          localStorage.setItem('local_user_profile', JSON.stringify(updated));
        }}
        plateMap={plateMap}
        plateList={plates}
        onReload={loadPlates}
        onForceSyncAllToCloud={handleForceSyncAllToCloud}
        onRestoreFromCloud={loadPlates}
      />

      {/* Gemini Debug Button */}
      <button
        className="fixed bottom-4 right-4 z-[200] bg-yellow-500 text-black text-sm font-bold px-3 py-2 rounded-lg shadow-lg"
        onClick={async () => {
          const result = await testGeminiConnection();
          alert(result);
        }}
      >
        測試 API
      </button>

      {/* Real-time Save Confirmation Toast */}
      {saveSuccessToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[92%] sm:w-auto bg-slate-900/95 border border-emerald-500/50 shadow-2xl rounded-2xl p-3 flex items-center justify-between gap-3 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 stroke-[3]" />
            </div>
            <div className="text-xs">
              <p className="font-bold text-slate-100">{saveSuccessToast.message}</p>
              <p className="text-[11px] text-emerald-400 font-medium">已安全備份至本機與雲端資料庫</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {saveSuccessToast.plateNumber && (
              <button
                type="button"
                onClick={() => {
                  handleJumpToNumber(saveSuccessToast.plateNumber!);
                  setSaveSuccessToast(null);
                }}
                className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition"
              >
                查看 #{saveSuccessToast.plateNumber}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSaveSuccessToast(null)}
              className="p-1 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
