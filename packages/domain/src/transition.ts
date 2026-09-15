import { DependencyType, InspectionStatus, IssueSeverity, IssueStatus } from "./types";

/**
 * WorkTransitionPolicy (ТЗ п.20-21).
 * canStartWork(workId) -> { allowed, reasons[] } — конкретные причины блокировки,
 * не просто "заблокировано". Проверка обязана выполняться на backend.
 */

export interface WorkDependencyInput {
  predecessorWorkId: string;
  predecessorWorkName: string;
  dependencyType: DependencyType;
  requiresAcceptance: boolean;
  /** Последний статус строительного контроля по работе-предшественнику. */
  predecessorLatestInspectionStatus: InspectionStatus | null;
  /** Есть ли непогашенные критические замечания по предшественнику. */
  predecessorHasOpenCriticalIssues: boolean;
  /** Обязательный документ (например АОСР) ещё не подтверждён ПТО. */
  predecessorMissingRequiredDocument: boolean;
}

export interface TransitionCheckResult {
  allowed: boolean;
  reasons: string[];
}

export class WorkTransitionPolicy {
  static canStartWork(dependencies: WorkDependencyInput[]): TransitionCheckResult {
    const reasons: string[] = [];

    for (const dep of dependencies) {
      if (dep.dependencyType !== DependencyType.FINISH_TO_START) continue;
      if (!dep.requiresAcceptance) continue;

      if (dep.predecessorLatestInspectionStatus !== InspectionStatus.ACCEPTED) {
        reasons.push(
          `«${dep.predecessorWorkName}» не принята строительным контролем (текущий статус: ${dep.predecessorLatestInspectionStatus ?? "не предъявлена"}).`,
        );
      }
      if (dep.predecessorHasOpenCriticalIssues) {
        reasons.push(`По «${dep.predecessorWorkName}» есть непогашенное критическое замечание.`);
      }
      if (dep.predecessorMissingRequiredDocument) {
        reasons.push(`По «${dep.predecessorWorkName}» не подтверждён обязательный документ.`);
      }
    }

    return { allowed: reasons.length === 0, reasons };
  }

  /**
   * Критическое замечание блокирует технологический переход (ТЗ п.23) —
   * используется при принятии решения по самой работе (не только следующей).
   */
  static blocksOwnWork(openIssues: Array<{ severity: IssueSeverity; status: IssueStatus }>): boolean {
    return openIssues.some(
      (i) => i.severity === IssueSeverity.CRITICAL && i.status !== IssueStatus.CLOSED && i.status !== IssueStatus.REJECTED,
    );
  }
}
