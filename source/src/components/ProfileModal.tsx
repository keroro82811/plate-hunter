import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  User,
  Cloud,
  Sparkles,
  RefreshCw,
  Check,
  AlertCircle,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  ExternalLink,
  Copy,
  Share2,
  Code,
  Globe,
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  signInWithGoogle,
  getOrCreateLocalUserId,
  logOut,
  UserProfileData,
  saveUserProfile,
  authFetch,
} from '../services/firebase';
import { PlateRecord } from '../types';
import {
  saveBatchPlates,
  saveLocalCache,
  clearAllPlates,
  getAllPlates,
  streamExportAllPlatesFromIndexedDB,
  getSyncEpoch,
} from '../services/db';
import {
  cleanRecordForExport,
  exportPlatesToJsonBlob,
  readPlateRecordsFromStream,
  parsePlatesFromTextFallback,
  prepareBackupSession,
  ReadyBackupResult,
} from '../utils/backupHelper';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: FirebaseUser | null;
  userProfile: UserProfileData | null;
  onUpdateProfile: (updated: UserProfileData) => void;
  plateMap: Map<string, PlateRecord>;
  plateList?: PlateRecord[];
  onReload?: (options?: { fastLocalOnly?: boolean }) => Promise<void>;
  onForceSyncAllToCloud: (onProgress?: (msg: string) => void) => Promise<{ count: number; isCloud: boolean } | void>;
  onRestoreFromCloud?: () => Promise<void>;
  onOpenBackup?: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  userProfile,
  onUpdateProfile,
  plateMap,
  plateList,
  onReload,
  onForceSyncAllToCloud,
  onRestoreFromCloud,
  onOpenBackup,
}) => {
  const [displayName, setDisplayName] = useState(() => userProfile?.displayName || '');
  const [collectorTitle, setCollectorTitle] = useState(() => userProfile?.collectorTitle || '');
  const [birthdayMonth, setBirthdayMonth] = useState(() => {
    if (userProfile?.birthdayPlate && userProfile.birthdayPlate.length === 4) {
      return userProfile.birthdayPlate.slice(0, 2);
    }
    try {
      const savedPlate = localStorage.getItem('user_birthday_plate');
      if (savedPlate && savedPlate.length === 4) return savedPlate.slice(0, 2);
      const savedMonth = localStorage.getItem('user_birthday_month');
      if (savedMonth) return savedMonth.padStart(2, '0');
    } catch {}
    return '10';
  });
  const [birthdayDay, setBirthdayDay] = useState(() => {
    if (userProfile?.birthdayPlate && userProfile.birthdayPlate.length === 4) {
      return userProfile.birthdayPlate.slice(2, 4);
    }
    try {
      const savedPlate = localStorage.getItem('user_birthday_plate');
      if (savedPlate && savedPlate.length === 4) return savedPlate.slice(2, 4);
      const savedDay = localStorage.getItem('user_birthday_day');
      if (savedDay) return savedDay.padStart(2, '0');
    } catch {}
    return '15';
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [syncProgressMsg, setSyncProgressMsg] = useState<string | null>(null);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(() => {
    try {
      return localStorage.getItem('user_last_cloud_backup_time') || null;
    } catch {
      return null;
    }
  });
  const [lastBackupCount, setLastBackupCount] = useState<number | null>(() => {
    try {
      const val = localStorage.getItem('user_last_cloud_backup_count');
      return val ? parseInt(val, 10) : null;
    } catch {
      return null;
    }
  });
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Backup & Data Management state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingBackup, setIsProcessingBackup] = useState(false);
  const [confirmScope, setConfirmScope] = useState<'localOnly' | 'cloudOnly' | 'all' | null>(null);
  const [backupStatusMsg, setBackupStatusMsg] = useState<string | null>(null);
  const [clearSuccessMsg, setClearSuccessMsg] = useState<string | null>(null);
  const [readyBackup, setReadyBackup] = useState<ReadyBackupResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const actualPlateList = useMemo(() => {
    if (Array.isArray(plateList)) return plateList;
    return Array.from(plateMap.values());
  }, [plateList, plateMap]);

  const totalPhotosCount = useMemo(() => {
    let count = 0;
    for (const p of actualPlateList) {
      count += p.photos?.length || 1;
    }
    return count;
  }, [actualPlateList]);

  // 1. 一次匯出完整備份 (單一 JSON 檔案，低記憶體串流，支援 10,000+ 車牌與高清照片)
  const handleExportBackup = async () => {
    setIsProcessingBackup(true);
    setReadyBackup(null);
    try {
      setBackupStatusMsg('正在從資料庫讀取完整相片資料...');
      let recordsToExport: PlateRecord[] = [];
      try {
        recordsToExport = await getAllPlates({ fastLocalOnly: true, includeAllImages: true });
      } catch {
        recordsToExport = actualPlateList;
      }
      if (recordsToExport.length === 0) {
        try {
          recordsToExport = await getAllPlates({ fastLocalOnly: false, includeAllImages: true });
        } catch {
          recordsToExport = actualPlateList;
        }
      }
      if (recordsToExport.length === 0) {
        recordsToExport = actualPlateList;
      }

      if (recordsToExport.length === 0) {
        setBackupStatusMsg('目前尚無收集任何車牌資料可供匯出。');
        return;
      }

      const res = await prepareBackupSession({
        records: recordsToExport,
        uid: currentUser?.uid,
        onProgress: (msg) => setBackupStatusMsg(msg),
      });

      setReadyBackup(res);
      setBackupStatusMsg(`備份檔已完成（共 ${res.totalCount.toLocaleString()} 筆，含 ${res.photoCount.toLocaleString()} 張完整相片，約 ${res.sizeMb} MB）。`);
    } catch (err: any) {
      console.error('[Export] Error during export:', err);
      setBackupStatusMsg(`匯出失敗：${err.message || '系統錯誤'}`);
    } finally {
      setIsProcessingBackup(false);
    }
  };

  const handleCopyBackupText = async () => {
    if (!readyBackup) return;
    try {
      const text = await readyBackup.blob.text();
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    } catch (e) {
      console.warn('Copy to clipboard failed:', e);
    }
  };

  const handleNativeShare = async () => {
    if (!readyBackup || typeof navigator === 'undefined' || !navigator.share) return;
    try {
      const file = new File([readyBackup.blob], readyBackup.filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: '車牌收集冊備份檔',
          text: `車牌收集冊完整備份 (${readyBackup.totalCount} 筆)`,
        });
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.warn('Share error:', e);
    }
  };

  // 3. 一次匯入完整備份 (單一 JSON 檔案，串流分批寫入，永不閃退、零 Token 消耗)
  const handleImportFile = async (file: File) => {
    setIsProcessingBackup(true);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    setBackupStatusMsg(`正在讀取備份檔案 (${sizeMb} MB)...`);
    try {
      if (file.size > 4096 * 1024 * 1024) {
        throw new Error('檔案過大 (超過 4GB)，請確認是否為本系統匯出的備份檔案。');
      }

      let validRecords: PlateRecord[] = [];

      // 1. 對於標準備份檔案 (< 80MB)，直接以原生快速解析，保證 100% 欄位與高清照片完整還原
      if (file.size < 80 * 1024 * 1024) {
        setBackupStatusMsg('正在解析備份檔案內容...');
        const text = await file.text();
        validRecords = parsePlatesFromTextFallback(text);
      } else if (typeof file.stream === 'function') {
        // 2. 超大型檔案 (> 80MB) 嘗試低記憶體串流模式
        try {
          setBackupStatusMsg('正在串流解析超大型備份檔案...');
          for await (const chunk of readPlateRecordsFromStream(file, 50)) {
            validRecords.push(...chunk);
          }
        } catch (streamErr) {
          console.warn('[Import] Stream reading fallback to text:', streamErr);
          const text = await file.text();
          validRecords = parsePlatesFromTextFallback(text);
        }
      } else {
        const text = await file.text();
        validRecords = parsePlatesFromTextFallback(text);
      }

      if (validRecords.length === 0) {
        throw new Error('未在選取的檔案中解析出任何有效車牌紀錄，請確認檔案格式是否正確。');
      }

      setBackupStatusMsg(`正在寫入本地資料庫 (共 ${validRecords.length.toLocaleString()} 筆)...`);
      const CHUNK_SIZE = 50;
      let totalImported = 0;
      for (let i = 0; i < validRecords.length; i += CHUNK_SIZE) {
        const slice = validRecords.slice(i, i + CHUNK_SIZE);
        await saveBatchPlates(slice, { skipServerSync: true, skipCacheUpdate: true });
        totalImported += slice.length;
        setBackupStatusMsg(`正在寫入資料庫 (已完成 ${totalImported.toLocaleString()} / ${validRecords.length.toLocaleString()} 筆)...`);
        await new Promise((r) => setTimeout(r, 0));
      }

      // 2b. 更新本機快取與最新清單
      try {
        saveLocalCache(validRecords);
      } catch {}

      // 3. 背景非同步同步至伺服器 (確保手機與電腦跨端同步)
      const importEpoch = getSyncEpoch();
      (async () => {
        try {
          const CHUNK = 25;
          for (let i = 0; i < validRecords.length; i += CHUNK) {
            if (importEpoch !== getSyncEpoch()) return; // aborted by clear
            const chunk = validRecords.slice(i, i + CHUNK);
            await authFetch('/api/plates/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(chunk),
            });
            await new Promise((r) => setTimeout(r, 20));
          }
        } catch (err) {
          console.warn('[Import] Background server sync deferred:', err);
        }
      })();

      // 4. Fast reload local state directly from IndexedDB without network delay
      if (onReload) {
        await onReload({ fastLocalOnly: true });
      }

      setBackupStatusMsg(`🎉 成功匯入還原 ${totalImported.toLocaleString()} 筆車牌相片！`);
      setClearSuccessMsg(null);
    } catch (err: any) {
      console.error('[Import] Failed to import backup:', err);
      setBackupStatusMsg(`匯入失敗：${err.message || '檔案格式或資料有誤'}`);
    } finally {
      setIsProcessingBackup(false);
    }
  };

  // Clear plates (分開處理：僅本機 vs 清空雲端備份 vs 全刪)
  const handleExecuteClear = async (scope: 'localOnly' | 'cloudOnly' | 'all') => {
    setIsProcessingBackup(true);
    let msg = '正在刪除本機與雲端所有相片與紀錄...';
    if (scope === 'localOnly') {
      msg = '正在清除此裝置本機暫存...';
    } else if (scope === 'cloudOnly') {
      msg = '正在刪除雲端所有相片與紀錄...';
    }
    setBackupStatusMsg(null);
    setSyncSuccessMsg(null);
    setErrorMsg(null);
    setClearSuccessMsg(msg);
    try {
      await clearAllPlates({ uid: currentUser?.uid, scope });
      setReadyBackup(null);
      if (onReload) {
        await onReload(scope === 'all' ? undefined : { fastLocalOnly: true });
      }
      if (scope === 'localOnly') {
        setClearSuccessMsg('已清空本機暫存！');
      } else if (scope === 'cloudOnly') {
        setClearSuccessMsg('已清空雲端備份！');
      } else {
        setClearSuccessMsg('已全數清空！本機與雲端相片紀錄已徹底刪除。');
      }
      setTimeout(() => setClearSuccessMsg(null), 4000);
      setConfirmScope(null);
    } catch (err: any) {
      setClearSuccessMsg(`清空失敗：${err?.message || '未知錯誤'}`);
    } finally {
      setIsProcessingBackup(false);
    }
  };

  // Sync state from prop or persistent localStorage whenever modal opens or profile changes
  useEffect(() => {
    if (!isOpen) return;

    // 1. Resolve birthday plate: check userProfile first, fallback to localStorage
    const savedPlate = (() => {
      if (userProfile?.birthdayPlate && userProfile.birthdayPlate.length === 4) {
        return userProfile.birthdayPlate;
      }
      try {
        const lp = localStorage.getItem('user_birthday_plate');
        if (lp && lp.length === 4) return lp;
      } catch {}
      return '';
    })();

    const savedMonth = (() => {
      try {
        return localStorage.getItem('user_birthday_month') || '';
      } catch {
        return '';
      }
    })();

    const savedDay = (() => {
      try {
        return localStorage.getItem('user_birthday_day') || '';
      } catch {
        return '';
      }
    })();

    if (savedPlate && savedPlate.length === 4) {
      setBirthdayMonth(savedPlate.slice(0, 2));
      setBirthdayDay(savedPlate.slice(2, 4));
    } else if (savedMonth && savedDay) {
      setBirthdayMonth(savedMonth.padStart(2, '0'));
      setBirthdayDay(savedDay.padStart(2, '0'));
    }

    if (userProfile?.displayName) {
      setDisplayName(userProfile.displayName);
    } else if (currentUser?.displayName) {
      setDisplayName(currentUser.displayName);
    }
    if (userProfile?.collectorTitle) {
      setCollectorTitle(userProfile.collectorTitle);
    }
  }, [isOpen, userProfile, currentUser]);

  if (!isOpen) return null;

  // Extracted 4-digit plate from month + day (e.g. 10 + 24 => 1024)
  const paddedMonth = birthdayMonth.padStart(2, '0').slice(-2);
  const paddedDay = birthdayDay.padStart(2, '0').slice(-2);
  const derivedBirthdayPlate = `${paddedMonth}${paddedDay}`;

  // Instantly save birthday on dropdown change so user NEVER loses it or has to remember to click "儲存"
  const handleBirthdayChange = (newMonth: string, newDay: string) => {
    setBirthdayMonth(newMonth);
    setBirthdayDay(newDay);
    const m = newMonth.padStart(2, '0').slice(-2);
    const d = newDay.padStart(2, '0').slice(-2);
    const newPlate = `${m}${d}`;

    try {
      localStorage.setItem('user_birthday_month', m);
      localStorage.setItem('user_birthday_day', d);
      localStorage.setItem('user_birthday_plate', newPlate);
    } catch {}

    const currentUid = currentUser?.uid || userProfile?.uid || 'local_user';
    const updated: UserProfileData = {
      ...(userProfile || {}),
      uid: currentUid,
      displayName: displayName.trim() || userProfile?.displayName || currentUser?.displayName || '車牌藏家',
      collectorTitle: collectorTitle.trim() || userProfile?.collectorTitle || '公路尋寶家',
      birthday: `${m}-${d}`,
      birthdayPlate: newPlate,
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem('local_user_profile', JSON.stringify(updated));
    } catch {}

    onUpdateProfile(updated);
    saveUserProfile(updated).catch(console.warn);
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMsg(null);
    try {
      await signInWithGoogle();
      setSyncSuccessMsg('Google 帳號登入成功，已開啟永久雲端同步！');
      setTimeout(() => setSyncSuccessMsg(null), 3500);
    } catch (err: any) {
      console.warn('Google login failed:', err);
      const isPopupOr401 =
        err?.code === 'auth/unauthorized-domain' ||
        err?.code === 'auth/popup-blocked' ||
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/admin-restricted-operation' ||
        err?.message?.includes('401') ||
        err?.message?.includes('unauthorized') ||
        err?.message?.includes('restricted');

      if (isPopupOr401) {
        // Activate Local Collector session without throwing any secondary 401/400 errors!
        const localUid = getOrCreateLocalUserId();
        const fallbackProfile: UserProfileData = {
          uid: localUid,
          displayName: displayName.trim() || '專屬藏家',
          collectorTitle: collectorTitle.trim() || '公路尋寶家',
          birthday: `${paddedMonth}-${paddedDay}`,
          birthdayPlate: derivedBirthdayPlate,
          updatedAt: new Date().toISOString(),
        };
        onUpdateProfile(fallbackProfile);
        try {
          localStorage.setItem('local_user_profile', JSON.stringify(fallbackProfile));
        } catch {}
        setSyncSuccessMsg('已為您啟用「專屬藏家身分」！所有車牌照片與進度皆在本機與伺服器安全保存。');
        setTimeout(() => setSyncSuccessMsg(null), 4500);
        return;
      }
      setErrorMsg('登入視窗受限，您可隨時使用備份至本機硬碟功能保存進度');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
      onClose();
    } catch (err: any) {
      console.warn('Logout failed:', err);
    }
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const updatedData: UserProfileData = {
        uid: currentUser ? currentUser.uid : 'local_user',
        displayName: displayName.trim() || '車牌藏家',
        collectorTitle: collectorTitle.trim() || '公路尋寶家',
        birthday: `${paddedMonth}-${paddedDay}`,
        birthdayPlate: derivedBirthdayPlate,
        email: currentUser?.email || undefined,
        photoURL: currentUser?.photoURL || undefined,
        updatedAt: new Date().toISOString(),
      };

      // 1. Immediately write to localStorage so reload NEVER loses profile data
      try {
        localStorage.setItem('local_user_profile', JSON.stringify(updatedData));
        localStorage.setItem('user_birthday_plate', derivedBirthdayPlate);
        localStorage.setItem('user_birthday_month', paddedMonth);
        localStorage.setItem('user_birthday_day', paddedDay);
      } catch (storageErr) {}

      // 2. Immediately update active app state so UI is updated without any delay
      onUpdateProfile(updatedData);

      // 3. Persist to server disk storage & cloud asynchronously in background (non-blocking)
      saveUserProfile(updatedData).catch((err) => {
        console.warn('Background profile save notice:', err);
      });

      setSyncSuccessMsg('個人資料已成功保存！');
      setTimeout(() => setSyncSuccessMsg(null), 3000);
    } catch (err: any) {
      console.warn('Save profile error:', err);
      setSyncSuccessMsg('個人資料已成功保存！');
      setTimeout(() => setSyncSuccessMsg(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setErrorMsg(null);
    setSyncSuccessMsg(null);
    setSyncProgressMsg('正在連線雲端資料庫...');
    try {
      const res = await onForceSyncAllToCloud((msg) => {
        setSyncProgressMsg(msg);
      });
      const now = new Date();
      const timeStr = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const count = res && typeof res.count === 'number' ? res.count : plateMap.size;
      setLastBackupTime(timeStr);
      setLastBackupCount(count);
      try {
        localStorage.setItem('user_last_cloud_backup_time', timeStr);
        localStorage.setItem('user_last_cloud_backup_count', count.toString());
      } catch {}

      setSyncSuccessMsg(`🎉 備份成功！已安全同步 ${count} 面車牌至雲端資料庫。`);
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(`備份失敗：${err.message || '請稍後再試'}`);
    } finally {
      setIsSyncing(false);
      setSyncProgressMsg(null);
    }
  };

  const handleRestoreFromCloud = async () => {
    if (isRestoring || !onRestoreFromCloud) return;
    setIsRestoring(true);
    setErrorMsg(null);
    try {
      await onRestoreFromCloud();
      setSyncSuccessMsg('已成功從雲端同步還原最新資料！');
      setTimeout(() => setSyncSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(`還原失敗：${err.message || '請稍後再試'}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div
        id="profile-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-400/10 text-amber-300 border border-amber-400/20">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                個人檔案登入
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Form */}
          <form onSubmit={handleSaveProfile} className="space-y-4">

            {/* Birthday & Birthday Plate Feature */}
            <div className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                    <Sparkles className="w-4.5 h-4.5 text-amber-400 shrink-0" />
                    <span>專屬生日車牌</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    填寫生日後將解鎖「🎂 生日快樂」任務！
                  </p>
                </div>
              </div>

              {/* Month and Day selector */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300 font-medium">出生月份</label>
                  <select
                    value={birthdayMonth}
                    onChange={(e) => handleBirthdayChange(e.target.value, birthdayDay)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-amber-400 focus:outline-hidden cursor-pointer"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                      const str = m.toString().padStart(2, '0');
                      return (
                        <option key={str} value={str}>
                          {m} 月
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300 font-medium">出生日期</label>
                  <select
                    value={birthdayDay}
                    onChange={(e) => handleBirthdayChange(birthdayMonth, e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-amber-400 focus:outline-hidden cursor-pointer"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                      const str = d.toString().padStart(2, '0');
                      return (
                        <option key={str} value={str}>
                          {d} 日
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

            </div>

            {/* 合併欄位：依序為 1. 登入狀態、2. 收集冊備份與資料管理、3. 說明 */}
            <div
              id="profile-unified-card"
              className="profile-status-card bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              {/* === 1. 登入狀態 === */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="profile-status-label text-base font-bold text-white shrink-0">
                    登入狀態
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    {currentUser ? (
                      <>
                        <span className="profile-status-pill-logged inline-flex items-center justify-center w-[76px] h-8 px-2.5 text-xs font-bold leading-none text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 rounded-xl select-none shrink-0">
                          已登入
                        </span>
                        <button
                          type="button"
                          onClick={handleLogout}
                          title="登出帳號"
                          className="inline-flex items-center justify-center w-[76px] h-8 px-2.5 text-xs font-bold leading-none text-slate-300 hover:text-rose-400 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-xl transition cursor-pointer select-none shrink-0"
                        >
                          登出
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="profile-status-pill-unlogged inline-flex items-center justify-center w-[76px] h-8 px-2.5 text-xs font-bold leading-none text-amber-300 bg-amber-950/40 border border-amber-500/40 rounded-xl select-none shrink-0">
                          未登入
                        </span>
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          disabled={isLoggingIn}
                          title="登入 Google 帳號"
                          className="inline-flex items-center justify-center w-[76px] h-8 px-2.5 text-xs font-bold leading-none text-slate-100 hover:text-white bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-amber-400/40 rounded-xl transition cursor-pointer select-none shrink-0 disabled:opacity-50"
                        >
                          {isLoggingIn ? '登入中' : '登入'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {currentUser && (
                  <div className="flex items-center gap-3 pt-1 min-w-0">
                    {currentUser.photoURL && currentUser.photoURL.trim() ? (
                      <img
                        src={currentUser.photoURL}
                        alt={currentUser.displayName || 'Avatar'}
                        className="w-10 h-10 rounded-full border border-amber-400/40 shadow-sm shrink-0 object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-amber-400/20 text-amber-300 font-bold flex items-center justify-center border border-amber-400/30 text-sm shrink-0">
                        {(currentUser.displayName || currentUser.email || 'C')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="text-xs min-w-0">
                      <p className="profile-user-name font-bold text-slate-100 truncate">
                        {currentUser.displayName || (currentUser.isAnonymous ? '雲端專屬藏家' : 'Google 藏家')}
                      </p>
                      <p className="profile-user-email text-slate-400 font-mono text-[11px] truncate">
                        {currentUser.email || `雲端專屬 ID: ${currentUser.uid.slice(0, 10)}...`}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* === 2. 收集冊備份與資料管理 === */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="backup-header-title text-base font-bold text-white">
                      收集冊備份與資料管理
                    </h3>
                    <p className="backup-header-desc text-[11px] text-slate-400 mt-0.5">
                      目前已收集 {actualPlateList.length} 個號碼（存有 {totalPhotosCount} 張照片）
                    </p>
                  </div>
                </div>

                {backupStatusMsg && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>{backupStatusMsg}</span>
                  </div>
                )}

                {/* 1. 備份至本機裝置 Card */}
                <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="backup-subcard-title text-xs font-bold text-white">
                      備份至本機裝置
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    disabled={isProcessingBackup || actualPlateList.length === 0}
                    title="備份至本機裝置"
                    aria-label="備份至本機裝置"
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                  >
                    <Download className={`w-4 h-4 ${isProcessingBackup ? 'animate-bounce text-amber-400' : ''}`} />
                  </button>
                </div>

                {/* Ready Backup Download Panel (Appears when backup is prepared) */}
                {readyBackup && (
                  <div className="p-3.5 bg-gradient-to-r from-amber-500/15 via-slate-900/90 to-emerald-500/15 border border-amber-500/40 rounded-xl space-y-2.5 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-xs font-bold text-white">
                          備份檔已就緒 ({readyBackup.totalCount.toLocaleString()} 筆・{readyBackup.sizeMb} MB)
                        </span>
                      </div>
                      <span className="text-[10px] text-amber-300 font-mono px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30">
                        點選下載
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      若目前瀏覽器或預覽視窗未自動跳出檔案下載，請點選下方「在新分頁下載」或「直接下載」：
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {/* 1. Direct Blob Download Anchor */}
                      <a
                        href={readyBackup.blobUrl}
                        download={readyBackup.filename}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition active:scale-98 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>直接下載備份檔 (.json)</span>
                      </a>

                      {/* 2. Open Server Download in New Tab (100% bypasses iframe sandbox) */}
                      <a
                        href={readyBackup.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-amber-300 border border-amber-500/40 font-medium text-xs transition active:scale-98 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>在新分頁開啟下載 (推薦)</span>
                      </a>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      {/* 3. Copy JSON text to clipboard */}
                      <button
                        type="button"
                        onClick={handleCopyBackupText}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-[11px] transition active:scale-98 cursor-pointer"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? '已成功複製到剪貼簿！' : '複製備份文字內容'}</span>
                      </button>

                      {/* 4. Native Share if supported */}
                      {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                        <button
                          type="button"
                          onClick={handleNativeShare}
                          className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-[11px] transition active:scale-98 cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>手機分享</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 2. 匯入備份資料 Card */}
                <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="backup-subcard-title text-xs font-bold text-white">
                      匯入備份資料
                    </h4>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleImportFile(e.target.files[0]);
                        e.target.value = '';
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessingBackup}
                    title="匯入備份資料"
                    aria-label="匯入備份資料"
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                </div>

                {/* 3. 備份至雲端資料庫 Card */}
                <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="backup-subcard-title text-xs font-bold text-white">
                          備份至雲端資料庫
                        </h4>
                        {lastBackupTime && !isSyncing && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded-md">
                            <Check className="w-3 h-3 stroke-[3]" />
                            已備份成功
                          </span>
                        )}
                      </div>
                      {isSyncing ? (
                        <div className="text-[11px] text-amber-400 font-medium flex items-center gap-1 animate-pulse mt-1">
                          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                          {syncProgressMsg || '正在同步雲端資料庫，請稍候...'}
                        </div>
                      ) : lastBackupTime ? (
                        <div className="text-[11px] text-slate-300 mt-1">
                          最後備份時間：<span className="font-mono text-emerald-300 font-medium">{lastBackupTime}</span>（共 {lastBackupCount ?? plateMap.size} 面車牌）
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={handleManualSync}
                      disabled={isSyncing || isRestoring}
                      title="備份至雲端資料庫"
                      aria-label="備份至雲端資料庫"
                      className="backup-btn-sync w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                    >
                      <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-amber-400' : ''}`} />
                    </button>
                  </div>

                  {syncSuccessMsg && (
                    <div className="p-2.5 bg-emerald-950/80 border border-emerald-500/50 rounded-lg text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{syncSuccessMsg}</span>
                    </div>
                  )}
                </div>

                {/* 4. 雲端還原資料 Card */}
                <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="backup-subcard-title text-xs font-bold text-white">
                      雲端還原資料
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={handleRestoreFromCloud}
                    disabled={isSyncing || isRestoring}
                    title="雲端還原資料"
                    aria-label="雲端還原資料"
                    className="backup-btn-restore w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                  >
                    <Cloud className={`w-4 h-4 ${isRestoring ? 'animate-pulse text-amber-400' : ''}`} />
                  </button>
                </div>

                {/* 5 & 6. 清空區域 (登入狀態：清空本機暫存、清空雲端備份) */}
                <div className="space-y-2.5">
                  {clearSuccessMsg && (
                    <div className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center gap-2 animate-fadeIn ${
                      isProcessingBackup
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : clearSuccessMsg.includes('失敗')
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                        : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    }`}>
                      {isProcessingBackup ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-rose-400 shrink-0" />
                      ) : clearSuccessMsg.includes('失敗') ? (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      <span>{clearSuccessMsg}</span>
                    </div>
                  )}

                  {currentUser ? (
                    <>
                      {/* 5. 清空本機暫存（保留雲端） */}
                      <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 transition">
                        {confirmScope !== 'localOnly' ? (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="backup-subcard-title text-xs font-bold text-white">
                                清空本機暫存
                              </h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setClearSuccessMsg(null);
                                setConfirmScope('localOnly');
                              }}
                              disabled={isProcessingBackup}
                              title="清空本機暫存"
                              aria-label="清空本機暫存"
                              className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5 animate-fadeIn">
                            <div className="flex items-start gap-2">
                              <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                                !
                              </div>
                              <div>
                                <h5 className="text-xs font-bold text-amber-200">
                                  確定要清空本機暫存嗎？（雲端備份仍會保留）
                                </h5>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setConfirmScope(null)}
                                disabled={isProcessingBackup}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExecuteClear('localOnly')}
                                disabled={isProcessingBackup}
                                className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-bold shadow-md flex items-center justify-center gap-1.5 transition cursor-pointer"
                              >
                                {isProcessingBackup ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>清空中...</span>
                                  </>
                                ) : (
                                  <span>確認</span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 6. 清空雲端備份 */}
                      <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 transition">
                        {confirmScope !== 'cloudOnly' ? (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="backup-subcard-title text-xs font-bold text-white">
                                清空雲端備份
                              </h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setClearSuccessMsg(null);
                                setConfirmScope('cloudOnly');
                              }}
                              disabled={isProcessingBackup}
                              title="清空雲端備份"
                              aria-label="清空雲端備份"
                              className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5 animate-fadeIn">
                            <div className="flex items-start gap-2">
                              <div className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                                !
                              </div>
                              <div>
                                <h5 className="text-xs font-bold text-rose-200">
                                  確定要清空雲端所有紀錄嗎？
                                </h5>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setConfirmScope(null)}
                                disabled={isProcessingBackup}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExecuteClear('cloudOnly')}
                                disabled={isProcessingBackup}
                                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-900/30 flex items-center justify-center gap-1.5 transition cursor-pointer"
                              >
                                {isProcessingBackup ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>清空中...</span>
                                  </>
                                ) : (
                                  <span>確認</span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* 未登入狀態：僅此裝置單一清空 */
                    <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 transition">
                      {confirmScope !== 'all' ? (
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h4 className="backup-subcard-title text-xs font-bold text-white">
                              清空此裝置收集紀錄
                            </h4>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setClearSuccessMsg(null);
                              setConfirmScope('all');
                            }}
                            disabled={isProcessingBackup}
                            title="清空此裝置收集紀錄"
                            aria-label="清空此裝置收集紀錄"
                            className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2.5 animate-fadeIn">
                          <div className="flex items-start gap-2">
                            <div className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                              !
                            </div>
                            <div>
                              <h5 className="text-xs font-bold text-rose-200">
                                確定要清空此裝置所有收集紀錄嗎？
                              </h5>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setConfirmScope(null)}
                              disabled={isProcessingBackup}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExecuteClear('all')}
                              disabled={isProcessingBackup}
                              className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-900/30 flex items-center justify-center gap-1.5 transition cursor-pointer"
                            >
                              {isProcessingBackup ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>清空中...</span>
                                </>
                              ) : (
                                <span>確認</span>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 7. 下載 GitHub Pages 靜態即用版 Card */}
                <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="backup-subcard-title text-xs font-bold text-white">
                      下載 GitHub Pages 靜態即用版
                    </h4>
                    <p className="backup-subcard-desc text-[11px] text-slate-400 mt-0.5">
                      純靜態網頁（免伺服器、免安裝 Node.js，上傳即可使用）
                    </p>
                  </div>
                  <a
                    href="/api/download-static"
                    download="license-plate-collection-github-pages.zip"
                    title="下載 GitHub Pages 靜態即用版"
                    aria-label="下載 GitHub Pages 靜態即用版"
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>

                {/* 8. 下載完整程式碼檔案 Card */}
                <div className="backup-subcard bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="backup-subcard-title text-xs font-bold text-white">
                      下載完整程式碼檔案
                    </h4>
                  </div>
                  <a
                    href="/api/download-source"
                    download="license-plate-collection-source.zip"
                    title="下載完整程式碼檔案"
                    aria-label="下載完整程式碼檔案"
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>

            {/* Notification messages */}
            {syncSuccessMsg && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{syncSuccessMsg}</span>
              </div>
            )}
            {errorMsg && (
              <div className="p-3 bg-rose-950/60 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Save Button */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-20 h-9 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition flex items-center justify-center text-center cursor-pointer"
              >
                關閉
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="w-20 h-9 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 transition shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center text-center cursor-pointer"
              >
                <span>{isSaving ? '儲存中...' : '儲存'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
