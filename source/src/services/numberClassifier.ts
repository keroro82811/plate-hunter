import { FilterCategory, SpecialTag } from '../types';

/**
 * 禁忌 4444
 */
export function isForbidden(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  return numStr.trim() === '4444';
}

/**
 * 鐵支 四個相同（1111、2222、3333... 包括 4444、8888 等，不含 0000）
 */
export function isFourOfAKind(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  const s = numStr.trim();
  if (s.length !== 4 || s === '0000') return false;
  return s[0] === s[1] && s[1] === s[2] && s[2] === s[3];
}

/**
 * 對子 （1100、8822、5566... AABB 形式）
 */
export function isPairs(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  const s = numStr.trim();
  if (s.length !== 4) return false;
  // AABB (e.g. 1100, 8822, 5566, 1122) where AA !== BB
  return s[0] === s[1] && s[2] === s[3] && s[0] !== s[2];
}

/**
 * 順子 連續數字（1234、9876、2345... 不含 0123、3210，不含 4444）
 */
export function isSequential(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  const s = numStr.trim();
  if (s.length !== 4) return false;
  if (s === '0123' || s === '3210') return false;
  const ascending = '0123456789';
  const descending = '9876543210';
  return ascending.includes(s) || descending.includes(s);
}

/**
 * 千元 （1000、2000、3000... 9000 等 X000，不含 0000）
 */
export function isThousands(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  const s = numStr.trim();
  if (s.length !== 4) return false;
  return s !== '0000' && s.endsWith('000');
}

/**
 * 大吉大利 0168、1688、5168、6688、8888
 */
export const AUSPICIOUS_LUCKY_NUMBERS = [
  '0168',
  '1688',
  '5168',
  '6688',
  '8888',
] as const;

export function isLucky(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  const s = numStr.trim();
  if (s.length !== 4) return false;
  return (AUSPICIOUS_LUCKY_NUMBERS as readonly string[]).includes(s);
}

/**
 * 台股奇蹟 2330
 */
export function isTSMC(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  return numStr.trim() === '2330';
}

/**
 * 霸氣外漏 8787
 */
export function isDominant(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  return numStr.trim() === '8787';
}

/**
 * 幸運星 6666
 */
export function isLuckyStar(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  return numStr.trim() === '6666';
}

/**
 * 幸運拉霸 7777
 */
export function isLuckySlot(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  return numStr.trim() === '7777';
}

/**
 * 鏡像 像是 1221、8778 這種 ABBA 規則
 */
export function isMirror(numStr: string): boolean {
  if (!numStr || typeof numStr !== 'string') return false;
  const s = numStr.trim();
  if (s.length !== 4) return false;
  // ABBA 形式 (如 1221、8778、5665)，其中首末同數、中間同數且 A !== B
  return s[0] === s[3] && s[1] === s[2] && s[0] !== s[1];
}

export interface TagInfo {
  tag: SpecialTag;
  label: string;
  emoji: string;
  colorClass: string;
  bgClass: string;
}

export function getNumberTags(numStr: string): TagInfo[] {
  const tags: TagInfo[] = [];

  // 1. 禁忌 4444
  if (isForbidden(numStr)) {
    tags.push({
      tag: 'forbidden',
      label: '禁忌',
      emoji: '☠',
      colorClass: 'text-red-400 border-red-500/60',
      bgClass: 'bg-red-500/20',
    });
  }

  // 2. 護國神山 2330
  if (isTSMC(numStr)) {
    tags.push({
      tag: 'tsmc',
      label: '護國神山',
      emoji: '🏔️',
      colorClass: 'text-emerald-300 border-emerald-400/60',
      bgClass: 'bg-emerald-500/20',
    });
  }

  // 3. 大吉大利 (1688, 5168, 8888, 6666, 6688, 1680, 0168)
  if (isLucky(numStr)) {
    tags.push({
      tag: 'lucky',
      label: '大吉大利',
      emoji: '🧧',
      colorClass: 'text-amber-300 border-amber-400/60',
      bgClass: 'bg-amber-500/20',
    });
  }

  // 4. 鐵支 (四個相同 1111, 2222...)
  if (isFourOfAKind(numStr)) {
    tags.push({
      tag: 'four-of-a-kind',
      label: '鐵支',
      emoji: '🀄',
      colorClass: 'text-yellow-300 border-yellow-500/60',
      bgClass: 'bg-yellow-500/20',
    });
  }

  // 5. 順子 (連續數字 1234, 9876...)
  if (isSequential(numStr)) {
    tags.push({
      tag: 'sequential',
      label: '順子',
      emoji: '🚀',
      colorClass: 'text-sky-300 border-sky-500/60',
      bgClass: 'bg-sky-500/20',
    });
  }

  // 6. 對子 (1100、8822...)
  if (isPairs(numStr)) {
    tags.push({
      tag: 'pairs',
      label: '對子',
      emoji: '👥',
      colorClass: 'text-cyan-300 border-cyan-500/60',
      bgClass: 'bg-cyan-500/20',
    });
  }

  // 7. 千元 (1000、2000...)
  if (isThousands(numStr)) {
    tags.push({
      tag: 'thousands',
      label: '千元',
      emoji: '👑',
      colorClass: 'text-purple-300 border-purple-500/60',
      bgClass: 'bg-purple-500/20',
    });
  }

  // 8. 霸氣外漏 8787
  if (isDominant(numStr)) {
    tags.push({
      tag: 'dominant',
      label: '霸氣外漏',
      emoji: '⚡',
      colorClass: 'text-rose-300 border-rose-500/60',
      bgClass: 'bg-rose-500/20',
    });
  }

  // 9. 六六大順 6666
  if (isLuckyStar(numStr)) {
    tags.push({
      tag: 'lucky-star',
      label: '六六大順',
      emoji: '🌟',
      colorClass: 'text-amber-300 border-amber-400/60',
      bgClass: 'bg-amber-500/20',
    });
  }

  // 10. 幸運拉霸 7777
  if (isLuckySlot(numStr)) {
    tags.push({
      tag: 'lucky-slot',
      label: '幸運拉霸',
      emoji: '🎰',
      colorClass: 'text-emerald-300 border-emerald-400/60',
      bgClass: 'bg-emerald-500/20',
    });
  }

  // 11. 鏡像 (ABBA 形式，如 1221、8778)
  if (isMirror(numStr)) {
    tags.push({
      tag: 'mirror',
      label: '鏡像',
      emoji: '🪞',
      colorClass: 'text-violet-300 border-violet-400/60',
      bgClass: 'bg-violet-500/20',
    });
  }

  return tags;
}

export function matchFilterCategory(numStr: string, filter: FilterCategory, isCollected: boolean): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'collected':
      return isCollected;
    case 'missing':
      return !isCollected;
    case 'special':
      return getNumberTags(numStr).length > 0;
    case 'forbidden':
      return isForbidden(numStr);
    case 'tsmc':
      return isTSMC(numStr);
    case 'dominant':
      return isDominant(numStr);
    case 'lucky-star':
      return isLuckyStar(numStr);
    case 'lucky-slot':
      return isLuckySlot(numStr);
    case 'four-of-a-kind':
      return isFourOfAKind(numStr);
    case 'pairs':
      return isPairs(numStr);
    case 'sequential':
      return isSequential(numStr);
    case 'thousands':
      return isThousands(numStr);
    case 'lucky':
      return isLucky(numStr);
    case 'mirror':
      return isMirror(numStr);
    default:
      return true;
  }
}
