import { DEFAULT_RISK_THRESHOLDS, HealthStatus, RiskThresholds, ScheduleStatus } from "./types";

/**
 * ObjectHealthService (ТЗ п.32) — автоматический расчёт светофора объекта.
 * Сигналы: schedule variance, delayDays, критические работы, блокировки,
 * просроченные замечания, отсутствие актуального факта, ПТО/СДО backlog.
 * GRAY = недостаточно данных (нет работ или факт никогда не вносился).
 */

export interface ObjectHealthInput {
  hasWorks: boolean;
  /** Последнее обновление факта по объекту (любая работа), null = никогда. */
  lastProgressUpdateAt: Date | null;
  today: Date;
  worstScheduleStatus: ScheduleStatus | null;
  worstVarianceP: number | null;
  maxDelayDays: number;
  criticalOpenIssuesCount: number;
  overdueIssuesCount: number;
  blockedWorksCount: number;
  ptoBacklogCount: number; // пакеты ИД, готовые, но не переданные N+ дней
  sdoBacklogCount: number; // пакеты в СДО дольше настроечного порога
}

export interface ObjectHealthResult {
  status: HealthStatus;
  reasons: string[];
}

export class ObjectHealthService {
  static calculate(input: ObjectHealthInput, thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS): ObjectHealthResult {
    if (!input.hasWorks) {
      return { status: HealthStatus.GRAY, reasons: ["На объекте ещё не заведены работы."] };
    }

    const staleDays = input.lastProgressUpdateAt
      ? Math.round((input.today.getTime() - input.lastProgressUpdateAt.getTime()) / 86_400_000)
      : Infinity;

    if (staleDays > thresholds.staleProgressAfterDays) {
      return {
        status: HealthStatus.GRAY,
        reasons: [`Факт не обновлялся ${Number.isFinite(staleDays) ? staleDays : "—"} дн. — недостаточно данных для оценки.`],
      };
    }

    const reasons: string[] = [];
    let status: HealthStatus = HealthStatus.GREEN;

    const escalate = (next: HealthStatus) => {
      const order = [HealthStatus.GREEN, HealthStatus.YELLOW, HealthStatus.RED];
      if (order.indexOf(next) > order.indexOf(status)) status = next;
    };

    if (input.worstScheduleStatus === ScheduleStatus.BEHIND) {
      escalate(HealthStatus.YELLOW);
      reasons.push(`Отставание по графику: план опережает факт на ${Math.abs(input.worstVarianceP ?? 0).toFixed(0)} п.п.`);
    }
    if (input.worstScheduleStatus === ScheduleStatus.CRITICAL) {
      escalate(HealthStatus.RED);
      reasons.push(`Критическое отставание: ${Math.abs(input.worstVarianceP ?? 0).toFixed(0)} п.п. от плана.`);
    }
    if (input.maxDelayDays > 0) {
      reasons.push(`Потеряно ${input.maxDelayDays} дн. относительно плана.`);
    }
    if (input.criticalOpenIssuesCount > 0) {
      escalate(HealthStatus.RED);
      reasons.push(`Открытых критических замечаний: ${input.criticalOpenIssuesCount}.`);
    }
    if (input.overdueIssuesCount > 0) {
      escalate(HealthStatus.YELLOW);
      reasons.push(`Просроченных замечаний: ${input.overdueIssuesCount}.`);
    }
    if (input.blockedWorksCount > 0) {
      escalate(HealthStatus.YELLOW);
      reasons.push(`Заблокированных работ (нет допуска): ${input.blockedWorksCount}.`);
    }
    if (input.ptoBacklogCount > 0) {
      escalate(HealthStatus.YELLOW);
      reasons.push(`Пакетов ИД, зависших в ПТО: ${input.ptoBacklogCount}.`);
    }
    if (input.sdoBacklogCount > 0) {
      escalate(HealthStatus.YELLOW);
      reasons.push(`Пакетов, зависших в СДО: ${input.sdoBacklogCount}.`);
    }

    if (reasons.length === 0) reasons.push("Все показатели в норме.");

    return { status, reasons };
  }
}
