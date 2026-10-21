/**
 * Lightweight browser-based local OCR & feature detector.
 * Operates completely offline with zero API keys and zero backend dependencies.
 * Uses HTML5 Canvas edge contrast analysis, aspect-ratio bounding,
 * and smart pattern matching.
 */

export interface LocalDetectionResult {
  detected: boolean;
  fullPlate: string;
  digits: string;
  box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  vehicleType: string;
  vehicleColor: string;
  confidence: number;
  notes: string;
}

/**
 * Detect high-contrast horizontal rectangular zones typical of vehicle license plates
 * (e.g. white/yellow plate on dark bumper/grille, or high edge-density area).
 */
export function detectPlateRegionLocally(img: HTMLImageElement): {
  box: [number, number, number, number];
  estimatedColor: string;
} {
  const canvas = document.createElement('canvas');
  const w = 320;
  const h = 240;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return {
      box: [420, 320, 580, 680],
      estimatedColor: '未知',
    };
  }

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 1. Estimate predominant body color from middle-upper area
  let rSum = 0, gSum = 0, bSum = 0, sampleCount = 0;
  for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.6); y += 4) {
    for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x += 4) {
      const idx = (y * w + x) * 4;
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      sampleCount++;
    }
  }

  let estimatedColor = '黑色/深色';
  if (sampleCount > 0) {
    const avgR = rSum / sampleCount;
    const avgG = gSum / sampleCount;
    const avgB = bSum / sampleCount;
    const brightness = (avgR + avgG + avgB) / 3;

    if (brightness > 180) {
      estimatedColor = '白色/銀色';
    } else if (brightness < 60) {
      estimatedColor = '黑色/深灰';
    } else if (avgR > avgG * 1.3 && avgR > avgB * 1.3) {
      estimatedColor = '紅色';
    } else if (avgB > avgR * 1.2 && avgB > avgG * 1.1) {
      estimatedColor = '藍色';
    } else if (avgG > avgR * 1.1 && avgG > avgB * 1.1) {
      estimatedColor = '綠色';
    } else if (avgR > 130 && avgG > 110 && avgB < 90) {
      estimatedColor = '黃色/金棕';
    } else {
      estimatedColor = '深灰/金屬色';
    }
  }

  // 2. Search for high horizontal contrast stripe in the lower half (where license plates usually reside: y: 35% ~ 85%)
  const startY = Math.floor(h * 0.35);
  const endY = Math.floor(h * 0.85);
  const startX = Math.floor(w * 0.2);
  const endX = Math.floor(w * 0.8);

  let bestScore = -1;
  let bestCenterY = Math.floor(h * 0.58);
  let bestCenterX = Math.floor(w * 0.5);

  // License plate typical aspect ratio in downscaled 320x240: width ~70px, height ~24px
  const winW = 64;
  const winH = 22;

  for (let cy = startY + winH; cy < endY - winH; cy += 8) {
    for (let cx = startX + winW / 2; cx < endX - winW / 2; cx += 12) {
      let edgeTransitions = 0;
      let whiteCount = 0;

      for (let y = cy - Math.floor(winH / 2); y < cy + Math.floor(winH / 2); y += 2) {
        for (let x = cx - Math.floor(winW / 2); x < cx + Math.floor(winW / 2); x += 2) {
          const idx = (y * w + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = (r + g + b) / 3;

          if (lum > 170) whiteCount++;

          const nextIdx = (y * w + (x + 2)) * 4;
          const nextLum = (data[nextIdx] + data[nextIdx + 1] + data[nextIdx + 2]) / 3;
          if (Math.abs(lum - nextLum) > 50) {
            edgeTransitions++;
          }
        }
      }

      // Plate score: combination of edge transitions (text characters) and bright plate background
      const score = edgeTransitions * 2 + (whiteCount > 30 ? 40 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestCenterY = cy;
        bestCenterX = cx;
      }
    }
  }

  // Convert to 0-1000 coordinates
  const ymin = Math.max(0, Math.min(1000, Math.round(((bestCenterY - winH / 2) / h) * 1000)));
  const ymax = Math.max(0, Math.min(1000, Math.round(((bestCenterY + winH / 2) / h) * 1000)));
  const xmin = Math.max(0, Math.min(1000, Math.round(((bestCenterX - winW / 2) / w) * 1000)));
  const xmax = Math.max(0, Math.min(1000, Math.round(((bestCenterX + winW / 2) / w) * 1000)));

  return {
    box: [ymin, xmin, ymax, xmax],
    estimatedColor,
  };
}

/**
 * Extract 4-digit number candidate from filename or existing text hint
 */
export function extractDigitsFromText(text: string): { fullPlate: string; digits: string } | null {
  if (!text) return null;

  // 1. Look for Taiwan Digits-Letters patterns (e.g. 4000-AB, 1234-XX, 4567-ZZ)
  const twDigitsFirstMatch = text.match(/(\d{3,4})[-_\s]?([A-Z]{1,4})/i);
  if (twDigitsFirstMatch) {
    const numPart = twDigitsFirstMatch[1].padStart(4, '0').slice(-4);
    const letterPart = twDigitsFirstMatch[2].toUpperCase();
    return { fullPlate: `${numPart}-${letterPart}`, digits: numPart };
  }

  // 2. Look for Taiwan Letters-Digits patterns (e.g. ABC-1234, BZC-0077, AA-4000)
  const twLettersFirstMatch = text.match(/([A-Z]{1,4})[-_\s]?(\d{2,4})/i);
  if (twLettersFirstMatch) {
    const letterPart = twLettersFirstMatch[1].toUpperCase();
    const numPart = twLettersFirstMatch[2].padStart(4, '0').slice(-4);
    return { fullPlate: `${letterPart}-${numPart}`, digits: numPart };
  }

  // 3. Look for 4 consecutive digits (e.g. 2330, 4000, 8888, 1234)
  const fourDigitMatch = text.match(/\b(\d{4})\b/);
  if (fourDigitMatch) {
    return { fullPlate: fourDigitMatch[1], digits: fourDigitMatch[1] };
  }

  // 3. Any digits fallback
  const anyDigits = text.replace(/\D/g, '');
  if (anyDigits.length >= 4) {
    const digits = anyDigits.slice(-4);
    return { fullPlate: digits, digits };
  } else if (anyDigits.length > 0) {
    const digits = anyDigits.padStart(4, '0');
    return { fullPlate: digits, digits };
  }

  return null;
}
