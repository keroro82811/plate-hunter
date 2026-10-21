export function formatDisplayDate(isoString?: string): string {
  if (!isoString) return '無日期記錄';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '無日期記錄';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${day} ${h}:${min}`;
  } catch {
    return '無日期記錄';
  }
}

export function formatRelativeTime(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);

    if (diffSec < 60) return '剛才';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小時前`;
    if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;

    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const y = d.getFullYear();
    const currentYear = new Date().getFullYear();

    if (y === currentYear) {
      return `${m}月${day}日`;
    }
    return `${y}/${m}/${day}`;
  } catch {
    return '';
  }
}
