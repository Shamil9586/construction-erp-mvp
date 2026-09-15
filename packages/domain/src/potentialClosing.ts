/**
 * PotentialClosingService (ТЗ п.31) — ключевой показатель для ГД: где именно
 * "зависли деньги". Потенциал = стоимость физически выполненного объёма минус
 * уже отражённое финансовое закрытие, разбитая по 5 стадиям задержки.
 */

export interface WorkClosingInput {
  workId: string;
  workName: string;
  /** Договорная стоимость работы целиком (за весь plannedQuantity). */
  estimatedCost: number;
  plannedQuantity: number;
  /** Физически выполнено (факт РП). */
  actualQuantity: number;
  /** Принято строительным контролем. */
  acceptedQuantity: number;
  /** Объём, покрытый готовой (READY/APPROVED) исполнительной документацией. */
  executiveDocsReadyQuantity: number;
  /** Объём, переданный в СДО. */
  transferredToSdoQuantity: number;
  /** Сумма, которую СДО уже осметило по переданному объёму. */
  calculatedValue: number;
  /** Сумма, уже отражённая в финансовом закрытии. */
  closedValue: number;
}

export interface PotentialClosingStage {
  stage: 1 | 2 | 3 | 4 | 5;
  label: string;
  amount: number;
}

export interface PotentialClosingResult {
  physicallyExecutedValue: number;
  closedValue: number;
  potentialClosingValue: number;
  stages: PotentialClosingStage[];
  byWork: Array<{ workId: string; workName: string; potential: number }>;
}

const clamp0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export class PotentialClosingService {
  static calculate(works: WorkClosingInput[]): PotentialClosingResult {
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    let s5 = 0;
    let physicallyExecutedValue = 0;
    let closedValue = 0;
    const byWork: Array<{ workId: string; workName: string; potential: number }> = [];

    for (const w of works) {
      if (w.plannedQuantity <= 0) continue;
      const rate = w.estimatedCost / w.plannedQuantity;

      const physicalVal = w.actualQuantity * rate;
      const acceptedVal = Math.min(w.acceptedQuantity, w.actualQuantity) * rate;
      const docsReadyVal = Math.min(w.executiveDocsReadyQuantity, w.acceptedQuantity) * rate;
      const transferredVal = Math.min(w.transferredToSdoQuantity, w.executiveDocsReadyQuantity) * rate;

      const stage1 = clamp0(physicalVal - acceptedVal);
      const stage2 = clamp0(acceptedVal - docsReadyVal);
      const stage3 = clamp0(docsReadyVal - transferredVal);
      const stage4 = clamp0(transferredVal - w.calculatedValue);
      const stage5 = clamp0(w.calculatedValue - w.closedValue);

      s1 += stage1;
      s2 += stage2;
      s3 += stage3;
      s4 += stage4;
      s5 += stage5;

      physicallyExecutedValue += physicalVal;
      closedValue += w.closedValue;

      const potential = stage1 + stage2 + stage3 + stage4 + stage5;
      if (potential > 0.01) byWork.push({ workId: w.workId, workName: w.workName, potential });
    }

    const potentialClosingValue = s1 + s2 + s3 + s4 + s5;

    return {
      physicallyExecutedValue,
      closedValue,
      potentialClosingValue,
      stages: [
        { stage: 1, label: "Выполнено, но СК не принял", amount: s1 },
        { stage: 2, label: "Принято СК, но ИД не готова", amount: s2 },
        { stage: 3, label: "ИД готова, но не передана в СДО", amount: s3 },
        { stage: 4, label: "Передано в СДО, но не осметено", amount: s4 },
        { stage: 5, label: "Осмечено, но ещё не закрыто", amount: s5 },
      ],
      byWork: byWork.sort((a, b) => b.potential - a.potential),
    };
  }
}
