import { DEFAULT_RISK_THRESHOLDS, RiskThresholds, ScheduleStatus } from "./types";

/**
 * ScheduleStatusService — план/факт (ТЗ п.19).
 * MVP: plannedProgress считается линейно между plannedStartDate и
 * plannedFinishDate. Архитектура расширяема под недельный/дневной
 * распределённый план (передать сюда PlanCurve вместо линейной функции —
 * следующая итерация, см. docs/architecture.md).
 */

export interface ScheduleInput {
  plannedStartDate: Date;
  plannedFinishDate: Date;
  actualProgressPercent: number; // 0..100, из ProgressCalculationService
  today: Date;
}

export interface ScheduleResult {
  plannedProgressPercent: number;
  actualProgressPercent: number;
  varianceP: number; // п.п., actual - planned
  delayDays: number; // оценка отставания в днях, 0 если не отстаёт
  scheduleStatus: ScheduleStatus;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export class ScheduleStatusService {
  static plannedProgress(input: Pick<ScheduleInput, "plannedStartDate" | "plannedFinishDate" | "today">): number {
    const { plannedStartDate, plannedFinishDate, today } = input;
    if (today <= plannedStartDate) return 0;
    if (today >= plannedFinishDate) return 100;
    const span = daysBetween(plannedStartDate, plannedFinishDate) || 1;
    const elapsed = daysBetween(plannedStartDate, today);
    return Math.max(0, Math.min(100, (elapsed / span) * 100));
  }

  static evaluate(input: ScheduleInput, thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS): ScheduleResult {
    const plannedProgressPercent = this.plannedProgress(input);
    const variance = input.actualProgressPercent - plannedProgressPercent;
    const span = Math.max(1, daysBetween(input.plannedStartDate, input.plannedFinishDate));

    let delayDays = 0;
    if (variance < 0) {
      // Приближённая оценка: сколько дней потеряно при текущем темпе относительно
      // линейного плана. Простая и объяснимая для UI эвристика для MVP.
      delayDays = Math.round((Math.abs(variance) / 100) * span);
    }

    // ТЗ п.19: GREEN variance >= -5; YELLOW ниже -5, но не хуже -15; RED хуже -15.
    let scheduleStatus: ScheduleStatus;
    if (input.actualProgressPercent >= 100) {
      scheduleStatus = ScheduleStatus.DONE;
    } else if (variance >= thresholds.greenVarianceThreshold) {
      scheduleStatus = ScheduleStatus.ON_TRACK;
    } else if (variance >= thresholds.yellowVarianceThreshold) {
      scheduleStatus = ScheduleStatus.BEHIND;
    } else {
      scheduleStatus = ScheduleStatus.CRITICAL;
    }

    return {
      plannedProgressPercent,
      actualProgressPercent: input.actualProgressPercent,
      varianceP: variance,
      delayDays,
      scheduleStatus,
    };
  }
}
