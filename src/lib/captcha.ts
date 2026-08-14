// SVG 验证码实现 — 替代 Python PIL 版本
// 输出 data:image/svg+xml;utf8,... 格式，无需图像处理库
import { eq, lt } from 'drizzle-orm';
import { captchas, type Database } from './db';
import { timingSafeEqualStrings } from './crypto';

export type CaptchaData = {
  captcha_id: string;
  image: string;
  text: string; // 仅内部使用，返回给前端时不要带
  expire: number;
};

function randInt(min: number, max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + (arr[0] % (max - min + 1));
}

function randChoice<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function generateCaptchaText(): string {
  const digits = Array.from({ length: 3 }, () => randChoice('0123456789'.split(''))).join('');
  const letters = Array.from({ length: 2 }, () => randChoice('ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''))).join('');
  const chars = (digits + letters).split('');
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function randColor(min = 70, max = 255): string {
  return `rgb(${randInt(min, max)}, ${randInt(min, max)}, ${randInt(min, max)})`;
}

function makeCaptchaSvg(text: string): string {
  const width = 132;
  const height = 46;
  const chars = text.split('');
  const step = width / (chars.length + 1);

  let dots = '';
  for (let i = 0; i < 150; i++) {
    const x = randInt(0, width - 1);
    const y = randInt(0, height - 1);
    const c = randInt(120, 255);
    dots += `<circle cx="${x}" cy="${y}" r="0.8" fill="rgb(${c},${c},${c})" />`;
  }

  let lines = '';
  for (let i = 0; i < 4; i++) {
    const x1 = randInt(-10, width);
    const y1 = randInt(0, height);
    const x2 = randInt(-10, width);
    const y2 = randInt(0, height);
    const col = `rgb(${randInt(70, 190)},${randInt(70, 190)},${randInt(70, 190)})`;
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1" />`;
  }

  let charEls = '';
  chars.forEach((ch, index) => {
    const x = step + index * step + randInt(-2, 2);
    const y = randInt(26, 38);
    const rotate = randInt(-15, 15);
    const color = `rgb(${randInt(200, 255)}, ${randInt(180, 255)}, ${randInt(120, 220)})`;
    charEls += `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="rgb(22,27,47)" />
  ${dots}
  ${lines}
  ${charEls}
</svg>`;
  return svg;
}

export function createCaptcha(): Omit<CaptchaData, 'expire'> {
  const text = generateCaptchaText();
  const captchaId = randomIdHex(8);
  const svg = makeCaptchaSvg(text);
  const dataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return { captcha_id: captchaId, image: dataUri, text };
}

function randomIdHex(len: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

// D1 存储封装（替代 KV，一次性使用）
export async function storeCaptcha(db: Database, captcha: CaptchaData) {
  const now = Math.floor(Date.now() / 1000);
  // 清理过期记录，避免表膨胀（D1 无 TTL）
  await db.delete(captchas).where(lt(captchas.expire, now));
  await db.insert(captchas).values({
    captchaId: captcha.captcha_id,
    text: captcha.text,
    expire: Math.floor(captcha.expire),
  });
}

export async function verifyCaptcha(db: Database, captchaId: string, userInput: string): Promise<boolean> {
  if (!captchaId || !userInput) return false;
  // DELETE RETURNING 原子完成"读取+删除"，天然防重放
  const rows = await db.delete(captchas).where(eq(captchas.captchaId, captchaId)).returning();
  if (rows.length === 0) return false;
  const row = rows[0];
  if (Date.now() / 1000 > row.expire) return false;
  return timingSafeEqualStrings(row.text.toUpperCase(), userInput.trim().toUpperCase());
}
