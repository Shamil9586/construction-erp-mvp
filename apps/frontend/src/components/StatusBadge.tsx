import React from "react";
import { Tag } from "antd";
import { HealthStatus, ScheduleStatus } from "@construction-erp/domain";

const HEALTH_LABELS: Record<HealthStatus, { color: string; label: string }> = {
  [HealthStatus.GREEN]: { color: "success", label: "В норме" },
  [HealthStatus.YELLOW]: { color: "warning", label: "Риск" },
  [HealthStatus.RED]: { color: "error", label: "Критично" },
  [HealthStatus.GRAY]: { color: "default", label: "Нет данных" },
};

export function HealthBadge({ status }: { status: HealthStatus | string }) {
  const info = HEALTH_LABELS[status as HealthStatus] ?? HEALTH_LABELS[HealthStatus.GRAY];
  return <Tag color={info.color}>{info.label}</Tag>;
}

const SCHEDULE_LABELS: Record<ScheduleStatus, { color: string; label: string }> = {
  [ScheduleStatus.ON_TRACK]: { color: "success", label: "По графику" },
  [ScheduleStatus.BEHIND]: { color: "warning", label: "Отставание" },
  [ScheduleStatus.CRITICAL]: { color: "error", label: "Критическое отставание" },
  [ScheduleStatus.DONE]: { color: "default", label: "Завершено" },
};

export function ScheduleBadge({ status }: { status: ScheduleStatus | string }) {
  const info = SCHEDULE_LABELS[status as ScheduleStatus] ?? SCHEDULE_LABELS[ScheduleStatus.ON_TRACK];
  return <Tag color={info.color}>{info.label}</Tag>;
}
