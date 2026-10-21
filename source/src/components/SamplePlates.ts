/**
 * Generates realistic sample vehicle + license plate photos as high-res Data URLs
 * for instant testing and demonstration of AI recognition and 1:1 cropping.
 */

export interface SamplePlateDemo {
  id: string;
  name: string;
  plate: string;
  digits: string;
  carType: string;
  color: string;
  box: [number, number, number, number]; // exact [ymin, xmin, ymax, xmax] 0-1000
  notes: string;
  locationName?: string;
  generateDataUrl: () => string;
}

function renderCarCanvas(
  plateText: string,
  carColor: string,
  carModel: string,
  isSuv: boolean = false
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background / Street environment
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 720);
  bgGrad.addColorStop(0, '#1e293b');
  bgGrad.addColorStop(0.45, '#334155');
  bgGrad.addColorStop(0.5, '#475569');
  bgGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 960, 720);

  // Asphalt road
  ctx.fillStyle = '#1e2024';
  ctx.fillRect(0, 480, 960, 240);
  // Road markings
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 4;
  ctx.setLineDash([30, 25]);
  ctx.beginPath();
  ctx.moveTo(0, 640);
  ctx.lineTo(960, 640);
  ctx.stroke();
  ctx.setLineDash([]);

  // Car Body Outline
  const cx = 480;
  ctx.save();

  // Car Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.ellipse(cx, 560, 360, 45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Draw Car Body
  const carGrad = ctx.createLinearGradient(cx - 320, 200, cx + 320, 520);
  carGrad.addColorStop(0, carColor);
  carGrad.addColorStop(0.4, carColor);
  carGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = carGrad;

  ctx.beginPath();
  if (isSuv) {
    // SUV shape
    ctx.moveTo(cx - 280, 500);
    ctx.lineTo(cx - 300, 420);
    ctx.lineTo(cx - 260, 320);
    ctx.lineTo(cx - 180, 220);
    ctx.lineTo(cx + 180, 220);
    ctx.lineTo(cx + 260, 320);
    ctx.lineTo(cx + 300, 420);
    ctx.lineTo(cx + 280, 500);
  } else {
    // Sedan / Coupe shape
    ctx.moveTo(cx - 290, 510);
    ctx.lineTo(cx - 310, 440);
    ctx.lineTo(cx - 270, 350);
    ctx.lineTo(cx - 160, 250);
    ctx.lineTo(cx + 160, 250);
    ctx.lineTo(cx + 270, 350);
    ctx.lineTo(cx + 310, 440);
    ctx.lineTo(cx + 290, 510);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.stroke();

  // Windshield
  ctx.fillStyle = '#090d16';
  ctx.beginPath();
  ctx.moveTo(cx - 150, 260);
  ctx.lineTo(cx + 150, 260);
  ctx.lineTo(cx + 230, 350);
  ctx.lineTo(cx - 230, 350);
  ctx.closePath();
  ctx.fill();

  // Windshield reflection
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(cx - 140, 265);
  ctx.lineTo(cx - 60, 265);
  ctx.lineTo(cx - 110, 345);
  ctx.lineTo(cx - 190, 345);
  ctx.closePath();
  ctx.fill();

  // Headlights
  ctx.fillStyle = '#fef08a';
  ctx.shadowColor = '#fef08a';
  ctx.shadowBlur = 20;
  // Left light
  ctx.beginPath();
  ctx.ellipse(cx - 220, 415, 38, 16, -0.15, 0, Math.PI * 2);
  ctx.fill();
  // Right light
  ctx.beginPath();
  ctx.ellipse(cx + 220, 415, 38, 16, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Front Grille
  ctx.fillStyle = '#18181b';
  ctx.beginPath();
  ctx.roundRect(cx - 140, 395, 280, 55, 8);
  ctx.fill();
  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 2;
  ctx.stroke();

  // License Plate Mount
  // plateWidth = 240, plateHeight = 82, plateX = 360, plateY = 430
  // In 960x720 coordinates:
  // ymin = 430 / 720 * 1000 = 597
  // xmin = 360 / 960 * 1000 = 375
  // ymax = (430 + 82) / 720 * 1000 = 711
  // xmax = (360 + 240) / 960 * 1000 = 625
  const plateWidth = 240;
  const plateHeight = 82;
  const plateX = cx - plateWidth / 2;
  const plateY = 430;

  // Plate Backing / Frame
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(plateX - 6, plateY - 6, plateWidth + 12, plateHeight + 12, 8);
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Plate Background (Taiwan Standard White Plate)
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateWidth, plateHeight, 6);
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Plate Screws
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(plateX + 18, plateY + 16, 4, 0, Math.PI * 2);
  ctx.arc(plateX + plateWidth - 18, plateY + 16, 4, 0, Math.PI * 2);
  ctx.fill();

  // Plate Text (Bold crisp typography)
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 36px "JetBrains Mono", "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(plateText, cx, plateY + plateHeight / 2 + 2);

  // Subtle plate gloss
  const gloss = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateHeight);
  gloss.addColorStop(0, 'rgba(255,255,255,0.4)');
  gloss.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateWidth, plateHeight, 6);
  ctx.fill();

  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.95);
}

