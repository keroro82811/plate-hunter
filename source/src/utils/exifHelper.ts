import exifr from 'exifr';

export interface PhotoLocationInfo {
  latitude?: number;
  longitude?: number;
  locationName?: string;
  dateTime?: string; // ISO string
}

// Bounding box / point-in-polygon heuristic for Taiwan 22 administrative regions
const TAIWAN_REGIONS: Array<{
  name: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  centerLat: number;
  centerLng: number;
}> = [
  { name: '基隆市', latMin: 25.08, latMax: 25.18, lngMin: 121.68, lngMax: 121.82, centerLat: 25.13, centerLng: 121.74 },
  { name: '台北市', latMin: 24.96, latMax: 25.21, lngMin: 121.45, lngMax: 121.66, centerLat: 25.037, centerLng: 121.563 },
  { name: '新北市', latMin: 24.67, latMax: 25.30, lngMin: 121.28, lngMax: 122.01, centerLat: 25.01, centerLng: 121.46 },
  { name: '桃園市', latMin: 24.58, latMax: 25.12, lngMin: 120.98, lngMax: 121.48, centerLat: 24.99, centerLng: 121.30 },
  { name: '新竹市', latMin: 24.74, latMax: 24.86, lngMin: 120.90, lngMax: 121.05, centerLat: 24.81, centerLng: 120.97 },
  { name: '新竹縣', latMin: 24.45, latMax: 24.95, lngMin: 120.88, lngMax: 121.37, centerLat: 24.83, centerLng: 121.01 },
  { name: '苗栗縣', latMin: 24.30, latMax: 24.73, lngMin: 120.62, lngMax: 121.24, centerLat: 24.56, centerLng: 120.82 },
  { name: '台中市', latMin: 24.03, latMax: 24.44, lngMin: 120.48, lngMax: 121.45, centerLat: 24.16, centerLng: 120.68 },
  { name: '彰化縣', latMin: 23.82, latMax: 24.20, lngMin: 120.25, lngMax: 120.67, centerLat: 24.07, centerLng: 120.54 },
  { name: '南投縣', latMin: 23.45, latMax: 24.25, lngMin: 120.60, lngMax: 121.35, centerLat: 23.91, centerLng: 120.68 },
  { name: '雲林縣', latMin: 23.50, latMax: 23.85, lngMin: 120.10, lngMax: 120.73, centerLat: 23.70, centerLng: 120.43 },
  { name: '嘉義市', latMin: 23.44, latMax: 23.52, lngMin: 120.40, lngMax: 120.49, centerLat: 23.48, centerLng: 120.44 },
  { name: '嘉義縣', latMin: 23.20, latMax: 23.65, lngMin: 120.12, lngMax: 120.95, centerLat: 23.45, centerLng: 120.30 },
  { name: '台南市', latMin: 22.88, latMax: 23.42, lngMin: 120.03, lngMax: 120.65, centerLat: 22.99, centerLng: 120.21 },
  { name: '高雄市', latMin: 22.48, latMax: 23.47, lngMin: 120.24, lngMax: 120.88, centerLat: 22.62, centerLng: 120.31 },
  { name: '屏東縣', latMin: 21.89, latMax: 22.88, lngMin: 120.35, lngMax: 120.90, centerLat: 22.67, centerLng: 120.49 },
  { name: '宜蘭縣', latMin: 24.30, latMax: 24.99, lngMin: 121.31, lngMax: 121.95, centerLat: 24.75, centerLng: 121.75 },
  { name: '花蓮縣', latMin: 23.09, latMax: 24.37, lngMin: 121.15, lngMax: 121.78, centerLat: 23.99, centerLng: 121.61 },
  { name: '台東縣', latMin: 22.20, latMax: 23.45, lngMin: 120.80, lngMax: 121.60, centerLat: 22.75, centerLng: 121.15 },
  { name: '澎湖縣', latMin: 23.18, latMax: 23.78, lngMin: 119.30, lngMax: 119.72, centerLat: 23.57, centerLng: 119.58 },
  { name: '金門縣', latMin: 24.35, latMax: 24.54, lngMin: 118.21, lngMax: 118.50, centerLat: 24.44, centerLng: 118.37 },
  { name: '連江縣', latMin: 25.92, latMax: 26.38, lngMin: 119.90, lngMax: 120.55, centerLat: 26.15, centerLng: 119.95 },
];

/**
 * Approximate Taiwan county/city from coordinates (100% offline)
 */
export function getTaiwanCityFromCoordinates(lat: number, lng: number): string {
  // Find match inside bounding box, prioritize closest center
  let bestMatch = '';
  let minDistance = Infinity;

  for (const reg of TAIWAN_REGIONS) {
    if (lat >= reg.latMin && lat <= reg.latMax && lng >= reg.lngMin && lng <= reg.lngMax) {
      const dist = Math.hypot(lat - reg.centerLat, lng - reg.centerLng);
      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = reg.name;
      }
    }
  }

  if (bestMatch) return bestMatch;

  // Fallback for general Taiwan bounding box
  if (lat >= 21.5 && lat <= 26.5 && lng >= 118.0 && lng <= 122.5) {
    return '台灣';
  }

  return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

/**
 * Reverse geocode via OpenStreetMap Nominatim with fast timeout and offline fallback
 */
export async function reverseGeocodeLocation(lat: number, lng: number): Promise<string> {
  const offlineName = getTaiwanCityFromCoordinates(lat, lng);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s quick timeout

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1&accept-language=zh-TW`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const city = addr.city || addr.county || addr.town || addr.municipality || '';
      const district = addr.suburb || addr.city_district || addr.district || addr.town || addr.village || '';
      const road = addr.road || '';

      if (city && district) {
        return road ? `${city}${district} (${road})` : `${city}${district}`;
      } else if (city) {
        return road ? `${city} (${road})` : city;
      } else if (data.display_name) {
        const parts = data.display_name.split(',').map((s: string) => s.trim());
        return parts.slice(0, 2).join(' ') || offlineName;
      }
    }
  } catch {
    // Network failure, timeout, or blocked -> use offline calculation
  }

  return offlineName;
}

/**
 * Extract EXIF metadata (GPS & DateTime) from a photo File/Blob
 */
export async function extractExifMetadata(file: File | Blob): Promise<PhotoLocationInfo> {
  const result: PhotoLocationInfo = {};

  try {
    // Parse GPS and Dates
    const [gps, exif] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']).catch(() => null),
    ]);

    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      result.latitude = gps.latitude;
      result.longitude = gps.longitude;
      result.locationName = await reverseGeocodeLocation(gps.latitude, gps.longitude);
    }

    if (exif) {
      const rawDate = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
      if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
        result.dateTime = rawDate.toISOString();
      } else if (typeof rawDate === 'string') {
        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
        const clean = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
        const parsed = new Date(clean);
        if (!isNaN(parsed.getTime())) {
          result.dateTime = parsed.toISOString();
        }
      }
    }
  } catch (err) {
    console.warn('EXIF extraction skipped:', err);
  }

  return result;
}

/**
 * Get current location from browser's Geolocation API (for live camera shots)
 */
export async function getCurrentBrowserLocation(): Promise<{
  latitude: number;
  longitude: number;
  locationName: string;
} | null> {
  if (!navigator.geolocation) return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const locationName = await reverseGeocodeLocation(lat, lng);
        resolve({
          latitude: lat,
          longitude: lng,
          locationName,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
    );
  });
}
