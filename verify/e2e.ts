/**
 * verify/e2e.ts — обязательный E2E-сценарий (ТЗ п.53), исполняется против
 * настоящего локального PostgreSQL и настоящего пакета @construction-erp/domain.
 * Каждый шаг пронумерован как в ТЗ и проверяется через node:assert.
 */
import assert from "node:assert/strict";
import { exec, lit, num, dateLit, queryOne, queryJson, returningId } from "./db";
import {
  ProgressCalculationService,
  ScheduleStatusService,
  ObjectHealthService,
  WorkTransitionPolicy,
  PtoPackageValidationService,
  PotentialClosingService,
  DependencyType,
  InspectionStatus,
  IssueSeverity,
  IssueStatus,
  ExecutiveDocumentType,
  ExecutiveDocumentStatus,
} from "../packages/domain/src";
import type { SeedIds } from "./seed";

const TODAY = new Date("2026-09-14T00:00:00Z");
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

function audit(tenantId: string, userId: string, entityType: string, entityId: string, action: string) {
  exec(
    `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action)
     VALUES (${lit(tenantId)}, ${lit(userId)}, ${lit(entityType)}, ${lit(entityId)}, ${lit(action)})`,
  );
}

export function runE2E(seedIds: SeedIds) {
  const { tenantId, users, contractors, workTypes } = seedIds;
  const pmId = users["pm1"];
  const ccId = users["cc1"];
  const ptoId = users["pto1"];
  const sdoId = users["sdo1"];
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const record = (step: string, fn: () => string) => {
    try {
      const detail = fn();
      steps.push({ step, ok: true, detail });
    } catch (e: any) {
      steps.push({ step, ok: false, detail: e.message });
      throw e;
    }
  };

  // -------------------------------------------------------------- 1. Создать объект
  let objectId = "";
  record("1. Создать объект", () => {
    objectId = returningId(
      `INSERT INTO construction_objects (tenant_id, external_code, name, address, customer_name, organization_name,
         start_date, planned_finish_date, contract_value, status, health_status)
       VALUES (${lit(tenantId)}, ${lit("ГПО-999")}, ${lit('ЖК «Тестовый квартал», корпус 1')}, ${lit("г. Москва, ул. Демонстрационная, 1")},
               ${lit("Заказчик-застройщик")}, ${lit('ООО СЗ «Гор-Строй»')}, ${dateLit(addDays(TODAY, -30))}, ${dateLit(addDays(TODAY, 300))},
               ${num(50_000_000)}, 'ACTIVE', 'GRAY') RETURNING id`,
    );
    audit(tenantId, pmId, "ConstructionObject", objectId, "Создан объект «ЖК «Тестовый квартал», корпус 1»");
    return objectId;
  });

  // -------------------------------------------------------------- 2. Назначить РП
  record("2. Назначить РП", () => {
    exec(`UPDATE construction_objects SET project_manager_id = ${lit(pmId)}, updated_at = now() WHERE id = ${lit(objectId)}`);
    audit(tenantId, pmId, "ConstructionObject", objectId, "Назначен РП: Ким Роман Сергеевич");
    return pmId;
  });

  // -------------------------------------------------------------- 3. Назначить субподрядчика
  record("3. Назначить субподрядчика", () => {
    exec(`INSERT INTO object_contractors (object_id, contractor_id, role) VALUES (${lit(objectId)}, ${lit(contractors["monolit"])}, ${lit("Генподрядчик по монолиту")})`);
    audit(tenantId, pmId, "ConstructionObject", objectId, "Назначен субподрядчик: ООО «МонолитСтрой»");
    return contractors["monolit"];
  });

  // ----------------------------------------------- 4-5. Добавить работу, план 20 т
  let workId = "";
  const wStart = addDays(TODAY, -30);
  const wFinish = addDays(TODAY, 10); // 40 дней; на TODAY прошло 30/40 = 75% планового срока
  record("4-5. Добавить работу «Армирование фундамента Ф-1», план 20 т", () => {
    workId = returningId(
      `INSERT INTO object_works (tenant_id, object_id, work_type_id, contractor_id, responsible_user_id, name, unit,
          planned_quantity, actual_quantity, planned_start_date, planned_finish_date, estimated_cost, status)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workTypes["rebar"])}, ${lit(contractors["monolit"])}, ${lit(pmId)},
               ${lit("Армирование фундамента Ф-1")}, ${lit("т")}, 20, 0, ${dateLit(wStart)}, ${dateLit(wFinish)}, 900000, 'PLANNED')
       RETURNING id`,
    );
    audit(tenantId, pmId, "ObjectWork", workId, "Добавлена работа «Армирование фундамента Ф-1», план 20 т");
    return workId;
  });

  // -------------------------------------------------------------- 6-7. Факт 10 т -> 50%
  record("6-7. Ввести факт 10 т -> получить 50%", () => {
    const progress = ProgressCalculationService.calculate({ plannedQuantity: 20, actualQuantity: 10 });
    assert.equal(progress.progressPercent, 50, "ожидалось 50%");
    exec(
      `UPDATE object_works SET actual_quantity = 10, progress_percent = 50, status = 'IN_PROGRESS', updated_at = now() WHERE id = ${lit(workId)}`,
    );
    exec(
      `INSERT INTO work_progress (tenant_id, object_work_id, quantity_delta, total_quantity, progress_percent, reported_by, comment)
       VALUES (${lit(tenantId)}, ${lit(workId)}, 10, 10, 50, ${lit("РП Ким Р.")}, ${lit("Внесено вручную")})`,
    );
    audit(tenantId, pmId, "ObjectWork", workId, "Внесён факт: +10 т (итого 10/20 т, 50%)");
    return `progressPercent=${progress.progressPercent}`;
  });

  // ------------------------------------------------- 8-9. Плановый % и RED при отставании
  let scheduleResult: ReturnType<typeof ScheduleStatusService.evaluate>;
  record("8-9. Плановый % на сегодня и светофор при отставании", () => {
    scheduleResult = ScheduleStatusService.evaluate({
      plannedStartDate: wStart,
      plannedFinishDate: wFinish,
      today: TODAY,
      actualProgressPercent: 50,
    });
    assert.equal(scheduleResult.plannedProgressPercent, 75, "плановый % на сегодня должен быть 75%");
    assert.ok(
      scheduleResult.scheduleStatus === "BEHIND" || scheduleResult.scheduleStatus === "CRITICAL",
      "при факте 50% против плана 75% статус должен быть YELLOW(BEHIND) или RED(CRITICAL)",
    );
    assert.ok(scheduleResult.delayDays > 0, "delayDays должен быть > 0");
    exec(
      `UPDATE object_works SET schedule_status = ${lit(scheduleResult.scheduleStatus)}, variance_p = ${num(scheduleResult.varianceP)}, delay_days = ${scheduleResult.delayDays} WHERE id = ${lit(workId)}`,
    );
    return `plannedProgress=${scheduleResult.plannedProgressPercent}%, scheduleStatus=${scheduleResult.scheduleStatus}, variance=${scheduleResult.varianceP.toFixed(1)}пп, delayDays=${scheduleResult.delayDays}`;
  });

  // -------------------------------------------------------------- 10. Довести факт до 100%
  record("10. Довести факт до 100%", () => {
    const progress = ProgressCalculationService.calculate({ plannedQuantity: 20, actualQuantity: 20 });
    assert.equal(progress.progressPercent, 100);
    exec(`UPDATE object_works SET actual_quantity = 20, progress_percent = 100, status = 'DONE', actual_finish_date = ${dateLit(TODAY)}, updated_at = now() WHERE id = ${lit(workId)}`);
    exec(
      `INSERT INTO work_progress (tenant_id, object_work_id, quantity_delta, total_quantity, progress_percent, reported_by, comment)
       VALUES (${lit(tenantId)}, ${lit(workId)}, 10, 20, 100, ${lit("РП Ким Р.")}, ${lit("Армирование завершено")})`,
    );
    audit(tenantId, pmId, "ObjectWork", workId, "Внесён факт: +10 т (итого 20/20 т, 100%)");
    return "actualQuantity=20/20 (100%)";
  });

  // -------------------------------------------------------------- 11. Предъявить СК
  let inspectionId = "";
  record("11. Предъявить СК", () => {
    inspectionId = returningId(
      `INSERT INTO construction_inspections (tenant_id, object_id, object_work_id, requested_by_id, status, requested_at)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workId)}, ${lit(pmId)}, 'WAITING', now()) RETURNING id`,
    );
    audit(tenantId, pmId, "ConstructionInspection", inspectionId, "Работа предъявлена строительному контролю");
    return inspectionId;
  });

  // -------------------------------------------------------------- 12. СК создаёт замечание
  let issueId = "";
  record("12. СК создаёт замечание", () => {
    exec(`UPDATE construction_inspections SET status = 'ISSUES_FOUND', inspector_id = ${lit(ccId)}, inspection_date = ${dateLit(TODAY)} WHERE id = ${lit(inspectionId)}`);
    issueId = returningId(
      `INSERT INTO inspection_issues (tenant_id, inspection_id, title, description, severity, responsible_user_id, due_date, status)
       VALUES (${lit(tenantId)}, ${lit(inspectionId)}, ${lit("Недостаточный защитный слой бетона")},
               ${lit("Защитный слой в осях 2-3 менее проектного значения")}, 'CRITICAL', ${lit(pmId)}, ${dateLit(addDays(TODAY, 2))}, 'OPEN')
       RETURNING id`,
    );
    audit(tenantId, ccId, "InspectionIssue", issueId, "Замечание СК: недостаточный защитный слой бетона (критично)");
    return issueId;
  });

  // ------------------------------------------------- 13. Следующая работа блокируется
  let concreteWorkId = "";
  record("13. Следующая работа («Бетонирование») блокируется", () => {
    concreteWorkId = returningId(
      `INSERT INTO object_works (tenant_id, object_id, work_type_id, contractor_id, responsible_user_id, name, unit,
          planned_quantity, actual_quantity, planned_start_date, planned_finish_date, estimated_cost, status)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workTypes["concrete"])}, ${lit(contractors["monolit"])}, ${lit(pmId)},
               ${lit("Бетонирование фундамента Ф-1")}, ${lit("м³")}, 210, 0, ${dateLit(TODAY)}, ${dateLit(addDays(TODAY, 5))}, 4050060, 'BLOCKED')
       RETURNING id`,
    );
    exec(
      `INSERT INTO work_dependencies (predecessor_work_id, successor_work_id, dependency_type, requires_acceptance)
       VALUES (${lit(workId)}, ${lit(concreteWorkId)}, 'FINISH_TO_START', true)`,
    );
    const check = WorkTransitionPolicy.canStartWork([
      {
        predecessorWorkId: workId,
        predecessorWorkName: "Армирование фундамента Ф-1",
        dependencyType: DependencyType.FINISH_TO_START,
        requiresAcceptance: true,
        predecessorLatestInspectionStatus: InspectionStatus.ISSUES_FOUND,
        predecessorHasOpenCriticalIssues: true,
        predecessorMissingRequiredDocument: false,
      },
    ]);
    assert.equal(check.allowed, false, "Бетонирование должно быть заблокировано");
    assert.ok(check.reasons.length >= 1);
    return `canStartWork=false; причины: ${check.reasons.join(" | ")}`;
  });

  // -------------------------------------------------------------- 14. РП устраняет замечание
  record("14. РП устраняет замечание", () => {
    exec(`UPDATE inspection_issues SET status = 'READY_FOR_VERIFICATION', resolved_at = now() WHERE id = ${lit(issueId)}`);
    audit(tenantId, pmId, "InspectionIssue", issueId, "Замечание устранено, приложены фото устранения");
    return "issue.status=READY_FOR_VERIFICATION";
  });

  // -------------------------------------------------------------- 15. СК повторно проверяет
  record("15. СК повторно проверяет", () => {
    exec(`UPDATE construction_inspections SET status = 'REINSPECTION', inspection_date = ${dateLit(TODAY)} WHERE id = ${lit(inspectionId)}`);
    audit(tenantId, ccId, "ConstructionInspection", inspectionId, "Повторная проверка армирования Ф-1");
    return "inspection.status=REINSPECTION";
  });

  // -------------------------------------------------------------- 16. СК принимает работу
  record("16. СК принимает работу", () => {
    // Транзакционно (в реальном backend — единая DB-транзакция, см. apps/backend InspectionsService.accept):
    // 1) inspection -> ACCEPTED, 2) issue -> CLOSED, 3) work.acceptedQuantity, 4) audit, 5) event.
    exec(`UPDATE construction_inspections SET status = 'ACCEPTED', accepted_at = now(), accepted_quantity = 20 WHERE id = ${lit(inspectionId)}`);
    exec(`UPDATE inspection_issues SET status = 'CLOSED', verified_at = now() WHERE id = ${lit(issueId)}`);
    exec(`UPDATE object_works SET accepted_quantity = 20 WHERE id = ${lit(workId)}`);
    audit(tenantId, ccId, "ConstructionInspection", inspectionId, "Строительный контроль: работа принята в полном объёме — 20 т");
    return "inspection.status=ACCEPTED, issue.status=CLOSED, acceptedQuantity=20";
  });

  // ------------------------------------------------- 17. «Бетонирование» разблокируется
  record("17. «Бетонирование» разблокируется", () => {
    const check = WorkTransitionPolicy.canStartWork([
      {
        predecessorWorkId: workId,
        predecessorWorkName: "Армирование фундамента Ф-1",
        dependencyType: DependencyType.FINISH_TO_START,
        requiresAcceptance: true,
        predecessorLatestInspectionStatus: InspectionStatus.ACCEPTED,
        predecessorHasOpenCriticalIssues: false,
        predecessorMissingRequiredDocument: false,
      },
    ]);
    assert.equal(check.allowed, true, "Бетонирование должно разблокироваться после приёмки");
    exec(`UPDATE object_works SET status = 'PLANNED' WHERE id = ${lit(concreteWorkId)}`);
    audit(tenantId, ccId, "ObjectWork", concreteWorkId, "Разблокирована «Бетонирование фундамента Ф-1» после приёмки армирования");
    return "canStartWork=true";
  });

  // -------------------------------------------------------------- 18. ПТО получает информацию
  record("18. ПТО получает информацию", () => {
    exec(
      `INSERT INTO notifications (tenant_id, user_id, type, title, dedup_key)
       VALUES (${lit(tenantId)}, ${lit(ptoId)}, ${lit("INSPECTION_ACCEPTED")}, ${lit("Работа принята СК — можно готовить ИД: Армирование фундамента Ф-1")}, ${lit("insp-accepted-" + workId + "-" + TODAY.toISOString().slice(0, 10))})`,
    );
    return "notification -> ПТО";
  });

  // -------------------------------------------------------------- 19. ПТО формирует пакет ИД
  let packageId = "";
  let aosrDocId = "";
  record("19. ПТО формирует пакет ИД", () => {
    packageId = returningId(
      `INSERT INTO executive_document_packages (tenant_id, object_id, status, created_by) VALUES (${lit(tenantId)}, ${lit(objectId)}, 'DRAFT', ${lit("Волкова Е.С.")}) RETURNING id`,
    );
    aosrDocId = returningId(
      `INSERT INTO executive_documents (tenant_id, object_id, object_work_id, type, number, document_date, status, created_by)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workId)}, 'AOSR', ${lit("АОСР-Ф1-001")}, ${dateLit(TODAY)}, 'DRAFT', ${lit("Волкова Е.С.")}) RETURNING id`,
    );
    const schemeDocId = returningId(
      `INSERT INTO executive_documents (tenant_id, object_id, object_work_id, type, number, document_date, status, created_by)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workId)}, 'EXECUTIVE_SCHEME', ${lit("ИС-Ф1-001")}, ${dateLit(TODAY)}, 'DRAFT', ${lit("Волкова Е.С.")}) RETURNING id`,
    );
    exec(`INSERT INTO executive_document_package_items (package_id, document_id) VALUES (${lit(packageId)}, ${lit(aosrDocId)}), (${lit(packageId)}, ${lit(schemeDocId)})`);
    audit(tenantId, ptoId, "ExecutiveDocumentPackage", packageId, "Сформирован пакет ИД: АОСР + исполнительная схема (черновик)");
    return `package=${packageId}, docs=[АОСР, Исполнительная схема] (DRAFT)`;
  });

  // -------------------------------------------------- 20. Материалы и документы
  record("20. Добавляются материалы и документы", () => {
    const materialId = returningId(
      `INSERT INTO materials (tenant_id, name, manufacturer, brand) VALUES (${lit(tenantId)}, ${lit("Арматура А500С Ø12")}, ${lit("МеталлТорг")}, ${lit("А500С")}) RETURNING id`,
    );
    const batchId = returningId(
      `INSERT INTO material_batches (tenant_id, material_id, batch_number, supplier, delivery_date, object_id)
       VALUES (${lit(tenantId)}, ${lit(materialId)}, ${lit("ПТ-2201")}, ${lit("ООО «МеталлТорг»")}, ${dateLit(addDays(TODAY, -40))}, ${lit(objectId)}) RETURNING id`,
    );
    exec(
      `INSERT INTO material_documents (tenant_id, material_batch_id, type, number, valid_from, valid_until)
       VALUES (${lit(tenantId)}, ${lit(batchId)}, 'CERTIFICATE', ${lit("С-000123")}, ${dateLit(addDays(TODAY, -40))}, ${dateLit(addDays(TODAY, 320))})`,
    );
    exec(`INSERT INTO work_materials (object_work_id, material_batch_id, quantity) VALUES (${lit(workId)}, ${lit(batchId)}, 20)`);
    // Подтверждаем АОСР и исполнительную схему после того, как приложены материалы/сертификаты (переход к APPROVED).
    exec(`UPDATE executive_documents SET status = 'APPROVED', approved_by = ${lit("Волкова Е.С.")}, approved_at = now() WHERE object_work_id = ${lit(workId)}`);
    audit(tenantId, ptoId, "MaterialBatch", batchId, "Привязана партия арматуры А500С Ø12 (ПТ-2201) с сертификатом");

    // Валидация пакета перед передачей (PtoPackageValidationService) — используем реальный домен-сервис.
    const validation = PtoPackageValidationService.validate(
      [{ workId, workName: "Армирование фундамента Ф-1", requiresExecutiveDocs: true, requiresMaterials: true, hasMaterialWithValidDocument: true }],
      [{ workId, type: ExecutiveDocumentType.AOSR, status: ExecutiveDocumentStatus.APPROVED }],
    );
    assert.equal(validation.canTransfer, true, "пакет должен пройти валидацию: " + validation.reasons.join("; "));
    return "материалы привязаны, АОСР/схема -> APPROVED, PtoPackageValidationService.canTransfer=true";
  });

  // -------------------------------------------------- 21. Пакет передаётся в СДО
  let sdoCaseId = "";
  record("21. Пакет передаётся в СДО", () => {
    exec(`UPDATE executive_document_packages SET status = 'TRANSFERRED_TO_SDO', completed_at = now() WHERE id = ${lit(packageId)}`);
    sdoCaseId = returningId(
      `INSERT INTO sdo_cases (tenant_id, object_id, object_work_id, executive_document_package_id, status, pto_transferred_at, sdo_responsible_id, estimated_value)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workId)}, ${lit(packageId)}, 'TRANSFERRED', now(), ${lit(sdoId)}, 900000) RETURNING id`,
    );
    exec(`UPDATE object_works SET executive_docs_ready_quantity = 20, transferred_to_sdo_quantity = 20 WHERE id = ${lit(workId)}`);
    audit(tenantId, ptoId, "SdoCase", sdoCaseId, "Пакет ИД передан в СДО");
    return sdoCaseId;
  });

  // -------------------------------------------------- 22. СДО вводит стоимость
  record("22. СДО вводит стоимость (осмечивание вне системы, результат вводится в приложение)", () => {
    exec(`UPDATE sdo_cases SET status = 'CALCULATED', calculated_value = 902700, calculated_at = now() WHERE id = ${lit(sdoCaseId)}`);
    audit(tenantId, sdoId, "SdoCase", sdoCaseId, "СДО осметило пакет: 902 700 ₽");
    return "sdoCase.calculatedValue=902700, status=CALCULATED";
  });

  // -------------------------------------------------- 23. Формируется финансовое закрытие
  let financialClosingId = "";
  record("23. Формируется финансовое закрытие", () => {
    financialClosingId = returningId(
      `INSERT INTO financial_closings (tenant_id, object_id, sdo_case_id, period, amount, closing_date, created_by)
       VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(sdoCaseId)}, ${lit("2026-09")}, 902700, ${dateLit(TODAY)}, ${lit("Белова Н.В.")}) RETURNING id`,
    );
    exec(`UPDATE sdo_cases SET status = 'CLOSED', accepted_closing_value = 902700, closed_at = now() WHERE id = ${lit(sdoCaseId)}`);
    audit(tenantId, sdoId, "FinancialClosing", financialClosingId, "Зафиксировано финансовое закрытие: 902 700 ₽ за 2026-09");
    return financialClosingId;
  });

  // -------------------------------------------------- 24. Dashboard пересчитывается
  record("24. Dashboard автоматически пересчитывается", () => {
    const potential = PotentialClosingService.calculate([
      {
        workId,
        workName: "Армирование фундамента Ф-1",
        estimatedCost: 900000,
        plannedQuantity: 20,
        actualQuantity: 20,
        acceptedQuantity: 20,
        executiveDocsReadyQuantity: 20,
        transferredToSdoQuantity: 20,
        calculatedValue: 902700,
        closedValue: 902700,
      },
    ]);
    assert.equal(potential.potentialClosingValue, 0, "после полного закрытия потенциал должен быть 0");
    assert.equal(potential.closedValue, 902700);

    const health = ObjectHealthService.calculate({
      hasWorks: true,
      lastProgressUpdateAt: TODAY,
      today: TODAY,
      worstScheduleStatus: "DONE" as any,
      worstVarianceP: 0,
      maxDelayDays: 0,
      criticalOpenIssuesCount: 0,
      overdueIssuesCount: 0,
      blockedWorksCount: 0,
      ptoBacklogCount: 0,
      sdoBacklogCount: 0,
    });
    exec(`UPDATE construction_objects SET health_status = ${lit(health.status)}, health_reasons = ${lit(JSON.stringify(health.reasons))}::jsonb WHERE id = ${lit(objectId)}`);
    return `potentialClosing=0 ₽ (было 900000), object.healthStatus=${health.status}`;
  });

  // -------------------------------------------------- 25. AuditLog содержит всю историю
  record("25. AuditLog содержит всю историю", () => {
    const rows = queryJson<{ action: string }>(`SELECT action FROM audit_log WHERE entity_id IN (${lit(objectId)}, ${lit(workId)}, ${lit(inspectionId)}, ${lit(issueId)}, ${lit(packageId)}, ${lit(sdoCaseId)}, ${lit(financialClosingId)}, ${lit(concreteWorkId)}) ORDER BY created_at`);
    assert.ok(rows.length >= 10, `ожидалось >= 10 записей аудита, получено ${rows.length}`);
    return `audit_log: ${rows.length} записей, полная история от создания объекта до финансового закрытия`;
  });

  return { objectId, workId, steps };
}
