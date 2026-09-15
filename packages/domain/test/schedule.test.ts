import test from "node:test";
import assert from "node:assert/strict";
import { ScheduleStatusService } from "../src/schedule";
import { ScheduleStatus } from "../src/types";

const d = (s: string) => new Date(s + "T00:00:00Z");

test("plannedProgress = 0% до старта", () => {
  const p = ScheduleStatusService.plannedProgress({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-02-20"),
  });
  assert.equal(p, 0);
});

test("plannedProgress = 100% после финиша", () => {
  const p = ScheduleStatusService.plannedProgress({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-04-01"),
  });
  assert.equal(p, 100);
});

test("plannedProgress линейна на середине интервала", () => {
  const p = ScheduleStatusService.plannedProgress({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-03-06"),
  });
  assert.equal(p, 50);
});

test("GREEN: variance >= -5", () => {
  const r = ScheduleStatusService.evaluate({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-03-06"), // planned 50%
    actualProgressPercent: 48, // variance -2
  });
  assert.equal(r.scheduleStatus, ScheduleStatus.ON_TRACK);
});

test("YELLOW: отклонение между -5 и -15", () => {
  const r = ScheduleStatusService.evaluate({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-03-06"), // planned 50%
    actualProgressPercent: 40, // variance -10
  });
  assert.equal(r.scheduleStatus, ScheduleStatus.BEHIND);
});

test("RED: отклонение хуже -15", () => {
  const r = ScheduleStatusService.evaluate({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-03-06"), // planned 50%
    actualProgressPercent: 20, // variance -30
  });
  assert.equal(r.scheduleStatus, ScheduleStatus.CRITICAL);
  assert.ok(r.delayDays > 0);
});

test("DONE при 100% факта независимо от графика", () => {
  const r = ScheduleStatusService.evaluate({
    plannedStartDate: d("2026-03-01"),
    plannedFinishDate: d("2026-03-11"),
    today: d("2026-03-06"),
    actualProgressPercent: 100,
  });
  assert.equal(r.scheduleStatus, ScheduleStatus.DONE);
});
