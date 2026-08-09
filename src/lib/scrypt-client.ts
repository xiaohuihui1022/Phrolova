// 客户端 scrypt 计算 — 使用 hash-wasm (WASM 实现，浏览器无 CPU 限制)
// 用于老玩家密码升级：在浏览器端计算 scrypt(旧密码, salt, params)，
// 将结果发送给服务端验证，服务端永远不暴露存储的哈希值。

import { scrypt } from "hash-wasm";
import type { ScryptParams } from "@/api";

/**
 * 在浏览器端计算 scrypt(password, salt, params)，返回 hex 字符串。
 * 与 Node.js scryptSync / werkzeug scrypt 完全兼容（同一算法 RFC 7914）。
 *
 * 关键安全点：
 * - salt 作为 UTF-8 字符串编码（与 werkzeug generate_password_hash 一致）
 * - 只返回 derived key 的 hex，不涉及存储的哈希
 */
export async function computeScryptHex(
  password: string,
  params: ScryptParams,
): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltBytes = encoder.encode(params.salt); // werkzeug 的 salt 是 base64url 字符串，按 UTF-8 编码

  const derived = await scrypt({
    password: passwordBytes,
    salt: saltBytes,
    costFactor: params.N,
    blockSize: params.r,
    parallelism: params.p,
    hashLength: params.dklen,
  });

  return derived; // hash-wasm scrypt 返回 hex 字符串
}
