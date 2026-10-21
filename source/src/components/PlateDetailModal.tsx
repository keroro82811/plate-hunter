import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Calendar,
  Tag,
  Edit3,
  Car,
  Trash2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Layers,
  Image as ImageIcon,
  MapPin,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { PlateRecord, PlatePhotoItem } from '../types';
import { getNumberTags } from '../services/numberClassifier';
import { isJapanPlate, isRealPhotoImage, isSyntheticSvgImage } from '../utils/plateHelper';
import { getPlate } from '../services/db';

interface PlateDetailModalProps {
  record: PlateRecord | null;
  initialPhotoId?: string;
  onClose: () => void;
  onReplace: (number: string, photoId?: string) => void;
  onAddPhoto?: (number: string) => void;
  onDelete?: (number: string) => Promise<void> | void;
  onDeletePhoto?: (number: string, photoId: string) => Promise<void> | void;
  onUpdateLocation?: (number: string, photoId: string, newLocation: string) => Promise<void> | void;
  onUpdateFullPlate?: (number: string, photoId: string, newFullPlate: string) => Promise<void> | void;
}

export const PlateDetailModal: React.FC<PlateDetailModalProps> = ({
  record,
  initialPhotoId,
  onClose,
  onReplace,
  onAddPhoto,
  onDelete,
  onDeletePhoto,
  onUpdateLocation,
  onUpdateFullPlate,
}) => {
  const [localRecord, setLocalRecord] = useState<PlateRecord | null>(record);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isEditingLoc, setIsEditingLoc] = useState(false);
  const [locInput, setLocInput] = useState('');
  const [isEditingPlate, setIsEditingPlate] = useState(false);
  const [plateInput, setPlateInput] = useState('');
  const [imgLoading, setImgLoading] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [failedSources, setFailedSources] = useState<Set<string>>(new Set());

  // Sync incoming record and auto-fetch missing full image data asynchronously
  useEffect(() => {
    setLocalRecord(record);
    if (record) {
      const hasImg = Boolean(
        (record.imageUrl && record.imageUrl.length > 50) ||
        (record.photos && record.photos.some((p) => p.imageUrl && p.imageUrl.length > 50))
      );
      if (!hasImg) {
        getPlate(record.number)
          .then((full) => {
            if (full) {
              setLocalRecord(full);
            }
          })
          .catch(() => {});
      }
    }
  }, [record]);

  const activeRecord = localRecord || record;

  // Derive photos list with fallback (chronological: oldest to newest, e.g. 3/23 capture first)
  const photos: PlatePhotoItem[] = React.useMemo(() => {
    if (!activeRecord) return [];
    if (activeRecord.photos && Array.isArray(activeRecord.photos) && activeRecord.photos.length > 0) {
      const list = [...activeRecord.photos];
      list.sort((a, b) => {
        const tA = a.collectedAt ? new Date(a.collectedAt).getTime() : 0;
        const tB = b.collectedAt ? new Date(b.collectedAt).getTime() : 0;
        return tA - tB;
      });
      return list;
    }
    return [
      {
        id: `${activeRecord.number}_init`,
        fullPlate: activeRecord.fullPlate || activeRecord.number,
        imageUrl: activeRecord.imageUrl,
        originalImageUrl: activeRecord.originalImageUrl,
        collectedAt: activeRecord.collectedAt,
        vehicleType: activeRecord.vehicleType,
        vehicleColor: activeRecord.vehicleColor,
        notes: activeRecord.notes,
        locationName: activeRecord.locationName,
        latitude: activeRecord.latitude,
        longitude: activeRecord.longitude,
        cropSettings: activeRecord.cropSettings,
      },
    ];
  }, [activeRecord]);

  // Reset index when record number or initialPhotoId changes
  useEffect(() => {
    if (initialPhotoId && photos.length > 0) {
      const idx = photos.findIndex((p) => p.id === initialPhotoId);
      if (idx !== -1) {
        setCurrentIndex(idx);
        setShowDeleteConfirm(false);
        setIsEditingLoc(false);
        return;
      }
    }
    setCurrentIndex(0);
    setShowDeleteConfirm(false);
    setIsEditingLoc(false);
  }, [record?.number, initialPhotoId]);

  // Ensure currentIndex stays within bounds
  useEffect(() => {
    if (currentIndex >= photos.length && photos.length > 0) {
      setCurrentIndex(photos.length - 1);
    }
  }, [photos.length, currentIndex]);

  const currentPhoto = photos[currentIndex] || photos[0];

  useEffect(() => {
    setIsEditingLoc(false);
    setLocInput(currentPhoto?.locationName || '');
    setIsEditingPlate(false);
    setPlateInput(currentPhoto?.fullPlate || record?.number || '');
  }, [currentIndex, currentPhoto?.id, currentPhoto?.fullPlate, record?.number]);

  const handleSaveLocation = async () => {
    if (!record || !currentPhoto || !onUpdateLocation) return;
    await onUpdateLocation(record.number, currentPhoto.id, locInput.trim());
    setIsEditingLoc(false);
  };

  const handleSaveFullPlate = async () => {
    if (!record || !currentPhoto || !onUpdateFullPlate) return;
    const cleanPlate = plateInput.trim().toUpperCase() || record.number;
    await onUpdateFullPlate(record.number, currentPhoto.id, cleanPlate);
    setIsEditingPlate(false);
  };

  // Navigation handlers
  const handlePrevPhoto = () => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
  };

  const handleNextPhoto = () => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handlePrevPhoto();
      } else if (e.key === 'ArrowRight') {
        handleNextPhoto();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, photos.length]);

  // Touch Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    if (diff > 45) {
      // Swiped left -> next photo
      handleNextPhoto();
    } else if (diff < -45) {
      // Swiped right -> prev photo
      handlePrevPhoto();
    }
    setTouchStartX(null);
  };

  // Reset image loading states when active plate or photo changes
  useEffect(() => {
    setImgLoading(true);
    setImgError(false);
    setFailedSources(new Set());
  }, [activeRecord?.number, currentIndex, currentPhoto?.id]);

  // Candidate sources with real captured photo data first, then server endpoints fallback
  const candidateSources = React.useMemo(() => {
    if (!activeRecord) return [];
    const padded = activeRecord.number.padStart(4, '0');
    const sources: string[] = [];

    // 1. Primary: User's actual photo data (dataUrl / URL stored in client/cloud)
    if (isRealPhotoImage(currentPhoto?.imageUrl)) {
      sources.push(currentPhoto!.imageUrl!.trim());
    }
    if (isRealPhotoImage(currentPhoto?.originalImageUrl)) {
      sources.push(currentPhoto!.originalImageUrl!.trim());
    }
    if (Array.isArray(activeRecord.photos)) {
      for (const p of activeRecord.photos) {
        if (isRealPhotoImage(p?.imageUrl)) {
          sources.push(p.imageUrl!.trim());
        }
        if (isRealPhotoImage(p?.originalImageUrl)) {
          sources.push(p.originalImageUrl!.trim());
        }
      }
    }
    if (isRealPhotoImage(activeRecord.imageUrl)) {
      sources.push(activeRecord.imageUrl!.trim());
    }
    if (isRealPhotoImage(activeRecord.originalImageUrl)) {
      sources.push(activeRecord.originalImageUrl!.trim());
    }

    // 2. Fallback: Only add server endpoint if the record or photo explicitly pointed to server API
    if (currentPhoto?.imageUrl && currentPhoto.imageUrl.startsWith('/api/plates/')) {
      sources.push(currentPhoto.imageUrl);
    } else if (activeRecord.imageUrl && activeRecord.imageUrl.startsWith('/api/plates/')) {
      sources.push(activeRecord.imageUrl);
    }

    return Array.from(new Set(sources));
  }, [activeRecord, currentPhoto]);

  const activeSrc = candidateSources.find((s) => !failedSources.has(s)) || '';

  // Synchronize loading and error states whenever activeSrc changes
  useEffect(() => {
    if (activeSrc) {
      setImgLoading(true);
      setImgError(false);
    } else {
      setImgLoading(false);
      setImgError(true);
    }
  }, [activeSrc]);

  if (!activeRecord || !currentPhoto) return null;

  const tags = getNumberTags(activeRecord.number);
  const formattedDate = new Date(currentPhoto.collectedAt || activeRecord.collectedAt).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleDownloadImage = () => {
    const padded = activeRecord.number.padStart(4, '0');
    const a = document.createElement('a');
    a.href = activeSrc || `/api/plates/${padded}/image`;
    a.download = `Plate_${padded}_${currentPhoto.fullPlate || activeRecord.number}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isMultiplePhotos = photos.length > 1;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div
        id="plate-detail-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[95vh]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono font-black text-xl text-amber-300">
              #{activeRecord.number}
            </span>
            <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700 font-mono font-semibold flex items-center gap-1">
              <Layers className="w-3 h-3 text-amber-400" />
              <span>共存有 {photos.length} 張照片</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onAddPhoto && (
              <button
                onClick={() => {
                  onAddPhoto(activeRecord.number);
                  onClose();
                }}
                title="新增此號碼的其他照片 (例如不同英文字母)"
                className="hidden sm:flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg text-xs font-semibold transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增同號照片</span>
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

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          <div className="flex flex-col sm:flex-row gap-5 items-center">
            {/* 1:1 Image Frame with Swipe & Carousel Controls */}
            <div className="flex flex-col items-center gap-3 shrink-0">
              <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className="relative w-64 h-64 sm:w-72 sm:h-72 bg-slate-900 rounded-2xl overflow-hidden border-2 border-amber-400/80 shadow-2xl select-none group"
              >
                {activeSrc && !imgError ? (
                  <div className="w-full h-full relative">
                    <img
                      key={activeSrc}
                      src={activeSrc}
                      alt={`車牌 ${currentPhoto?.fullPlate || activeRecord.number}`}
                      className={`w-full h-full object-cover transition-opacity duration-200 ${
                        imgLoading ? 'opacity-0' : 'opacity-100'
                      }`}
                      onLoad={() => {
                        setImgLoading(false);
                        setImgError(false);
                      }}
                      onError={() => {
                        setFailedSources((prev) => {
                          const next = new Set(prev);
                          next.add(activeSrc);
                          const remaining = candidateSources.filter((s) => !next.has(s));
                          if (remaining.length === 0) {
                            setImgLoading(false);
                            setImgError(true);
                          }
                          return next;
                        });
                      }}
                    />
                    {imgLoading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-amber-400 gap-2 z-10">
                        <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                        <span className="text-[11px] font-mono text-slate-300">讀取照片中...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-300 p-4 text-center gap-2">
                    <span className="font-mono font-black text-2xl text-amber-300">#{activeRecord.number}</span>
                    <span className="text-xs text-slate-400 font-sans">{currentPhoto?.fullPlate || activeRecord.fullPlate || '暫無相片'}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFailedSources(new Set());
                        setImgLoading(true);
                        setImgError(false);
                      }}
                      className="mt-2 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>重新整理相片</span>
                    </button>
                  </div>
                )}

                {/* Index Indicator Pill */}
                <div className="absolute top-2.5 left-2.5 bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-full text-xs font-mono font-bold text-amber-300 border border-amber-400/40 flex items-center gap-1 shadow-md z-10 pointer-events-none">
                  <ImageIcon className="w-3 h-3 text-amber-400" />
                  <span>
                    {currentIndex + 1} / {photos.length}
                  </span>
                </div>

                {/* Left / Right Carousel Arrow Buttons */}
                {isMultiplePhotos && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrevPhoto();
                      }}
                      title="上一張照片 (或鍵盤向左鍵 / 左右滑動)"
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-slate-700/80 text-white shadow-xl flex items-center justify-center transition active:scale-95 group-hover:opacity-100 sm:opacity-85 z-10"
                    >
                      <ChevronLeft className="w-5 h-5 text-amber-300" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNextPhoto();
                      }}
                      title="下一張照片 (或鍵盤向右鍵 / 左右滑動)"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-slate-700/80 text-white shadow-xl flex items-center justify-center transition active:scale-95 group-hover:opacity-100 sm:opacity-85 z-10"
                    >
                      <ChevronRight className="w-5 h-5 text-amber-300" />
                    </button>
                  </>
                )}
              </div>

              {/* Photo Indicator Dots or Mini Thumbnail Bar */}
              {isMultiplePhotos && (
                <div className="w-full max-w-[288px] flex items-center justify-center gap-1.5 overflow-x-auto py-1 px-1">
                  {photos.map((p, idx) => {
                    const isSelected = idx === currentIndex;
                    const padded = activeRecord.number.padStart(4, '0');
                    const thumbSrc =
                      (p.imageUrl && p.imageUrl.trim()) ||
                      (p.originalImageUrl && p.originalImageUrl.trim()) ||
                      (p.id ? `/api/plates/${padded}/photos/${encodeURIComponent(p.id)}/image` : null) ||
                      `/api/plates/${padded}/image`;

                    return (
                      <button
                        key={`${p.id || 'photo'}_${idx}`}
                        type="button"
                        onClick={() => setCurrentIndex(idx)}
                        title={`切換到 ${p.fullPlate}`}
                        className={`relative w-10 h-10 rounded-lg overflow-hidden border-2 transition shrink-0 active:scale-95 ${
                          isSelected
                            ? 'border-amber-400 ring-2 ring-amber-400/40 scale-105'
                            : 'border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-600'
                        }`}
                      >
                        {thumbSrc ? (
                          <img
                            src={thumbSrc}
                            alt={p.fullPlate}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.src.includes(`/api/plates/${padded}/image`) && !target.src.startsWith('data:')) {
                                target.src = `/api/plates/${padded}/image`;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-400 font-mono text-[10px] font-bold">
                            {idx + 1}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Information Card (Changes with active photo) */}
            <div className="flex-1 space-y-4 w-full">
              {/* Plate display banner with inline editing */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-center shadow-inner relative group">
                <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-center gap-1.5">
                  <span>完整辨識字號</span>
                  {isMultiplePhotos && (
                    <span className="text-[10px] text-amber-400/80 font-mono">
                      (第 {currentIndex + 1} 張)
                    </span>
                  )}
                  {onUpdateFullPlate && !isEditingPlate && (
                    <button
                      type="button"
                      onClick={() => setIsEditingPlate(true)}
                      title="修改完整車牌（如補充英文字母 ABC-4000）"
                      className="ml-1 p-0.5 text-slate-500 hover:text-amber-400 rounded transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {isEditingPlate ? (
                  <div className="flex items-center justify-center gap-2 max-w-xs mx-auto mt-1">
                    <input
                      type="text"
                      value={plateInput}
                      onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveFullPlate();
                        if (e.key === 'Escape') {
                          setIsEditingPlate(false);
                          setPlateInput(currentPhoto.fullPlate || record?.number || '');
                        }
                      }}
                      placeholder="例：ABC-4000 或 4000-XX"
                      autoFocus
                      className="bg-slate-900 border border-amber-400/70 text-amber-300 font-mono font-black text-lg px-2.5 py-1 rounded-lg text-center focus:outline-none w-full"
                    />
                    <button
                      type="button"
                      onClick={handleSaveFullPlate}
                      className="px-2.5 py-1 bg-amber-400 text-slate-950 font-bold rounded-lg text-xs hover:bg-amber-300 shrink-0 cursor-pointer"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingPlate(false);
                        setPlateInput(currentPhoto.fullPlate || record?.number || '');
                      }}
                      className="px-2 py-1 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700 shrink-0 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      if (onUpdateFullPlate) {
                        setIsEditingPlate(true);
                      }
                    }}
                    title="點擊修改完整車牌（例如補充英文字母 ABC-1234）"
                    className="font-mono font-black text-2xl tracking-wider text-slate-100 flex items-center justify-center gap-2 cursor-pointer hover:text-amber-300 transition py-0.5"
                  >
                    <span>{currentPhoto.fullPlate}</span>
                  </div>
                )}
              </div>

              {/* Special tags for this number */}
              {(tags.length > 0 || isJapanPlate(currentPhoto)) && (
                <div>
                  <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-amber-400" />
                    <span>特殊號碼屬性：</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t.tag}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold ${t.bgClass} ${t.colorClass}`}
                      >
                        {t.emoji} {t.label}
                      </span>
                    ))}
                    {isJapanPlate(currentPhoto) && (
                      <span
                        title="隱藏款屬性：日本拍攝車牌 (JP)"
                        className="text-xs px-2.5 py-1 rounded-lg border font-semibold bg-rose-950/80 border-rose-500/50 text-rose-300 font-mono shadow-xs"
                      >
                        JP
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata details for this specific photo */}
              <div className="space-y-2 text-xs text-slate-300 bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-slate-400 shrink-0">拍攝時間：</span>
                  <span className="font-mono">{formattedDate}</span>
                </div>

                {/* Location row */}
                {isEditingLoc ? (
                  <div className="flex items-center gap-2 bg-slate-900 border border-amber-400/50 rounded-lg p-1.5 animate-in fade-in">
                    <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                    <input
                      type="text"
                      value={locInput}
                      onChange={(e) => setLocInput(e.target.value)}
                      placeholder="輸入出沒地點（例如：台北市中山區、國道一號）"
                      className="bg-transparent text-xs text-white focus:outline-none flex-1 min-w-0"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveLocation();
                        if (e.key === 'Escape') setIsEditingLoc(false);
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSaveLocation}
                      className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold text-xs hover:bg-amber-300 transition"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingLoc(false)}
                      className="p-1 text-slate-400 hover:text-white transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  (() => {
                    const photoLocation =
                      currentPhoto.locationName ||
                      (photos.length === 1 ? activeRecord.locationName : undefined);
                    return (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="text-slate-400 shrink-0">拍攝地點：</span>
                          {photoLocation ? (
                            <span className="text-emerald-300 font-medium truncate">
                              {photoLocation}
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">未填寫</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {photoLocation && (
                            <a
                              href={
                                currentPhoto.latitude && currentPhoto.longitude
                                  ? `https://www.google.com/maps?q=${currentPhoto.latitude},${currentPhoto.longitude}`
                                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                      photoLocation
                                    )}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              title="在 Google Maps 查看出沒地點"
                              className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 bg-amber-400/10 hover:bg-amber-400/20 px-2 py-0.5 rounded border border-amber-400/30 transition"
                            >
                              <span>地圖</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {onUpdateLocation && (
                            <button
                              type="button"
                              onClick={() => {
                                setLocInput(photoLocation || '');
                                setIsEditingLoc(true);
                              }}
                              title={photoLocation ? '修改拍攝地點' : '新增拍攝地點'}
                              className="text-[11px] text-slate-400 hover:text-amber-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-slate-800 transition"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>{photoLocation ? '修改' : '填寫'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}

                {(currentPhoto.vehicleType || currentPhoto.vehicleColor) && (
                  <div className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-400">車輛特徵：</span>
                    <span>
                      {[currentPhoto.vehicleColor, currentPhoto.vehicleType]
                        .filter(Boolean)
                        .join(' ')}
                    </span>
                  </div>
                )}

                {currentPhoto.notes && (
                  <div className="pt-1 text-slate-400 text-[11px] border-t border-slate-800">
                    備註：{currentPhoto.notes}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Floating Modal (Popup) */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 z-30 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-900 border border-rose-500/40 rounded-2xl p-5 max-w-sm w-full shadow-2xl text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">
                  {isMultiplePhotos ? '確認刪除此張車牌照片？' : '確認刪除這張車牌照片？'}
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isMultiplePhotos ? (
                    <>
                      將從號碼 <span className="text-amber-400 font-mono font-bold">#{activeRecord.number}</span> 刪除車牌【
                      <span className="text-white font-mono font-bold">{currentPhoto.fullPlate}</span>】的照片。
                      <br />
                      此號碼仍會保留其餘 <span className="text-amber-400 font-bold">{photos.length - 1}</span> 張照片，總體收集進度不受影響。
                    </>
                  ) : (
                    <>
                      車牌號碼 <span className="text-amber-400 font-mono font-bold">#{activeRecord.number}</span>（
                      {currentPhoto.fullPlate}）將從收集冊中移除，收集進度與徽章積分將同步重新計算。
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-755 text-slate-300 border border-slate-700 transition active:scale-95"
                >
                  取消返回
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      if (isMultiplePhotos && onDeletePhoto) {
                        await onDeletePhoto(activeRecord.number, currentPhoto.id);
                        setShowDeleteConfirm(false);
                      } else if (onDelete) {
                        await onDelete(activeRecord.number);
                        setShowDeleteConfirm(false);
                        onClose();
                      }
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isDeleting ? '刪除中...' : '確定刪除'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          {/* Left: Delete Button */}
          {onDelete ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={showDeleteConfirm || isDeleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 transition active:scale-95 disabled:opacity-50"
              title={isMultiplePhotos ? '刪除目前這張照片' : '從收集冊刪除此車牌'}
            >
              <Trash2 className="w-4 h-4" />
              <span>{isMultiplePhotos ? '刪除此張' : '刪除照片'}</span>
            </button>
          ) : (
            <div />
          )}

          {/* Right: Add new, Replace & Download */}
          <div className="flex items-center gap-2">
            {onAddPhoto && (
              <button
                onClick={() => {
                  onAddPhoto(activeRecord.number);
                  onClose();
                }}
                className="sm:hidden flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-2 rounded-lg text-xs font-semibold transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增照片</span>
              </button>
            )}

            <button
              onClick={() => {
                onReplace(activeRecord.number, currentPhoto.id);
                onClose();
              }}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-700 transition"
              title="替換目前這張照片"
            >
              <Edit3 className="w-4 h-4" />
              <span>更換此張</span>
            </button>

            <button
              onClick={handleDownloadImage}
              className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 px-3.5 sm:px-4 py-2 rounded-lg text-xs font-bold shadow-md shadow-amber-500/10 transition active:scale-95 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>下載此照</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
