import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  X,
  Check,
  Lock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  PartyPopper,
  Info,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ComputedBadge, getBadgeTargetNumbers } from '../services/achievements';
import { renderBadgeIcon, getTierStyle } from './BadgeItem';
import { PlateRecord } from '../types';
import { getPlate } from '../services/db';

interface BadgeDetailModalProps {
  badge: ComputedBadge | null;
  isOpen: boolean;
  onClose: () => void;
  plateMap: Map<string, PlateRecord>;
  onSelectPlate: (number: string, photoId?: string) => void;
}

export const BadgeDetailModal: React.FC<BadgeDetailModalProps> = ({
  badge,
  isOpen,
  onClose,
  plateMap,
  onSelectPlate,
}) => {
  const [selectedFilterNumber, setSelectedFilterNumber] = useState<string | null>(null);
  const [activePhotoItem, setActivePhotoItem] = useState<{
    number: string;
    photoId?: string;
    fullPlate: string;
    imageUrl: string;
    collectedAt?: string;
  } | null>(null);
  const [loadedFullRecords, setLoadedFullRecords] = useState<Map<string, PlateRecord>>(new Map());
  const previewRef = useRef<HTMLDivElement>(null);
  const contentBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActivePhotoItem(null);
    setSelectedFilterNumber(null);
  }, [badge?.id, isOpen]);

  // Smoothly scroll down to preview photo when a plate is clicked
  useEffect(() => {
    if (activePhotoItem) {
      const timer = setTimeout(() => {
        if (contentBodyRef.current) {
          contentBodyRef.current.scrollTo({
            top: contentBodyRef.current.scrollHeight,
            behavior: 'smooth',
          });
        } else if (previewRef.current) {
          previewRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activePhotoItem]);

  // Robust image resolver for activePhotoItem with multi-tier fallback
  const previewImage = useMemo(() => {
    if (!activePhotoItem) return '';
    // 1. Direct from activePhotoItem
    if (activePhotoItem.imageUrl && activePhotoItem.imageUrl.length > 50) {
      return activePhotoItem.imageUrl;
    }
    // 2. From plateMap prop
    const mapRec = plateMap.get(activePhotoItem.number);
    if (mapRec) {
      if (activePhotoItem.photoId && mapRec.photos) {
        const p = mapRec.photos.find((ph) => ph.id === activePhotoItem.photoId);
        if (p?.imageUrl && p.imageUrl.length > 50) return p.imageUrl;
        if (p?.originalImageUrl && p.originalImageUrl.length > 50) return p.originalImageUrl;
      }
      if (mapRec.imageUrl && mapRec.imageUrl.length > 50) return mapRec.imageUrl;
      if (mapRec.originalImageUrl && mapRec.originalImageUrl.length > 50) return mapRec.originalImageUrl;
      if (mapRec.photos && mapRec.photos[0]?.imageUrl && mapRec.photos[0].imageUrl.length > 50) {
        return mapRec.photos[0].imageUrl;
      }
    }
    // 3. From loadedFullRecords
    const fullRec = loadedFullRecords.get(activePhotoItem.number);
    if (fullRec) {
      if (activePhotoItem.photoId && fullRec.photos) {
        const p = fullRec.photos.find((ph) => ph.id === activePhotoItem.photoId);
        if (p?.imageUrl && p.imageUrl.length > 50) return p.imageUrl;
        if (p?.originalImageUrl && p.originalImageUrl.length > 50) return p.originalImageUrl;
      }
      if (fullRec.imageUrl && fullRec.imageUrl.length > 50) return fullRec.imageUrl;
      if (fullRec.originalImageUrl && fullRec.originalImageUrl.length > 50) return fullRec.originalImageUrl;
      if (fullRec.photos && fullRec.photos[0]?.imageUrl && fullRec.photos[0].imageUrl.length > 50) {
        return fullRec.photos[0].imageUrl;
      }
    }
    // 4. Server direct image endpoint (100% reliable fallback)
    if (activePhotoItem.number) {
      if (activePhotoItem.photoId) {
        return `/api/plates/${activePhotoItem.number}/photos/${encodeURIComponent(activePhotoItem.photoId)}/image`;
      }
      return `/api/plates/${activePhotoItem.number}/image`;
    }
    return activePhotoItem.imageUrl || '';
  }, [activePhotoItem, plateMap, loadedFullRecords]);

  // If activePhotoItem is selected but has no image, fetch immediately
  useEffect(() => {
    if (!activePhotoItem) return;
    if (!previewImage || previewImage.length < 50) {
      getPlate(activePhotoItem.number).then((full) => {
        if (full) {
          const matchP = full.photos?.find((p) => p.id === activePhotoItem.photoId);
          const img = matchP?.imageUrl || matchP?.originalImageUrl || full.imageUrl || full.originalImageUrl;
          if (img && img.length > 50) {
            setActivePhotoItem((prev) => (prev ? { ...prev, imageUrl: img } : null));
          }
        }
      }).catch(() => {});
    }
  }, [activePhotoItem?.number, activePhotoItem?.photoId, previewImage]);

  // Asynchronously load full plate records (with high-res base64 images) from IndexedDB
  // for all matching plates across all thousand blocks so photos always render 100% reliably!
  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !badge || badge.category === 'milestone' || !badge.matchingPlates.length) {
      setLoadedFullRecords(new Map());
      return;
    }

    const loadMissingFullRecords = async () => {
      const updates = new Map<string, PlateRecord>();

      await Promise.all(
        badge.matchingPlates.map(async (num) => {
          try {
            const full = await getPlate(num);
            if (full) {
              updates.set(num, full);
            }
          } catch (e) {
            console.warn(`[BadgeModal] Failed to get plate #${num}:`, e);
          }
        })
      );

      if (!isCancelled && updates.size > 0) {
        setLoadedFullRecords(updates);
      }
    };

    loadMissingFullRecords();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, badge?.id, badge?.matchingPlates]);

  useEffect(() => {
    if (isOpen && badge?.unlocked) {
      // Gentle celebratory confetti trigger
      try {
        confetti({
          particleCount: 35,
          spread: 60,
          origin: { y: 0.65 },
          colors: ['#fbbf24', '#f59e0b', '#38bdf8', '#a855f7'],
        });
      } catch (e) {
        // Safe fallback if confetti isn't supported in iframe
      }
    }
  }, [isOpen, badge]);

  const isMilestone = badge?.category === 'milestone';

  // Flatten all photos from matching records so each collected photo (e.g. 3 photos for 6666)
  // is shown individually with its full plate, without duplicating the 4-digit number on top!
  const matchingPhotos = useMemo(() => {
    if (!badge || isMilestone) return [];
    const list: {
      number: string;
      photoId?: string;
      fullPlate: string;
      imageUrl: string;
      collectedAt?: string;
    }[] = [];

    for (const num of badge.matchingPlates) {
      if (selectedFilterNumber && num !== selectedFilterNumber) continue;
      const rec = loadedFullRecords.get(num) || plateMap.get(num);
      if (!rec) continue;

      if (Array.isArray(rec.photos) && rec.photos.length > 0) {
        for (const p of rec.photos) {
          const photoImg =
            (p.imageUrl && p.imageUrl.length > 50 ? p.imageUrl : null) ||
            (p.originalImageUrl && p.originalImageUrl.length > 50 ? p.originalImageUrl : null) ||
            (rec.imageUrl && rec.imageUrl.length > 50 ? rec.imageUrl : null) ||
            (rec.originalImageUrl && rec.originalImageUrl.length > 50 ? rec.originalImageUrl : null) ||
            (p.id ? `/api/plates/${rec.number}/photos/${encodeURIComponent(p.id)}/image` : `/api/plates/${rec.number}/image`);
          list.push({
            number: rec.number,
            photoId: p.id,
            fullPlate: p.fullPlate || rec.fullPlate || rec.number,
            imageUrl: photoImg,
            collectedAt: p.collectedAt || rec.collectedAt,
          });
        }
      } else {
        const photoImg =
          (rec.imageUrl && rec.imageUrl.length > 50 ? rec.imageUrl : null) ||
          (rec.originalImageUrl && rec.originalImageUrl.length > 50 ? rec.originalImageUrl : null) ||
          `/api/plates/${rec.number}/image`;
        list.push({
          number: rec.number,
          fullPlate: rec.fullPlate || rec.number,
          imageUrl: photoImg,
          collectedAt: rec.collectedAt,
        });
      }
    }
    return list;
  }, [badge, isMilestone, plateMap, loadedFullRecords, selectedFilterNumber]);

  // Total matching photos count across all matching numbers in this badge
  const totalMatchingPhotosCount = useMemo(() => {
    if (!badge || isMilestone) return 0;
    let count = 0;
    for (const num of badge.matchingPlates) {
      const rec = loadedFullRecords.get(num) || plateMap.get(num);
      if (!rec) continue;
      if (Array.isArray(rec.photos) && rec.photos.length > 0) {
        count += rec.photos.length;
      } else {
        count += 1;
      }
    }
    return count;
  }, [badge, isMilestone, plateMap, loadedFullRecords]);

  if (!isOpen || !badge) return null;

  const style = getTierStyle(badge.tier, badge.unlocked);

  const triggerManualConfetti = () => {
    try {
      confetti({
        particleCount: 60,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#fbbf24', '#f59e0b', '#38bdf8', '#10b981'],
      });
    } catch (e) {}
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        id="badge-detail-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Hero Badge Display with Glowing Halo */}
        <div className="relative pt-8 pb-5 px-6 flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 border-b border-slate-800/80 overflow-hidden shrink-0">
          {/* Ambient Glow */}
          {badge.unlocked && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-amber-400/15 blur-3xl pointer-events-none" />
          )}

          {/* Ribbon Pin Top */}
          <div className="relative z-10 flex flex-col items-center">
            <div
              className={`w-10 h-6 rounded-t shadow-md ${style.ribbonBg} flex items-center justify-center mb-[-6px] z-10`}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-white/40 shadow-inner" />
            </div>

            {/* Big Medallion */}
            <div
              className={`w-28 h-28 rounded-full p-1.5 ${
                badge.unlocked
                  ? `bg-gradient-to-tr ${style.ringGradient} ${style.glow} shadow-2xl`
                  : 'locked-detail-ring bg-slate-700/80 shadow-md'
              } flex items-center justify-center transition-transform hover:scale-105 duration-300`}
            >
              <div
                className={`w-full h-full rounded-full p-1 ${
                  badge.unlocked ? 'bg-slate-950' : 'locked-detail-inset bg-slate-900'
                } flex items-center justify-center`}
              >
                <div
                  className={`w-full h-full rounded-full ${
                    badge.unlocked ? style.innerBg : 'locked-detail-core bg-slate-850'
                  } flex items-center justify-center relative overflow-hidden border ${
                    badge.unlocked ? 'border-white/10' : 'border-slate-700/60'
                  }`}
                >
                  {badge.unlocked ? (
                    <div className={`${style.iconColor} drop-shadow`}>
                      {renderBadgeIcon(badge.icon, 'w-14 h-14')}
                    </div>
                  ) : (
                    <div className="locked-detail-status flex flex-col items-center justify-center">
                      <Lock className="w-10 h-10 mb-1 text-slate-300 locked-detail-icon" />
                      <span className="text-[11px] font-sans font-bold text-slate-200 locked-detail-label tracking-wide">
                        未解鎖
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tier and Category Tag */}
          <div className="mt-4 flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold border ${style.accentBg}`}
            >
              {style.tierLabel}
            </span>
            <span
              className={`badge-detail-category px-2.5 py-1 rounded-full text-xs font-semibold border ${
                badge.category === 'special' || badge.categoryLabel.includes('特殊')
                  ? 'bg-purple-900/40 text-purple-200 border-purple-500/50'
                  : 'bg-amber-900/30 text-amber-200 border-amber-500/40'
              }`}
            >
              {badge.categoryLabel}
            </span>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold border ${
                badge.points < 0
                  ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              }`}
            >
              {badge.points > 0 ? `+${badge.points}` : `${badge.points}`} PTS
            </span>
          </div>

          {/* Title */}
          <h3 className="text-xl font-black text-white mt-3 flex items-center gap-2">
            {badge.title}
          </h3>

          {badge.tagline && (
            <p className="badge-detail-tagline text-xs text-amber-300/90 font-medium italic mt-1">
              "{badge.tagline}"
            </p>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[50vh] overflow-y-auto">
          {/* Unlock Requirement Description & Target Progress */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Info className="w-4 h-4 text-amber-400" />
              <span>徽章解鎖條件</span>
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">{badge.description}</p>

            {/* Progress Status Bar */}
            {badge.targetCount >= 1 && (
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs select-none">
                  <span className="text-slate-400">目前達成進度</span>
                  <span className="font-mono font-bold text-slate-200">
                    {badge.currentCount} / {badge.targetCount}
                    {badge.unlocked && <span className="text-emerald-400 ml-1.5">(已達標)</span>}
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      badge.unlocked ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                    style={{ width: `${badge.progressPercentage}%` }}
                  />
                </div>

                {/* Target Numbers Checklist formatted cleanly as 0168 0/1 (Option B: overflow actual count, pure display) */}
                {(() => {
                  const targetNumbers = getBadgeTargetNumbers(badge.id);
                  if (!targetNumbers || targetNumbers.length <= 1) return null;

                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 pt-1">
                      {targetNumbers.map((num) => {
                        const record = loadedFullRecords.get(num) || plateMap.get(num);
                        const count = record ? Math.max(1, record.photos?.length || 1) : 0;
                        const isCaptured = count > 0;
                        const isSelected = selectedFilterNumber === num;
                        return (
                          <div
                            key={num}
                            role="button"
                            onClick={() => {
                              if (isCaptured) {
                                setSelectedFilterNumber((prev) => (prev === num ? null : num));
                                setActivePhotoItem(null);
                              }
                            }}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-mono select-none transition ${
                              isCaptured
                                ? isSelected
                                  ? 'bg-amber-500/20 border-amber-400 text-amber-200 ring-2 ring-amber-400/50 cursor-pointer scale-[1.02]'
                                  : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:border-amber-400/60 cursor-pointer'
                                : 'bg-slate-900/80 border-slate-800 text-slate-400'
                            }`}
                            title={isCaptured ? `點選篩選 ${num} 車牌` : undefined}
                          >
                            <span className="text-sm font-bold tracking-wider">{num}</span>
                            <span
                              className={`text-xs font-mono font-semibold flex items-center gap-1 ${
                                isCaptured ? 'text-emerald-400 font-bold' : 'text-slate-500'
                              }`}
                            >
                              {isCaptured ? (
                                <>
                                  <span>{count}/1</span>
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </>
                              ) : (
                                <span>0/1</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Matching Collected Plates Showcase (hidden for milestones) */}
          {!isMilestone && totalMatchingPhotosCount > 0 && (
            <div className="pt-1 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>
                    {selectedFilterNumber ? `【${selectedFilterNumber}】典藏車牌` : '符合條件的典藏車牌'}
                  </span>
                </h4>
                <div className="flex items-center gap-2">
                  {selectedFilterNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFilterNumber(null);
                        setActivePhotoItem(null);
                      }}
                      className="text-[10px] text-amber-400 hover:text-amber-300 underline font-medium"
                    >
                      檢視全部 ({totalMatchingPhotosCount})
                    </button>
                  )}
                  <span className="text-[11px] font-mono text-slate-400">
                    {matchingPhotos.length} 張已收集
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 mb-3">
                點選下方車牌號碼即可查看詳細相片：
              </p>

              {/* Plate Number Chips (uniform width and height, camera icon removed) */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {matchingPhotos.map((item, idx) => {
                  const isSelected = activePhotoItem?.photoId
                    ? activePhotoItem.photoId === item.photoId
                    : (activePhotoItem?.fullPlate === item.fullPlate && activePhotoItem?.number === item.number);

                  return (
                    <button
                      key={`${item.number}_${item.photoId || idx}`}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setActivePhotoItem(null);
                        } else {
                          const rec = loadedFullRecords.get(item.number) || plateMap.get(item.number);
                          const ph = rec?.photos?.find((p) => p.id === item.photoId);
                          const img =
                            (ph?.imageUrl && ph.imageUrl.length > 50 ? ph.imageUrl : null) ||
                            (ph?.originalImageUrl && ph.originalImageUrl.length > 50 ? ph.originalImageUrl : null) ||
                            (rec?.imageUrl && rec.imageUrl.length > 50 ? rec.imageUrl : null) ||
                            (item.imageUrl && item.imageUrl.length > 50 ? item.imageUrl : null) ||
                            (item.photoId ? `/api/plates/${item.number}/photos/${encodeURIComponent(item.photoId)}/image` : `/api/plates/${item.number}/image`);
                          setActivePhotoItem({
                            ...item,
                            imageUrl: img,
                          });
                        }
                      }}
                      className={`h-10 w-full rounded-xl border font-mono font-bold text-xs sm:text-sm flex items-center justify-center px-2 transition duration-150 select-none shadow-sm cursor-pointer ${
                        isSelected
                          ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400/50 scale-[1.02] shadow-amber-500/20'
                          : 'bg-slate-950 text-slate-200 border-slate-700/80 hover:border-amber-400/60 hover:text-amber-300 hover:bg-slate-900 active:scale-95'
                      }`}
                    >
                      <span className="tracking-wider truncate">{item.fullPlate}</span>
                    </button>
                  );
                })}
              </div>

              {/* Active Detailed Photo Inspection Card (slides/scrolls down cleanly with only preview and button) */}
              {activePhotoItem && (
                <div
                  ref={previewRef}
                  className="mt-3.5 bg-slate-950/95 border border-amber-400/50 rounded-2xl p-4 shadow-2xl flex flex-col items-center gap-3.5 animate-in fade-in zoom-in-95 duration-200"
                >
                  {/* Photo Preview Container */}
                  <div
                    onClick={() => onSelectPlate(activePhotoItem.number, activePhotoItem.photoId)}
                    role="button"
                    tabIndex={0}
                    className="relative w-full max-w-xs h-64 sm:h-72 rounded-2xl overflow-hidden bg-slate-900 border-2 border-amber-400/70 flex items-center justify-center shadow-2xl group cursor-pointer"
                    title="點選開啟大圖檢視"
                  >
                    {previewImage && previewImage.trim() ? (
                      <img
                        src={previewImage}
                        alt={activePhotoItem.fullPlate}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        onError={(e) => {
                          const target = e.currentTarget;
                          const padded = activePhotoItem.number ? activePhotoItem.number.padStart(4, '0') : '';
                          if (padded && !target.src.includes(`/api/plates/${padded}/image`)) {
                            target.src = `/api/plates/${padded}/image`;
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center font-mono text-amber-400 gap-2 p-4 text-center bg-slate-950">
                        <span className="font-black text-2xl text-amber-300 tracking-wider">{activePhotoItem.fullPlate}</span>
                        <span className="text-xs text-slate-400 font-sans">點選下方「開啟完整資訊」查看照片</span>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center pointer-events-none">
                      <span className="text-[11px] text-white font-bold bg-slate-950/90 px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-md">
                        <ExternalLink className="w-3.5 h-3.5" />
                        開啟車牌詳情
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActivePhotoItem(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-950/80 hover:bg-slate-900 text-slate-300 hover:text-white transition shadow-md cursor-pointer z-10"
                      title="關閉相片預覽"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Primary Action Button: 開啟完整資訊 */}
                  <button
                    type="button"
                    onClick={() => onSelectPlate(activePhotoItem.number, activePhotoItem.photoId)}
                    className="w-full max-w-xs px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 shadow-md shadow-amber-400/20 cursor-pointer"
                  >
                    <span>開啟完整資訊</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          {badge.unlocked ? (
            <button
              onClick={triggerManualConfetti}
              className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-semibold transition"
            >
              <PartyPopper className="w-4 h-4" />
              <span>灑花慶祝解鎖</span>
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
