/**
 * Юнит-тесты session.util.ts на встроенном node:test — не требуют Jest
 * (которого нет в этой песочнице). Запуск: tsx --test test/session.util.node-test.ts
 * (тот же приём, что и в packages/domain/test — см. docs/mvp-test-scenario.md).
 * Это РЕАЛЬНО исполнялось в этой среде, в отличие от Jest-сьютов backend'а,
 * которым требуется полноценный npm install.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken } from "../src/modules/auth/session.util";

const SECRET = "test-secret-at-least-16-chars";

test("создаёт и проверяет валидный токен", () => {
  const token = createSessionToken({ tenantId: "tenant-1", bitrixUserId: 42 }, SECRET, 3600);
  const result = verifySessionToken(token, SECRET);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.tenantId, "tenant-1");
    assert.equal(result.payload.bitrixUserId, 42);
  }
});

test("отклоняет токен с чужим секретом (подделанная подпись)", () => {
  const token = createSessionToken({ tenantId: "tenant-1", bitrixUserId: 42 }, SECRET, 3600);
  const result = verifySessionToken(token, "wrong-secret-1234567890");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad_signature");
});

test("отклоняет протухший токен", () => {
  const token = createSessionToken({ tenantId: "tenant-1", bitrixUserId: 42 }, SECRET, -1); // уже истёк
  const result = verifySessionToken(token, SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "expired");
});

test("отклоняет токен с изменённым payload (попытка подмены tenantId/bitrixUserId)", () => {
  const token = createSessionToken({ tenantId: "tenant-1", bitrixUserId: 42 }, SECRET, 3600);
  const [payloadB64, sig] = token.split(".");
  const tampered = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  tampered.bitrixUserId = 999; // атакующий пытается стать другим сотрудником
  const tamperedPayloadB64 = Buffer.from(JSON.stringify(tampered)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const forged = `${tamperedPayloadB64}.${sig}`;
  const result = verifySessionToken(forged, SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad_signature");
});

test("отклоняет произвольный мусор вместо токена", () => {
  assert.equal(verifySessionToken("not-a-token", SECRET).ok, false);
  assert.equal(verifySessionToken("", SECRET).ok, false);
  assert.equal(verifySessionToken("a.b.c", SECRET).ok, false);
});

test("createSessionToken требует секрет минимум 16 символов", () => {
  assert.throws(() => createSessionToken({ tenantId: "t", bitrixUserId: 1 }, "short", 3600));
});
