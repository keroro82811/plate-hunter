import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Filter,
  Sparkles,
  Eye,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Clock,
  ArrowUpDown,
  MapPin,
  Calendar,
} from 'lucide-react';
import { FilterCategory, PlateRecord, SortMode } from '../types';
import { getNumberTags, matchFilterCategory } from '../services/numberClassifier';
import { formatRelativeTime } from '../utils/dateHelper';
import { isJapanPlate, isRealPhotoImage, isSyntheticSvgImage, isBase64Photo } from '../utils/plateHelper';
import { getPlate } from '../services/db';

/**
 * Viewport-aware lazy image component with on-demand fallback from IndexedDB.
 * Prevents decoding 1,000+ uncompressed base64 bitmap textures into GPU memory simultaneously.
 * Drops active VRAM from 1.6GB+ down to ~35MB, completely eliminating browser tab OOM reloads!
 */
const getRecordDisplayImage = (record?: PlateRecord | null, plateNumber?: string) => {
  if (!record) return '';
  // 1. Prioritize authentic Base64 photo
  const b64Photo = record.photos?.find((p) => isBase64Photo(p?.imageUrl));
  if (b64Photo?.imageUrl) {
    return b64Photo.imageUrl.trim();
  }
  if (isBase64Photo(record.imageUrl)) {
    return record.imageUrl!.trim();
  }
  if (isBase64Photo(record.originalImageUrl)) {
    return record.originalImageUrl!.trim();
  }
  // 2. Any real photo in photos array
  const photoWithImg = record.photos?.find((p) => isRealPhotoImage(p?.imageUrl));
  if (photoWithImg?.imageUrl) {
    return photoWithImg.imageUrl.trim();
  }
  if (isRealPhotoImage(record.imageUrl)) {
    return record.imageUrl!.trim();
  }
  if (isRealPhotoImage(record.originalImageUrl)) {
    return record.originalImageUrl!.trim();
  }
  if (record.imageUrl && record.imageUrl.startsWith('/api/plates/')) {
    return record.imageUrl;
  }
  return '';
};

const LazyPlateImage: React.FC<{
  src?: string;
  fallbackSrc?: string;
  plateNumber?: string;
  alt?: string;
  className?: string;
}> = ({ src, fallbackSrc, plateNumber, alt, className }) => {
  const paddedNum = plateNumber ? plateNumber.padStart(4, '0') : '';
  const getInitialSrc = () => {
    if (src && src.trim() && !isSyntheticSvgImage(src)) return src.trim();
    if (fallbackSrc && fallbackSrc.trim() && !isSyntheticSvgImage(fallbackSrc)) return fallbackSrc.trim();
    if (paddedNum) return `/api/plates/${paddedNum}/image`;
    return '';
  };

  const [currentSrc, setCurrentSrc] = useState(getInitialSrc);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
    if (src && src.trim() && !isSyntheticSvgImage(src)) {
      setCurrentSrc(src.trim());
    } else if (fallbackSrc && fallbackSrc.trim() && !isSyntheticSvgImage(fallbackSrc)) {
      setCurrentSrc(fallbackSrc.trim());
    } else if (paddedNum) {
      setCurrentSrc(`/api/plates/${paddedNum}/image`);
    } else {
      setCurrentSrc('');
    }
  }, [src, fallbackSrc, paddedNum]);

  if (!currentSrc || hasError || isSyntheticSvgImage(currentSrc)) {
    return (
      <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-400 font-mono text-[9px] p-1 text-center select-none border border-slate-800">
        <span className="font-bold text-amber-300">#{plateNumber || ''}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-slate-900 overflow-hidden">
      <img
        src={currentSrc}
        alt={alt || ''}
        className={className}
        loading="lazy"
        decoding="async"
        onError={async () => {
          if (fallbackSrc && currentSrc !== fallbackSrc && !isSyntheticSvgImage(fallbackSrc)) {
            setCurrentSrc(fallbackSrc);
            return;
          }
          if (paddedNum && !currentSrc.includes(`/api/plates/${paddedNum}/image`)) {
            setCurrentSrc(`/api/plates/${paddedNum}/image`);
            return;
          }
          // Self-healing attempt: if /api/ 404s or network drops, check local IndexedDB for base64 photo!
          if (paddedNum) {
            try {
              const local = await getPlate(paddedNum);
              const b64 = local?.imageUrl && isBase64Photo(local.imageUrl)
                ? local.imageUrl
                : local?.photos?.find((p) => isBase64Photo(p.imageUrl))?.imageUrl;
              if (b64 && b64 !== currentSrc) {
                setCurrentSrc(b64);
                return;
              }
            } catch {}
          }
          setHasError(true);
        }}
      />
    </div>
  );
};

