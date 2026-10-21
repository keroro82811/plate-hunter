import { CropPositionMode, CropSettings } from '../types';

export interface CropRect {
  x: number; // pixel in original image
  y: number; // pixel in original image
  size: number; // width and height in original image (1:1)
}

/**
 * Calculates the 1:1 square crop rectangle in original image coordinates
 * based on the detected plate bounding box and chosen positioning mode.
 */
export function calculateSquareCrop(
  imageWidth: number,
  imageHeight: number,
  box: [number, number, number, number], // [ymin, xmin, ymax, xmax] in 0-1000
  placement: CropPositionMode = 'full-vehicle',
  zoom: number = 1.0,
  offsetXPercent: number = 0,
  offsetYPercent: number = 0
): CropRect {
  // Convert normalized 0-1000 box to image pixels
  const [ymin, xmin, ymax, xmax] = box;
  const boxTop = Math.max(0, Math.min(imageHeight, (ymin / 1000) * imageHeight));
  const boxLeft = Math.max(0, Math.min(imageWidth, (xmin / 1000) * imageWidth));
  const boxBottom = Math.max(0, Math.min(imageHeight, (ymax / 1000) * imageHeight));
  const boxRight = Math.max(0, Math.min(imageWidth, (xmax / 1000) * imageWidth));

  const plateWidth = Math.max(20, boxRight - boxLeft);
  const plateHeight = Math.max(10, boxBottom - boxTop);
  const plateCenterX = boxLeft + plateWidth / 2;
  const plateCenterY = boxTop + plateHeight / 2;

  // Maximum possible square size within the image
  const maxSquareSize = Math.min(imageWidth, imageHeight);

  // Determine target square size based on vehicle framing mode
  // Note: A standard car width is ~4.8x to 5.2x the license plate width (185cm vs 38cm).
  let baseSize: number;
  // targetYRatio: where plate center should sit vertically within the 1:1 square (0 = top, 0.5 = center, 1 = bottom)
  let targetYRatio = 0.70;

  switch (placement) {
    case 'full-vehicle':
      // Vehicle Body + License Plate (車身全貌 + 車牌 - 預設推薦)
      // Captures full car body width (left and right headlights, fenders, hood, grille, and roofline/windshield)
      // with plate placed in lower third.
      baseSize = plateWidth * 4.9;
      targetYRatio = 0.72;
      break;

    case 'car-front':
      // Car Front/Rear half-body + Plate (車頭/車尾半身 + 車牌)
      baseSize = plateWidth * 3.4;
      targetYRatio = 0.68;
      break;

    case 'lower':
      // Lower third framing: plate sits near bottom-center (Y ~ 75%), showing extensive car body above
      baseSize = plateWidth * 4.6;
      targetYRatio = 0.74;
      break;

    case 'upper':
      // Upper third framing: plate sits near top (Y ~ 28%)
      baseSize = plateWidth * 4.2;
      targetYRatio = 0.28;
      break;

    case 'tight':
      // Close-up on the plate: plate occupies ~65% of the square width
      baseSize = plateWidth * 1.6;
      targetYRatio = 0.5;
      break;

    case 'center':
    case 'custom':
    default:
      // Perfectly centered car body & plate
      baseSize = plateWidth * 4.4;
      targetYRatio = 0.5;
      break;
  }

  // Apply zoom (higher zoom means smaller crop size, closer view; lower zoom means wider view)
  const adjustedZoom = Math.max(0.2, Math.min(3.0, zoom));
  let size = baseSize / adjustedZoom;

  // Ensure size is within reasonable bounds
  size = Math.max(plateWidth * 1.15, Math.min(maxSquareSize, size));

  // Compute top-left of the square based on target plate position
  let x = plateCenterX - size / 2;
  let y = plateCenterY - size * targetYRatio;

  // Apply custom offsets (percentage of square size)
  x += (offsetXPercent / 100) * size;
  y += (offsetYPercent / 100) * size;

  // Clamp to remain inside the image bounds
  x = Math.max(0, Math.min(imageWidth - size, x));
  y = Math.max(0, Math.min(imageHeight - size, y));

  return {
    x: Math.round(x),
    y: Math.round(y),
    size: Math.round(size),
  };
}

/**
 * Creates a high-resolution 1:1 square cropped image from an HTMLImageElement or ImageBitmap
 */
export async function createCroppedSquareImage(
  img: HTMLImageElement | ImageBitmap,
  cropRect: CropRect,
  outputSize: number = 800
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Failed to get 2d context for cropping.');
  }

  // Smooth scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw the 1:1 cropped section scaled to outputSize x outputSize
  ctx.drawImage(
    img,
    cropRect.x,
    cropRect.y,
    cropRect.size,
    cropRect.size,
    0,
    0,
    outputSize,
    outputSize
  );

  // Return crisp WebP or JPEG
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * Creates a clean 1:1 square image simply centered or fitted, without complex viewfinder layouts
 */
export async function createSimpleSquareCrop(
  img: HTMLImageElement,
  outputSize: number = 640
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return img.src;
  }

  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  const size = Math.min(imgW, imgH);
  const sx = (imgW - size) / 2;
  const sy = (imgH - size) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, size, size, 0, 0, outputSize, outputSize);

  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * Calculates exact crop coordinates for a 1:1 square from any aspect ratio (e.g. 9:16, 16:9)
 * with zoom factor and pan offsets (-100 to 100%).
 */
