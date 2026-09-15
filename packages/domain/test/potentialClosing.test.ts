import test from "node:test";
import assert from "node:assert/strict";
import { PotentialClosingService } from "../src/potentialClosing";

test("работа полностью не тронута дальше физики — весь потенциал в стадии 1", () => {
  const r = PotentialClosingService.calculate([
    {
      workId: "w1",
      workName: "Армирование Ф-1",
      estimatedCost: 1_000_000,
      plannedQuantity: 100,
      actualQuantity: 50, // 50% физически выполнено
      acceptedQuantity: 0,
      executiveDocsReadyQuantity: 0,
      transferredToSdoQuantity: 0,
      calculatedValue: 0,
      closedValue: 0,
    },
  ]);
  assert.equal(r.physicallyExecutedValue, 500_000);
  assert.equal(r.potentialClosingValue, 500_000);
  assert.equal(r.stages[0].amount, 500_000); // stage 1
  assert.equal(r.stages[1].amount, 0);
});

test("полный цикл до закрытия — потенциал равен нулю", () => {
  const r = PotentialClosingService.calculate([
    {
      workId: "w1",
      workName: "Бетонирование Ф-1",
      estimatedCost: 4_050_060,
      plannedQuantity: 210,
      actualQuantity: 210,
      acceptedQuantity: 210,
      executiveDocsReadyQuantity: 210,
      transferredToSdoQuantity: 210,
      calculatedValue: 4_050_060,
      closedValue: 4_050_060,
    },
  ]);
  assert.equal(r.potentialClosingValue, 0);
  assert.equal(r.closedValue, 4_050_060);
});

test("частичное закрытие — остаток в стадии 5 (осмечено, не закрыто)", () => {
  const r = PotentialClosingService.calculate([
    {
      workId: "w1",
      workName: "Бетонирование Ф-1",
      estimatedCost: 4_050_060,
      plannedQuantity: 210,
      actualQuantity: 210,
      acceptedQuantity: 210,
      executiveDocsReadyQuantity: 210,
      transferredToSdoQuantity: 210,
      calculatedValue: 4_050_060,
      closedValue: 3_000_000,
    },
  ]);
  assert.equal(r.stages[4].amount, 1_050_060);
  assert.equal(r.potentialClosingValue, 1_050_060);
});

test("несколько работ на объекте суммируются по стадиям", () => {
  const r = PotentialClosingService.calculate([
    {
      workId: "w1",
      workName: "Работа 1",
      estimatedCost: 1_000_000,
      plannedQuantity: 100,
      actualQuantity: 100,
      acceptedQuantity: 0,
      executiveDocsReadyQuantity: 0,
      transferredToSdoQuantity: 0,
      calculatedValue: 0,
      closedValue: 0,
    },
    {
      workId: "w2",
      workName: "Работа 2",
      estimatedCost: 2_000_000,
      plannedQuantity: 100,
      actualQuantity: 100,
      acceptedQuantity: 100,
      executiveDocsReadyQuantity: 0,
      transferredToSdoQuantity: 0,
      calculatedValue: 0,
      closedValue: 0,
    },
  ]);
  assert.equal(r.stages[0].amount, 1_000_000); // w1: не принято СК
  assert.equal(r.stages[1].amount, 2_000_000); // w2: принято, но ИД не готова
  assert.equal(r.potentialClosingValue, 3_000_000);
  assert.equal(r.byWork.length, 2);
});
