import test from "node:test";
import assert from "node:assert/strict";
import { ProgressCalculationService } from "../src/progress";

test("50% при половине выполненного объёма", () => {
  const r = ProgressCalculationService.calculate({ plannedQuantity: 20, actualQuantity: 10 });
  assert.equal(r.progressPercent, 50);
  assert.equal(r.rawProgressPercent, 50);
  assert.equal(r.isOverperformed, false);
});

test("управленческий процент ограничен 100%, но raw показывает перевыполнение", () => {
  const r = ProgressCalculationService.calculate({ plannedQuantity: 20, actualQuantity: 24 });
  assert.equal(r.progressPercent, 100);
  assert.equal(r.rawProgressPercent, 120);
  assert.equal(r.isOverperformed, true);
});

test("нулевой план не делит на ноль", () => {
  const r = ProgressCalculationService.calculate({ plannedQuantity: 0, actualQuantity: 5 });
  assert.equal(r.progressPercent, 0);
});

test("E2E сценарий (ТЗ п.53, шаг 7): 10 т из 20 т = 50%", () => {
  const r = ProgressCalculationService.calculate({ plannedQuantity: 20, actualQuantity: 10 });
  assert.equal(r.progressPercent, 50);
});
