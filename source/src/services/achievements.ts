import { PlateRecord } from '../types';
import {
  isForbidden,
  isFourOfAKind,
  isPairs,
  isSequential,
  isThousands,
  isLucky,
  isTSMC,
  isDominant,
  isLuckyStar,
  isLuckySlot,
  isMirror,
  AUSPICIOUS_LUCKY_NUMBERS,
} from './numberClassifier';

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'diamond' | 'legendary';
export type BadgeCategory = 'special' | 'milestone';

export interface BadgeDefinition {
  id: string;
  title: string;
  category: BadgeCategory;
  categoryLabel: string;
  tier: BadgeTier;
  icon: string; // identifier for Lucide icon
  tagline: string;
  description: string;
  targetCount: number;
  points: number;
  evaluate: (plateMap: Map<string, PlateRecord>) => {
    unlocked: boolean;
    currentCount: number;
    matchingPlates: string[]; // plate numbers that match
  };
}

export interface ComputedBadge {
  id: string;
  title: string;
  category: BadgeCategory;
  categoryLabel: string;
  tier: BadgeTier;
  icon: string;
  tagline: string;
  description: string;
  targetCount: number;
  points: number;
  unlocked: boolean;
  currentCount: number;
  progressPercentage: number;
  matchingPlates: string[];
}

export interface HunterRank {
  title: string;
  minPlates: number;
  minBadges?: number;
  badgeColor: string;
  description: string;
}

