import test from "node:test";
import assert from "node:assert/strict";
import { ObjectHealthService } from "../src/health";
import { HealthStatus, ScheduleStatus } from "../src/types";

const today = new Date("2026-09-14T00:00:00Z");

test("GRAY: нет работ на объекте", () => {
  const r = ObjectHealthService.calculate({
    hasWorks: false,
    lastProgressUpdateAt: null,
    today,
    worstScheduleStatus: null,
    worstVarianceP: null,
    maxDelayDays: 0,
    criticalOpenIssuesCount: 0,
    overdueIssuesCount: 0,
    blockedWorksCount: 0,
    ptoBacklogCount: 0,
    sdoBacklogCount: 0,
  });
  assert.equal(r.status, HealthStatus.GRAY);
});

test("GRAY: факт не обновлялся дольше порога", () => {
  const r = ObjectHealthService.calculate({
    hasWorks: true,
    lastProgressUpdateAt: new Date("2026-08-01T00:00:00Z"),
    today,
    worstScheduleStatus: ScheduleStatus.ON_TRACK,
    worstVarianceP: 0,
    maxDelayDays: 0,
    criticalOpenIssuesCount: 0,
    overdueIssuesCount: 0,
    blockedWorksCount: 0,
    ptoBacklogCount: 0,
    sdoBacklogCount: 0,
  });
  assert.equal(r.status, HealthStatus.GRAY);
});

test("GREEN: всё в норме", () => {
  const r = ObjectHealthService.calculate({
    hasWorks: true,
    lastProgressUpdateAt: today,
    today,
    worstScheduleStatus: ScheduleStatus.ON_TRACK,
    worstVarianceP: -1,
    maxDelayDays: 0,
    criticalOpenIssuesCount: 0,
    overdueIssuesCount: 0,
    blockedWorksCount: 0,
    ptoBacklogCount: 0,
    sdoBacklogCount: 0,
  });
  assert.equal(r.status, HealthStatus.GREEN);
});

test("YELLOW: отставание по графику (BEHIND)", () => {
  const r = ObjectHealthService.calculate({
    hasWorks: true,
    lastProgressUpdateAt: today,
    today,
    worstScheduleStatus: ScheduleStatus.BEHIND,
    worstVarianceP: -10,
    maxDelayDays: 3,
    criticalOpenIssuesCount: 0,
    overdueIssuesCount: 0,
    blockedWorksCount: 0,
    ptoBacklogCount: 0,
    sdoBacklogCount: 0,
  });
  assert.equal(r.status, HealthStatus.YELLOW);
});

test("RED: критическое отставание перекрывает YELLOW-сигналы", () => {
  const r = ObjectHealthService.calculate({
    hasWorks: true,
    lastProgressUpdateAt: today,
    today,
    worstScheduleStatus: ScheduleStatus.CRITICAL,
    worstVarianceP: -30,
    maxDelayDays: 14,
    criticalOpenIssuesCount: 1,
    overdueIssuesCount: 2,
    blockedWorksCount: 1,
    ptoBacklogCount: 1,
    sdoBacklogCount: 0,
  });
  assert.equal(r.status, HealthStatus.RED);
  assert.ok(r.reasons.length >= 3);
});

test("RED: критическое замечание эскалирует даже при GREEN графике", () => {
  const r = ObjectHealthService.calculate({
    hasWorks: true,
    lastProgressUpdateAt: today,
    today,
    worstScheduleStatus: ScheduleStatus.ON_TRACK,
    worstVarianceP: 0,
    maxDelayDays: 0,
    criticalOpenIssuesCount: 2,
    overdueIssuesCount: 0,
    blockedWorksCount: 0,
    ptoBacklogCount: 0,
    sdoBacklogCount: 0,
  });
  assert.equal(r.status, HealthStatus.RED);
});
