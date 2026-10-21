import React, { useState } from 'react';
import { Search, Award, Layers } from 'lucide-react';
import { ActiveTab } from './StatsDashboard';
import { AppTheme } from '../types';
import { ThemeSwitcher } from './ThemeSwitcher';
import { UserProfileData } from '../services/firebase';
import { User as FirebaseUser } from 'firebase/auth';

interface HeaderProps {
  totalCollected: number;
  unlockedBadgeCount?: number;
  totalBadgeCount?: number;
  currentTheme?: AppTheme;
  userProfile?: UserProfileData | null;
  currentUser?: FirebaseUser | null;
  onSelectTheme?: (theme: AppTheme) => void;
  onOpenUpload: (initialNumber?: string) => void;
  onOpenBatchUpload?: () => void;
  onOpenStats: (tab?: ActiveTab) => void;
  onOpenBackup?: () => void;
  onOpenProfile?: () => void;
  onJumpToNumber: (num: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  totalCollected,
  unlockedBadgeCount = 0,
  totalBadgeCount = 13,
  currentTheme = 'carbon',
  userProfile,
  currentUser,
  onSelectTheme,
  onOpenUpload,
  onOpenBatchUpload,
  onOpenStats,
  onOpenBackup,
  onOpenProfile,
  onJumpToNumber,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const totalSlots = 10000;
  const percentage = ((totalCollected / totalSlots) * 100).toFixed(2);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchInput.trim();
    if (!query) return;
    onJumpToNumber(query);
  };

  return (
    <header className="sticky top-0 z-30 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Title & Brand */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            {/* Top-left 0-9 icon acts directly as the Login button */}
            <button
              type="button"
              id="app-brand-icon-wrapper"
              onClick={onOpenProfile}
              title={
                currentUser
                  ? `已登入：${currentUser.displayName || currentUser.email || '已連線'}（點此查看登入狀態與個人檔案）`
                  : '點此直接登入'
              }
              aria-label="0-9 登入與個人檔案"
              className="group relative w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-amber-400 to-amber-300 p-0.5 shadow-lg shadow-amber-500/20 flex items-center justify-center shrink-0 transition-transform active:scale-95 hover:scale-105 cursor-pointer focus:outline-hidden"
            >
              <div
                id="app-brand-icon-inner"
                className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center relative overflow-hidden border border-amber-400/25 group-hover:border-amber-400/60 transition"
              >
                <span
                  id="app-brand-icon-text"
                  className="font-mono font-black text-[15px] tracking-tight bg-gradient-to-b from-amber-200 via-amber-400 to-amber-500 bg-clip-text text-transparent select-none drop-shadow-[0_1px_2px_rgba(245,158,11,0.25)]"
                >
                  0-9
                </span>
                {/* Active login indicator dot */}
                {currentUser && (
                  <span
                    title="已登入"
                    className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-slate-950 shadow-xs ring-1 ring-emerald-300 animate-pulse"
                  />
                )}
              </div>
            </button>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  車牌號碼收集冊
                </h1>
              </div>
            </div>
          </div>

          {/* Mobile Upload Button */}
          <div className="md:hidden flex items-center gap-1.5">
            {onOpenBatchUpload && (
              <button
                type="button"
                id="mobile-batch-upload-btn"
                onClick={onOpenBatchUpload}
                title="上傳照片"
                className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-3 py-2 rounded-lg text-xs shadow-md transition active:scale-95"
              >
                <Layers className="w-4 h-4" />
                <span>上傳照片</span>
              </button>
            )}
          </div>
        </div>

        {/* Search Jump Box */}
        <form
          onSubmit={handleSearchSubmit}
          className="relative w-full md:w-72 flex items-center"
        >
          <Search className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" />
          <input
            id="search-plate-input"
            type="text"
            maxLength={12}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="查詢車牌號碼"
            className="w-full bg-slate-900/90 text-slate-100 placeholder-slate-500 text-xs font-mono pl-9 pr-16 py-2.5 rounded-lg border border-slate-700/80 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
          />
          {searchInput && (
            <button
              type="submit"
              className="absolute right-1.5 px-2 py-1 text-[11px] font-mono bg-amber-400 text-slate-950 font-bold rounded hover:bg-amber-300 transition"
            >
              前往
            </button>
          )}
        </form>

        {/* Progress & Actions */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          {/* Theme Switcher Button */}
          {onSelectTheme && (
            <ThemeSwitcher
              currentTheme={currentTheme}
              onSelectTheme={onSelectTheme}
            />
          )}

          {/* Badge Showcase Button - Flat solid style without gradient */}
          <button
            type="button"
            id="open-badges-btn"
            onClick={() => onOpenStats('badges')}
            title="查看典藏櫃"
            className="h-10 px-3 sm:px-4 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 text-amber-400 border border-slate-700 hover:border-amber-400/50 text-xs font-semibold transition active:scale-95 shadow-xs shrink-0 whitespace-nowrap"
          >
            <Award className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="hidden xs:inline">典藏櫃</span>
          </button>

          {/* Progress summary widget - Visible on ALL devices (mobile & desktop) */}
          <button
            type="button"
            id="open-progress-btn"
            onClick={() => onOpenStats('stats')}
            title="查看進度條分頁"
            className="cursor-pointer group flex items-center gap-2 sm:gap-3 flex-1 md:flex-initial md:w-56 lg:w-60 h-10 bg-slate-900/90 hover:bg-slate-850 px-3 py-1.5 rounded-xl border border-amber-500/30 hover:border-amber-400/60 transition active:scale-95 text-left shrink-0"
          >
            <div className="flex items-center gap-1 text-xs text-slate-300 shrink-0">
              <span className="text-slate-300 font-medium">進度條</span>
              <span className="font-mono font-bold text-amber-300">{percentage}%</span>
            </div>
            <div className="flex-1 min-w-[50px] bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 to-amber-300 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(2, Math.min(100, (totalCollected / 10000) * 100))}%` }}
              />
            </div>
          </button>

          {/* Desktop Batch Upload Button */}
          {onOpenBatchUpload && (
            <button
              type="button"
              id="desktop-batch-upload-btn"
              onClick={onOpenBatchUpload}
              title="一次選取單張或多張照片上傳"
              className="hidden md:flex items-center justify-center gap-1.5 h-10 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-4 rounded-xl text-xs shadow-md transition active:scale-95 shrink-0 whitespace-nowrap"
            >
              <Layers className="w-4 h-4 shrink-0" />
              <span>上傳照片</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
