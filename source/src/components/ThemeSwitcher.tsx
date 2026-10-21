import React, { useState, useRef, useEffect } from 'react';
import { Check, Palette } from 'lucide-react';
import { AppTheme } from '../types';

export interface ThemeConfig {
  id: AppTheme;
  name: string;
  bgHex: string;
  cardHex: string;
  accentHex: string;
  borderHex: string;
}

export const THEME_LIST: ThemeConfig[] = [
  {
    id: 'carbon',
    name: '暗夜黑金',
    bgHex: '#020617',
    cardHex: '#0f172a',
    accentHex: '#f59e0b',
    borderHex: '#334155',
  },
  {
    id: 'cyber',
    name: '午夜賽博',
    bgHex: '#06070f',
    cardHex: '#0d132a',
    accentHex: '#00f0ff',
    borderHex: '#1e2d5a',
  },
  {
    id: 'parchment',
    name: '日系手帳',
    bgHex: '#f5f0e6',
    cardHex: '#fcf9f2',
    accentHex: '#b93826',
    borderHex: '#d6cab6',
  },
];

interface ThemeSwitcherProps {
  currentTheme: AppTheme;
  onSelectTheme: (theme: AppTheme) => void;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  currentTheme,
  onSelectTheme,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeConfig =
    THEME_LIST.find((t) => t.id === currentTheme) || THEME_LIST[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        id="theme-switcher-btn"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={`切換風格主題（目前：${activeConfig.name}）`}
        className="h-10 px-3 sm:px-3.5 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-amber-400/50 text-xs font-semibold transition active:scale-95 shadow-sm shrink-0 whitespace-nowrap cursor-pointer"
      >
        <Palette className="w-3.5 h-3.5 shrink-0 transition-colors" />
        <span className="hidden sm:inline font-sans text-xs">{activeConfig.name}</span>
      </button>

      {isOpen && (
        <>
          {/* Mobile backdrop to catch outside taps and prevent accidental background clicks */}
          <div
            className="fixed inset-0 z-40 sm:hidden bg-black/25 backdrop-blur-[1px]"
            onClick={() => setIsOpen(false)}
          />

          <div
            id="theme-dropdown-menu"
            className="absolute left-0 sm:left-auto sm:right-0 top-12 mt-1 w-52 sm:w-48 p-2 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
            style={{ transformOrigin: 'top left' }}
          >
            {/* Header label for clarity */}
            <div className="px-2 pb-1.5 mb-1.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 theme-dropdown-title">切換視覺風格</span>
              <span className="text-[10px] text-slate-500 font-mono">3 款樣式</span>
            </div>

            <div className="space-y-1">
              {THEME_LIST.map((theme) => {
                const isSelected = theme.id === currentTheme;
                return (
                  <button
                    key={theme.id}
                    onClick={() => {
                      onSelectTheme(theme.id);
                      setIsOpen(false);
                    }}
                    className={`theme-dropdown-item w-full text-left px-2.5 py-2 rounded-xl transition flex items-center justify-between gap-2.5 group cursor-pointer border ${
                      isSelected
                        ? 'bg-slate-800/90 border-amber-400/60 shadow-xs'
                        : 'hover:bg-slate-800/50 border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Visual color palette preview swatch */}
                      <div
                        className="w-4 h-4 rounded-md border shadow-xs flex items-center justify-center shrink-0 relative overflow-hidden"
                        style={{
                          backgroundColor: theme.bgHex,
                          borderColor: theme.borderHex,
                        }}
                      >
                        <div
                          className="w-2 h-2 rounded-full shadow-xs"
                          style={{ backgroundColor: theme.accentHex }}
                        />
                      </div>

                      <span className="text-xs font-bold text-slate-100 theme-name-text truncate">
                        {theme.name}
                      </span>
                    </div>

                    {isSelected && (
                      <div className="theme-check-icon w-4 h-4 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shrink-0 shadow-xs">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
