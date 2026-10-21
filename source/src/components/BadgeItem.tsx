import React from 'react';
import {
  Compass,
  Target,
  Flame,
  Trophy,
  Crown,
  Gem,
  Zap,
  Sparkles,
  Heart,
  Award,
  Globe,
  Palette,
  Car,
  Shield,
  Lock,
  Check,
  Star,
  Skull,
  TrendingUp,
  Coins,
  Cake,
  Mountain,
} from 'lucide-react';
import { ComputedBadge, BadgeTier, getBadgeTargetNumbers } from '../services/achievements';

interface BadgeItemProps {
  badge: ComputedBadge;
  onClick: () => void;
}

// Icon helper
export const renderBadgeIcon = (iconName: string, className: string = 'w-6 h-6') => {
  switch (iconName) {
    case 'Skull':
      return <Skull className={className} />;
    case 'TrendingUp':
      return <TrendingUp className={className} />;
    case 'Coins':
      return <Coins className={className} />;
    case 'Cake':
      return <Cake className={className} />;
    case 'Compass':
      return <Compass className={className} />;
    case 'Target':
      return <Target className={className} />;
    case 'Flame':
      return <Flame className={className} />;
    case 'Trophy':
      return <Trophy className={className} />;
    case 'Crown':
      return <Crown className={className} />;
    case 'Mountain':
      return <Mountain className={className} />;
    case 'Gem':
      return <Gem className={className} />;
    case 'Zap':
      return <Zap className={className} />;
    case 'Sparkles':
      return <Sparkles className={className} />;
    case 'Heart':
      return <Heart className={className} />;
    case 'Award':
      return <Award className={className} />;
    case 'Globe':
      return <Globe className={className} />;
    case 'Palette':
      return <Palette className={className} />;
    case 'Car':
      return <Car className={className} />;
    case 'Shield':
      return <Shield className={className} />;
    case 'Star':
      return <Star className={className} />;
    case 'Coins':
      return <Coins className={className} />;
    default:
      return <Star className={className} />;
  }
};

export const getTierStyle = (tier: BadgeTier, unlocked: boolean) => {
  if (!unlocked) {
    return {
      outerBorder: 'border-slate-700/80 hover:border-slate-500',
      ribbonBg: 'bg-slate-700 text-slate-200 border border-slate-600',
      ringGradient: 'from-slate-600 via-slate-700 to-slate-800',
      innerBg: 'bg-slate-850',
      iconColor: 'text-slate-300',
      glow: '',
      tierLabel: '未解鎖',
      tierColor: 'text-slate-300',
      accentBg: 'bg-slate-800 text-slate-200 border-slate-700',
    };
  }

  switch (tier) {
    case 'bronze':
      return {
        outerBorder: 'border-amber-900/60 hover:border-amber-600',
        ribbonBg: 'bg-amber-800 text-amber-100',
        ringGradient: 'from-amber-600 via-amber-700 to-amber-900',
        innerBg: 'bg-gradient-to-br from-amber-950/80 via-slate-900 to-amber-950/90',
        iconColor: 'text-amber-300',
        glow: 'shadow-[0_0_18px_rgba(217,119,6,0.25)]',
        tierLabel: '銅質青銅',
        tierColor: 'text-amber-500',
        accentBg: 'bg-amber-900/30 text-amber-200 border-amber-800/60',
      };
    case 'silver':
      return {
        outerBorder: 'border-slate-500/60 hover:border-slate-300',
        ribbonBg: 'bg-slate-600 text-slate-100',
        ringGradient: 'from-slate-200 via-slate-400 to-slate-600',
        innerBg: 'bg-gradient-to-br from-slate-800/90 via-slate-900 to-slate-800/90',
        iconColor: 'text-slate-100',
        glow: 'shadow-[0_0_18px_rgba(203,213,225,0.3)]',
        tierLabel: '白銀銀質',
        tierColor: 'text-slate-300',
        accentBg: 'bg-slate-800/50 text-slate-200 border-slate-700/80',
      };
    case 'gold':
      return {
        outerBorder: 'border-amber-500/60 hover:border-amber-300',
        ribbonBg: 'bg-amber-500 text-slate-950 font-bold',
        ringGradient: 'from-yellow-200 via-amber-400 to-amber-600',
        innerBg: 'bg-gradient-to-br from-amber-950/70 via-slate-900 to-amber-950/70',
        iconColor: 'text-amber-300',
        glow: 'shadow-[0_0_22px_rgba(251,191,36,0.35)]',
        tierLabel: '黃金金質',
        tierColor: 'text-amber-400',
        accentBg: 'bg-amber-500/20 text-amber-200 border-amber-400/50',
      };
    case 'diamond':
      return {
        outerBorder: 'border-cyan-500/60 hover:border-cyan-300',
        ribbonBg: 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold',
        ringGradient: 'from-cyan-200 via-sky-400 to-indigo-600',
        innerBg: 'bg-gradient-to-br from-sky-950/80 via-slate-900 to-indigo-950/80',
        iconColor: 'text-cyan-300',
        glow: 'shadow-[0_0_24px_rgba(56,189,248,0.4)]',
        tierLabel: '鑽石璀璨',
        tierColor: 'text-cyan-400',
        accentBg: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50',
      };
    case 'legendary':
      return {
        outerBorder: 'border-purple-500/70 hover:border-pink-400',
        ribbonBg: 'bg-gradient-to-r from-pink-500 via-purple-500 to-amber-400 text-white font-black',
        ringGradient: 'from-rose-400 via-amber-300 to-purple-500',
        innerBg: 'bg-gradient-to-br from-purple-950/80 via-slate-900 to-pink-950/80',
        iconColor: 'text-amber-300',
        glow: 'shadow-[0_0_28px_rgba(168,85,247,0.45)]',
        tierLabel: '神話傳奇',
        tierColor: 'text-purple-400',
        accentBg: 'bg-purple-500/25 text-purple-200 border-purple-400/60',
      };
  }
};

