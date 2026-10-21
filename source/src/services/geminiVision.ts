/**
 * Client-side Gemini Vision API for license plate recognition.
 * Replaces the backend /api/recognize-plate endpoint.
 */

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

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

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    throw new Error(`Gemini API error: ${response.status}`);
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
