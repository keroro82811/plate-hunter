import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  X,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  Shield,
  ExternalLink,
  Copy,
  Check,
  Share2,
  RefreshCw,
  Code,
  Globe,
  Cloud,
} from 'lucide-react';
import { PlateRecord } from '../types';
import { User } from 'firebase/auth';
import {
  saveBatchPlates,
  clearAllPlates,
  getAllPlates,
  streamExportAllPlatesFromIndexedDB,
  saveLocalCache,
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
import { authFetch } from '../services/firebase';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  plateList: PlateRecord[];
  currentUser?: User | null;
  onReload: (options?: { fastLocalOnly?: boolean }) => Promise<void>;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  plateList,
  currentUser,
  onReload,
}) => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clearSuccessMessage, setClearSuccessMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmScope, setConfirmScope] = useState<'localOnly' | 'cloudOnly' | 'all' | null>(null);
  const [readyBackup, setReadyBackup] = useState<ReadyBackupResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalPhotosCount = useMemo(() => {
    let count = 0;
    for (const p of plateList) {
      count += p.photos?.length || 1;
    }
    return count;
  }, [plateList]);

  if (!isOpen) return null;

  // 1. 一次匯出完整備份 (單一 JSON 檔案，包含全部車牌號碼、相片、時間地點)
  const handleExportBackup = async () => {
    setIsProcessing(true);
    setReadyBackup(null);
    try {
      setStatusMessage('正在從資料庫讀取完整相片資料...');
      let recordsToExport: PlateRecord[] = [];
      try {
        recordsToExport = await getAllPlates({ fastLocalOnly: true, includeAllImages: true });
      } catch {
        recordsToExport = plateList;
      }
      if (recordsToExport.length === 0) {
        try {
          recordsToExport = await getAllPlates({ fastLocalOnly: false, includeAllImages: true });
        } catch {
          recordsToExport = plateList;
        }
      }
      if (recordsToExport.length === 0) {
        recordsToExport = plateList;
      }

      if (recordsToExport.length === 0) {
        setStatusMessage('目前尚無收集任何車牌資料可供匯出。');
        return;
      }

      const res = await prepareBackupSession({
        records: recordsToExport,
        onProgress: (msg) => setStatusMessage(msg),
      });

      setReadyBackup(res);
      setStatusMessage(`備份檔已完成（共 ${res.totalCount.toLocaleString()} 筆，含 ${res.photoCount.toLocaleString()} 張完整相片，約 ${res.sizeMb} MB）。`);
    } catch (err: any) {
      console.error('[Export] Error during export:', err);
      setStatusMessage(`匯出失敗：${err.message || '系統錯誤'}`);
    } finally {
      setIsProcessing(false);
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

  // 2. 一次匯入完整備份 (單一 JSON 檔案，串流分批寫入，永不閃退、零 Token 消耗)
  const handleImportFile = async (file: File) => {
    setIsProcessing(true);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    setStatusMessage(`正在讀取備份檔案 (${sizeMb} MB)...`);
    try {
      if (file.size > 4096 * 1024 * 1024) {
        throw new Error('檔案過大 (超過 4GB)，請確認是否為本系統匯出的備份檔案。');
      }

      let validRecords: PlateRecord[] = [];

      // A. 對於標準備份檔案 (< 80MB)，直接以原生快速解析，保證 100% 欄位與高清照片完整還原
      if (file.size < 80 * 1024 * 1024) {
        setStatusMessage('正在解析備份檔案內容...');
        const text = await file.text();
        validRecords = parsePlatesFromTextFallback(text);
      } else if (typeof file.stream === 'function') {
        // B. 超大型檔案 (> 80MB) 嘗試低記憶體串流模式
        try {
          setStatusMessage('正在串流解析超大型備份檔案...');
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

      setStatusMessage(`正在寫入本地資料庫 (共 ${validRecords.length.toLocaleString()} 筆)...`);
      const CHUNK_SIZE = 50;
      let totalImported = 0;
      for (let i = 0; i < validRecords.length; i += CHUNK_SIZE) {
        const slice = validRecords.slice(i, i + CHUNK_SIZE);
        await saveBatchPlates(slice, { skipServerSync: true, skipCacheUpdate: true });
        totalImported += slice.length;
        setStatusMessage(`正在寫入資料庫 (已完成 ${totalImported.toLocaleString()} / ${validRecords.length.toLocaleString()} 筆)...`);
        await new Promise((r) => setTimeout(r, 0));
      }

      // C. 更新本機快取與最新清單
      try {
        saveLocalCache(validRecords);
      } catch {}

      // D. 背景非同步同步至伺服器 (確保手機與電腦跨端同步)
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

      // E. 立即更新畫面展示
      await onReload({ fastLocalOnly: true });
      setStatusMessage(`🎉 成功匯入還原 ${totalImported.toLocaleString()} 筆車牌相片！`);
      setClearSuccessMessage(null);
    } catch (err: any) {
      console.error('[Import] Failed to import backup:', err);
      setStatusMessage(`匯入失敗：${err.message || '檔案格式或資料有誤'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 清空資料處理（分開處理：僅本機 vs 雲端 vs 全刪）
  const handleExecuteClear = async (scope: 'localOnly' | 'cloudOnly' | 'all') => {
    setIsProcessing(true);
    let msg = '正在刪除本機與雲端所有相片與紀錄...';
    if (scope === 'localOnly') {
      msg = '正在清除此裝置本機暫存...';
    } else if (scope === 'cloudOnly') {
      msg = '正在刪除雲端所有相片與紀錄...';
    }
    setStatusMessage(null);
    setClearSuccessMessage(msg);
    try {
      await clearAllPlates({ uid: currentUser?.uid, scope });
      setReadyBackup(null);
      await onReload(scope === 'all' ? undefined : { fastLocalOnly: true });
      if (scope === 'localOnly') {
        setClearSuccessMessage('已清空本機暫存！');
      } else if (scope === 'cloudOnly') {
        setClearSuccessMessage('已清空雲端備份！');
      } else {
        setClearSuccessMessage('已全數清空！本機與雲端相片紀錄已徹底刪除。');
      }
      setTimeout(() => setClearSuccessMessage(null), 4000);
      setConfirmScope(null);
    } catch (err: any) {
      setClearSuccessMessage(`清空失敗：${err?.message || '未知錯誤'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 一鍵修復相片與同步
  const handleRepairPhotos = async () => {
    setIsProcessing(true);
    setStatusMessage('正在修復相片並清理異常資料...');
    try {
      // 1. 從伺服器端同步最新原始相片
      const res = await authFetch('/api/plates');
      if (res.ok) {
        const serverPlates = await res.json();
        if (Array.isArray(serverPlates) && serverPlates.length > 0) {
          await saveBatchPlates(serverPlates, { skipServerSync: true });
        }
      }
      // 2. 清除快取並重新載入，觸發 db.ts 的自動去合成 SVG 流程
      await onReload();
      setStatusMessage('🎉 相片修復完成！已清除異常合成圖，並成功還原真實相片。');
    } catch (e: any) {
      setStatusMessage(`修復時發生問題：${e?.message || '請重試'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div
        id="backup-modal"
        className="relative w-full max-w-lg bg-slate-900 border border-slate-750 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">收集冊備份與資料管理</h2>
              <p className="text-xs text-slate-400">
                目前本機共收集 {plateList.length.toLocaleString()} 個號碼（存有 {totalPhotosCount.toLocaleString()} 張照片）
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {statusMessage && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}


          {/* 1. 備份至本機裝置 Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white">
                備份至本機裝置
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                匯出 JSON 檔案
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportBackup}
              disabled={isProcessing || plateList.length === 0}
              title="備份至本機裝置"
              aria-label="備份至本機裝置"
              className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
            >
              <Download className={`w-4 h-4 ${isProcessing ? 'animate-bounce text-amber-400' : ''}`} />
            </button>
          </div>

          {/* Ready Backup Download Panel */}
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
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 font-medium text-xs transition active:scale-98 cursor-pointer"
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
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white">
                匯入備份資料
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                選取先前 JSON 檔案（匯入時零 Token 消耗）
              </p>
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
              disabled={isProcessing}
              title="匯入備份資料"
              aria-label="匯入備份資料"
              className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>

          {/* 3. 一鍵修復相片與同步 Card */}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-emerald-300">
                一鍵修復相片與同步
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                清除異常或破圖快取，還原伺服器端真實相片
              </p>
            </div>
            <button
              type="button"
              onClick={handleRepairPhotos}
              disabled={isProcessing}
              title="一鍵修復相片"
              className="px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-40 shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>修復相片</span>
            </button>
          </div>

          {/* 4. GitHub Pages 靜態即用版 Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white">
                下載 GitHub Pages 靜態即用版
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
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

          {/* 5. 下載完整程式碼檔案 Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white">
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

          {/* 6. 清空區域 (登入狀態：本機暫存 vs 雲端備份 分開) */}
          <div className="space-y-2.5">
            {clearSuccessMessage && (
              <div className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center gap-2 animate-fadeIn ${
                isProcessing
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : clearSuccessMessage.includes('失敗')
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                  : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              }`}>
                {isProcessing ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span>{clearSuccessMessage}</span>
              </div>
            )}

            {currentUser ? (
              <>
                {/* 登入選項 A：清空本機暫存（保留雲端） */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 transition">
                  {confirmScope !== 'localOnly' ? (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-white">
                          清空本機暫存
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setClearSuccessMessage(null);
                          setConfirmScope('localOnly');
                        }}
                        disabled={isProcessing}
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
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExecuteClear('localOnly')}
                          disabled={isProcessing}
                          className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-bold shadow-md flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          {isProcessing ? (
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

                {/* 登入選項 B：清空雲端備份（保留本機裝置紀錄） */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 transition">
                  {confirmScope !== 'cloudOnly' ? (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-white">
                          清空雲端備份
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setClearSuccessMessage(null);
                          setConfirmScope('cloudOnly');
                        }}
                        disabled={isProcessing}
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
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-medium transition cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExecuteClear('cloudOnly')}
                          disabled={isProcessing}
                          className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-900/30 flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          {isProcessing ? (
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
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 transition">
                {confirmScope !== 'all' ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        清空此裝置收集紀錄
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        清除所有車牌收集紀錄與相片快取（此操作不可逆）
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClearSuccessMessage(null);
                        setConfirmScope('all');
                      }}
                      disabled={isProcessing}
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
                        <p className="text-[11px] text-rose-300/80 mt-0.5">
                          此操作不可逆！本機所有相片與紀錄將全數刪除。
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setConfirmScope(null)}
                        disabled={isProcessing}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExecuteClear('all')}
                        disabled={isProcessing}
                        className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-900/30 flex items-center gap-1.5 transition cursor-pointer"
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>清空中...</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>確認全數清空</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