export const HUNTER_RANKS: HunterRank[] = [
  { title: '零之起點', minPlates: 0, minBadges: 0, badgeColor: 'text-amber-500', description: '萬里之行・始於足下' },
  { title: '十全大補', minPlates: 10, minBadges: 1, badgeColor: 'text-slate-200', description: '小試身手・漸入佳境' },
  { title: '五十五十', minPlates: 50, minBadges: 2, badgeColor: 'text-amber-400', description: '成敗各半・逆天改命' },
  { title: '百步穿楊', minPlates: 100, minBadges: 3, badgeColor: 'text-cyan-300', description: '弦無虛發・勢不可擋' },
  { title: '千羅萬象', minPlates: 1000, minBadges: 4, badgeColor: 'text-purple-300', description: '破千化境・玄妙莫測' },
  { title: '五嶽獨尊', minPlates: 5000, minBadges: 5, badgeColor: 'text-rose-400', description: '登峰造極・睥睨群雄' },
  { title: '萬佛朝宗', minPlates: 10000, minBadges: 6, badgeColor: 'text-amber-300', description: '萬象歸一・傳奇圓滿' },
];

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // ==========================================
  // --- 特殊車號 ---
  // ==========================================
  {
    id: 'badge_forbidden_4444',
    title: '禁忌之巔',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'legendary',
    icon: 'Skull',
    tagline: '你敢開嗎?',
    description: '完成收集到車牌「4444」。',
    targetCount: 1,
    points: -444,
    evaluate: (plateMap) => {
      const match = plateMap.has('4444') ? ['4444'] : [];
      return {
        unlocked: match.length > 0,
        currentCount: match.length,
        matchingPlates: match,
      };
    },
  },
  {
    id: 'badge_tsmc_2330',
    title: '護國神山',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'legendary',
    icon: 'TrendingUp',
    tagline: '台灣半導體奇蹟',
    description: '完成收集到tsmc車牌「2330」，見證台灣半導體傳奇。',
    targetCount: 1,
    points: 2330,
    evaluate: (plateMap) => {
      const match = plateMap.has('2330') ? ['2330'] : [];
      return {
        unlocked: match.length > 0,
        currentCount: match.length,
        matchingPlates: match,
      };
    },
  },
  {
    id: 'badge_dominant_8787',
    title: '霸氣外漏',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'legendary',
    icon: 'Flame',
    tagline: '不能在高了!',
    description: '完成收集到車牌「8787」。',
    targetCount: 1,
    points: 87,
    evaluate: (plateMap) => {
      const match = plateMap.has('8787') ? ['8787'] : [];
      return {
        unlocked: match.length > 0,
        currentCount: match.length,
        matchingPlates: match,
      };
    },
  },
  {
    id: 'badge_lucky_star_6666',
    title: '六六大順',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'legendary',
    icon: 'Star',
    tagline: '吉星高照・好運連連',
    description: '完成收集到車牌「6666」。',
    targetCount: 1,
    points: 666,
    evaluate: (plateMap) => {
      const match = plateMap.has('6666') ? ['6666'] : [];
      return {
        unlocked: match.length > 0,
        currentCount: match.length,
        matchingPlates: match,
      };
    },
  },
  {
    id: 'badge_lucky_slot_7777',
    title: '幸運拉霸',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'legendary',
    icon: 'Coins',
    tagline: '頭獎降臨・天降橫財',
    description: '完成收集到車牌「7777」。',
    targetCount: 1,
    points: 777,
    evaluate: (plateMap) => {
      const match = plateMap.has('7777') ? ['7777'] : [];
      return {
        unlocked: match.length > 0,
        currentCount: match.length,
        matchingPlates: match,
      };
    },
  },
  {
    id: 'badge_lucky_auspicious',
    title: '大吉大利',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'diamond',
    icon: 'Sparkles',
    tagline: '富貴吉祥・一路發發',
    description: '完成收集指定吉祥號碼（0168、1688、5168、6688、8888 共 5 組）。',
    targetCount: 5,
    points: 888,
    evaluate: (plateMap) => {
      const matches: string[] = [];
      for (const num of AUSPICIOUS_LUCKY_NUMBERS) {
        if (plateMap.has(num)) matches.push(num);
      }
      return {
        unlocked: matches.length >= 5,
        currentCount: matches.length,
        matchingPlates: matches,
      };
    },
  },
  {
    id: 'badge_four_of_a_kind',
    title: '鐵支天王',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'diamond',
    icon: 'Gem',
    tagline: 'AAAA',
    description: '完成收集四個相同號碼。',
    targetCount: 9,
    points: 900,
    evaluate: (plateMap) => {
      const matches: string[] = [];
      for (const [num] of plateMap.entries()) {
        if (isFourOfAKind(num)) matches.push(num);
      }
      return {
        unlocked: matches.length >= 9,
        currentCount: matches.length,
        matchingPlates: matches,
      };
    },
  },
  {
    id: 'badge_sequential',
    title: '順子連行',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'gold',
    icon: 'Zap',
    tagline: '',
    description: '完成收集連續號碼車牌。',
    targetCount: 12,
    points: 600,
    evaluate: (plateMap) => {
      const matches: string[] = [];
      for (const [num] of plateMap.entries()) {
        if (isSequential(num)) matches.push(num);
      }
      return {
        unlocked: matches.length >= 12,
        currentCount: matches.length,
        matchingPlates: matches,
      };
    },
  },
  {
    id: 'badge_pairs',
    title: '成雙成對',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'silver',
    icon: 'Heart',
    tagline: '雙雙對對・萬年富貴',
    description: '完成收集對子號碼（如 5566、8877 等 AABB 格式）。',
    targetCount: 90,
    points: 500,
    evaluate: (plateMap) => {
      const matches: string[] = [];
      for (const [num] of plateMap.entries()) {
        if (isPairs(num)) matches.push(num);
      }
      return {
        unlocked: matches.length >= 90,
        currentCount: matches.length,
        matchingPlates: matches,
      };
    },
  },
  {
    id: 'badge_thousands',
    title: '千元霸主',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'silver',
    icon: 'Coins',
    tagline: '尖尖哇嘎乃',
    description: '完成收集整千號碼車牌。',
    targetCount: 9,
    points: 300,
    evaluate: (plateMap) => {
      const matches: string[] = [];
      for (const [num] of plateMap.entries()) {
        if (isThousands(num)) matches.push(num);
      }
      return {
        unlocked: matches.length >= 9,
        currentCount: matches.length,
        matchingPlates: matches,
      };
    },
  },
  {
    id: 'badge_mirror',
    title: '鏡花水月',
    category: 'special',
    categoryLabel: '特殊車號',
    tier: 'silver',
    icon: 'Sparkles',
    tagline: '你從什麼時候開始產生了我沒使用鏡花水月的錯覺?',
    description: '完成收集鏡像號碼（如 1221、8778 等 ABBA 格式，共 90 組）。',
    targetCount: 90,
    points: 570,
    evaluate: (plateMap) => {
      const matches: string[] = [];
      for (const [num] of plateMap.entries()) {
        if (isMirror(num)) matches.push(num);
      }
      return {
        unlocked: matches.length >= 90,
        currentCount: matches.length,
        matchingPlates: matches,
      };
    },
  },

  // ==========================================
  // --- 收集里程碑 (Milestones) ---
  // ==========================================
  {
    id: 'first_catch',
    title: '零之起點',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'bronze',
    icon: 'Compass',
    tagline: '萬里之行・始於足下',
    description: '成功上傳第一張車牌號碼。',
    targetCount: 1,
    points: 50,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 1,
        currentCount: Math.min(1, all.length),
        matchingPlates: [],
      };
    },
  },
  {
    id: 'ten_milestone',
    title: '十全大補',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'silver',
    icon: 'Target',
    tagline: '小試身手・漸入佳境',
    description: '累積收集達到 10 張不同號碼的車牌。',
    targetCount: 10,
    points: 100,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 10,
        currentCount: Math.min(10, all.length),
        matchingPlates: [],
      };
    },
  },
  {
    id: 'fifty_hunter',
    title: '五十五十',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'gold',
    icon: 'Flame',
    tagline: '成敗各半・逆天改命',
    description: '累積收集達到 50 張不同號碼的車牌。',
    targetCount: 50,
    points: 250,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 50,
        currentCount: Math.min(50, all.length),
        matchingPlates: [],
      };
    },
  },
  {
    id: 'centurion_100',
    title: '百步穿楊',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'diamond',
    icon: 'Trophy',
    tagline: '弦無虛發・勢不可擋',
    description: '累積達到 100 張車牌，踏入核心收藏家殿堂。',
    targetCount: 100,
    points: 500,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 100,
        currentCount: Math.min(100, all.length),
        matchingPlates: [],
      };
    },
  },
  {
    id: 'grand_1000',
    title: '千羅萬象',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'legendary',
    icon: 'Crown',
    tagline: '破千化境・玄妙莫測',
    description: '累積收集達到 1,000 張不同號碼的車牌。',
    targetCount: 1000,
    points: 1000,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 1000,
        currentCount: Math.min(1000, all.length),
        matchingPlates: [],
      };
    },
  },
  {
    id: 'grand_5000',
    title: '五嶽獨尊',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'legendary',
    icon: 'Mountain',
    tagline: '登峰造極・睥睨群雄',
    description: '累積收集達到 5,000 張不同號碼的車牌。',
    targetCount: 5000,
    points: 5000,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 5000,
        currentCount: Math.min(5000, all.length),
        matchingPlates: [],
      };
    },
  },
  {
    id: 'grand_10000',
    title: '萬佛朝宗',
    category: 'milestone',
    categoryLabel: '收集里程碑',
    tier: 'legendary',
    icon: 'Crown',
    tagline: '萬象歸一・傳奇圓滿',
    description: '累積收集達到 10,000 張不同號碼的車牌。',
    targetCount: 10000,
    points: 10000,
    evaluate: (plateMap) => {
      const all = Array.from(plateMap.keys());
      return {
        unlocked: all.length >= 10000,
        currentCount: Math.min(10000, all.length),
        matchingPlates: [],
      };
    },
  },
];

