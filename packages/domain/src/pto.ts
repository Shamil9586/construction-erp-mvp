import { ExecutiveDocumentStatus, ExecutiveDocumentType } from "./types";

/**
 * PtoPackageValidationService (ТЗ п.26) — пакет ИД нельзя передать в СДО,
 * если не выполнены обязательные требования.
 */

export interface PackageWorkRequirement {
  workId: string;
  workName: string;
  requiresExecutiveDocs: boolean;
  requiresMaterials: boolean;
  hasMaterialWithValidDocument: boolean;
}

export interface PackageDocumentInput {
  workId: string;
  type: ExecutiveDocumentType;
  status: ExecutiveDocumentStatus;
}

export interface PtoValidationResult {
  canTransfer: boolean;
  reasons: string[];
}

const REQUIRED_APPROVED_STATUSES = new Set([ExecutiveDocumentStatus.APPROVED, ExecutiveDocumentStatus.READY]);

export class PtoPackageValidationService {
  static validate(works: PackageWorkRequirement[], documents: PackageDocumentInput[]): PtoValidationResult {
    const reasons: string[] = [];

    for (const work of works) {
      if (work.requiresExecutiveDocs) {
        const aosr = documents.find((d) => d.workId === work.workId && d.type === ExecutiveDocumentType.AOSR);
        if (!aosr) {
          reasons.push(`«${work.workName}»: не оформлен АОСР.`);
        } else if (!REQUIRED_APPROVED_STATUSES.has(aosr.status)) {
          reasons.push(`«${work.workName}»: АОСР в статусе «${aosr.status}», требуется подтверждение ПТО (READY/APPROVED).`);
        }
      }
      if (work.requiresMaterials && !work.hasMaterialWithValidDocument) {
        reasons.push(`«${work.workName}»: не привязан материал с действующим сертификатом/паспортом.`);
      }
    }

    if (works.length === 0) {
      reasons.push("В пакете нет ни одной работы.");
    }

    return { canTransfer: reasons.length === 0, reasons };
  }
}
