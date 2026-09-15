import test from "node:test";
import assert from "node:assert/strict";
import { EscalationService, buildNotificationDedupKey } from "../src/escalation";

test("нет эскалации, если объект не в RED", () => {
  assert.equal(EscalationService.evaluate(0), "NONE");
});

test("эскалация руководителю направления при RED > 0 дней", () => {
  assert.equal(EscalationService.evaluate(3), "DEPARTMENT_HEAD");
});

test("эскалация техническому директору после порога N (по умолчанию 7 дней)", () => {
  assert.equal(EscalationService.evaluate(7), "TECHNICAL_DIRECTOR");
  assert.equal(EscalationService.evaluate(10), "TECHNICAL_DIRECTOR");
});

test("эскалация генеральному директору после порога M (по умолчанию 14 дней)", () => {
  assert.equal(EscalationService.evaluate(14), "GENERAL_DIRECTOR");
  assert.equal(EscalationService.evaluate(30), "GENERAL_DIRECTOR");
});

test("пороги настраиваемые, не захардкожены", () => {
  const custom = {
    greenVarianceThreshold: -5,
    yellowVarianceThreshold: -15,
    escalateToTechDirectorAfterDays: 2,
    escalateToGeneralDirectorAfterDays: 4,
    staleProgressAfterDays: 10,
  };
  assert.equal(EscalationService.evaluate(3, custom), "TECHNICAL_DIRECTOR");
});

test("дедупликация уведомлений: один и тот же день -> одинаковый ключ", () => {
  const d1 = new Date("2026-09-14T08:00:00Z");
  const d2 = new Date("2026-09-14T20:00:00Z");
  assert.equal(
    buildNotificationDedupKey("WORK_DELAYED", "work-1", d1),
    buildNotificationDedupKey("WORK_DELAYED", "work-1", d2),
  );
});

test("дедупликация: разные дни -> разный ключ", () => {
  const d1 = new Date("2026-09-14T08:00:00Z");
  const d2 = new Date("2026-09-15T08:00:00Z");
  assert.notEqual(
    buildNotificationDedupKey("WORK_DELAYED", "work-1", d1),
    buildNotificationDedupKey("WORK_DELAYED", "work-1", d2),
  );
});