export function getCropCoordinates(
  imgW: number,
  imgH: number,
  zoom: number = 1.0,
  panX: number = 0,
  panY: number = 0
): { sx: number; sy: number; cropSize: number } {
  const minDim = Math.min(imgW, imgH);
  const effectiveZoom = Math.max(1.0, Math.min(5.0, zoom));
  const cropSize = Math.max(20, minDim / effectiveZoom);

  const maxShiftX = Math.max(0, (imgW - cropSize) / 2);
  const maxShiftY = Math.max(0, (imgH - cropSize) / 2);

  const clampedPanX = Math.max(-100, Math.min(100, panX));
  const clampedPanY = Math.max(-100, Math.min(100, panY));

  let sx = (imgW - cropSize) / 2 + (clampedPanX / 100) * maxShiftX;
  let sy = (imgH - cropSize) / 2 + (clampedPanY / 100) * maxShiftY;

  sx = Math.max(0, Math.min(imgW - cropSize, sx));
  sy = Math.max(0, Math.min(imgH - cropSize, sy));

  return {
    sx: Math.round(sx),
    sy: Math.round(sy),
    cropSize: Math.round(cropSize),
  };
}

/**
 * Checks whether an image has a 1:1 square aspect ratio (within reasonable tolerance)
 */
export function isSquareAspectRatio(w: number, h: number, tolerance: number = 0.08): boolean {
  if (!w || !h) return false;
  const ratio = w / h;
  return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}

/**
 * Calculates optimal vehicle framing for 9:16 or other aspect ratios.
 * Automatically zooms in to exclude irrelevant sky/ground/background,
 * and centers on the vehicle / license plate if bounding box is provided.
 */
export function calculateOptimalVehicleFraming(
  imgW: number,
  imgH: number,
  box?: [number, number, number, number] | null
): { zoom: number; panX: number; panY: number } {
  // If user uploads an image that is already 1:1 square, do NOT auto-zoom to 1.35x or crop!
  // Keep 1.0x intact and let user manually adjust if they desire.
  if (isSquareAspectRatio(imgW, imgH)) {
    return {
      zoom: 1.0,
      panX: 0,
      panY: 0,
    };
  }

  const minDim = Math.min(imgW, imgH);

  if (box && Array.isArray(box) && box.length === 4) {
    const [ymin, xmin, ymax, xmax] = box;
    const plateNormX = (xmin + xmax) / 2 / 1000;
    const plateNormY = (ymin + ymax) / 2 / 1000;
    const plateWidth = Math.max(20, ((xmax - xmin) / 1000) * imgW);

    // Target car framing: car width is usually ~3.6x - 4.5x plate width
    const targetCrop = Math.max(plateWidth * 2.8, Math.min(minDim, plateWidth * 4.2));
    let calculatedZoom = Number((minDim / targetCrop).toFixed(2));
    calculatedZoom = Math.max(1.15, Math.min(3.0, calculatedZoom));

    const cropSize = minDim / calculatedZoom;
    const maxShiftX = Math.max(0, (imgW - cropSize) / 2);
    const maxShiftY = Math.max(0, (imgH - cropSize) / 2);

    const platePxX = plateNormX * imgW;
    const platePxY = plateNormY * imgH;

    // Position plate slightly below center (at ~62% of crop height) so hood and lights are visible
    const desiredCenterY = platePxY - cropSize * 0.12;
    const deltaX = platePxX - imgW / 2;
    const deltaY = desiredCenterY - imgH / 2;

    const panX = maxShiftX > 0 ? Math.round((deltaX / maxShiftX) * 100) : 0;
    const panY = maxShiftY > 0 ? Math.round((deltaY / maxShiftY) * 100) : 0;

    return {
      zoom: calculatedZoom,
      panX: Math.max(-100, Math.min(100, panX)),
      panY: Math.max(-100, Math.min(100, panY)),
    };
  }

  // Fallback heuristic based on aspect ratio:
  // 9:16 portrait phone shots typically have car at lower half and huge sky above
  if (imgH > imgW * 1.25) {
    return {
      zoom: 1.35,
      panX: 0,
      panY: 28, // shift downward to focus on car and cut empty sky
    };
  }

  // 16:9 landscape
  if (imgW > imgH * 1.25) {
    return {
      zoom: 1.2,
      panX: 0,
      panY: 0,
    };
  }

  // Square or near-square
  return {
    zoom: 1.1,
    panX: 0,
    panY: 0,
  };
}

/**
 * Creates a clean 1:1 square crop with zoom and pan offsets
 */
export async function createCustomSquareCrop(
  img: HTMLImageElement,
  zoom: number = 1.0,
  panX: number = 0,
  panY: number = 0,
  outputSize: number = 640
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return img.src;
  }

  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  const { sx, sy, cropSize } = getCropCoordinates(imgW, imgH, zoom, panX, panY);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, outputSize, outputSize);

  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * Helper to load an image from a URL or data URL
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}
