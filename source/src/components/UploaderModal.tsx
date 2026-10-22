import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Upload,
  Camera,
  Sparkles,
  RefreshCw,
  Check,
  ZoomIn,
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
  Grid3X3,
  Layers,
  AlertTriangle,
  MapPin,
  Calendar,
  Navigation,
  Crosshair,
  Plus,
} from 'lucide-react';
import { PlateRecord, PlateRecognitionResult } from '../types';
import {
  createCustomSquareCrop,
  createSimpleSquareCrop,
  getCropCoordinates,
  calculateOptimalVehicleFraming,
  isSquareAspectRatio,
  loadImage,
} from '../utils/cropper';
import { SAMPLE_PLATES } from './SamplePlates';
import { getNumberTags } from '../services/numberClassifier';
import { extractDigitsFromText } from '../services/localVision';
import { extractExifMetadata, getCurrentBrowserLocation } from '../utils/exifHelper';
import { recognizePlateWithGemini } from '../services/geminiVision';

interface UploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (record: PlateRecord, options?: { replacePhotoId?: string }) => Promise<void>;
  existingPlateMap: Map<string, PlateRecord>;
  initialTargetNumber?: string;
  replacePhotoId?: string;
  onSwitchToBatch?: (files?: File[]) => void;
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

export const UploaderModal: React.FC<UploaderModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingPlateMap,
  initialTargetNumber,
  replacePhotoId,
  onSwitchToBatch,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  // Viewfinder 1:1 framing adjustments
  const [zoom, setZoom] = useState<number>(1.0);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [detectedBox, setDetectedBox] = useState<[number, number, number, number] | null>(null);

  // Form states - plate number and collection digits
  const [fullPlate, setFullPlate] = useState('');
  const [digits, setDigits] = useState(initialTargetNumber || '');
  const [isSaving, setIsSaving] = useState(false);

  // EXIF Location & Date metadata states
  const [locationName, setLocationName] = useState<string>('');
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [capturedAt, setCapturedAt] = useState<string>('');
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [exifNotice, setExifNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Interactive Drag & Touch gesture refs
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number }>({
    x: 0,
    y: 0,
    startPanX: 0,
    startPanY: 0,
  });
  const initialPinchDistRef = useRef<number | null>(null);
  const initialPinchZoomRef = useRef<number>(1.0);

  // Reset when modal opens / closes
  useEffect(() => {
    if (isOpen) {
      if (initialTargetNumber) {
        setDigits(initialTargetNumber);
      }
    } else {
      setImageSrc(null);
      setImageObj(null);
      setIsScanning(false);
      setScanMessage(null);
      setFullPlate('');
      setDigits('');
      setZoom(1.0);
      setOffsetX(0);
      setOffsetY(0);
      setDetectedBox(null);
      setIsSaving(false);
      setLocationName('');
      setLatitude(undefined);
      setLongitude(undefined);
      setCapturedAt('');
      setIsLocating(false);
      setExifNotice(null);
    }
  }, [isOpen, initialTargetNumber]);

  // Synchronize 1:1 Live Preview Canvas
  useEffect(() => {
    if (!imageObj || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = imageObj.naturalWidth || imageObj.width;
    const H = imageObj.naturalHeight || imageObj.height;
    const { sx, sy, cropSize } = getCropCoordinates(W, H, zoom, offsetX, offsetY);

    canvas.width = 480;
    canvas.height = 480;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, 480, 480);
    ctx.drawImage(imageObj, sx, sy, cropSize, cropSize, 0, 0, 480, 480);
  }, [imageObj, zoom, offsetX, offsetY]);

  // Execute AI recognition on an image dataUrl
  const runPlateRecognition = useCallback(
    async (
      dataUrl: string,
      mimeType: string = 'image/jpeg',
      fileName?: string,
      loadedImg?: HTMLImageElement | null
    ): Promise<boolean> => {
      setIsScanning(true);
      setScanMessage('正在進行 AI 車牌號碼辨識...');

      try {
        const data: PlateRecognitionResult = await recognizePlateWithGemini(dataUrl, mimeType);

        {
          if (data.detected && (data.digits || data.fullPlate)) {
            const detectedPlate = (data.fullPlate || data.digits || '').trim().toUpperCase();
            let detectedDigits = data.digits;
            if (!detectedDigits && detectedPlate) {
              const numOnly = detectedPlate.replace(/\D/g, '');
              if (numOnly) detectedDigits = numOnly.slice(-4).padStart(4, '0');
            }
            if (!detectedDigits) detectedDigits = initialTargetNumber || '0000';
            setFullPlate(detectedPlate);
            setDigits(detectedDigits);
            setScanMessage('辨識成功');

            // If AI returned bounding box, auto-focus on vehicle and plate (unless already 1:1 square)
            let calculatedFraming = { zoom: 1.0, panX: 0, panY: 0 };
            if (data.box) {
              setDetectedBox(data.box);
              const targetImg = loadedImg || imageObj;
              if (targetImg) {
                const W = targetImg.naturalWidth || targetImg.width;
                const H = targetImg.naturalHeight || targetImg.height;
                if (!isSquareAspectRatio(W, H)) {
                  calculatedFraming = calculateOptimalVehicleFraming(W, H, data.box);
                  setZoom(calculatedFraming.zoom);
                  setOffsetX(calculatedFraming.panX);
                  setOffsetY(calculatedFraming.panY);
                } else {
                  setZoom(1.0);
                  setOffsetX(0);
                  setOffsetY(0);
                }
              }
            }

            // Automatic secondary focused re-scan if fullPlate lacks English letters
            const targetImg = loadedImg || imageObj;
            if (targetImg && !/[A-Z]/.test(detectedPlate)) {
              setScanMessage(`已辨識到數字 (${detectedDigits})，正在自動二次放大補齊英文字母...`);
              (async () => {
                try {
                  const focusedCrop = await createCustomSquareCrop(
                    targetImg,
                    calculatedFraming.zoom > 1.0 ? calculatedFraming.zoom : 1.4,
                    calculatedFraming.panX,
                    calculatedFraming.panY,
                    640
                  );
                  const data2: PlateRecognitionResult = await recognizePlateWithGemini(focusedCrop, 'image/jpeg');
                  {
                    if (data2.fullPlate && /[A-Z]/.test(data2.fullPlate)) {
                      setFullPlate(data2.fullPlate.trim().toUpperCase());
                      setScanMessage(`已自動補齊完整車牌 (${data2.fullPlate.trim().toUpperCase()})！`);
                    } else {
                      setScanMessage('辨識完成');
                    }
                  }
                } catch {
                  // Keep initial successful digits
                }
              })();
            }

            return true;
          } else if (fileName) {
            const fileHint = extractDigitsFromText(fileName);
            if (fileHint) {
              setFullPlate(fileHint.fullPlate);
              setDigits(fileHint.digits);
              setScanMessage(`已從檔名解析車牌 (${fileHint.fullPlate})`);
              return true;
            }
          }

          if (data.message) {
            setScanMessage(data.message);
          } else {
            setScanMessage('未能自動辨識出完整車號，請手動確認或調整');
          }
        }
      } catch (err) {
        console.error('[Gemini] 辨識失敗:', err);
        setScanMessage(`辨識失敗: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsScanning(false);
      }
      return false;
    },
    [initialTargetNumber, imageObj]
  );

  // Process image from file
  const processImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setScanMessage('請上傳圖片格式檔案 (JPEG、PNG、WebP 等)');
      return;
    }

    // Extract EXIF Location & Date metadata in background
    extractExifMetadata(file).then((meta) => {
      let notes: string[] = [];
      if (meta.locationName) {
        setLocationName(meta.locationName);
        notes.push(`📍 讀取到拍攝地點：${meta.locationName}`);
      }
      if (typeof meta.latitude === 'number' && typeof meta.longitude === 'number') {
        setLatitude(meta.latitude);
        setLongitude(meta.longitude);
      }
      if (meta.dateTime) {
        setCapturedAt(meta.dateTime);
        notes.push('📅 讀取到原始拍攝時間');
      }
      if (notes.length > 0) {
        setExifNotice(notes.join(' · '));
      }
    });

    const filenameHint = extractDigitsFromText(file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      await handleNewImageData(dataUrl, file.type, filenameHint, file.name);
    };
    reader.readAsDataURL(file);
  };

  // Get current device GPS location on demand
  const handleGetDeviceLocation = async () => {
    setIsLocating(true);
    try {
      const loc = await getCurrentBrowserLocation();
      if (loc) {
        setLocationName(loc.locationName);
        setLatitude(loc.latitude);
        setLongitude(loc.longitude);
        setExifNotice(`📍 已獲取目前定位：${loc.locationName}`);
      } else {
        alert('無法取得即時定位，請確認已在瀏覽器中允許位置存取權限。');
      }
    } catch {
      alert('定位獲取失敗');
    } finally {
      setIsLocating(false);
    }
  };

  const handleNewImageData = async (
    dataUrl: string,
    mimeType: string = 'image/jpeg',
    presetHint?: {
      fullPlate?: string;
      digits?: string;
      locationName?: string;
      box?: [number, number, number, number];
    } | null,
    fileName?: string
  ) => {
    setImageSrc(dataUrl);

    try {
      const img = await loadImage(dataUrl);
      setImageObj(img);
      const W = img.naturalWidth || img.width;
      const H = img.naturalHeight || img.height;

      // If preset sample hint exists
      if (presetHint?.fullPlate && presetHint?.digits) {
        setFullPlate(presetHint.fullPlate);
        setDigits(presetHint.digits);
        if (presetHint.locationName) {
          setLocationName(presetHint.locationName);
          setExifNotice(`📍 示範地點：${presetHint.locationName}`);
        }
        if (presetHint.box) {
          setDetectedBox(presetHint.box);
          const framing = calculateOptimalVehicleFraming(W, H, presetHint.box);
          setZoom(framing.zoom);
          setOffsetX(framing.panX);
          setOffsetY(framing.panY);
        } else {
          const framing = calculateOptimalVehicleFraming(W, H);
          setZoom(framing.zoom);
          setOffsetX(framing.panX);
          setOffsetY(framing.panY);
        }
        setScanMessage(`已載入範例：${presetHint.fullPlate}`);
        return;
      }

      // Initial intelligent framing for 9:16 portrait or wide shots to cut out unwanted sky/ground
      // If user uploaded an image that is already 1:1 square, keep 1.0x unadjusted!
      if (isSquareAspectRatio(W, H)) {
        setZoom(1.0);
        setOffsetX(0);
        setOffsetY(0);
      } else {
        const initialFraming = calculateOptimalVehicleFraming(W, H);
        setZoom(initialFraming.zoom);
        setOffsetX(initialFraming.panX);
        setOffsetY(initialFraming.panY);
      }

      // Optimize image for fast ALPR recognition (downscale large smartphone camera photos)
      let recognitionDataUrl = dataUrl;
      try {
        const optimized = await prepareOptimizedImageForAI(img);
        if (optimized) recognitionDataUrl = optimized;
      } catch {
        // use original dataUrl if optimization fails
      }

      // Run AI recognition
      const aiSucceeded = await runPlateRecognition(recognitionDataUrl, 'image/jpeg', fileName, img);

      // If AI recognition didn't detect plate, check fallback hints or preserve target slot
      if (!aiSucceeded) {
        if (presetHint?.digits) {
          setDigits(presetHint.digits);
          setFullPlate(presetHint.fullPlate || presetHint.digits);
        } else if (initialTargetNumber) {
          setDigits(initialTargetNumber);
          setFullPlate(initialTargetNumber);
        }
      }
    } catch (err: any) {
      console.warn('Image processing failed:', err);
      setIsScanning(false);
    }
  };

  // Viewfinder Pointer Drag Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: offsetX,
      startPanY: offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    // Moving drag left (-dx) pulls right content into view (+panX)
    const panDeltaX = -(dx / 135) * 50;
    const panDeltaY = -(dy / 135) * 50;

    setOffsetX(Math.max(-100, Math.min(100, Math.round(dragStartRef.current.startPanX + panDeltaX))));
    setOffsetY(Math.max(-100, Math.min(100, Math.round(dragStartRef.current.startPanY + panDeltaY))));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((prev) => Math.max(1.0, Math.min(4.0, Number((prev + zoomDelta).toFixed(2)))));
  };

  // Mobile Pinch-to-Zoom
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialPinchDistRef.current = dist;
      initialPinchZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && initialPinchDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / initialPinchDistRef.current;
      const newZoom = Number((initialPinchZoomRef.current * factor).toFixed(2));
      setZoom(Math.max(1.0, Math.min(4.0, newZoom)));
    }
  };

  const handleTouchEnd = () => {
    initialPinchDistRef.current = null;
  };

  // Target number formatted to 4 digits
  const targetNumFormatted = digits
    ? digits.replace(/\D/g, '').padStart(4, '0').slice(-4)
    : initialTargetNumber || '0000';

  const existingRecord = existingPlateMap.get(targetNumFormatted);
  const isAlreadyCollected = !!existingRecord;

  // Check if identical plate (same letters and numbers) already exists
  const isIdenticalDuplicate = (() => {
    if (!existingRecord) return false;
    const normDetected = fullPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (!normDetected) return false;

    const allExistingPlates =
      existingRecord.photos && existingRecord.photos.length > 0
        ? existingRecord.photos.map((p) =>
            (p.fullPlate || existingRecord.number).replace(/[^A-Z0-9]/gi, '').toUpperCase()
          )
        : [(existingRecord.fullPlate || existingRecord.number).replace(/[^A-Z0-9]/gi, '').toUpperCase()];

    return allExistingPlates.includes(normDetected);
  })();

  // Notify if identical duplicate detected after scan completes
  useEffect(() => {
    if (isIdenticalDuplicate && !isScanning && imageSrc) {
      setScanMessage('⚠️ 此車牌已拍攝過，略過上傳');
    }
  }, [isIdenticalDuplicate, isScanning, imageSrc]);

  // Manual Re-Scan with current viewfinder crop
  const handleReScanFocus = async () => {
    if (!imageObj && !imageSrc) return;
    setIsScanning(true);
    setScanMessage('正在以目前特寫視窗重新辨識車牌...');
    try {
      let cropToScan = '';
      if (imageObj) {
        cropToScan = await createCustomSquareCrop(imageObj, zoom, offsetX, offsetY, 640);
      } else if (imageSrc) {
        cropToScan = imageSrc;
      }
      const data: PlateRecognitionResult = await recognizePlateWithGemini(cropToScan, 'image/jpeg');
      if (data.detected && (data.fullPlate || data.digits)) {
        const newPlate = (data.fullPlate || data.digits || '').trim().toUpperCase();
        const numOnly = newPlate.replace(/\D/g, '');
        const newDigits = data.digits || (numOnly ? numOnly.slice(-4).padStart(4, '0') : digits);
        setFullPlate(newPlate);
        if (newDigits) setDigits(newDigits);
        setScanMessage(`重新辨識成功：${newPlate}`);
      } else {
        setScanMessage('未能辨識出更清楚的車牌，請手動調整輸入');
      }
    } catch {
      setScanMessage('重新辨識失敗，請檢查網路連線');
    } finally {
      setIsScanning(false);
    }
  };

  const numberTags = getNumberTags(targetNumFormatted);

  // Save to collection using exact 1:1 viewfinder crop
  const handleSaveToCollection = async (andContinue: boolean = false) => {
    if (!imageObj && !imageSrc) return;
    setIsSaving(true);

    try {
      let finalImageUrl = '';
      if (imageObj) {
        // Crop image using exact zoom, horizontal offset, and vertical offset
        finalImageUrl = await createCustomSquareCrop(imageObj, zoom, offsetX, offsetY, 640);
      } else if (imageSrc) {
        try {
          const img = await loadImage(imageSrc);
          finalImageUrl = await createCustomSquareCrop(img, zoom, offsetX, offsetY, 640);
        } catch {
          finalImageUrl = imageSrc;
        }
      }

      const cleanPlate = fullPlate.trim() ? fullPlate.trim().toUpperCase() : targetNumFormatted;

      const record: PlateRecord = {
        number: targetNumFormatted,
        fullPlate: cleanPlate,
        imageUrl: finalImageUrl || imageSrc || '',
        collectedAt: capturedAt || new Date().toISOString(),
        locationName: locationName.trim() || undefined,
        latitude,
        longitude,
      };

      await onSave(record, replacePhotoId ? { replacePhotoId } : undefined);

      if (andContinue) {
        // Reset state for continuous next image recognition
        setImageSrc(null);
        setImageObj(null);
        setIsScanning(false);
        setScanMessage(null);
        setFullPlate('');
        setDigits('');
        setZoom(1.0);
        setOffsetX(0);
        setOffsetY(0);
        setDetectedBox(null);
        setLocationName('');
        setLatitude(undefined);
        setLongitude(undefined);
        setCapturedAt('');
        setIsLocating(false);
        setExifNotice(null);
        setTimeout(() => {
          fileInputRef.current?.click();
        }, 120);
      } else {
        onClose();
      }
    } catch (err) {
      console.warn('Save error:', err);
      alert('儲存失敗，請重試');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div
        id="uploader-modal"
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-750 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-6 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-400/10 text-amber-400 flex items-center justify-center border border-amber-400/20">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">上傳車牌照片</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onSwitchToBatch && (
              <button
                type="button"
                onClick={() => onSwitchToBatch()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-amber-300 border border-slate-750 hover:border-amber-400/50 text-xs font-semibold transition"
                title="切換為多張批次連續辨識模式"
              >
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>切換批量上傳</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {!imageSrc ? (
            /* Image Picker Area */
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
                  if (files.length > 1 && onSwitchToBatch) {
                    onSwitchToBatch(files);
                  } else if (files.length >= 1) {
                    processImageFile(files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className="group border-2 border-dashed border-slate-700 hover:border-amber-400/80 bg-slate-950/50 hover:bg-slate-900/80 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    if (files.length > 1 && onSwitchToBatch) {
                      onSwitchToBatch(files);
                    } else if (files.length === 1) {
                      processImageFile(files[0]);
                    }
                    e.target.value = '';
                  }}
                />
                <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400 flex items-center justify-center mb-3 group-hover:scale-110 transition">
                  <Upload className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-semibold text-slate-200 group-hover:text-amber-300 transition">
                  點擊選取照片（支援單張或多張）
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  支援手機拍攝或相簿照片，若一次選取多張將自動啟動批次高速辨識
                </p>
                {initialTargetNumber && (
                  <div className="mt-3 px-3 py-1 bg-amber-400/10 border border-amber-400/20 rounded-full text-xs font-mono text-amber-300">
                    目標號碼槽：#{initialTargetNumber}
                  </div>
                )}
                {onSwitchToBatch && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSwitchToBatch();
                    }}
                    className="mt-3 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-semibold transition active:scale-95"
                  >
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span>一次上傳多張照片（批次辨識）</span>
                  </button>
                )}
              </div>

              {/* Sample Photos for quick testing */}
              <div>
                <div className="text-xs font-medium text-slate-400 mb-2">
                  或點擊測試範例照片：
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SAMPLE_PLATES.slice(0, 3).map((sample) => (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => {
                        const sampleDataUrl = sample.generateDataUrl();
                        handleNewImageData(sampleDataUrl, 'image/jpeg', {
                          fullPlate: sample.plate,
                          digits: sample.digits,
                          locationName: sample.locationName,
                        });
                      }}
                      className="flex flex-col items-center bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-amber-400/60 rounded-xl p-2.5 transition text-center"
                    >
                      <span className="text-xs font-mono font-bold text-amber-300">
                        {sample.plate}
                      </span>
                      <span className="text-[10px] text-slate-400 mt-0.5">
                        槽號 #{sample.digits}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Image Selected: 1:1 Viewfinder with Nine-Grid & Sliders */
            <div className="space-y-4">
              {/* Recognition status banner */}
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border bg-slate-950/60 border-slate-800 text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  {isScanning ? (
                    <>
                      <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                      <span className="text-amber-300 font-medium">辨識中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-slate-300 truncate">
                        {scanMessage || '已載入照片，可使用下方滑桿調整 1:1 取景位置與縮放'}
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => imageSrc && runPlateRecognition(imageSrc)}
                  className="shrink-0 flex items-center gap-1 text-[11px] px-2.5 py-1 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded-lg font-medium transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>重新辨識</span>
                </button>
              </div>

              {/* Main Workspace: 1:1 Viewfinder (Left) & Controls + Form (Right) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
                {/* 1:1 Square Viewfinder with Nine-Grid */}
                <div className="flex flex-col items-center gap-2.5">
                  <div
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onWheel={handleWheel}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    className="relative w-full max-w-[280px] aspect-square bg-slate-950 rounded-2xl overflow-hidden border-2 border-amber-400 shadow-xl select-none cursor-grab active:cursor-grabbing touch-none"
                    title="可直接在畫面上拖曳平移，或雙指捏合/滾輪縮放"
                  >
                    {/* Live Synchronized 1:1 Crop Canvas */}
                    <canvas
                      ref={previewCanvasRef}
                      className="w-full h-full object-contain pointer-events-none"
                    />

                    {/* Nine-Grid (九宮格參考線 - Zero mask, clear viewfinder) */}
                    {showGrid && (
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
                    )}

                    {/* Corner Framing Marks */}
                    <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-400 pointer-events-none" />
                    <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-400 pointer-events-none" />
                    <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-400 pointer-events-none" />
                    <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-400 pointer-events-none" />

                    {/* 1:1 Tag & Grid Toggle */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 pointer-events-auto">
                      <button
                        type="button"
                        onClick={() => setShowGrid((g) => !g)}
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded backdrop-blur-sm border transition flex items-center gap-1 ${
                          showGrid
                            ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                            : 'bg-slate-950/80 text-slate-400 border-slate-700'
                        }`}
                        title="切換九宮格參考線"
                      >
                        <Grid3X3 className="w-3 h-3" />
                        <span>九宮格</span>
                      </button>
                    </div>

                    <div className="absolute bottom-2 right-2 bg-slate-950/85 backdrop-blur-sm text-amber-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-750">
                      1:1 特寫
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setImageSrc(null);
                      setImageObj(null);
                      setScanMessage(null);
                      setZoom(1.0);
                      setOffsetX(0);
                      setOffsetY(0);
                    }}
                    className="text-xs text-slate-400 hover:text-amber-300 transition"
                  >
                    更換其他照片
                  </button>
                </div>

                {/* Framing Sliders & Form Controls */}
                <div className="space-y-4">
                  {/* Sliders Box */}
                  <div className="crop-controls-card bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-3 text-xs">
                    {/* Zoom Section with Quick Presets */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5 font-medium text-[11px]">
                          <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                          畫面縮放 (Zoom)
                        </span>
                        <span className="font-mono text-amber-300 text-[11px] font-bold">
                          {zoom.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.05"
                        value={zoom}
                        onChange={(e) => setZoom(parseFloat(e.target.value))}
                        className="crop-range-slider w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />

                      {/* Quick Zoom Presets */}
                      <div className="grid grid-cols-4 gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setZoom(1.0)}
                          className={`py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                            zoom === 1.0
                              ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          1.0x 全景
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoom(1.35)}
                          className={`py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                            Math.abs(zoom - 1.35) < 0.05
                              ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                          title="最適合 9:16 直拍照片，去除多餘天空與地面"
                        >
                          1.35x 去背景
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoom(1.8)}
                          className={`py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                            Math.abs(zoom - 1.8) < 0.05
                              ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          1.8x 聚焦
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoom(2.5)}
                          className={`py-1 px-1 rounded text-[10px] font-medium border text-center transition ${
                            Math.abs(zoom - 2.5) < 0.05
                              ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          2.5x 特寫
                        </button>
                      </div>
                    </div>

                    {/* Horizontal Offset Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5 font-medium text-[11px]">
                          <MoveHorizontal className="w-3.5 h-3.5 text-amber-400" />
                          水平位移 (X)
                        </span>
                        <span className="font-mono text-slate-400 text-[11px]">
                          {offsetX > 0 ? `+${offsetX}` : offsetX}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={offsetX}
                        onChange={(e) => setOffsetX(parseInt(e.target.value, 10))}
                        className="crop-range-slider w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                    </div>

                    {/* Vertical Offset Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5 font-medium text-[11px]">
                          <MoveVertical className="w-3.5 h-3.5 text-amber-400" />
                          垂直位移 (Y)
                        </span>
                        <span className="font-mono text-slate-400 text-[11px]">
                          {offsetY > 0 ? `+${offsetY}` : offsetY}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={offsetY}
                        onChange={(e) => setOffsetY(parseInt(e.target.value, 10))}
                        className="crop-range-slider w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                    </div>

                    {/* Position Quick Align & Reset */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-800/80">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setOffsetX(0);
                            setOffsetY(0);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 text-[10px]"
                        >
                          置中
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOffsetX(0);
                            setOffsetY(28);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 text-[10px]"
                          title="適合 9:16 車輛在下半部的構圖"
                        >
                          偏下 (9:16)
                        </button>
                        {detectedBox && imageObj && (
                          <button
                            type="button"
                            onClick={() => {
                              const W = imageObj.naturalWidth || imageObj.width;
                              const H = imageObj.naturalHeight || imageObj.height;
                              const framing = calculateOptimalVehicleFraming(W, H, detectedBox);
                              setZoom(framing.zoom);
                              setOffsetX(framing.panX);
                              setOffsetY(framing.panY);
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/30 text-[10px] font-semibold"
                          >
                            <Crosshair className="w-2.5 h-2.5" />
                            <span>AI對焦</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (imageObj) {
                            const W = imageObj.naturalWidth || imageObj.width;
                            const H = imageObj.naturalHeight || imageObj.height;
                            const framing = calculateOptimalVehicleFraming(W, H, detectedBox);
                            setZoom(framing.zoom);
                            setOffsetX(framing.panX);
                            setOffsetY(framing.panY);
                          } else {
                            setZoom(1.0);
                            setOffsetX(0);
                            setOffsetY(0);
                          }
                        }}
                        className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 transition ml-auto"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重設構圖</span>
                      </button>
                    </div>
                  </div>

                  {/* License Plate Number Input */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-300">
                        完整車牌
                      </label>
                      <button
                        type="button"
                        onClick={handleReScanFocus}
                        disabled={isScanning || (!imageObj && !imageSrc)}
                        className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 disabled:opacity-40 transition cursor-pointer"
                        title="以目前特寫視窗重新辨識車牌英文字母與數字"
                      >
                        <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                        <span>重新辨識</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={fullPlate}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setFullPlate(val);
                        const numOnly = val.replace(/\D/g, '');
                        if (numOnly.length >= 4) {
                          setDigits(numOnly.slice(-4));
                        } else if (numOnly.length > 0 && (!digits || digits === '0000')) {
                          setDigits(numOnly.padStart(4, '0'));
                        }
                      }}
                      placeholder="完整車牌 (例如 ABC-1234)"
                      className="w-full bg-slate-950 text-slate-100 font-mono font-bold text-base px-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* 4-Digit Collection Slot */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-300">
                        歸檔號碼槽 (0000-9999)
                      </label>
                      {targetNumFormatted && !isIdenticalDuplicate && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                            replacePhotoId
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : isAlreadyCollected
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {replacePhotoId
                            ? '🔄 將替換此張照片'
                            : isAlreadyCollected
                            ? `📷 此號現存 ${existingRecord.photos?.length || 1} 張照片 (一併收錄)`
                            : '✨ 新號碼入庫'}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        maxLength={4}
                        value={digits}
                        onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
                        placeholder="0000"
                        className="w-full bg-slate-950 text-amber-300 font-mono font-black text-xl tracking-widest px-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-amber-400"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                        #{targetNumFormatted}
                      </span>
                    </div>

                    {/* Special tags preview */}
                    {numberTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {numberTags.map((t) => (
                          <span
                            key={t.tag}
                            className={`text-[10px] px-2 py-0.5 rounded border font-medium ${t.bgClass} ${t.colorClass}`}
                          >
                            {t.emoji} {t.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Location & Date Metadata Card */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-2.5">
                    {/* EXIF Notice Badge */}
                    {exifNotice && (
                      <div className="bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 rounded-lg text-xs text-amber-300 flex items-center gap-1.5 animate-in fade-in duration-200">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">{exifNotice}</span>
                      </div>
                    )}

                    {/* Location Input & GPS Trigger */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-amber-400" />
                          <span>拍攝地點 (自動讀取/手動)</span>
                        </label>
                        <button
                          type="button"
                          disabled={isLocating}
                          onClick={handleGetDeviceLocation}
                          title="獲取當前手機/瀏覽器 GPS 定位"
                          className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 bg-amber-400/10 hover:bg-amber-400/20 px-2 py-0.5 rounded-md border border-amber-400/30 transition disabled:opacity-50"
                        >
                          <Navigation className={`w-3 h-3 ${isLocating ? 'animate-spin' : ''}`} />
                          <span>{isLocating ? '定位中...' : '📍 獲取即時 GPS'}</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={locationName}
                        onChange={(e) => setLocationName(e.target.value)}
                        placeholder="例：台北市信義區、台中市西屯區..."
                        className="w-full bg-slate-900 text-slate-100 text-xs px-3 py-1.5 rounded-lg border border-slate-750 focus:outline-none focus:border-amber-400 font-sans"
                      />
                    </div>

                    {/* Captured Date & Time */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1 mb-1">
                        <Calendar className="w-3.5 h-3.5 text-amber-400" />
                        <span>拍攝/收集時間</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={
                          capturedAt
                            ? new Date(new Date(capturedAt).getTime() - new Date().getTimezoneOffset() * 60000)
                                .toISOString()
                                .slice(0, 16)
                            : ''
                        }
                        onChange={(e) => {
                          if (e.target.value) {
                            setCapturedAt(new Date(e.target.value).toISOString());
                          } else {
                            setCapturedAt('');
                          }
                        }}
                        className="w-full bg-slate-900 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-750 focus:outline-none focus:border-amber-400 font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            取消
          </button>
          {imageSrc && (
            <>
              <button
                type="button"
                disabled={isSaving || isIdenticalDuplicate}
                onClick={() => handleSaveToCollection(true)}
                title="儲存此張並直接開啟選取下一張照片"
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-750 disabled:opacity-50 disabled:cursor-not-allowed text-amber-300 border border-slate-700 hover:border-amber-400/50 font-bold px-3.5 py-2 rounded-lg text-xs transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" />
                <span>儲存並繼續新增下一張</span>
              </button>
              <button
                id="save-to-collection-btn"
                disabled={isSaving || isIdenticalDuplicate}
                onClick={() => handleSaveToCollection(false)}
                className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold px-5 py-2 rounded-lg text-xs shadow-lg shadow-amber-500/20 transition active:scale-95"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>儲存中...</span>
                  </>
                ) : isIdenticalDuplicate ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-slate-900" />
                    <span>此車牌已拍攝過，略過上傳</span>
                  </>
                ) : (
                  <span>
                    {replacePhotoId
                      ? `儲存替換照片 (#${targetNumFormatted})`
                      : isAlreadyCollected
                      ? `新增照片至此號碼 (#${targetNumFormatted})`
                      : `儲存車牌照片 (#${targetNumFormatted})`}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
