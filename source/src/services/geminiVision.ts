/**
 * Client-side Gemini Vision API for license plate recognition.
 * Logic ported from server.ts /api/recognize-plate endpoint.
 */

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const isNewKeyFormat = GEMINI_API_KEY.startsWith('AQ.');

function buildUrl(model: string): string {
  if (isNewKeyFormat) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isNewKeyFormat) h['x-goog-api-key'] = GEMINI_API_KEY;
  return h;
}

// Structured JSON schema — same as server.ts responseSchema
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    detected: { type: 'boolean', description: 'True if a vehicle or license plate was identified' },
    fullPlate: { type: 'string', description: 'Full license plate string with letters and numbers (e.g. ABC-8888, 1234-AB, KKA-0066)' },
    digits: { type: 'string', description: 'The exact 4-digit collection number from 0000 to 9999 (e.g. "0001", "8888", "0066")' },
    box: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] coordinates from 0 to 1000' },
    confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0' },
  },
  required: ['detected', 'fullPlate', 'digits', 'box'],
};

const MAIN_PROMPT = `You are a specialized vehicle license plate recognition (ALPR/ANPR) computer vision engine.
Examine this vehicle photo or license plate photo very carefully.
Your task:
1. Locate the vehicle license plate in the image (front or rear bumper, angled or straight, close-up or full vehicle).
2. Accurately read the COMPLETE license plate string.
   - CRITICAL REQUIREMENT: A standard vehicle license plate ALWAYS contains BOTH English letters and numbers (e.g., "ABC-1234", "1234-AB", "EAA-0001", "KKA-0066", "AJW-1000", "BZC-0077", "0300-CDL", "8888-ZZ").
   - DO NOT RETURN ONLY DIGITS if English letters exist on the license plate! Look closely at characters to the left, right, or above the numbers to locate the English letters.
   - Format with a hyphen '-' between letters and numbers (e.g. "ABC-1234" or "1234-AB").
   - Set this string as "fullPlate".
3. For a 0000-9999 license plate collection, extract the primary 4-digit number (0000 to 9999):
   - If the plate has a 4-digit numeric portion (e.g., "ABC-5678" -> "5678", "1234-AB" -> "1234", "KKA-0066" -> "0066"), return those 4 digits.
   - If the plate has fewer than 4 digits (e.g., "ABC-88" -> "0088", "123-AB" -> "0123"), pad with leading zeros to 4 digits.
   - If only digits are visible, extract the 4-digit sequence.
   - Set this string as "digits".
4. Detect the exact bounding box enclosing the license plate in normalized coordinates from 0 to 1000:
   - ymin, xmin, ymax, xmax
5. Set confidence between 0.0 and 1.0. If no vehicle license plate is visible, set detected to false.

Return strictly JSON matching the required schema.`;

async function callGemini(model: string, base64Data: string, mimeType: string, prompt: string, schema: object): Promise<any> {
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Data } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  // Try up to 3 times for 503/429
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    const res = await fetch(buildUrl(model), { method: 'POST', headers: buildHeaders(), body });
    if (res.status === 503 || res.status === 429) continue;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status} (${model}): ${errText.slice(0, 200)}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text;
  }
  throw new Error(`Gemini 503/429 after retries (${model})`);
}

export interface PlateRecognitionResult {
  detected: boolean;
  fullPlate: string;
  digits: string;
  box?: [number, number, number, number];
  vehicleType?: string;
  vehicleColor?: string;
  confidence?: number;
  notes?: string;
  message?: string;
}

/**
 * Quick connectivity test — returns status string for debugging
 */
