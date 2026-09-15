import React from "react";
import { Tooltip } from "antd";
import { ScheduleStatus } from "@construction-erp/domain";

/**
 * Лёгкая собственная реализация диаграммы Ганта (ТЗ §44).
 * Сознательно НЕ используется коммерческая/GPL-библиотека Гантта —
 * реализация строится на чистых div/flex по аналогии с GanttRow из
 * исходного прототипа (construction-erp-full.jsx), но пересчитывается на
 * основе реальных доменных сервисов (ScheduleStatusService) через backend.
 */

export interface GanttTask {
  id: string;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  progressPercent: number;
  plannedProgressPercent: number;
  scheduleStatus: ScheduleStatus | string;
}

const STATUS_COLOR: Record<string, string> = {
  ON_TRACK: "#52c41a",
  BEHIND: "#faad14",
  CRITICAL: "#ff4d4f",
  DONE: "#8c8c8c",
};

function daysBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

export function Gantt({ tasks }: { tasks: GanttTask[] }) {
  if (tasks.length === 0) return <div style={{ color: "#999", padding: 16 }}>Нет работ для отображения графика.</div>;

  const starts = tasks.map((t) => new Date(t.plannedStart).getTime());
  const finishes = tasks.map((t) => new Date(t.plannedFinish).getTime());
  const rangeStart = new Date(Math.min(...starts));
  const rangeEnd = new Date(Math.max(...finishes));
  const totalDays = daysBetween(rangeStart, rangeEnd);

  return (
    <div className="gantt-scroll">
      <div style={{ minWidth: 900, padding: 12 }}>
        {tasks.map((t) => {
          const start = new Date(t.plannedStart);
          const finish = new Date(t.plannedFinish);
          const offsetPct = (daysBetween(rangeStart, start) - 1) / totalDays * 100;
          const widthPct = Math.max(2, (daysBetween(start, finish) / totalDays) * 100);
          const color = STATUS_COLOR[t.scheduleStatus as string] ?? "#1677ff";

          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <div style={{ width: 260, fontSize: 13, paddingRight: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.name}
              </div>
              <div style={{ position: "relative", flex: 1, height: 20, background: "#f5f5f5", borderRadius: 3 }}>
                <Tooltip
                  title={
                    <>
                      {t.plannedStart.slice(0, 10)} — {t.plannedFinish.slice(0, 10)}
                      <br />
                      Факт: {Math.round(t.progressPercent)}% / план на сегодня: {Math.round(t.plannedProgressPercent)}%
                    </>
                  }
                >
                  <div
                    className="gantt-bar"
                    style={{
                      position: "absolute",
                      left: `${offsetPct}%`,
                      width: `${widthPct}%`,
                      background: color,
                      opacity: 0.85,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: `${Math.min(100, t.progressPercent)}%`,
                        background: "rgba(0,0,0,0.25)",
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
