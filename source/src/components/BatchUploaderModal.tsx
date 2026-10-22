import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Upload,
  Sparkles,
  RefreshCw,
  Check,
  AlertTriangle,
  Layers,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  Plus,
  Crop,
  ZoomIn,
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
} from 'lucide-react';
import { PlateRecord, PlateRecognitionResult } from '../types';
import {
  createCustomSquareCrop,
  createSimpleSquareCrop,
  calculateOptimalVehicleFraming,
  isSquareAspectRatio,
  getCropCoordinates,
  loadImage,
} from '../utils/cropper';
import { getNumberTags } from '../services/numberClassifier';
import { extractDigitsFromText } from '../services/localVision';
import { SAMPLE_PLATES } from './SamplePlates';
import { extractExifMetadata } from '../utils/exifHelper';
import { recognizePlateWithGemini } from '../services/geminiVision';

export interface BatchItem {
  id: string;
  file?: File;
  originalDataUrl: string;
  squareCropUrl: string;
  fullPlate: string;
  digits: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  collectedAt?: string;
  status: 'pending' | 'recognizing' | 'success' | 'manual' | 'skipped' | 'error';
  statusMessage?: string;
  isExisting: boolean; // already collected in plateMap
  isDuplicatePlate?: boolean; // identical fullPlate and digits already collected
  zoom?: number;
  panX?: number;
  panY?: number;
}

interface BatchUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveBatch: (records: PlateRecord[]) => Promise<void>;
  existingPlateMap: Map<string, PlateRecord>;
  initialFiles?: File[];
}

async function prepareOptimizedImageForAI(img: HTMLImageElement): Promise<string> {
  const maxDim = 960;
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) return '';

  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.80);
}

