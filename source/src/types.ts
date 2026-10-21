export type CropPositionMode =
  | 'full-vehicle'
  | 'car-front'
  | 'center'
  | 'lower'
  | 'upper'
  | 'tight'
  | 'custom';

export interface CropSettings {
  box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  placement: CropPositionMode;
  zoom: number; // 1.0 = normal context, 0.6 = wide context, 2.0 = tighter
  offsetX: number; // -100 to +100 (%)
  offsetY: number; // -100 to +100 (%)
}

export interface PlatePhotoItem {
  id: string; // unique identifier for the photo
  fullPlate: string; // Full license plate, e.g. "ABC-8888"
  imageUrl: string; // 1:1 cropped square image
  originalImageUrl?: string;
  collectedAt: string; // ISO 8601 string
  vehicleType?: string;
  vehicleColor?: string;
  notes?: string;
  locationName?: string; // Captured location, e.g. "台北市信義區"
  latitude?: number;
  longitude?: number;
  cropSettings?: CropSettings;
}

export interface PlateRecord {
  number: string; // 4-digit formatted string: "0000" to "9999"
  fullPlate: string; // Full license plate, e.g. "ABC-8888"
  imageUrl: string; // 1:1 cropped square image (data URL or blob URL)
  originalImageUrl?: string;
  collectedAt: string; // ISO 8601 string
  vehicleType?: string;
  vehicleColor?: string;
  notes?: string;
  locationName?: string; // Captured location, e.g. "台北市信義區"
  latitude?: number;
  longitude?: number;
  cropSettings?: CropSettings;
  photos?: PlatePhotoItem[]; // Multi-photo gallery for this number slot
}

export type SortMode = 'number-asc' | 'number-desc' | 'time-desc' | 'time-asc';

export interface PlateRecognitionResult {
  detected: boolean;
  fullPlate: string;
  digits: string; // "0000" to "9999"
  box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] (0-1000)
  vehicleType?: string;
  vehicleColor?: string;
  confidence?: number;
  notes?: string;
  message?: string;
  fallbackReason?: string;
}

export type SpecialTag =
  | 'forbidden'
  | 'four-of-a-kind'
  | 'pairs'
  | 'sequential'
  | 'thousands'
  | 'lucky'
  | 'tsmc'
  | 'dominant'
  | 'lucky-star'
  | 'lucky-slot'
  | 'mirror'
  | 'none';

export type FilterCategory =
  | 'all'
  | 'collected'
  | 'missing'
  | 'special'
  | 'forbidden'
  | 'four-of-a-kind'
  | 'pairs'
  | 'sequential'
  | 'thousands'
  | 'lucky'
  | 'tsmc'
  | 'dominant'
  | 'lucky-star'
  | 'lucky-slot'
  | 'mirror';

export type AppTheme = 'carbon' | 'cyber' | 'parchment';

