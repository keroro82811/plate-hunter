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

  const prompt = `你是台灣車牌辨識專家。請仔細辨識這張圖片中的車牌號碼。

台灣車牌格式：
- 數字+英文：如 0001-R5、1234-AB、9999-ZZ
- 英文+數字：如 ABC-1234、AB-1234、A-1234
- 純數字：如 0001、1234

請只回傳 JSON，格式如下：
{
  "detected": true/false,
  "fullPlate": "完整車牌號碼（含英文字母，如 0001-R5）",
  "digits": "只取4位數字部分（如 0001）",
  "vehicleType": "轎車/機車/貨車/其他",
  "vehicleColor": "車身顏色",
  "confidence": 0到1的信心值
}

如果找不到車牌，回傳 {"detected": false, "fullPlate": "", "digits": ""}。
只回傳 JSON，不要其他文字。`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isNewKeyFormat) {
    headers['x-goog-api-key'] = GEMINI_API_KEY;
  }

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
      },
    }),
  });

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