// Fixed standard normalized bounding box for the generated cars [ymin, xmin, ymax, xmax]
const SAMPLE_BOX: [number, number, number, number] = [597, 375, 711, 625];

export const SAMPLE_PLATES: SamplePlateDemo[] = [
  {
    id: 'sample-2330',
    name: '台積電科技藍跑車 (2330 護國神山)',
    plate: 'TSMC-2330',
    digits: '2330',
    carType: '旗艦跑車',
    color: '科技藍',
    box: SAMPLE_BOX,
    notes: '竹科巡航遇見的台積電傳奇號碼跑車！',
    locationName: '新竹市東區 (竹科園區)',
    generateDataUrl: () => renderCarCanvas('TSMC-2330', '#0284c7', 'Sport'),
  },
  {
    id: 'sample-4444',
    name: '狂野黑武士休旅 (4444 禁忌/鐵支/順子)',
    plate: 'DEV-4444',
    digits: '4444',
    carType: '裝甲休旅',
    color: '消光黑',
    box: SAMPLE_BOX,
    notes: '罕見至極的四四四四神號，兼具禁忌之巔、鐵支天王與順子連行。',
    locationName: '台北市信義區',
    generateDataUrl: () => renderCarCanvas('DEV-4444', '#18181b', 'SUV', true),
  },
  {
    id: 'sample-8888',
    name: '珍珠白豪華轎車 (8888 鐵支天王)',
    plate: 'BBA-8888',
    digits: '8888',
    carType: '豪華轎車',
    color: '珍珠白',
    box: SAMPLE_BOX,
    notes: '大吉大利一路發，經典四同頂級鐵支。',
    locationName: '台中市西屯區 (七期)',
    generateDataUrl: () => renderCarCanvas('BBA-8888', '#e2e8f0', 'Sedan'),
  },
  {
    id: 'sample-1688',
    name: '極致紅運動轎跑 (1688 大吉大利・富貴吉祥)',
    plate: 'RC-1688',
    digits: '1688',
    carType: '轎跑車',
    color: '極光紅',
    box: SAMPLE_BOX,
    notes: '大吉大利 1688 一路發發，招財吉數。',
    locationName: '高雄市左營區',
    generateDataUrl: () => renderCarCanvas('RC-1688', '#b91c1c', 'Coupe'),
  },
  {
    id: 'sample-1100',
    name: '香檳金都會跨界 (1100 成雙成對)',
    plate: 'PAIR-1100',
    digits: '1100',
    carType: '跨界休旅',
    color: '香檳金',
    box: SAMPLE_BOX,
    notes: '成雙成對雙雙對對，整齊對稱的美感。',
    locationName: '新北市板橋區',
    generateDataUrl: () => renderCarCanvas('PAIR-1100', '#d97706', 'CUV', true),
  },
  {
    id: 'sample-1234',
    name: '鋼鐵灰跑車 (1234 順子)',
    plate: 'ABC-1234',
    digits: '1234',
    carType: '跑車',
    color: '鋼鐵灰',
    box: SAMPLE_BOX,
    notes: '教科書等級的 1234 步步高升順子。',
    locationName: '台北市大安區',
    generateDataUrl: () => renderCarCanvas('ABC-1234', '#475569', 'Coupe'),
  },
  {
    id: 'sample-2000',
    name: '翡翠綠豪華房車 (2000 千元)',
    plate: 'K-2000',
    digits: '2000',
    carType: '行政房車',
    color: '墨玉綠',
    box: SAMPLE_BOX,
    notes: '千元整號，氣勢非凡的 2000 大鈔號。',
    locationName: '台南市中西區',
    generateDataUrl: () => renderCarCanvas('K-2000', '#065f46', 'Sedan'),
  },
  {
    id: 'sample-6666',
    name: '曜石金豪華旗艦 (6666 幸運星・六六大順)',
    plate: 'LUCK-6666',
    digits: '6666',
    carType: '豪華旗艦',
    color: '曜石金',
    box: SAMPLE_BOX,
    notes: '六六大順幸運星，頂級耀眼吉數鐵支。',
    locationName: '桃園市中壢區',
    generateDataUrl: () => renderCarCanvas('LUCK-6666', '#d97706', 'Sedan'),
  },
  {
    id: 'sample-7777',
    name: '璀璨綠敞篷跑車 (7777 幸運拉霸・頭獎降臨)',
    plate: 'WIN-7777',
    digits: '7777',
    carType: '敞篷跑車',
    color: '璀璨綠',
    box: SAMPLE_BOX,
    notes: '四連幸運7，象徵大獎至尊降臨的幸運拉霸。',
    locationName: '花蓮市',
    generateDataUrl: () => renderCarCanvas('WIN-7777', '#059669', 'Sport'),
  },
];