/**
 * Compute all badges with current status from plateMap
 */
export function computeBadges(
  plateMap?: Map<string, PlateRecord>,
  options?: { birthdayPlate?: string }
): {
  badges: ComputedBadge[];
  unlockedCount: number;
  totalCount: number;
  totalPointsEarned: number;
  maxPointsPossible: number;
  currentRank: HunterRank;
  nextRank: HunterRank | null;
  collectedPlatesCount: number;
} {
  const safeMap = plateMap instanceof Map ? plateMap : new Map<string, PlateRecord>();

  const allDefs = [...BADGE_DEFINITIONS];
  if (options?.birthdayPlate && /^\d{4}$/.test(options.birthdayPlate)) {
    const bPlate = options.birthdayPlate;
    allDefs.unshift({
      id: 'badge_birthday',
      title: '生日快樂',
      category: 'special',
      categoryLabel: '生日專屬',
      tier: 'legendary',
      icon: 'Cake',
      tagline: '可以跟我說那四個字嗎?',
      description: '成功收集屬於您個人的生日車牌！',
      targetCount: 1,
      points: 1000,
      evaluate: (map) => {
        const isCollected = map.has(bPlate);
        return {
          unlocked: isCollected,
          currentCount: isCollected ? 1 : 0,
          matchingPlates: isCollected ? [bPlate] : [],
        };
      },
    });
  }

  const badges: ComputedBadge[] = allDefs.map((def) => {
    let result = { unlocked: false, currentCount: 0, matchingPlates: [] as string[] };
    try {
      result = def.evaluate(safeMap);
    } catch (e) {
      console.warn(`Error evaluating badge ${def.id}:`, e);
    }
    const currentCount = Number.isFinite(result.currentCount) ? Math.max(0, result.currentCount) : 0;
    const progressPercentage = Math.min(100, Math.round((currentCount / Math.max(1, def.targetCount)) * 100));
    return {
      id: def.id,
      title: def.title,
      category: def.category,
      categoryLabel: def.categoryLabel,
      tier: def.tier,
      icon: def.icon,
      tagline: def.tagline,
      description: def.description,
      targetCount: def.targetCount,
      points: def.points,
      unlocked: Boolean(result.unlocked),
      currentCount,
      progressPercentage,
      matchingPlates: Array.isArray(result.matchingPlates) ? result.matchingPlates : [],
    };
  });

  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const totalCount = badges.length;
  const totalPointsEarned = badges.reduce((acc, b) => acc + (b.unlocked ? b.points : 0), 0);
  const maxPointsPossible = badges.reduce((acc, b) => acc + Math.max(0, b.points), 0);

  const collectedPlatesCount = safeMap.size;

  // Compute rank based on collection milestones (plate count)
  let currentRank = HUNTER_RANKS[0];
  let nextRank: HunterRank | null = HUNTER_RANKS[1] || null;

  for (let i = 0; i < HUNTER_RANKS.length; i++) {
    if (collectedPlatesCount >= HUNTER_RANKS[i].minPlates) {
      currentRank = HUNTER_RANKS[i];
      nextRank = HUNTER_RANKS[i + 1] || null;
    }
  }

  return {
    badges,
    unlockedCount,
    totalCount,
    totalPointsEarned,
    maxPointsPossible,
    currentRank,
    nextRank,
    collectedPlatesCount,
  };
}

/**
 * Returns specific target numbers for special number badges if defined
 */
export function getBadgeTargetNumbers(badgeId: string): string[] | null {
  switch (badgeId) {
    case 'badge_four_of_a_kind':
      return ['1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999'];
    case 'badge_thousands':
      return ['1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000', '9000'];
    case 'badge_sequential':
      return [
        '1234', '2345', '3456', '4567', '5678', '6789',
        '9876', '8765', '7654', '6543', '5432', '4321',
      ];
    case 'badge_lucky_auspicious':
      return ['0168', '1688', '5168', '6688', '8888'];
    default:
      return null;
  }
}
