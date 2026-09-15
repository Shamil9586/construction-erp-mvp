import { DEFAULT_RISK_THRESHOLDS, RiskThresholds } from "./types";

/**
 * EscalationService (ТЗ п.39). РП -> руководитель направления -> технический
 * директор -> генеральный директор. N/M — настройки (RiskThresholds).
 */

export type EscalationTarget = "NONE" | "DEPARTMENT_HEAD" | "TECHNICAL_DIRECTOR" | "GENERAL_DIRECTOR";

export class EscalationService {
  static evaluate(redDurationDays: number, thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS): EscalationTarget {
    if (redDurationDays >= thresholds.escalateToGeneralDirectorAfterDays) return "GENERAL_DIRECTOR";
    if (redDurationDays >= thresholds.escalateToTechDirectorAfterDays) return "TECHNICAL_DIRECTOR";
    if (redDurationDays > 0) return "DEPARTMENT_HEAD";
    return "NONE";
  }
}

/**
 * Дедупликация уведомлений (ТЗ п.38) — не спамить одинаковыми уведомлениями.
 * Ключ строится из типа события + идентификатора сущности + "окна" (дня),
 * чтобы одно и то же событие не отправлялось повторно чаще раза в сутки.
 */
export function buildNotificationDedupKey(eventType: string, entityId: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `${eventType}:${entityId}:${day}`;
}
