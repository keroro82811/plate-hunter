import React, { useState, useMemo } from 'react';
import {
  X,
  Award,
  Target,
  Sparkles,
  TrendingUp,
  Medal,
  Shield,
  CheckCircle2,
  Lock,
  Filter,
} from 'lucide-react';
import { PlateRecord } from '../types';
import {
  computeBadges,
  ComputedBadge,
  BadgeCategory,
} from '../services/achievements';
import { BadgeItem } from './BadgeItem';
import { BadgeDetailModal } from './BadgeDetailModal';

interface StatsDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  plateMap: Map<string, PlateRecord>;
  onSelectPlate?: (num: string, photoId?: string) => void;
  initialTab?: ActiveTab;
  birthdayPlate?: string;
}

export type ActiveTab = 'badges' | 'stats';
type BadgeFilter = 'all' | 'unlocked' | 'locked' | 'special' | 'milestone';

export const StatsDashboard: React.FC<StatsDashboardProps> = ({
  isOpen,
  onClose,
  plateMap,
  onSelectPlate,
  initialTab = 'badges',
  birthdayPlate,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilter>('all');
  const [selectedBadge, setSelectedBadge] = useState<ComputedBadge | null>(null);

  React.useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Compute Badges & Hunter Rank safely
  const badgeData = useMemo(() => {
    return computeBadges(plateMap, { birthdayPlate });
  }, [plateMap, birthdayPlate]);

  // Filtered badges list
  const filteredBadges = useMemo(() => {
    return badgeData.badges.filter((b) => {
      if (badgeFilter === 'all') return true;
      if (badgeFilter === 'unlocked') return b.unlocked;
      if (badgeFilter === 'locked') return !b.unlocked;
      return b.category === badgeFilter;
    });
  }, [badgeData.badges, badgeFilter]);

  const totalSlots = 10000;
  const totalCollected = plateMap ? plateMap.size : 0;
  const overallPercentage = ((totalCollected / totalSlots) * 100).toFixed(2);

  // Total stored photos across all numbers
  const totalPhotosCount = useMemo(() => {
    if (!plateMap) return 0;
    let count = 0;
    for (const record of plateMap.values()) {
      if (!record) continue;
      count += record.photos?.length || 1;
    }
    return count;
  }, [plateMap]);

  // Compute thousand ranges breakdown safely
  const thousandBreakdown = useMemo(() => {
    const breakdown = Array.from({ length: 10 }, (_, i) => ({
      range: `${i}000-${i}999`,
      count: 0,
    }));
    if (plateMap) {
      for (const [num] of plateMap.entries()) {
        if (!num || typeof num !== 'string') continue;
        const idx = parseInt(num[0], 10);
        if (!isNaN(idx) && idx >= 0 && idx <= 9) {
          breakdown[idx].count++;
        }
      }
    }
    return breakdown;
  }, [plateMap]);

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      >
        <div
          id="stats-dashboard-modal"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Top Header Bar */}
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500/25 to-amber-400/10 text-amber-300 border border-amber-500/30 shadow-sm">
                <Medal className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  典藏櫃
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

          {/* Navigation Tabs */}
          <div className="px-5 pt-3 pb-0 bg-slate-950/40 border-b border-slate-800 flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto">
            <button
              onClick={() => setActiveTab('badges')}
              className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition shrink-0 ${
                activeTab === 'badges'
                  ? 'border-amber-400 text-amber-300 bg-slate-800/80'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Award className="w-4 h-4 text-amber-400" />
              <span>徽章</span>
            </button>

            <button
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition shrink-0 ${
                activeTab === 'stats'
                  ? 'border-amber-400 text-amber-300 bg-slate-800/80'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>進度條</span>
            </button>
          </div>

          {/* Scrollable Modal Content */}
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
            {activeTab === 'badges' && (
              <>
                {/* Hunter Rank & Points Hero Showcase Banner */}
                <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/20 border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-5">
                  <div className="w-full sm:w-auto">

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">目前稱號：</span>
                        <span
                          className={`text-base font-black tracking-wide ${badgeData.currentRank.badgeColor}`}
                        >
                          {badgeData.currentRank.title}
                        </span>
                      </div>

                      {badgeData.nextRank ? (
                        <p className="text-[11px] text-amber-400/80 mt-1.5 flex items-center gap-1 font-medium">
                          <span>下一階級「{badgeData.nextRank.title}」</span>
                          <span>
                            • 尚需收集{' '}
                            {Math.max(
                              1,
                              badgeData.nextRank.minPlates - (badgeData.collectedPlatesCount ?? 0)
                            ).toLocaleString()}{' '}
                            張車牌
                          </span>
                        </p>
                      ) : (
                        <p className="text-[11px] text-amber-300 mt-1.5 flex items-center gap-1 font-bold">
                          <span>🌟 已達成最高榮譽階級！</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Summary Counters */}
                  <div className="flex items-center gap-4 sm:gap-6 border-t sm:border-t-0 sm:border-l border-slate-800 pt-4 sm:pt-0 sm:pl-6 w-full sm:w-auto justify-around sm:justify-end">
                    <div className="text-center">
                      <div className="text-[11px] text-slate-400">已解鎖徽章</div>
                      <div className="text-2xl font-mono font-black text-amber-300">
                        {badgeData.unlockedCount}
                        <span className="text-xs text-slate-500 font-normal ml-1">
                          / {badgeData.totalCount}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {Math.round((badgeData.unlockedCount / Math.max(1, badgeData.totalCount)) * 100)}% 達成率
                      </div>
                    </div>

                    <div className="text-center">
                      <div className="text-[11px] text-slate-400">成就點數</div>
                      <div className="text-2xl font-mono font-black text-cyan-300">
                        {badgeData.totalPointsEarned}
                        <span className="text-xs text-slate-500 font-normal ml-1">
                          / {badgeData.maxPointsPossible}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">PTS 積分</div>
                    </div>
                  </div>
                </div>

                {/* Badge Filter Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  <button
                    onClick={() => setBadgeFilter('all')}
                    className={`badge-filter-btn px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                      badgeFilter === 'all'
                        ? 'bg-amber-400 text-slate-950 shadow-xs font-bold'
                        : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    全部徽章 ({badgeData.totalCount})
                  </button>
                  <button
                    onClick={() => setBadgeFilter('unlocked')}
                    className={`badge-filter-btn px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                      badgeFilter === 'unlocked'
                        ? 'bg-emerald-500 text-white shadow-xs font-bold'
                        : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    已獲得 ({badgeData.unlockedCount})
                  </button>
                  <button
                    onClick={() => setBadgeFilter('special')}
                    className={`badge-filter-btn badge-filter-special px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                      badgeFilter === 'special'
                        ? 'bg-purple-600 text-white shadow-xs font-bold'
                        : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    特殊車號
                  </button>
                  <button
                    onClick={() => setBadgeFilter('milestone')}
                    className={`badge-filter-btn px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                      badgeFilter === 'milestone'
                        ? 'bg-amber-400 text-slate-950 shadow-xs font-bold'
                        : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    收集里程碑
                  </button>
                </div>

                {/* Badge Collection Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {filteredBadges.map((badge) => (
                    <BadgeItem
                      key={badge.id}
                      badge={badge}
                      onClick={() => setSelectedBadge(badge)}
                    />
                  ))}
                </div>

                {filteredBadges.length === 0 && (
                  <div className="bg-slate-800/30 border border-dashed border-slate-700/80 rounded-2xl p-8 text-center">
                    <p className="text-sm text-slate-300">目前此分類尚無徽章。</p>
                  </div>
                )}
              </>
            )}

            {/* Statistics Progress Tab */}
            {activeTab === 'stats' && (
              <>
                {/* 10,000 Grand Collection Progress */}
                <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-700/80 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-5">
                  <div>
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono font-black text-4xl text-amber-300">
                        {totalCollected.toLocaleString()}
                      </span>
                      <span className="text-slate-400 font-mono text-sm">/ 10,000</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-mono font-bold text-xs border border-amber-400/30">
                        {overallPercentage}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      （已收錄 {totalCollected} 個號碼，目前總共留存 {totalPhotosCount} 張照片）
                    </p>
                  </div>

                  <div className="w-full sm:w-56 flex flex-col items-center">
                    <div className="w-full bg-slate-800 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-700">
                      <div
                        className="bg-gradient-to-r from-amber-500 to-amber-300 h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.max(1, (totalCollected / totalSlots) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 mt-1.5">
                      總完成率：{overallPercentage}%
                    </span>
                  </div>
                </div>

                {/* Thousand Blocks Breakdown */}
                <div>
                  <h3 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    <span>千位號碼分佈</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    {thousandBreakdown.map((item) => {
                      return (
                        <div
                          key={item.range}
                          className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 text-center space-y-1"
                        >
                          <span className="font-mono text-xs font-bold text-slate-300">
                            {item.range}
                          </span>
                          <div className="text-sm font-mono font-bold text-amber-300">
                            {item.count} <span className="text-[10px] text-slate-500">/ 1000</span>
                          </div>
                          <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                            <div
                              className="bg-amber-400 h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.max(item.count > 0 ? 5 : 0, item.count / 10)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between shrink-0">
            <span className="text-xs text-slate-400">
              {activeTab === 'badges'
                ? '點擊任一徽章可檢視大圖、解鎖條件與符合的已收集車牌'
                : ''}
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition active:scale-95"
            >
              關閉
            </button>
          </div>
        </div>
      </div>

      {/* Deep Badge Inspector Modal */}
      <BadgeDetailModal
        badge={selectedBadge}
        isOpen={!!selectedBadge}
        onClose={() => setSelectedBadge(null)}
        plateMap={plateMap}
        onSelectPlate={(num, photoId) => {
          setSelectedBadge(null);
          onClose();
          if (onSelectPlate) {
            onSelectPlate(num, photoId);
          }
        }}
      />
    </>
  );
};
