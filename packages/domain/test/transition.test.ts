import test from "node:test";
import assert from "node:assert/strict";
import { WorkTransitionPolicy } from "../src/transition";
import { DependencyType, InspectionStatus, IssueSeverity, IssueStatus } from "../src/types";

test("разрешено, если нет зависимостей", () => {
  const r = WorkTransitionPolicy.canStartWork([]);
  assert.equal(r.allowed, true);
});

test("заблокировано: предшественник не принят СК (ТЗ п.53 шаг 13)", () => {
  const r = WorkTransitionPolicy.canStartWork([
    {
      predecessorWorkId: "w1",
      predecessorWorkName: "Армирование фундамента",
      dependencyType: DependencyType.FINISH_TO_START,
      requiresAcceptance: true,
      predecessorLatestInspectionStatus: InspectionStatus.ISSUES_FOUND,
      predecessorHasOpenCriticalIssues: true,
      predecessorMissingRequiredDocument: false,
    },
  ]);
  assert.equal(r.allowed, false);
  assert.ok(r.reasons.some((x) => x.includes("не принята")));
  assert.ok(r.reasons.some((x) => x.includes("критическое замечание")));
});

test("разрешено после приёмки СК без замечаний (ТЗ п.53 шаг 16-17)", () => {
  const r = WorkTransitionPolicy.canStartWork([
    {
      predecessorWorkId: "w1",
      predecessorWorkName: "Армирование фундамента",
      dependencyType: DependencyType.FINISH_TO_START,
      requiresAcceptance: true,
      predecessorLatestInspectionStatus: InspectionStatus.ACCEPTED,
      predecessorHasOpenCriticalIssues: false,
      predecessorMissingRequiredDocument: false,
    },
  ]);
  assert.equal(r.allowed, true);
  assert.equal(r.reasons.length, 0);
});

test("зависимость без requiresAcceptance не блокирует", () => {
  const r = WorkTransitionPolicy.canStartWork([
    {
      predecessorWorkId: "w1",
      predecessorWorkName: "Демонтаж",
      dependencyType: DependencyType.FINISH_TO_START,
      requiresAcceptance: false,
      predecessorLatestInspectionStatus: null,
      predecessorHasOpenCriticalIssues: false,
      predecessorMissingRequiredDocument: false,
    },
  ]);
  assert.equal(r.allowed, true);
});

test("blocksOwnWork: критическое незакрытое замечание блокирует", () => {
  assert.equal(
    WorkTransitionPolicy.blocksOwnWork([{ severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN }]),
    true,
  );
  assert.equal(
    WorkTransitionPolicy.blocksOwnWork([{ severity: IssueSeverity.CRITICAL, status: IssueStatus.CLOSED }]),
    false,
  );
  assert.equal(
    WorkTransitionPolicy.blocksOwnWork([{ severity: IssueSeverity.MINOR, status: IssueStatus.OPEN }]),
    false,
  );
});
