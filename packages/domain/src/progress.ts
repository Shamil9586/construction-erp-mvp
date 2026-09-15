/**
 * ProgressCalculationService — расчёт физического процента выполнения работы.
 * Правило (ТЗ п.17): процент не вводится вручную, если есть физический объём.
 * Формула: actualQuantity / plannedQuantity * 100, управленческий процент
 * ограничивается 100%. Сырой actualQuantity может превышать план (перевыполнение),
 * храним это отдельно и не режем при записи факта.
 */

export interface ProgressInput {
  plannedQuantity: number;
  actualQuantity: number;
}

export interface ProgressResult {
  /** Процент без ограничения сверху — для внутреннего анализа перевыполнения. */
  rawProgressPercent: number;
  /** Управленческий процент, показываемый в UI/дашборде — ограничен [0, 100]. */
  progressPercent: number;
  isOverperformed: boolean;
}

export class ProgressCalculationService {
  static calculate(input: ProgressInput): ProgressResult {
    const { plannedQuantity, actualQuantity } = input;
    if (plannedQuantity <= 0) {
      return { rawProgressPercent: 0, progressPercent: 0, isOverperformed: false };
    }
    const raw = (actualQuantity / plannedQuantity) * 100;
    return {
      rawProgressPercent: raw,
      progressPercent: Math.max(0, Math.min(100, raw)),
      isOverperformed: raw > 100,
    };
  }

  /** Дельта объёма между двумя последовательными фактами (для WorkProgress истории). */
  static delta(previousActualQuantity: number, newActualQuantity: number): number {
    return newActualQuantity - previousActualQuantity;
  }
}
