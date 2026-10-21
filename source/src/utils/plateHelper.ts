export interface PlateIdentifiable {
  fullPlate?: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

/**
 * Automatically recognizes if a license plate record or photo was captured in Japan:
 * 1. Checks for explicit '#JP' tag in notes or plate string
 * 2. Checks for Hiragana characters (ろ, わ, あ, etc.) which are standard on Japanese plates
 * 3. Checks for Katakana characters (富士山, etc.)
 * 4. Checks for Japanese transport branch / region prefixes (品川, 世田谷, 練馬, etc.)
 * 5. Checks for Japan keywords in locationName (日本, 東京都, 品川, 大阪, etc.)
 * 6. Checks if GPS coordinates fall within Japan geographical territory (lat 24-46, lng 122.9-154)
 */
export function isJapanPlate(item?: PlateIdentifiable | null): boolean {
  if (!item) return false;

  const { fullPlate = '', locationName = '', latitude, longitude, notes = '' } = item;

  // 1. Explicit tag in notes or plate
  if (/#JP\b/i.test(notes) || /#JP\b/i.test(fullPlate)) {
    return true;
  }

  // 2. Hiragana characters in plate (\u3040-\u309F)
  if (/[\u3040-\u309F]/.test(fullPlate)) {
    return true;
  }

  // 3. Katakana characters in plate (\u30A0-\u30FF)
  if (/[\u30A0-\u30FF]/.test(fullPlate)) {
    return true;
  }

  // 4. Common Japanese transport district prefixes in fullPlate
  const JP_REGIONS = [
    '品川', '世田谷', '練馬', '足立', '杉並', '板橋', '多摩', '八王子',
    '横浜', '川崎', '湘南', '相模', '千葉', '習志野', '袖ヶ浦', '野田', '柏', '成田',
    '大宮', '所沢', '熊谷', '春日部', '川口', '越谷',
    '水戸', '土浦', 'つくば', '宇都宮', '那須', 'とちぎ', '前橋', '高崎', '群馬',
    '大阪', 'なにわ', '和泉', '堺', '京都', '神戸', '姫路', '奈良', '滋賀', '和歌山',
    '名古屋', '尾張小牧', '一宮', '春日井', '三河', '岡崎', '豊田', '豊橋',
    '静岡', '浜松', '富士山', '沼津', '伊豆', '岐阜', '飛騨', '三重', '鈴鹿',
    '札幌', '函館', '旭川', '室蘭', '釧路', '帯広', '北見',
    '青森', '八戸', '盛岡', '岩手', '平泉', '仙台', '宮城', '秋田', '山形', '庄内', '福島', '会津', '郡山', '白河', 'いわき',
    '新潟', '長岡', '上越', '富山', '金沢', '石川', '福井',
    '山梨', '長野', '松本', '諏訪',
    '鳥取', '島根', '出雲', '岡山', '倉敷', '広島', '福山', '山口', '下関',
    '徳島', '香川', '愛媛', '高知',
    '福岡', '北九州', '久留米', '筑豊', '佐賀', '長崎', '佐世保', '熊本', '大分', '宮崎', '鹿児島', '奄美', '沖縄'
  ];
  if (JP_REGIONS.some((region) => fullPlate.includes(region))) {
    return true;
  }

  // 5. Japanese location keywords in locationName
  if (
    /(日本|Japan|東京都|品川|新宿|澀谷|涉谷|渋谷|大阪|京都|北海道|福岡|沖繩|沖縄|神奈川|橫濱|横浜|愛知|名古屋|富士山|千葉|埼玉|兵庫|神戶|神戸|廣島|広島|靜岡|静岡|長野|奈良|宮城|仙台)/i.test(
      locationName
    )
  ) {
    return true;
  }

  // 6. Explicit GPS coordinates within Japan territory (lat 24-46, lng 122.9-154)
  // Standard Taiwan plates like ABC-1234 are excluded to prevent GPS drift/bleed false-positives
  const looksLikeTaiwanPlate = /^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/i.test(fullPlate.trim());
  if (!looksLikeTaiwanPlate && typeof latitude === 'number' && typeof longitude === 'number') {
    if (latitude >= 24 && latitude <= 46 && longitude >= 122.9 && longitude <= 154) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether an image URL is an artificial synthetic SVG illustration
 * rather than an authentic user-captured camera photo.
 */
export function isSyntheticSvgImage(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('data:image/svg+xml') ||
    trimmed.includes('<svg') ||
    trimmed.includes('carGrad') ||
    trimmed.includes('plateGloss') ||
    trimmed.includes('headlightGlow')
  );
}

/**
 * Checks whether an image URL is an authentic Base64 photo (JPEG, PNG, WebP)
 */
export function isBase64Photo(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (isSyntheticSvgImage(trimmed)) return false;
  return (
    (trimmed.startsWith('data:image/') ||
      trimmed.startsWith('data:application/octet-stream;base64,') ||
      trimmed.startsWith('/9j/') ||
      trimmed.startsWith('iVBORw') ||
      trimmed.startsWith('UklGR')) &&
    !trimmed.startsWith('data:image/svg+xml') &&
    trimmed.length > 50
  );
}

/**
 * Compares two image strings and returns the superior one:
 * 1. Base64 photo is ALWAYS preferred over relative URLs (/api/...) or placeholders.
 * 2. If both are Base64, returns the second (newer) one.
 * 3. External HTTP URLs are preferred over relative paths.
 * 4. Never returns synthetic SVG illustrations.
 */
export function getBetterImage(a?: string | null, b?: string | null): string {
  const cleanA = a && typeof a === 'string' && !isSyntheticSvgImage(a) ? a.trim() : '';
  const cleanB = b && typeof b === 'string' && !isSyntheticSvgImage(b) ? b.trim() : '';
  const aB64 = isBase64Photo(cleanA);
  const bB64 = isBase64Photo(cleanB);
  if (bB64) return cleanB;
  if (aB64) return cleanA;
  const bReal = isRealPhotoImage(cleanB);
  const aReal = isRealPhotoImage(cleanA);
  if (bReal && !cleanB.startsWith('/')) return cleanB;
  if (aReal && !cleanA.startsWith('/')) return cleanA;
  if (bReal) return cleanB;
  if (aReal) return cleanA;
  return cleanB || cleanA || '';
}

/**
 * Checks whether an image URL is an authentic captured camera photo (JPEG, PNG, WebP, Blob, HTTP)
 */
export function isRealPhotoImage(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (isSyntheticSvgImage(trimmed)) return false;
  return (
    trimmed.startsWith('data:image/jpeg') ||
    trimmed.startsWith('data:image/jpg') ||
    trimmed.startsWith('data:image/png') ||
    trimmed.startsWith('data:image/webp') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/api/plates/') ||
    trimmed.startsWith('/api/') ||
    (trimmed.length > 50 && !trimmed.startsWith('data:image/svg+xml'))
  );
}

/**
 * Returns the best real captured photo URL for a plate record.
 * Never synthesizes fake SVG cars. If no photo exists, returns empty string.
 */
export function getGuaranteedPlateImage(
  item?: { imageUrl?: string; originalImageUrl?: string; photos?: Array<{ imageUrl?: string; originalImageUrl?: string }>; fullPlate?: string; number?: string } | null,
  number?: string
): string {
  if (!item) return '';
  // 1. Base64 photo in imageUrl
  if (isBase64Photo(item.imageUrl)) {
    return item.imageUrl!.trim();
  }
  // 2. Base64 photo in photos array
  const b64Photo = item.photos?.find((p) => isBase64Photo(p?.imageUrl));
  if (b64Photo?.imageUrl) {
    return b64Photo.imageUrl.trim();
  }
  // 3. Base64 photo in originalImageUrl
  if (isBase64Photo(item.originalImageUrl)) {
    return item.originalImageUrl!.trim();
  }
  // 4. Any real photo
  if (isRealPhotoImage(item.imageUrl)) {
    return item.imageUrl!.trim();
  }
  const photoWithImg = item.photos?.find((p) => isRealPhotoImage(p?.imageUrl));
  if (photoWithImg?.imageUrl) {
    return photoWithImg.imageUrl.trim();
  }
  if (isRealPhotoImage(item.originalImageUrl)) {
    return item.originalImageUrl!.trim();
  }
  return '';
}
