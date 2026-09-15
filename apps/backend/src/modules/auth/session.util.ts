import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Подписанный серверный сессионный токен (HMAC-SHA256, node:crypto — без
 * внешней JWT-библиотеки, т.к. в песочнице разработки нет доступа к npm
 * registry для добавления новой зависимости; формат сознательно простой
 * и самодостаточный).
 *
 * ЗАЧЕМ ЭТО СУЩЕСТВУЕТ (ТЗ, hardening п.9): исходная MVP-схема
 * BitrixAuthGuard доверяла заголовкам X-Tenant-Id/X-Bitrix-User-Id,
 * заданным клиентом напрямую — это допустимо ТОЛЬКО в demo/dev режиме
 * (см. AUTH_MODE в bitrix-auth.guard.ts). Для production-режима личность
 * пользователя должна приходить не от клиента, а из подписанного токена,
 * который backend сам выпускает один раз — после проверки подписи
 * Bitrix24 при установке/открытии placement (см. install.controller.ts,
 * REQUIRES BITRIX24 TEST PORTAL VERIFICATION для самой проверки подписи
 * Bitrix). Дальше клиент может прислать что угодно в заголовках — это
 * не будет доверено, пока не пройдёт verifySessionToken().
 *
 * Формат токена: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Не JWT-совместимо по заголовку (нет alg/typ) — это намеренно, чтобы не
 * создавать иллюзию совместимости со сторонними JWT-библиотеками, которых
 * тут нет; при появлении доступа к npm стоит заменить на `jsonwebtoken`/
 * `jose`, сохранив тот же контракт verifySessionToken().
 */

export interface SessionPayload {
  tenantId: string;
  bitrixUserId: number;
  /** Unix-время (сек), после которого токен недействителен. */
  exp: number;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sign(payloadB64: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payloadB64).digest());
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">, secret: string, ttlSeconds: number): string {
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET слишком короткий или не задан (минимум 16 символов)");
  }
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(full), "utf8"));
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export type VerifyResult = { ok: true; payload: SessionPayload } | { ok: false; reason: string };

export function verifySessionToken(token: string, secret: string): VerifyResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return { ok: false, reason: "malformed" };

  const expectedSig = sign(payloadB64, secret);
  const a = fromBase64url(sig);
  const b = fromBase64url(expectedSig);
  // Длины могут отличаться при подделанной подписи — timingSafeEqual
  // требует равной длины, поэтому сначала явно её проверяем (это не
  // раскрывает секрет, длина корректной подписи всегда фиксирована).
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  if (!payload.tenantId || !payload.bitrixUserId || !payload.exp) {
    return { ok: false, reason: "incomplete_payload" };
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
