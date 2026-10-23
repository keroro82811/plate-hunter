/**
 * Client-side Gemini Vision API for license plate recognition.
 * Replaces the backend /api/recognize-plate endpoint.
 */

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
// 新版 AQ.Ab8... key 用 header 傳，舊版 AIzaSy... 用 URL 參數
const isNewKeyFormat = GEMINI_API_KEY.startsWith('AQ.');
const GEMINI_API_URL = isNewKeyFormat
  ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
  : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Quick connectivity test — returns status string for debugging
 */
export async function testGeminiConnection(): Promise<string> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isNewKeyFormat) headers['x-goog-api-key'] = GEMINI_API_KEY;
    const url = isNewKeyFormat
      ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
      : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: '回傳數字1' }] }] }),
    });
    const body = await res.text();
    return `HTTP ${res.status}: ${body.slice(0, 300)}`;
  } catch (e) {
    return `網路錯誤: ${e instanceof Error ? e.message : String(e)}`;
  }
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
 * Recognize license plate from a base64 image using Gemini Vision API directly from browser.
 */
export async function recognizePlateWithGemini(
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<PlateRecognitionResult> {
  // Strip data URL prefix if present
  const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const prompt = `Identify the license plate in this image. Taiwan plate formats: numbers+letters like 0001-R5, letters+numbers like ABC-1234, or pure numbers like 0001.

Respond with ONLY valid JSON, no markdown, no explanation:
{"detected":true,"fullPlate":"0001-R5","digits":"0001","vehicleType":"car","vehicleColor":"white","confidence":0.95}

If no plate found: {"detected":false,"fullPlate":"","digits":""}

Output JSON only.`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isNewKeyFormat) {
    headers['x-goog-api-key'] = GEMINI_API_KEY;
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Data } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 256, responseMimeType: 'application/json' },
  });

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    response = await fetch(GEMINI_API_URL, { method: 'POST', headers, body });
    if (response.status !== 503) break;
  }
  if (!response) throw new Error('No response');

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gemini ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in Gemini response');
  }

  const result = JSON.parse(jsonMatch[0]) as PlateRecognitionResult;
  return result;
}