interface CollectionGridProps {
  plateMap: Map<string, PlateRecord>;
  activeThousandBlock: number; // 0 to 9 (representing 0000-0999, 1000-1999, etc.)
  onChangeThousandBlock: (block: number) => void;
  onSelectSlot: (number: string, photoId?: string) => void; // Click empty slot to upload, or collected slot to view
  highlightNumber?: string | null;
}

interface TimelinePhotoItem {
  id: string;
  number: string;
  photoId: string;
  fullPlate: string;
  imageUrl: string;
  collectedAt: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  record: PlateRecord;
  photoIndex: number;
  totalPhotos: number;
}

const SPECIAL_SUB_CATEGORIES = [
  { id: 'dominant', label: '⚡ 霸氣外漏' },
  { id: 'forbidden', label: '☠ 禁忌之巔' },
  { id: 'tsmc', label: '🏔️ 護國神山' },
  { id: 'thousands', label: '👑 千元霸主' },
  { id: 'four-of-a-kind', label: '🀄 鐵支' },
  { id: 'sequential', label: '🚀 順子' },
  { id: 'pairs', label: '👥 對子' },
  { id: 'mirror', label: '🪞 鏡像' },
  { id: 'lucky', label: '🧧 大吉大利' },
  { id: 'lucky-star', label: '🌟 六六大順' },
  { id: 'lucky-slot', label: '🎰 幸運拉霸' },
] as const;

const ALL_SPECIAL_IDS = SPECIAL_SUB_CATEGORIES.map((s) => s.id);