export async function testGeminiConnection(): Promise<string> {
  try {
    const res = await fetch(buildUrl('gemini-2.0-flash-lite'), {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ contents: [{ parts: [{ text: '回傳數字1' }] }] }),
    });
    const body = await res.text();
    return `HTTP ${res.status}: ${body.slice(0, 300)}`;
  } catch (e) {
    return `網路錯誤: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Recognize license plate from a base64 image.
 * Mirrors server.ts /api/recognize-plate logic.
 */
export async function recognizePlateWithGemini(
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<PlateRecognitionResult> {
  const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  // Candidate models: try lite first, fall back to full
  const candidateModels = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  let responseText = '';
  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      responseText = await callGemini(model, base64Data, mimeType, MAIN_PROMPT, RESPONSE_SCHEMA);
      if (responseText) break;
    } catch (err: any) {
      lastError = err;
      console.warn(`[ALPR] Model ${model} failed:`, err?.message);
    }
  }

  if (!responseText) {
    throw lastError || new Error('All Gemini models failed');
  }

  let result: any;
  try {
    result = JSON.parse(responseText);
  } catch {
    // Try to extract JSON from response
    const m = responseText.match(/\{[\s\S]*\}/);
    if (m) {
      try { result = JSON.parse(m[0]); } catch {}
    }
    if (!result) return { detected: false, fullPlate: '', digits: '' };
  }

  // Sanitize fullPlate — add hyphen if missing (e.g. "ABC1234" -> "ABC-1234")
  let cleanFullPlate = (result.fullPlate || '').trim().toUpperCase();
  if (/^[A-Z]{2,4}\d{2,4}$/.test(cleanFullPlate)) {
    cleanFullPlate = cleanFullPlate.replace(/^([A-Z]{2,4})(\d{2,4})$/, '$1-$2');
  } else if (/^\d{2,4}[A-Z]{2,4}$/.test(cleanFullPlate)) {
    cleanFullPlate = cleanFullPlate.replace(/^(\d{2,4})([A-Z]{2,4})$/, '$1-$2');
  }

  // Sanitize digits
  let cleanDigits = (result.digits || '').replace(/\D/g, '');
  if (!cleanDigits && cleanFullPlate) {
    const numMatches = cleanFullPlate.match(/\d+/g);
    if (numMatches) cleanDigits = numMatches.join('');
  }
  if (cleanDigits.length >= 4) cleanDigits = cleanDigits.slice(-4);
  else if (cleanDigits.length > 0) cleanDigits = cleanDigits.padStart(4, '0');

  result.fullPlate = cleanFullPlate || cleanDigits;
  result.digits = cleanDigits;

  // Second pass: if only digits found (no English letters), re-ask Gemini for letters
  if (cleanDigits && !/[A-Z]/.test(cleanFullPlate)) {
    try {
      const letterPrompt = `Look closely at this vehicle license plate. We identified the numeric digits as "${cleanDigits}".
What are the English letters on this license plate?
Taiwanese plates have letters like "ABC-${cleanDigits}", "EAB-${cleanDigits}", "${cleanDigits}-AB", "KKA-${cleanDigits}", etc.
Examine the characters to the left, right, or above "${cleanDigits}".
Return strictly JSON with fullPlate containing BOTH the English letters and numbers formatted with a hyphen '-'.`;

      const letterSchema = {
        type: 'object',
        properties: {
          fullPlate: { type: 'string', description: 'Complete plate with English letters and numbers, e.g. ABC-1234 or 1234-AB' },
        },
        required: ['fullPlate'],
      };

      const retryText = await callGemini('gemini-2.0-flash-lite', base64Data, mimeType, letterPrompt, letterSchema);
      if (retryText) {
        const retryJson = JSON.parse(retryText);
        let retryPlate = (retryJson.fullPlate || '').trim().toUpperCase();
        if (/[A-Z]/.test(retryPlate)) {
          if (/^[A-Z]{2,4}\d{2,4}$/.test(retryPlate)) retryPlate = retryPlate.replace(/^([A-Z]{2,4})(\d{2,4})$/, '$1-$2');
          else if (/^\d{2,4}[A-Z]{2,4}$/.test(retryPlate)) retryPlate = retryPlate.replace(/^(\d{2,4})([A-Z]{2,4})$/, '$1-$2');
          result.fullPlate = retryPlate;
        }
      }
    } catch (e) {
      console.warn('[ALPR] Second pass skipped:', e);
    }
  }

  if (cleanDigits.length === 4 || result.fullPlate.length >= 4) result.detected = true;
  if (!Array.isArray(result.box) || result.box.length !== 4) result.box = [450, 300, 650, 700];

  return result as PlateRecognitionResult;
}
