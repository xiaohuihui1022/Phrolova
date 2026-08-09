// Web Crypto 密码哈希 — 替代 werkzeug.security
// 使用 PBKDF2-SHA256，与 Python hashlib.pbkdf2_hmac 兼容
// 支持 scrypt 格式 (werkzeug 生成的 scrypt:32768:8:1$salt$hash)

import { scryptSync, randomBytes } from 'node:crypto';

// ⚠️ Cloudflare Workers CPU limits: 免费计划 10ms / 付费 50ms
// ⚠️ Cloudflare Workers 对 PBKDF2 迭代次数有硬限制：100000 以下（含 100000）
// 超过会报错："Pbkdf2 failed: iteration counts above 100000 are not supported"
const ITERATIONS = 90_000;
const SALT_LEN = 16;
const KEY_LEN = 32;

/** Cloudflare Workers: crypto.timingSafeEqual 位于 crypto 顶层而非 subtle */
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const c = crypto as unknown as { timingSafeEqual: (x: ArrayBuffer | ArrayBufferView, y: ArrayBuffer | ArrayBufferView) => boolean };
  if (typeof c.timingSafeEqual === 'function') {
    return c.timingSafeEqual(a, b);
  }
  // 降级：常量时间比较
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 字符串级常量时间比较 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return safeEqual(enc.encode(a), enc.encode(b));
}

export async function generatePasswordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const key = await deriveKey(password, salt);
  return `pbkdf2:sha256:${ITERATIONS}$${toHex(salt)}$${toHex(key)}`;
}

export async function checkPasswordHash(password: string, storedHash: string): Promise<{ ok: boolean; reason?: 'scrypt-unavailable' | 'mismatch' | 'error' }> {
  try {
    if (storedHash.startsWith('scrypt:')) {
      // scrypt 是 werkzeug 老玩家迁移过来的密码（Workers 下 CPU/内存限制可能导致不可用）
      try {
        const [methodPart, salt, hashHex] = storedHash.split('$');
        const params = methodPart.split(':');
        const N = parseInt(params[1], 10);
        const r = parseInt(params[2], 10);
        const p = parseInt(params[3], 10);
        const dklen = hashHex.length / 2;
        const maxmem = Math.min(132 * N * r * p + 1024 * 1024, 128 * 1024 * 1024); // Workers 内存上限 128MB
        const saltBuf = Buffer.from(salt, 'utf8');
        const derived = scryptSync(password, saltBuf, dklen, { N, r, p, maxmem, cost: N, blockSize: r, parallelization: p });
        const matched = timingSafeEqualStrings(derived.toString('hex'), hashHex);
        return { ok: matched, reason: matched ? undefined : 'mismatch' };
      } catch (scryptErr) {
        console.warn('[crypto.checkPasswordHash] scryptSync unavailable on Workers:', scryptErr instanceof Error ? scryptErr.message : scryptErr);
        // scrypt 在 Workers 上不可用 → 返回特殊错误码由调用方决定
        return { ok: false, reason: 'scrypt-unavailable' };
      }
    }
    const [prefix, saltHex, keyHex] = storedHash.split('$');
    if (!prefix?.startsWith('pbkdf2:sha256:')) return { ok: false, reason: 'mismatch' };
    const itersMatch = prefix.match(/:(\d+)$/);
    const iterations = itersMatch ? parseInt(itersMatch[1], 10) : ITERATIONS;
    const salt = fromHex(saltHex);
    const expected = fromHex(keyHex);
    const actual = await deriveKey(password, salt, iterations);
    if (actual.length !== expected.length) return { ok: false, reason: 'mismatch' };
    const matched = safeEqual(actual, expected);
    return { ok: matched, reason: matched ? undefined : 'mismatch' };
  } catch (e) {
    console.warn('[crypto.checkPasswordHash] unexpected error:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'error' };
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits as ArrayBuffer);
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function generateToken(len = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return toHex(buf);
}

export function randomId(len = 8): string {
  return generateToken(len);
}

// HMAC-SHA256 hex digest (for admin tokens)
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(new Uint8Array(sig));
}