export const getCategoryChipStyle = (category: string, categoryLabel: string, unlocked: boolean) => {
  const isSpecial = category === 'special' || categoryLabel.includes('特殊');
  if (isSpecial) {
    return {
      chipClass: unlocked
        ? 'badge-chip-special bg-purple-900/40 text-purple-200 border-purple-500/50 font-bold'
        : 'badge-chip-special-locked bg-purple-950/40 text-purple-300 border-purple-600/40 font-semibold',
    };
  }
  return {
    chipClass: unlocked
      ? 'badge-chip-milestone bg-amber-900/30 text-amber-200 border-amber-500/40 font-bold'
      : 'badge-chip-milestone-locked bg-slate-800 text-slate-200 border-slate-700 font-semibold',
  };
};

export const BadgeItem: React.FC<BadgeItemProps> = ({ badge, onClick }) => {
  const { unlocked, tier } = badge;
  const style = getTierStyle(tier, unlocked);
  const categoryStyle = getCategoryChipStyle(badge.category, badge.categoryLabel, unlocked);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={`group relative badge-item-card bg-slate-850 border ${style.outerBorder} rounded-2xl p-4 flex flex-col items-center justify-between text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-pointer min-h-[200px] ${
        unlocked ? style.glow : 'hover:border-slate-500 hover:bg-slate-800'
      }`}
    >
      {/* Top Ribbon & Point Badge */}
      <div className="w-full flex items-center justify-between gap-1 text-[11px] mb-1 px-0.5 min-w-0">
        <span
          className={`badge-category-chip whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full border text-[9.5px] sm:text-[10px] tracking-wide leading-none ${categoryStyle.chipClass}`}
        >
          {badge.categoryLabel}
        </span>
        <span
          className={`font-mono font-bold flex items-center gap-0.5 text-[10.5px] sm:text-[11px] shrink-0 whitespace-nowrap ${
            badge.points < 0 ? 'text-rose-400' : 'text-amber-400/90'
          }`}
        >
          {badge.points > 0 ? `+${badge.points}` : `${badge.points}`}
          <span className="text-[8.5px] sm:text-[9px] text-slate-500">PTS</span>
        </span>
      </div>

      {/* 3D Physical Badge Medallion */}
      <div className="relative my-1">
        {/* Ribbon Pin on Top */}
        <div className="flex justify-center -mb-2 z-10 relative">
          <div
            className={`w-6 h-3.5 rounded-t-sm shadow-sm ${style.ribbonBg} flex items-center justify-center`}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-white/40 shadow-inner" />
          </div>
        </div>

        {/* Outer Ring */}
        <div
          className={`w-20 h-20 rounded-full p-[3px] ${
            unlocked
              ? `bg-gradient-to-tr ${style.ringGradient} shadow-md`
              : 'locked-badge-ring bg-slate-700/80 shadow-xs'
          } flex items-center justify-center transition-transform group-hover:scale-105 duration-300`}
        >
          {/* Beveled Metallic Inset */}
          <div
            className={`w-full h-full rounded-full p-[2px] ${
              unlocked ? 'bg-slate-950/80' : 'locked-badge-inset bg-slate-900'
            } flex items-center justify-center`}
          >
            {/* Center Core Emblem */}
            <div
              className={`w-full h-full rounded-full ${
                unlocked ? style.innerBg : 'locked-badge-core bg-slate-850'
              } flex items-center justify-center relative overflow-hidden border ${
                unlocked ? 'border-white/10' : 'border-slate-700/60'
              }`}
            >
              {/* Radial Luster Highlight */}
              {unlocked && (
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none" />
              )}

              {/* Center Icon */}
              {unlocked ? (
                <div className={`${style.iconColor} transition-transform duration-300 group-hover:scale-110`}>
                  {renderBadgeIcon(badge.icon, 'w-8 h-8')}
                </div>
              ) : (
                <div className="locked-badge-status flex flex-col items-center justify-center">
                  <Lock className="w-6 h-6 mb-0.5 text-slate-300 locked-lock-icon" />
                  <span className="text-[10px] font-sans font-bold text-slate-200 locked-lock-label tracking-wide">
                    未解鎖
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Unlocked Checkmark Seal */}
        {unlocked && (
          <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-slate-950 p-1 rounded-full border-2 border-slate-900 shadow-md">
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
        )}
      </div>

      {/* Badge Information */}
      <div className="w-full flex flex-col items-center mt-1">
        <h4
          className={`badge-title font-bold text-sm flex items-center gap-1 transition-colors line-clamp-1 ${
            unlocked
              ? 'text-slate-100 group-hover:text-amber-300'
              : 'text-slate-200 group-hover:text-white'
          }`}
        >
          {badge.title}
        </h4>

        {badge.tagline ? (
          <p
            className={`badge-tagline text-[11px] line-clamp-1 mt-0.5 max-w-[180px] font-medium ${
              unlocked ? 'text-slate-400' : 'text-slate-300'
            }`}
          >
            {badge.tagline}
          </p>
        ) : (
          <p className="text-[11px] text-transparent line-clamp-1 mt-0.5 select-none">
            &nbsp;
          </p>
        )}
      </div>
    </div>
  );
};