export const BatchUploaderModal: React.FC<BatchUploaderModalProps> = ({
  isOpen,
  onClose,
  onSaveBatch,
  existingPlateMap,
  initialFiles,
}) => {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewItem, setPreviewItem] = useState<BatchItem | null>(null);

  // Dedicated interactive crop & zoom editor state
  const [cropEditorItem, setCropEditorItem] = useState<BatchItem | null>(null);
  const [cropZoom, setCropZoom] = useState<number>(1.0);
  const [cropPanX, setCropPanX] = useState<number>(0);
  const [cropPanY, setCropPanY] = useState<number>(0);
  const [cropImgObj, setCropImgObj] = useState<HTMLImageElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingCropRef = useRef(false);
  const cropDragStartRef = useRef({ x: 0, y: 0, startPanX: 0, startPanY: 0 });

  const handleOpenCropEditor = async (item: BatchItem) => {
    setCropEditorItem(item);
    setCropZoom(item.zoom ?? 1.0);
    setCropPanX(item.panX ?? 0);
    setCropPanY(item.panY ?? 0);
    try {
      const img = await loadImage(item.originalDataUrl);
      setCropImgObj(img);
    } catch (e) {
      console.warn('Failed to load item image for crop editor:', e);
    }
  };

  useEffect(() => {
    if (!cropImgObj || !cropCanvasRef.current) return;
    const canvas = cropCanvasRef.current;
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const imgW = cropImgObj.naturalWidth || cropImgObj.width;
    const imgH = cropImgObj.naturalHeight || cropImgObj.height;
    const { sx, sy, cropSize } = getCropCoordinates(imgW, imgH, cropZoom, cropPanX, cropPanY);

    ctx.clearRect(0, 0, 480, 480);
    ctx.drawImage(cropImgObj, sx, sy, cropSize, cropSize, 0, 0, 480, 480);
  }, [cropImgObj, cropZoom, cropPanX, cropPanY]);

  const handleApplyCrop = async () => {
    if (!cropEditorItem || !cropImgObj) return;
    try {
      const croppedUrl = await createCustomSquareCrop(cropImgObj, cropZoom, cropPanX, cropPanY, 720);
      setItems((prev) =>
        prev.map((it) =>
          it.id === cropEditorItem.id
            ? {
                ...it,
                squareCropUrl: croppedUrl,
                zoom: cropZoom,
                panX: cropPanX,
                panY: cropPanY,
              }
            : it
        )
      );
      setCropEditorItem(null);
    } catch (e) {
      console.warn('Failed to apply crop:', e);
    }
  };

  const handleCropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    isDraggingCropRef.current = true;
    cropDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: cropPanX,
      startPanY: cropPanY,
    };
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCropRef.current) return;
    const dx = e.clientX - cropDragStartRef.current.x;
    const dy = e.clientY - cropDragStartRef.current.y;
    const panDeltaX = -(dx / 120) * 50;
    const panDeltaY = -(dy / 120) * 50;
    setCropPanX(Math.max(-100, Math.min(100, Math.round(cropDragStartRef.current.startPanX + panDeltaX))));
    setCropPanY(Math.max(-100, Math.min(100, Math.round(cropDragStartRef.current.startPanY + panDeltaY))));
  };

  const handleCropPointerUp = () => {
    isDraggingCropRef.current = false;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setItems([]);
      setIsProcessing(false);
      setIsSaving(false);
      setPreviewItem(null);
      setCropEditorItem(null);
      setCropImgObj(null);
    }
  }, [isOpen]);

  // Check if plate matches an existing collected record with identical letters and numbers
  const checkDuplicatePlate = (fullPlate: string, digits: string) => {
    const cleanDigits = digits.replace(/\D/g, '').padStart(4, '0').slice(-4);
    const existing = existingPlateMap.get(cleanDigits);
    if (!existing) return false;

    // Normalize license plate strings (remove dashes, spaces, case-insensitive)
    const normDetected = fullPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (!normDetected) return false;

    const allExistingPlates =
      existing.photos && existing.photos.length > 0
        ? existing.photos.map((p) =>
            (p.fullPlate || existing.number).replace(/[^A-Z0-9]/gi, '').toUpperCase()
          )
        : [(existing.fullPlate || existing.number).replace(/[^A-Z0-9]/gi, '').toUpperCase()];

    return allExistingPlates.includes(normDetected);
  };

  // AI recognition single worker
  const recognizeItem = async (
    item: BatchItem,
    presetHint?: { fullPlate?: string; digits?: string }
  ): Promise<BatchItem> => {
    // If preset sample hint provided
    if (presetHint?.digits) {
      const cleanDigits = presetHint.digits.padStart(4, '0').slice(-4);
      const fullPlate = presetHint.fullPlate || presetHint.digits;
      const isDuplicate = checkDuplicatePlate(fullPlate, cleanDigits);

      if (isDuplicate) {
        return {
          ...item,
          fullPlate,
          digits: cleanDigits,
          status: 'skipped',
          statusMessage: '此車牌已拍攝過，略過上傳',
          isExisting: true,
          isDuplicatePlate: true,
        };
      }

      return {
        ...item,
        fullPlate,
        digits: cleanDigits,
        status: 'success',
        statusMessage: `範例：${presetHint.fullPlate}`,
        isExisting: existingPlateMap.has(cleanDigits),
        isDuplicatePlate: false,
      };
    }

    try {
      const img = await loadImage(item.originalDataUrl);
      const optimizedDataUrl = await prepareOptimizedImageForAI(img);
      const payloadUrl = optimizedDataUrl || item.originalDataUrl;

      const data: PlateRecognitionResult = await recognizePlateWithGemini(payloadUrl, 'image/jpeg');

      if (true) {
        if (data.detected && (data.digits || data.fullPlate)) {
          const detectedPlate = (data.fullPlate || data.digits).toUpperCase();
          const cleanDigits = (data.digits || detectedPlate.replace(/\D/g, '')).padStart(4, '0').slice(-4);
          const isDuplicate = checkDuplicatePlate(detectedPlate, cleanDigits);

          if (isDuplicate) {
            return {
              ...item,
              fullPlate: detectedPlate,
              digits: cleanDigits,
              status: 'skipped',
              statusMessage: '此車牌已拍攝過，略過上傳',
              isExisting: true,
              isDuplicatePlate: true,
            };
          }

          // If AI returned box, auto-refine crop to focus on vehicle/plate (unless already 1:1 square)
          let refinedSquareCropUrl = item.squareCropUrl;
          if (data.box) {
            try {
              const W = img.naturalWidth || img.width;
              const H = img.naturalHeight || img.height;
              if (!isSquareAspectRatio(W, H)) {
                const framing = calculateOptimalVehicleFraming(W, H, data.box);
                refinedSquareCropUrl = await createCustomSquareCrop(img, framing.zoom, framing.panX, framing.panY, 640);
              }
            } catch {}
          }

          let finalFullPlate = detectedPlate;
          // If detectedPlate only has numbers (missing English letters), try a focused pass on the refined crop
          if (!/[A-Z]/.test(finalFullPlate) && refinedSquareCropUrl && refinedSquareCropUrl !== item.squareCropUrl) {
            try {
              const data2: PlateRecognitionResult = await recognizePlateWithGemini(refinedSquareCropUrl, 'image/jpeg');
              if (data2.fullPlate && /[A-Z]/.test(data2.fullPlate)) {
                finalFullPlate = data2.fullPlate.toUpperCase();
              }
            } catch {}
          }

          return {
            ...item,
            squareCropUrl: refinedSquareCropUrl,
            fullPlate: finalFullPlate,
            digits: cleanDigits,
            status: 'success',
            statusMessage: '辨識成功',
            isExisting: existingPlateMap.has(cleanDigits),
            isDuplicatePlate: false,
          };
        }
      }

      // Fallback: check filename hint
      const filename = item.file?.name || '';
      const nameHint = extractDigitsFromText(filename);
      if (nameHint?.digits) {
        const clean = nameHint.digits.padStart(4, '0').slice(-4);
        const fullPlate = nameHint.fullPlate || nameHint.digits;
        const isDuplicate = checkDuplicatePlate(fullPlate, clean);

        if (isDuplicate) {
          return {
            ...item,
            fullPlate,
            digits: clean,
            status: 'skipped',
            statusMessage: '此車牌已拍攝過，略過上傳',
            isExisting: true,
            isDuplicatePlate: true,
          };
        }

        return {
          ...item,
          fullPlate,
          digits: clean,
          status: 'manual',
          statusMessage: `由檔名帶入：${nameHint.digits}（待確認）`,
          isExisting: existingPlateMap.has(clean),
          isDuplicatePlate: false,
        };
      }

      return {
        ...item,
        status: 'manual',
        statusMessage: '未辨識出車號，請手動輸入',
        isDuplicatePlate: false,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        ...item,
        status: 'manual',
        statusMessage: `辨識失敗: ${errMsg.slice(0, 100)}`,
        isDuplicatePlate: false,
      };
    }
  };

  // Process a list of uploaded Files
  const handleAddFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    setIsProcessing(true);

    // 1. Initial items with square crop generated in memory
    const newItems: BatchItem[] = [];
    for (const file of fileArray) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });

      let squareCropUrl = dataUrl;
      let itemFraming = { zoom: 1.0, panX: 0, panY: 0 };
      try {
        const img = await loadImage(dataUrl);
        const W = img.naturalWidth || img.width;
        const H = img.naturalHeight || img.height;
        if (!isSquareAspectRatio(W, H)) {
          itemFraming = calculateOptimalVehicleFraming(W, H);
          squareCropUrl = await createCustomSquareCrop(img, itemFraming.zoom, itemFraming.panX, itemFraming.panY, 640);
        } else {
          itemFraming = { zoom: 1.0, panX: 0, panY: 0 };
          squareCropUrl = await createCustomSquareCrop(img, 1.0, 0, 0, 640);
        }
      } catch (e) {
        console.warn('Square crop creation failed:', e);
      }

      // Read EXIF GPS & Date
      let meta: any = {};
      try {
        meta = await extractExifMetadata(file);
      } catch {}

      const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      newItems.push({
        id,
        file,
        originalDataUrl: dataUrl,
        squareCropUrl,
        zoom: itemFraming.zoom,
        panX: itemFraming.panX,
        panY: itemFraming.panY,
        fullPlate: '',
        digits: '',
        locationName: meta.locationName,
        latitude: meta.latitude,
        longitude: meta.longitude,
        collectedAt: meta.dateTime,
        status: 'pending',
        statusMessage: meta.locationName ? `📍 ${meta.locationName} (等待辨識...)` : '等待辨識...',
        isExisting: false,
      });
    }

    // Append to existing items
    setItems((prev) => [...prev, ...newItems]);

    // 2. Concurrently run AI recognition with max 2 concurrent requests
    const queue = [...newItems];
    const updateItemInState = (updated: BatchItem) => {
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    };

    // Process one at a time with delay to avoid 429 rate limit (free tier: 15 req/min)
    for (let i = 0; i < newItems.length; i++) {
      const current = newItems[i];
      updateItemInState({
        ...current,
        status: 'recognizing',
        statusMessage: '辨識中...',
      });

      const finished = await recognizeItem(current);
      updateItemInState(finished);

      // Wait 4 seconds between requests to stay under rate limit
      if (i < newItems.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }

    setIsProcessing(false);
  };

  // Automatically process files passed from outside (e.g. multi-select from UploaderModal)
  const initialFilesHandledRef = useRef<boolean>(false);
  useEffect(() => {
    if (isOpen) {
      if (initialFiles && initialFiles.length > 0 && !initialFilesHandledRef.current) {
        initialFilesHandledRef.current = true;
        handleAddFiles(initialFiles);
      }
    } else {
      initialFilesHandledRef.current = false;
    }
  }, [isOpen, initialFiles]);

  // Add Sample Plates for quick demo
  const handleAddSamples = async () => {
    setIsProcessing(true);
    const demoSamples = SAMPLE_PLATES.slice(0, 3);
    const newItems: BatchItem[] = [];

    for (const s of demoSamples) {
      const dataUrl = s.generateDataUrl();
      let squareCropUrl = dataUrl;
      try {
        const img = await loadImage(dataUrl);
        squareCropUrl = await createSimpleSquareCrop(img, 640);
      } catch (e) {}

      const id = `sample_${s.id}_${Date.now()}`;
      newItems.push({
        id,
        originalDataUrl: dataUrl,
        squareCropUrl,
        fullPlate: s.plate,
        digits: s.digits,
        locationName: s.locationName,
        status: 'success',
        statusMessage: `示範：${s.plate}${s.locationName ? ` (📍 ${s.locationName})` : ''}`,
        isExisting: existingPlateMap.has(s.digits),
      });
    }

    setItems((prev) => [...prev, ...newItems]);
    setIsProcessing(false);
  };

  // Item field change handler
  const handleUpdateItem = (id: string, updates: Partial<BatchItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const nextDigits = updates.digits !== undefined ? updates.digits.replace(/\D/g, '') : it.digits;
        const nextFullPlate = updates.fullPlate !== undefined ? updates.fullPlate : it.fullPlate;
        const formatted = nextDigits.padStart(4, '0').slice(-4);
        const isDuplicate = checkDuplicatePlate(nextFullPlate, formatted);

        const resolvedStatus = isDuplicate
          ? 'skipped'
          : updates.status !== undefined
          ? updates.status
          : it.status === 'skipped'
          ? 'manual'
          : it.status;

        const resolvedMessage = isDuplicate
          ? '此車牌已拍攝過，略過上傳'
          : updates.statusMessage !== undefined
          ? updates.statusMessage
          : it.statusMessage;

        return {
          ...it,
          ...updates,
          digits: nextDigits,
          fullPlate: nextFullPlate,
          isExisting: nextDigits.length > 0 ? existingPlateMap.has(formatted) : false,
          isDuplicatePlate: isDuplicate,
          status: resolvedStatus,
          statusMessage: resolvedMessage,
        };
      })
    );
  };

  // Remove single item
  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (previewItem?.id === id) setPreviewItem(null);
  };

  // Re-run recognition on a single item (supports retry when timeout or failed)
  const handleRetryRecognize = async (id: string) => {
    const target = items.find((it) => it.id === id);
    if (!target) return;

    handleUpdateItem(id, {
      status: 'recognizing',
      statusMessage: '辨識中...',
    });

    const finished = await recognizeItem(target);
    handleUpdateItem(id, {
      ...finished,
      status: finished.status,
      statusMessage: finished.statusMessage,
    });
  };

  // Save all valid items to IndexedDB
  const handleSaveAll = async () => {
    // Collect items with at least a valid number (from digits or fullPlate) and NOT skipped as identical duplicate
    const validItems = items.filter((it) => {
      if (it.status === 'skipped' || it.isDuplicatePlate) return false;
      const cleaned = (it.digits || it.fullPlate).replace(/\D/g, '');
      return cleaned.length > 0;
    });

    if (validItems.length === 0) {
      alert('所有照片均已略過或未填妥號碼，請確認後再儲存！');
      return;
    }

    setIsSaving(true);
    try {
      const records: PlateRecord[] = await Promise.all(
        validItems.map(async (it) => {
          const rawNum = (it.digits || it.fullPlate).replace(/\D/g, '');
          const num = rawNum ? rawNum.padStart(4, '0').slice(-4) : '0000';
          const cleanPlate = it.fullPlate.trim() ? it.fullPlate.trim().toUpperCase() : num;
          let finalImg = it.squareCropUrl || it.originalDataUrl;
          if (finalImg && finalImg.length > 400000) {
            try {
              const img = await loadImage(finalImg);
              finalImg = await createSimpleSquareCrop(img, 640);
            } catch (e) {}
          }
          return {
            number: num,
            fullPlate: cleanPlate,
            imageUrl: finalImg,
            collectedAt: it.collectedAt || new Date().toISOString(),
            locationName: it.locationName,
            latitude: it.latitude,
            longitude: it.longitude,
          };
        })
      );

      await onSaveBatch(records);
      onClose();
    } catch (err) {
      console.warn('Batch save error:', err);
      alert('批次儲存失敗，請重試');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const validCount = items.filter(
    (it) => it.status !== 'skipped' && !it.isDuplicatePlate && it.digits.replace(/\D/g, '').length > 0
  ).length;
  const skippedCount = items.filter((it) => it.status === 'skipped' || it.isDuplicatePlate).length;
  const recognizingCount = items.filter((it) => it.status === 'recognizing' || it.status === 'pending').length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div
        id="batch-uploader-modal"
        className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-750 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-4 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-400/10 text-amber-400 flex items-center justify-center border border-amber-400/20">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">上傳照片</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Top Multi-File Drop / Select Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleAddFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className="group border-2 border-dashed border-slate-700 hover:border-amber-400/80 bg-slate-950/50 hover:bg-slate-900/80 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleAddFiles(e.target.files);
                  e.target.value = ''; // reset so same files can be re-selected if needed
                }
              }}
            />
            <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 text-amber-400 flex items-center justify-center mb-2 group-hover:scale-110 transition">
              <Upload className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-slate-200 group-hover:text-amber-300 transition">
              點擊選取照片（可一次選取多張）
            </h4>
            <p className="text-xs text-slate-400 mt-1">
              可一次選取多張車牌照片，系統將自動進行平行多工高速辨識
            </p>
            {items.length === 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddSamples();
                  }}
                  className="text-xs font-semibold text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 px-3 py-1.5 rounded-lg transition"
                >
                  ＋ 載入測試範例車牌
                </button>
              </div>
            )}
          </div>

          {/* Processing Indicator */}
          {recognizingCount > 0 && (
            <div className="flex items-center justify-between bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5 text-xs text-amber-300 animate-pulse">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="font-semibold">AI辨識執行中...</span>
              </div>
              <span className="font-mono">剩餘 {recognizingCount} 張</span>
            </div>
          )}

          {/* Items List */}
          {items.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <span>已加入照片清單（{items.length} 張）</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-emerald-400 font-mono">{validCount} 張備妥可入庫</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 font-medium px-2 py-1 rounded bg-slate-800 hover:bg-slate-750 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>加選照片</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setItems([])}
                    className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded hover:bg-rose-500/10 transition"
                  >
                    全部清除
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {items.map((item, idx) => {
                  const targetNum = item.digits.padStart(4, '0').slice(-4);
                  const tags = item.digits.length > 0 ? getNumberTags(targetNum) : [];
                  const isSkippedDuplicate = item.status === 'skipped' || item.isDuplicatePlate;

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 rounded-xl p-3 transition border ${
                        isSkippedDuplicate
                          ? 'bg-rose-950/20 border-rose-500/30'
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Image Thumbnail */}
                      <div
                        onClick={() => handleOpenCropEditor(item)}
                        className={`relative w-20 h-20 bg-slate-900 rounded-lg overflow-hidden border shrink-0 cursor-pointer group ${
                          isSkippedDuplicate ? 'border-rose-500/40 opacity-75' : 'border-slate-750'
                        }`}
                        title="點擊調整 1:1 縮放與取景（去除多餘背景）"
                      >
                        {(() => {
                          const imgSrc = (item.squareCropUrl && item.squareCropUrl.trim()) || (item.originalDataUrl && item.originalDataUrl.trim()) || null;
                          if (imgSrc) {
                            return (
                              <img
                                src={imgSrc}
                                alt="Plate Thumbnail"
                                className="w-full h-full object-cover group-hover:scale-105 transition"
                              />
                            );
                          }
                          return (
                            <div className="w-full h-full flex items-center justify-center bg-slate-800 text-slate-500 font-mono text-[10px]">
                              #{idx + 1}
                            </div>
                          );
                        })()}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Crop className="w-5 h-5 text-amber-300 drop-shadow" />
                        </div>
                        <span className="absolute top-1 left-1 batch-item-index-badge bg-slate-950/90 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-amber-300 border border-amber-400/40 shadow-md">
                          #{idx + 1}
                        </span>
                        {isSkippedDuplicate && (
                          <div className="absolute inset-x-0 bottom-0 bg-rose-600/90 text-white text-[8px] font-bold text-center py-0.5">
                            已略過
                          </div>
                        )}
                      </div>

                      {/* Fields & Status */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Status bar */}
                        <div className="flex items-center justify-between gap-1 text-[11px]">
                          {item.status === 'recognizing' || item.status === 'pending' ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                              <span className="truncate">{item.statusMessage || '辨識中...'}</span>
                            </span>
                          ) : isSkippedDuplicate ? (
                            <span className="flex items-center gap-1 text-rose-400 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                              <span className="truncate">{item.statusMessage || '此車牌已拍攝過，略過上傳'}</span>
                            </span>
                          ) : item.status === 'success' ? (
                            <span className="flex items-center gap-1 text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{item.statusMessage || '辨識成功'}</span>
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                              <span className="flex items-center gap-1 text-amber-300 font-medium truncate">
                                <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                                <span className="truncate">{item.statusMessage || '辨識連線超時，請手動輸入'}</span>
                              </span>
                            </div>
                          )}

                          {item.isExisting && !isSkippedDuplicate ? (
                            <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30 whitespace-nowrap shrink-0">
                              此號已有照片 (一併保留)
                            </span>
                          ) : null}
                        </div>

                        {/* Input Row */}
                        <div className="grid grid-cols-5 gap-2">
                          <div className="col-span-3">
                            <input
                              type="text"
                              value={item.fullPlate}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase();
                                const numOnly = val.replace(/\D/g, '');
                                const updates: Partial<BatchItem> = { fullPlate: val };
                                if (numOnly.length >= 4) {
                                  updates.digits = numOnly.slice(-4);
                                } else if (numOnly.length > 0 && (!item.digits || item.digits === '0000')) {
                                  updates.digits = numOnly.padStart(4, '0');
                                }
                                handleUpdateItem(item.id, updates);
                              }}
                              placeholder="完整車牌"
                              className={`w-full bg-slate-900 border rounded-lg px-2 py-1 text-xs font-mono font-bold placeholder:text-slate-600 focus:outline-none ${
                                isSkippedDuplicate
                                  ? 'border-rose-500/40 text-rose-200 focus:border-rose-400'
                                  : 'border-slate-700/80 focus:border-amber-400 text-white'
                              }`}
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              maxLength={4}
                              value={item.digits}
                              onChange={(e) => {
                                const newDigits = e.target.value.replace(/\D/g, '');
                                const updates: Partial<BatchItem> = { digits: newDigits };
                                if (!item.fullPlate || item.fullPlate === item.digits) {
                                  updates.fullPlate = newDigits;
                                }
                                handleUpdateItem(item.id, updates);
                              }}
                              placeholder="四位號碼"
                              className={`w-full bg-slate-900 border rounded-lg px-2 py-1 text-xs font-mono font-black placeholder:text-slate-600 focus:outline-none text-center ${
                                isSkippedDuplicate
                                  ? 'border-rose-500/40 text-rose-300 focus:border-rose-400'
                                  : 'border-slate-700/80 focus:border-amber-400 text-amber-300'
                              }`}
                            />
                          </div>
                        </div>

                        {/* Tags & Actions */}
                        <div className="flex items-center justify-between gap-1 pt-0.5">
                          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                            {tags.slice(0, 2).map((t) => (
                              <span
                                key={t.tag}
                                className={`text-[8px] px-1 py-0.5 rounded border font-semibold whitespace-nowrap ${t.bgClass} ${t.colorClass}`}
                              >
                                {t.label}
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRetryRecognize(item.id)}
                              disabled={item.status === 'recognizing'}
                              title="重新 AI 辨識"
                              className="flex items-center gap-1 px-2 py-1 text-[10px] text-amber-300 hover:text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 rounded font-medium transition active:scale-95 disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3 h-3 text-amber-400 ${item.status === 'recognizing' ? 'animate-spin' : ''}`} />
                              <span>重新辨識</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenCropEditor(item)}
                              title="調整 1:1 縮放與取景（去除多餘背景）"
                              className="flex items-center gap-1 px-2 py-1 text-[10px] text-amber-300 hover:text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 rounded font-medium transition active:scale-95"
                            >
                              <Crop className="w-3 h-3 text-amber-400" />
                              <span>縮放裁切</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              title="移除此張"
                              className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-slate-400">
            {items.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span>
                  共 <b className="text-white">{items.length}</b> 張照片
                </span>
                <span className="text-slate-600">•</span>
                <span>
                  可儲存 <b className="text-emerald-400">{validCount}</b> 張
                </span>
                {skippedCount > 0 && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="text-rose-400">
                      已略過 <b className="font-mono">{skippedCount}</b> 張重複
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span>尚未選取照片</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              取消
            </button>
            <button
              id="save-batch-btn"
              disabled={validCount === 0 || isSaving}
              onClick={handleSaveAll}
              className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:hover:bg-amber-400 text-slate-950 font-bold px-5 py-2 rounded-lg text-xs shadow-lg shadow-amber-500/20 transition active:scale-95"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>儲存中...</span>
                </>
              ) : (
                <span>儲存 ({validCount} 張)</span>
              )}
            </button>
          </div>
        </div>

        {/* Interactive 1:1 Crop & Zoom Adjustment Modal */}
        {cropEditorItem && (
          <div
            onClick={() => setCropEditorItem(null)}
            className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-w-md w-full bg-slate-900 border border-slate-750 rounded-2xl overflow-hidden p-4 sm:p-5 space-y-4 shadow-2xl my-auto"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Crop className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-bold text-slate-100">
                    調整 1:1 縮放與取景
                  </span>
                  <span className="text-xs font-mono text-amber-300 font-bold">
                    {cropEditorItem.fullPlate || `#${cropEditorItem.digits}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCropEditorItem(null)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Viewfinder Canvas with drag gestures */}
              <div className="flex flex-col items-center gap-2">
                <div
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerUp}
                  onPointerCancel={handleCropPointerUp}
                  className="relative w-64 h-64 bg-slate-950 rounded-2xl overflow-hidden border-2 border-amber-400 shadow-xl cursor-grab active:cursor-grabbing select-none touch-none"
                  title="可直接在畫面上拖曳移動取景"
                >
                  <canvas
                    ref={cropCanvasRef}
                    className="w-full h-full object-contain pointer-events-none"
                  />
                  {/* Grid Lines (Zero mask, clear viewfinder) */}
                  <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                    <div className="nine-grid-cell border-r border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-r border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-r border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-r border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-r border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell border-r border-b border-white/50 border-dashed !bg-transparent" />
                    <div className="nine-grid-cell !bg-transparent" />
                  </div>
                  <div className="absolute bottom-2 right-2 bg-slate-950/80 backdrop-blur-sm text-amber-300 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border border-slate-700 pointer-events-none">
                    {cropZoom.toFixed(2)}x
                  </div>
                </div>
              </div>

              {/* Zoom & Framing Controls */}
              <div className="crop-controls-card bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-3 text-xs">
                {/* Zoom row */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-slate-300 text-[11px] crop-control-label">
                    <span className="flex items-center gap-1 font-bold">
                      <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                      畫面縮放 (Zoom)
                    </span>
                    <span className="font-mono text-amber-300 font-bold crop-zoom-value">{cropZoom.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="0.05"
                    value={cropZoom}
                    onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                    className="crop-range-slider w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                  {/* Presets */}
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setCropZoom(1.0)}
                      className={`crop-preset-btn py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                        cropZoom === 1.0
                          ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold is-active'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                      }`}
                    >
                      1.0x 全景
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropZoom(1.35)}
                      className={`crop-preset-btn py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                        Math.abs(cropZoom - 1.35) < 0.05
                          ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold is-active'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                      }`}
                      title="最適合 9:16 直拍照片，去除多餘天空與地面"
                    >
                      1.35x 去背景
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropZoom(1.8)}
                      className={`crop-preset-btn py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                        Math.abs(cropZoom - 1.8) < 0.05
                          ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold is-active'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                      }`}
                    >
                      1.8x 聚焦
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropZoom(2.5)}
                      className={`crop-preset-btn py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                        Math.abs(cropZoom - 2.5) < 0.05
                          ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold is-active'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                      }`}
                    >
                      2.5x 特寫
                    </button>
                  </div>
                </div>

                {/* Pan X and Y */}
                <div className="grid grid-cols-2 gap-2.5 pt-1.5 border-t border-slate-800/80">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-slate-300 text-[10px] crop-control-label">
                      <span className="font-bold">水平位移 (X)</span>
                      <span className="font-mono text-amber-300 font-semibold">{cropPanX}%</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      value={cropPanX}
                      onChange={(e) => setCropPanX(parseInt(e.target.value, 10))}
                      className="crop-range-slider w-full h-2 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-slate-300 text-[10px] crop-control-label">
                      <span className="font-bold">垂直位移 (Y)</span>
                      <span className="font-mono text-amber-300 font-semibold">{cropPanY}%</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      value={cropPanY}
                      onChange={(e) => setCropPanY(parseInt(e.target.value, 10))}
                      className="crop-range-slider w-full h-2 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-400"
                    />
                  </div>
                </div>

                {/* Quick alignment */}
                <div className="flex items-center justify-between gap-1 pt-1">
                  <span className="text-[10px] text-slate-500">快速對齊：</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCropPanX(0);
                        setCropPanY(0);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[10px]"
                    >
                      居中
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropPanY(25)}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[10px]"
                      title="適合車輛位於畫面中下方的照片"
                    >
                      靠下(車身)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCropZoom(1.0);
                        setCropPanX(0);
                        setCropPanY(0);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 text-[10px] flex items-center gap-0.5"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>重設</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCropEditorItem(null)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleApplyCrop}
                  className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs shadow-md transition active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>套用縮放裁切</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