export const CollectionGrid: React.FC<CollectionGridProps> = ({
  plateMap,
  activeThousandBlock,
  onChangeThousandBlock,
  onSelectSlot,
  highlightNumber,
}) => {
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [showSpecialSubcategories, setShowSpecialSubcategories] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('number-asc');
  const [timelineDisplayLimit, setTimelineDisplayLimit] = useState(100);

  // Reset timeline display count when filters or sort change
  useEffect(() => {
    setTimelineDisplayLimit(100);
  }, [sortMode, selectedFilters]);

  // Calculate thousand blocks statistics
  const thousandStats = useMemo(() => {
    const stats = Array.from({ length: 10 }, (_, i) => ({
      block: i,
      label: `${i}000-${i}999`,
      count: 0,
    }));

    for (const record of plateMap.values()) {
      const firstDigit = parseInt(record.number[0] || '0', 10);
      if (firstDigit >= 0 && firstDigit <= 9) {
        stats[firstDigit].count += 1;
      }
    }
    return stats;
  }, [plateMap]);

  // Active filters categorization
  const specialFilters = useMemo(
    () => selectedFilters.filter((f) => ALL_SPECIAL_IDS.includes(f as any)),
    [selectedFilters]
  );
  const statusFilter = useMemo(
    () => selectedFilters.find((f) => f === 'collected' || f === 'missing'),
    [selectedFilters]
  );

  const isSpecialActive = specialFilters.length > 0;
  const isAllSpecialSelected = specialFilters.length === ALL_SPECIAL_IDS.length;

  // Toggle status filter logic
  const handleToggleStatus = (id: 'all' | 'collected' | 'missing') => {
    if (id === 'all') {
      setSelectedFilters([]);
      return;
    }

    setSelectedFilters((prev) => {
      if (id === 'collected') {
        const without = prev.filter((f) => f !== 'missing');
        return without.includes('collected')
          ? without.filter((f) => f !== 'collected')
          : [...without, 'collected'];
      }
      if (id === 'missing') {
        const without = prev.filter((f) => f !== 'collected');
        return without.includes('missing')
          ? without.filter((f) => f !== 'missing')
          : [...without, 'missing'];
      }
      return prev;
    });
  };

  // Toggle master special button (opens drawer, starts clean without all lit up)
  const handleToggleSpecialMaster = () => {
    if (showSpecialSubcategories || isSpecialActive) {
      if (specialFilters.length > 0) {
        // Clear active special filters
        setSelectedFilters((prev) =>
          prev.filter((f) => f === 'collected' || f === 'missing')
        );
      }
      setShowSpecialSubcategories(false);
    } else {
      // Open drawer for user selection, start with none lit up
      setShowSpecialSubcategories(true);
      setSelectedFilters((prev) =>
        prev.filter((f) => f === 'collected' || f === 'missing')
      );
    }
  };

  // Toggle drawer open/close (keeps lights as is, starts all dark)
  const handleToggleOpenDrawer = () => {
    setShowSpecialSubcategories((prev) => !prev);
  };

  // Toggle specific subcategory (clicking deselects to exclude, or clicks to re-include)
  const handleToggleSubCategory = (id: string) => {
    setSelectedFilters((prev) => {
      const status = prev.filter((f) => f === 'collected' || f === 'missing');
      const currentSpecial = prev.filter((f) => ALL_SPECIAL_IDS.includes(f as any));

      let nextSpecial: string[];
      if (currentSpecial.includes(id)) {
        // Exclude / turn off this item
        nextSpecial = currentSpecial.filter((f) => f !== id);
      } else {
        // Include / turn on this item
        nextSpecial = [...currentSpecial, id];
      }

      return [...status, ...nextSpecial];
    });
  };

  // Select all 10 special categories (all lit up)
  const handleSelectAllSpecial = () => {
    setSelectedFilters((prev) => [
      ...prev.filter((f) => f === 'collected' || f === 'missing'),
      ...ALL_SPECIAL_IDS,
    ]);
  };

  // Clear all special categories
  const handleClearAllSpecial = () => {
    setSelectedFilters((prev) =>
      prev.filter((f) => f === 'collected' || f === 'missing')
    );
  };

  // Generate list of photos for time-sorted view (every vehicle capture is shown independently, never stacked)
  const timelinePhotos = useMemo<TimelinePhotoItem[]>(() => {
    if (sortMode === 'number-asc') return [];

    const items: TimelinePhotoItem[] = [];

    for (const record of plateMap.values()) {
      if (specialFilters.length > 0) {
        const matches = specialFilters.some((cat) =>
          matchFilterCategory(record.number, cat as FilterCategory, true)
        );
        if (!matches) continue;
      }

      const rawPhotos =
        record.photos && record.photos.length > 0
          ? record.photos
          : [
              {
                id: `${record.number}_init`,
                fullPlate: record.fullPlate || record.number,
                imageUrl: record.imageUrl,
                collectedAt: record.collectedAt,
                locationName: record.locationName,
              },
            ];

      // Sort photos chronologically from oldest to newest
      const photos = [...rawPhotos].sort((a, b) => {
        const timeA = a.collectedAt ? new Date(a.collectedAt).getTime() : 0;
        const timeB = b.collectedAt ? new Date(b.collectedAt).getTime() : 0;
        return timeA - timeB;
      });

      // In the timeline wall, every captured vehicle/photo is an independent card (never stacked by number)
      const seenPhotoKeys = new Set<string>();
      photos.forEach((ph, idx) => {
        const pKey = ph.id || `${ph.imageUrl ? ph.imageUrl.slice(0, 100) : ''}_${ph.collectedAt || idx}`;
        if (seenPhotoKeys.has(pKey)) return;
        seenPhotoKeys.add(pKey);

        const safeId = ph.id ? `${ph.id}_${idx}` : `${record.number}_${idx}`;
        const photoImg =
          (ph.imageUrl && ph.imageUrl.trim()) ||
          (ph.originalImageUrl && ph.originalImageUrl.trim()) ||
          (record.imageUrl && record.imageUrl.trim()) ||
          (record.originalImageUrl && record.originalImageUrl.trim()) ||
          (ph.id ? `/api/plates/${record.number}/photos/${ph.id}/image` : `/api/plates/${record.number}/image`);

        items.push({
          id: safeId,
          number: record.number,
          photoId: ph.id || safeId,
          fullPlate: ph.fullPlate || record.fullPlate || record.number,
          imageUrl: photoImg,
          collectedAt: ph.collectedAt || record.collectedAt || '',
          locationName:
            ph.locationName || (photos.length === 1 ? record.locationName : undefined),
          latitude: photos.length === 1 ? (ph.latitude ?? record.latitude) : ph.latitude,
          longitude: photos.length === 1 ? (ph.longitude ?? record.longitude) : ph.longitude,
          notes: photos.length === 1 ? (ph.notes || record.notes) : ph.notes,
          record,
          photoIndex: idx,
          totalPhotos: photos.length,
        });
      });
    }

    // Sort by timestamp
    items.sort((a, b) => {
      const timeA = a.collectedAt ? new Date(a.collectedAt).getTime() : 0;
      const timeB = b.collectedAt ? new Date(b.collectedAt).getTime() : 0;
      return sortMode === 'time-desc' ? timeB - timeA : timeA - timeB;
    });

    return items;
  }, [plateMap, sortMode, specialFilters]);

  // Generate list of numbers to display for standard slot mode (0000-0999 or special categories)
  const displayedNumbers = useMemo(() => {
    if (sortMode !== 'number-asc') return [];

    let nums: string[] = [];

    // Special categories filter across 0000-9999
    if (specialFilters.length > 0) {
      for (let i = 0; i < 10000; i++) {
        const numStr = i.toString().padStart(4, '0');
        const isCollected = plateMap.has(numStr);

        if (statusFilter === 'collected' && !isCollected) continue;
        if (statusFilter === 'missing' && isCollected) continue;

        const matches = specialFilters.some((cat) =>
          matchFilterCategory(numStr, cat as FilterCategory, isCollected)
        );
        if (matches) {
          nums.push(numStr);
        }
      }
      return nums;
    }

    // Standard view: active thousand block (1,000 numbers)
    const startNum = activeThousandBlock * 1000;
    const endNum = startNum + 1000;

    for (let i = startNum; i < endNum; i++) {
      const numStr = i.toString().padStart(4, '0');
      const isCollected = plateMap.has(numStr);

      if (statusFilter === 'collected' && !isCollected) continue;
      if (statusFilter === 'missing' && isCollected) continue;

      nums.push(numStr);
    }

    return nums;
  }, [
    activeThousandBlock,
    selectedFilters,
    specialFilters,
    statusFilter,
    plateMap,
    sortMode,
  ]);

  // Current block info
  const currentBlockCount = thousandStats[activeThousandBlock]?.count || 0;
  const isAllSelected = selectedFilters.length === 0;

  return (
    <div className="space-y-4">
      {/* Thousand Range Selector Tabs (0000-0999, 1000-1999, ... 9000-9999) - Only in Number Order mode */}
      {sortMode === 'number-asc' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-md">
          <div className="flex items-center justify-between mb-2 sm:mb-2.5 px-0.5 sm:px-1">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              號碼分區 (0000-9999)
            </span>
            <span className="text-[11px] text-slate-400 font-mono hidden xs:inline">
              當前：<b className="text-amber-300">{activeThousandBlock}000-{activeThousandBlock}999</b> ({thousandStats[activeThousandBlock]?.count || 0}/1000)
            </span>
          </div>

          {/* 10 Thousand Tabs: 5 columns x 2 rows on mobile (0-4 / 5-9), 10 columns on desktop */}
          <div className="grid grid-cols-5 lg:grid-cols-10 gap-1.5 sm:gap-2">
            {thousandStats.map((item) => {
              const isActive = activeThousandBlock === item.block && specialFilters.length === 0;
              return (
                <button
                  key={item.block}
                  type="button"
                  onClick={() => {
                    onChangeThousandBlock(item.block);
                    // Clear special filters when user intentionally clicks a thousand partition
                    if (specialFilters.length > 0) {
                      setSelectedFilters((prev) => prev.filter((f) => f === 'collected' || f === 'missing'));
                    }
                  }}
                  className={`thousand-partition-btn flex flex-col p-1.5 sm:p-2 rounded-xl text-left border transition-all active:scale-95 cursor-pointer ${
                    isActive
                      ? 'is-active bg-amber-400 text-slate-950 border-amber-300 font-bold shadow-md shadow-amber-500/20'
                      : item.count > 0
                      ? 'bg-slate-950/70 text-slate-200 border-amber-400/40 hover:bg-slate-850 hover:border-amber-400 shadow-xs'
                      : 'bg-slate-950/40 text-slate-300 border-slate-800/80 hover:bg-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    {/* Compact 0xxx label on mobile, full label on tablet/desktop */}
                    <span className="font-mono tracking-tight font-black sm:hidden">{item.block}xxx</span>
                    <span className="font-mono tracking-tight font-black hidden sm:inline">{item.label}</span>
                    {item.count > 0 && (
                      <span
                        className={`partition-tab-count text-[9px] sm:text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isActive
                            ? 'active-count-badge bg-slate-950/25 text-slate-950'
                            : 'inactive-count-badge bg-amber-400/20 text-amber-300'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </div>
                  {/* Mini progress bar */}
                  <div
                    className={`partition-progress-track w-full h-1 mt-1 sm:mt-1.5 rounded-full overflow-hidden ${
                      isActive ? 'bg-slate-950/30' : 'bg-slate-800'
                    }`}
                  >
                    <div
                      className={`partition-progress-fill h-full rounded-full ${isActive ? 'bg-slate-950' : 'bg-amber-400'}`}
                      style={{ width: `${Math.max(item.count > 0 ? 5 : 0, item.count / 10)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Bar with Partition Stats */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          {/* Main Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-400 mr-1 flex items-center gap-1 text-[11px] font-semibold shrink-0">
              <Filter className="w-3.5 h-3.5" /> 篩選 (可複選):
            </span>

            {/* All button */}
            <button
              onClick={() => handleToggleStatus('all')}
              className={`px-2.5 py-1 rounded-lg transition font-medium text-xs border ${
                isAllSelected
                  ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 shadow-sm'
                  : 'text-slate-300 bg-slate-950/40 border-slate-800/80 hover:bg-slate-800 hover:text-white'
              }`}
            >
              全部
            </button>

            {/* Collected button */}
            <button
              onClick={() => handleToggleStatus('collected')}
              className={`px-2.5 py-1 rounded-lg transition font-medium text-xs flex items-center gap-1 border ${
                selectedFilters.includes('collected')
                  ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 shadow-sm'
                  : 'text-slate-300 bg-slate-950/40 border-slate-800/80 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {selectedFilters.includes('collected') && <Check className="w-3 h-3 stroke-[3]" />}
              <span>已收集</span>
            </button>

            {/* Missing button */}
            <button
              onClick={() => handleToggleStatus('missing')}
              className={`px-2.5 py-1 rounded-lg transition font-medium text-xs flex items-center gap-1 border ${
                selectedFilters.includes('missing')
                  ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 shadow-sm'
                  : 'text-slate-300 bg-slate-950/40 border-slate-800/80 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {selectedFilters.includes('missing') && <Check className="w-3 h-3 stroke-[3]" />}
              <span>未收集</span>
            </button>

            {/* Unified Special Plates Button with Subcategories Expand Toggle */}
            <div className="flex items-center rounded-lg border border-slate-800/80 bg-slate-950/40 overflow-hidden shadow-sm">
              <button
                onClick={handleToggleSpecialMaster}
                title="切換特殊車號篩選"
                className={`px-2.5 py-1 transition font-medium text-xs flex items-center gap-1.5 ${
                  isSpecialActive
                    ? 'bg-amber-400 text-slate-950 font-bold'
                    : showSpecialSubcategories
                    ? 'bg-amber-400/20 text-amber-300 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {isSpecialActive && <Check className="w-3 h-3 stroke-[3]" />}
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  特殊車號
                  {isSpecialActive
                    ? isAllSpecialSelected
                      ? ' (全亮)'
                      : ` (${specialFilters.length}/${ALL_SPECIAL_IDS.length})`
                    : showSpecialSubcategories
                    ? ' (展開中)'
                    : ''}
                </span>
              </button>
              <button
                onClick={handleToggleOpenDrawer}
                title={showSpecialSubcategories ? '收起細項分類' : '展開特殊車號細項分類'}
                className={`px-2 py-1 text-xs border-l border-slate-800/80 transition flex items-center gap-1 ${
                  showSpecialSubcategories
                    ? 'bg-amber-400/25 text-amber-300 font-bold'
                    : isSpecialActive
                    ? 'bg-amber-400/15 text-amber-400 hover:bg-amber-400/25'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <span className="text-[10px] hidden sm:inline font-sans">
                  {showSpecialSubcategories ? '收起' : '細項'}
                </span>
                {showSpecialSubcategories ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>

            {/* Sort Mode Controls (號碼排列 / 由新至舊 / 由舊至新) */}
            <div className="flex items-center rounded-lg border border-slate-800/80 bg-slate-950/40 p-0.5 shadow-sm">
              <button
                onClick={() => setSortMode('number-asc')}
                title="依號碼升冪順序（0000 ➔ 9999）"
                className={`px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1 ${
                  sortMode === 'number-asc'
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                <span>號碼排列</span>
              </button>
              <button
                onClick={() => setSortMode('time-desc')}
                title="依拍攝時間排序：由新至舊"
                className={`px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1 ${
                  sortMode === 'time-desc'
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>由新至舊</span>
              </button>
              <button
                onClick={() => setSortMode('time-asc')}
                title="依拍攝時間排序：由舊至新"
                className={`px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1 ${
                  sortMode === 'time-asc'
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <span>由舊至新</span>
              </button>
            </div>
          </div>

          {/* Partition Count & Filter Statistics Display */}
          <div className="flex items-center gap-3 shrink-0 self-end md:self-auto text-xs font-mono">
            {sortMode !== 'number-asc' ? (
              <div
                id="partition-stat-badge"
                className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl shadow-xs text-xs font-mono"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-300 font-sans font-medium">全體時序：</span>
                <span className="partition-count-pill inline-flex items-center gap-1 bg-amber-400/20 border border-amber-400/35 px-2 py-0.5 rounded-md font-bold">
                  <span className="text-amber-400 text-sm font-black">{timelinePhotos.length}</span>
                  <span className="text-slate-300 text-xs font-medium">面車牌</span>
                </span>
                <span className="text-slate-400 font-sans hidden sm:inline text-[11px] ml-0.5">
                  ({sortMode === 'time-desc' ? '由新至舊' : '由舊至新'})
                </span>
              </div>
            ) : specialFilters.length > 0 ? (
              <div
                id="partition-stat-badge"
                className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl shadow-xs text-xs font-mono"
              >
                <span className="text-slate-300 font-sans font-medium">特殊車號：</span>
                <span className="partition-count-pill inline-flex items-center gap-1 bg-amber-400/20 border border-amber-400/35 px-2 py-0.5 rounded-md font-bold">
                  <span className="text-amber-400 text-sm font-black">
                    {displayedNumbers.filter((n) => plateMap.has(n)).length}
                  </span>
                  <span className="text-slate-300 text-xs font-medium">/ {displayedNumbers.length}</span>
                </span>
                <span className="text-slate-400 font-sans text-[11px] ml-0.5">
                  (已收錄)
                </span>
              </div>
            ) : (
              <div
                id="partition-stat-badge"
                className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl shadow-xs text-xs font-mono"
              >
                <span className="text-slate-300 font-sans font-medium">當前分區已收：</span>
                <span className="partition-count-pill inline-flex items-center gap-1.5 bg-amber-400/20 border border-amber-400/35 px-2.5 py-0.5 rounded-md font-bold">
                  <span className="partition-number text-amber-400 text-sm font-black tracking-wide">
                    {currentBlockCount}
                  </span>
                  <span className="partition-total text-slate-300 text-xs font-medium">/ 1,000</span>
                </span>
                {statusFilter && (
                  <span className="text-slate-400 font-sans text-[11px] ml-1">
                    (顯示：<strong className="text-slate-200 font-mono">{displayedNumbers.length}</strong>)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Subcategories Drawer (Shown when expanded) */}
        {showSpecialSubcategories && (
          <div className="pt-2.5 border-t border-slate-800/80 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-slate-400 font-semibold flex flex-wrap items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>細項分類（點擊點亮要篩選的項目）：</span>
                <span className="font-mono text-amber-300 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                  {specialFilters.length}/{ALL_SPECIAL_IDS.length} 項亮起
                </span>
                {specialFilters.length === 0 && (
                  <span className="text-[10px] text-amber-400/90 font-medium">
                    （點選下方任一分類開始篩選）
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={handleSelectAllSpecial}
                  disabled={isAllSpecialSelected}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    isAllSpecialSelected
                      ? 'text-slate-600 bg-slate-900/40 border border-slate-850 cursor-not-allowed'
                      : 'text-amber-300 hover:text-amber-200 hover:bg-slate-800 bg-slate-900 border border-amber-500/30 font-semibold'
                  }`}
                >
                  全部亮起
                </button>
                <button
                  onClick={handleClearAllSpecial}
                  disabled={specialFilters.length === 0}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    specialFilters.length === 0
                      ? 'text-slate-600 bg-slate-900/40 border border-slate-850 cursor-not-allowed'
                      : 'text-slate-400 hover:text-rose-300 hover:bg-slate-800 bg-slate-900 border border-slate-800'
                  }`}
                >
                  全部取消
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {SPECIAL_SUB_CATEGORIES.map((tab) => {
                const isSelected = specialFilters.includes(tab.id);
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleToggleSubCategory(tab.id)}
                    title={isSelected ? `點擊取消排除「${tab.label}」` : `點擊選取加入「${tab.label}」`}
                    className={`px-2.5 py-1 rounded-lg transition font-medium text-xs flex items-center gap-1.5 active:scale-95 border ${
                      isSelected
                        ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 shadow-sm'
                        : 'text-slate-300 bg-slate-950/40 border-slate-800/80 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {isSelected ? (
                      <Check className="w-3 h-3 stroke-[3]" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full border border-slate-500/80 inline-block opacity-60" />
                    )}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Grid of 1:1 Tiles */}
      {sortMode !== 'number-asc' ? (
        timelinePhotos.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-amber-400 mb-3">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200">
              尚未有已收集的車牌照片
            </h3>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-10 gap-1 sm:gap-1.5 md:gap-2.5">
              {timelinePhotos.slice(0, timelineDisplayLimit).map((item, index) => {
                const isHighlighted = highlightNumber === item.number;
                const tags = getNumberTags(item.number);

                return (
                  <div
                    key={`${item.id}_${item.number}_${index}`}
                    onClick={() => onSelectSlot(item.number, item.photoId)}
                    className={`group relative aspect-square bg-slate-950 rounded-lg sm:rounded-xl overflow-hidden border cursor-pointer transition-all hover:scale-[1.03] hover:shadow-xl hover:shadow-amber-500/10 ${
                      isHighlighted
                        ? 'ring-2 sm:ring-4 ring-amber-400 border-amber-300'
                        : 'border-slate-800 hover:border-amber-400/80'
                    }`}
                  >
                    {/* Viewport-aware 1:1 Image */}
                    <LazyPlateImage
                      src={item.imageUrl}
                      fallbackSrc={`/api/plates/${item.number.padStart(4, '0')}/image`}
                      plateNumber={item.number}
                      alt={`車牌 ${item.fullPlate}`}
                      className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                    />

                    {/* Subtle gradient shade so photo stays bright and visible */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition pointer-events-none" />

                    {/* Top-left: Number and Date */}
                    <div className="absolute top-0.5 left-0.5 sm:top-1 sm:left-1 flex flex-col items-start gap-0.5 z-10 pointer-events-none">
                      <div className="bg-slate-950/90 backdrop-blur-xs px-1 py-0.5 rounded font-mono font-bold text-[7px] sm:text-[9px] md:text-[10px] text-amber-300 border border-amber-400/40 shadow-xs leading-none text-center">
                        #{item.number}
                      </div>
                      {item.collectedAt && (
                        <div className="bg-amber-400 text-slate-950 font-bold text-[5px] sm:text-[7px] md:text-[8px] px-1 py-0.5 rounded border border-amber-300 shadow-xs whitespace-nowrap leading-none text-center">
                          {formatRelativeTime(item.collectedAt)}
                        </div>
                      )}
                    </div>

                    {/* Top-right: JP badge & Multi-photo indicator badge */}
                    <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 z-10 pointer-events-none flex flex-col items-end gap-0.5">
                      {isJapanPlate(item) && (
                        <div
                          title="日本車牌 (JP)"
                          className="bg-rose-950/90 text-rose-300 border border-rose-500/50 shadow-xs px-1 sm:px-1.5 py-0.5 rounded font-mono font-bold text-[5.5px] sm:text-[7.5px] md:text-[8.5px] flex items-center leading-none backdrop-blur-xs"
                        >
                          <span>JP</span>
                        </div>
                      )}
                      {item.totalPhotos > 1 && (
                        <div
                          title={`此號碼共收錄 ${item.totalPhotos} 輛車牌照片`}
                          className="bg-slate-950/90 text-amber-300 border border-amber-400/50 shadow-xs px-1 sm:px-1.5 py-0.5 rounded font-mono font-bold text-[5.5px] sm:text-[7.5px] md:text-[8.5px] flex items-center gap-0.5 leading-none backdrop-blur-xs"
                        >
                          <Layers className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-amber-400" />
                          <span>{`${item.photoIndex + 1}/${item.totalPhotos}`}</span>
                        </div>
                      )}
                    </div>

                    {/* Bottom plate text & location */}
                    <div className="absolute bottom-0.5 inset-x-0.5 text-center pointer-events-none flex flex-col justify-end">
                      <div className="bg-slate-950/90 backdrop-blur-xs py-0 sm:py-0.5 px-0.5 rounded border border-slate-800/80 text-[6px] sm:text-[9px] md:text-[11px] font-mono font-bold text-slate-100 truncate shadow">
                        {item.fullPlate}
                      </div>
                      <div className="flex items-center justify-center gap-0.5 text-[7px] md:text-[8px] h-3 sm:h-3.5 md:h-4 text-emerald-300/95 font-medium truncate mt-0.5 bg-slate-950/70 rounded px-1">
                        {item.locationName ? (
                          <>
                            <MapPin className="w-2 h-2 shrink-0 text-emerald-400" />
                            <span className="truncate">{item.locationName.split(' ')[0]}</span>
                          </>
                        ) : (
                          <span className="text-slate-500/80 text-[6px] sm:text-[7.5px] truncate">未標記地點</span>
                        )}
                      </div>
                    </div>

                    {/* Hover inspection overlay */}
                    <div className="absolute inset-0 bg-amber-400/15 opacity-0 group-hover:opacity-100 transition flex items-center justify-center pointer-events-none">
                      <div className="p-1 sm:p-2 rounded-full bg-slate-950/80 text-amber-300 border border-amber-400/50 shadow-lg">
                        <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination button for timeline mode to protect memory */}
            {timelinePhotos.length > timelineDisplayLimit && (
              <div className="text-center pt-2 pb-4">
                <button
                  type="button"
                  onClick={() => setTimelineDisplayLimit((prev) => prev + 100)}
                  className="px-6 py-2.5 bg-slate-900 hover:bg-slate-850 text-amber-300 font-bold text-xs rounded-xl border border-slate-750 hover:border-amber-400 transition shadow-lg cursor-pointer"
                >
                  載入更多照片（已顯示 {Math.min(timelineDisplayLimit, timelinePhotos.length).toLocaleString()} / 總計 {timelinePhotos.length.toLocaleString()} 張）
                </button>
              </div>
            )}
          </div>
        )
      ) : displayedNumbers.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-amber-400 mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-200">
            此篩選條件下目前無號碼
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            嘗試更換篩選條件或點選「全部」重置
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-10 gap-1 sm:gap-1.5 md:gap-2.5">
          {displayedNumbers.map((numStr) => {
            const record = plateMap.get(numStr);
            const isCollected = Boolean(record);
            const isHighlighted = highlightNumber === numStr;
            const tags = getNumberTags(numStr);

            if (isCollected && record) {
              /* Collected Slot: Displays 1:1 square photo */
              return (
                <div
                  key={numStr}
                  onClick={() => onSelectSlot(numStr)}
                  className={`group relative aspect-square bg-slate-950 rounded-lg sm:rounded-xl overflow-hidden border cursor-pointer transition-all hover:scale-[1.03] hover:shadow-xl hover:shadow-amber-500/10 ${
                    isHighlighted
                      ? 'ring-2 sm:ring-4 ring-amber-400 border-amber-300'
                      : 'border-slate-800 hover:border-amber-400/80'
                  }`}
                >
                  {/* Viewport-aware 1:1 Image */}
                  <LazyPlateImage
                    src={getRecordDisplayImage(record, numStr)}
                    fallbackSrc={isRealPhotoImage(record.originalImageUrl) ? record.originalImageUrl : undefined}
                    plateNumber={numStr}
                    alt={`車牌 ${record.fullPlate}`}
                    className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                  />

                  {/* Subtle gradient shade so photo stays bright and visible */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition pointer-events-none" />

                  {/* Top-left: Number and multi-photo count */}
                  <div className="absolute top-0.5 left-0.5 sm:top-1 sm:left-1 flex flex-col items-start gap-0.5 z-10 pointer-events-none">
                    <div className="bg-slate-950/90 backdrop-blur-xs px-1 py-0.5 rounded font-mono font-bold text-[8px] sm:text-[9px] md:text-[10px] text-amber-300 border border-amber-400/40 shadow-xs leading-none text-center">
                      #{numStr}
                    </div>
                    {record.photos && record.photos.length > 1 && (
                      <div
                        title={`此號碼共收錄 ${record.photos.length} 張不同照片`}
                        className="bg-amber-400 text-slate-950 font-black px-1 py-0.5 rounded font-mono text-[6px] sm:text-[7px] md:text-[8px] border border-amber-300 shadow-xs leading-none text-center"
                      >
                        <span>{record.photos.length}張</span>
                      </div>
                    )}
                  </div>

                  {/* Top-right special tags */}
                  <div className="absolute top-0.5 right-0.5 sm:top-1.5 sm:right-1.5 flex flex-nowrap items-center justify-end gap-0.5 pointer-events-none z-10 max-w-[65%]">
                    {tags.map((t) => (
                      <span
                        key={t.tag}
                        className={`text-[6px] sm:text-[7px] md:text-[8px] px-0.5 py-0 sm:py-0.5 rounded font-bold border leading-none shadow-xs whitespace-nowrap flex-shrink-0 ${t.bgClass} ${t.colorClass}`}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>

                  {/* Bottom plate text & location */}
                  <div className="absolute bottom-0.5 inset-x-0.5 text-center pointer-events-none flex flex-col justify-end">
                    <div className="bg-slate-950/90 backdrop-blur-xs py-0 sm:py-0.5 px-0.5 rounded border border-slate-800/80 text-[7px] sm:text-[9px] md:text-[11px] font-mono font-bold text-slate-100 truncate shadow">
                      {record.fullPlate}
                    </div>
                    <div className="hidden sm:flex items-center justify-center gap-0.5 text-[7px] md:text-[8px] h-3 sm:h-3.5 md:h-4 text-emerald-300/95 font-medium truncate mt-0.5 bg-slate-950/70 rounded px-1">
                      {record.locationName ? (
                        <>
                          <MapPin className="w-2 h-2 shrink-0 text-emerald-400" />
                          <span className="truncate">{record.locationName.split(' ')[0]}</span>
                        </>
                      ) : (
                        <span className="text-slate-500/80 text-[6px] sm:text-[7.5px] truncate">未標記地點</span>
                      )}
                    </div>
                  </div>

                  {/* Hover inspection overlay */}
                  <div className="absolute inset-0 bg-amber-400/15 opacity-0 group-hover:opacity-100 transition flex items-center justify-center pointer-events-none">
                    <div className="p-1 sm:p-2 rounded-full bg-slate-950/80 text-amber-300 border border-amber-400/50 shadow-lg">
                      <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
                    </div>
                  </div>
                </div>
              );
            }

            /* Empty Slot: Pure clean number placeholder */
            return (
              <div
                key={numStr}
                className={`relative aspect-square bg-slate-950/30 rounded-lg sm:rounded-xl border border-dashed transition-all flex flex-col items-center justify-center p-0.5 sm:p-2 text-center select-none ${
                  isHighlighted
                    ? 'ring-2 sm:ring-4 ring-amber-400 border-amber-300 bg-slate-900/90'
                    : 'border-slate-850/60'
                }`}
              >
                {/* Special tags if any */}
                {tags.length > 0 && (
                  <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 flex flex-nowrap items-center justify-end gap-0.5 pointer-events-none z-10">
                    {tags.map((t) => (
                      <span
                        key={t.tag}
                        className={`text-[5px] sm:text-[7px] md:text-[8px] px-0.5 py-0 rounded font-bold border leading-none shadow-xs whitespace-nowrap flex-shrink-0 ${t.bgClass} ${t.colorClass}`}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                )}

                <span className="text-[9px] sm:text-xs md:text-sm font-mono font-bold tracking-tight sm:tracking-wider text-slate-600">
                  #{numStr}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
