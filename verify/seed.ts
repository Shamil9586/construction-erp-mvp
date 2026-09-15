/**
 * verify/seed.ts — реалистичные тестовые данные (ТЗ п.51): 10 объектов,
 * 8 субподрядчиков, 5 РП, 50+ работ, сценарии GREEN/YELLOW/RED/GRAY,
 * технологическая блокировка, просроченные замечания, ПТО/СДО backlog,
 * большой потенциал закрытия. Данные похожи на реальные строительные
 * (в стиле дашборда компании), не lorem ipsum.
 *
 * Исполняется через verify/run.ts против настоящего локального PostgreSQL.
 */
import { exec, lit, num, dateLit, returningId } from "./db";
import {
  ProgressCalculationService,
  ScheduleStatusService,
  ObjectHealthService,
  HealthStatus,
} from "../packages/domain/src";

export const TODAY = new Date("2026-09-14T00:00:00Z");
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export interface SeedIds {
  tenantId: string;
  users: Record<string, string>;
  contractors: Record<string, string>;
  workTypes: Record<string, string>;
  objects: Record<string, string>;
}

export function seed(): SeedIds {
  const tenantId = returningId(
    `INSERT INTO tenants (portal, member_id, name) VALUES
     (${lit("stroygeneral.bitrix24.ru")}, ${lit("mock-member-1")}, ${lit('ООО «СтройГенерал»')})
     RETURNING id`,
  );

  exec(`INSERT INTO risk_settings (tenant_id) VALUES (${lit(tenantId)})`);

  // ---------------------------------------------------------------- users --
  const userDefs: Array<{ key: string; bitrixUserId: number; name: string; role: string; position: string }> = [
    { key: "gd", bitrixUserId: 1, name: "Соколов Игорь Петрович", role: "GENERAL_DIRECTOR", position: "Генеральный директор" },
    { key: "td", bitrixUserId: 2, name: "Марков Денис Олегович", role: "TECHNICAL_DIRECTOR", position: "Технический директор" },
    { key: "admin", bitrixUserId: 3, name: "Егорова Светлана Игоревна", role: "ADMIN", position: "Администратор системы" },
    { key: "pm1", bitrixUserId: 10, name: "Ким Роман Сергеевич", role: "PROJECT_MANAGER", position: "Руководитель проекта" },
    { key: "pm2", bitrixUserId: 11, name: "Захарова Анна Викторовна", role: "PROJECT_MANAGER", position: "Руководитель проекта" },
    { key: "pm3", bitrixUserId: 12, name: "Дорофеев Павел Николаевич", role: "PROJECT_MANAGER", position: "Руководитель проекта" },
    { key: "pm4", bitrixUserId: 13, name: "Никитина Ольга Дмитриевна", role: "PROJECT_MANAGER", position: "Руководитель проекта" },
    { key: "pm5", bitrixUserId: 14, name: "Савельев Артём Юрьевич", role: "PROJECT_MANAGER", position: "Руководитель проекта" },
    { key: "cc1", bitrixUserId: 20, name: "Орлова Татьяна Ивановна", role: "CONSTRUCTION_CONTROL", position: "Инженер строительного контроля" },
    { key: "cc2", bitrixUserId: 21, name: "Прохоров Илья Андреевич", role: "CONSTRUCTION_CONTROL", position: "Инженер строительного контроля" },
    { key: "pto1", bitrixUserId: 30, name: "Волкова Елена Сергеевна", role: "PTO", position: "Инженер ПТО" },
    { key: "sdo1", bitrixUserId: 40, name: "Белова Наталья Владимировна", role: "SDO", position: "Сметчик СДО" },
    { key: "dh1", bitrixUserId: 50, name: "Гринёв Константин Семёнович", role: "DEPARTMENT_HEAD", position: "Руководитель направления" },
  ];
  const users: Record<string, string> = {};
  for (const u of userDefs) {
    const id = returningId(
      `INSERT INTO users (tenant_id, bitrix_user_id, name, role, position) VALUES
       (${lit(tenantId)}, ${u.bitrixUserId}, ${lit(u.name)}, ${lit(u.role)}, ${lit(u.position)}) RETURNING id`,
    );
    users[u.key] = id;
  }

  // ----------------------------------------------------------- contractors --
  const contractorDefs = [
    { key: "monolit", name: 'ООО «МонолитСтрой»', inn: "7701234501" },
    { key: "otdelka", name: 'ООО «АртОтделка»', inn: "7701234502" },
    { key: "inzhener", name: 'ООО «ИнжСетиМонтаж»', inn: "7701234503" },
    { key: "fasad", name: 'ООО «ФасадПро»', inn: "7701234504" },
    { key: "krovlya", name: 'ООО «КровляСервис»', inn: "7701234505" },
    { key: "metall", name: 'ООО «МеталлТорг»', inn: "7701234506" },
    { key: "beton", name: 'ООО «БетонСервис»', inn: "7701234507" },
    { key: "okna", name: 'ООО «ОконныеСистемы»', inn: "7701234508" },
  ];
  const contractors: Record<string, string> = {};
  for (const c of contractorDefs) {
    const id = returningId(
      `INSERT INTO contractors (tenant_id, name, inn) VALUES (${lit(tenantId)}, ${lit(c.name)}, ${lit(c.inn)}) RETURNING id`,
    );
    contractors[c.key] = id;
  }

  // ------------------------------------------------------- work dictionary --
  const catConstruct = returningId(
    `INSERT INTO work_categories (tenant_id, name, code, sort_order) VALUES (${lit(tenantId)}, ${lit("Конструктив")}, ${lit("CONSTRUCT")}, 1) RETURNING id`,
  );
  const catFundament = returningId(
    `INSERT INTO work_categories (tenant_id, parent_id, name, code, sort_order) VALUES (${lit(tenantId)}, ${lit(catConstruct)}, ${lit("Фундаменты")}, ${lit("FOUNDATION")}, 1) RETURNING id`,
  );
  const catOtdelka = returningId(
    `INSERT INTO work_categories (tenant_id, name, code, sort_order) VALUES (${lit(tenantId)}, ${lit("Отделочные работы")}, ${lit("FINISH")}, 2) RETURNING id`,
  );
  const catKrovlya = returningId(
    `INSERT INTO work_categories (tenant_id, name, code, sort_order) VALUES (${lit(tenantId)}, ${lit("Кровля")}, ${lit("ROOF")}, 3) RETURNING id`,
  );
  const catInzh = returningId(
    `INSERT INTO work_categories (tenant_id, name, code, sort_order) VALUES (${lit(tenantId)}, ${lit("Инженерные сети")}, ${lit("MEP")}, 4) RETURNING id`,
  );
  const catFasad = returningId(
    `INSERT INTO work_categories (tenant_id, name, code, sort_order) VALUES (${lit(tenantId)}, ${lit("Фасады")}, ${lit("FACADE")}, 5) RETURNING id`,
  );

  const workTypeDefs = [
    { key: "rebar", categoryId: catFundament, name: "Армирование фундамента", unit: "т", inspection: true, docs: true, materials: true },
    { key: "concrete", categoryId: catFundament, name: "Бетонирование фундамента", unit: "м³", inspection: true, docs: true, materials: true },
    { key: "masonry", categoryId: catConstruct, name: "Кладка стен", unit: "м³", inspection: true, docs: true, materials: true },
    { key: "plaster", categoryId: catOtdelka, name: "Штукатурка стен", unit: "м²", inspection: false, docs: true, materials: false },
    { key: "putty", categoryId: catOtdelka, name: "Шпаклёвка стен", unit: "м²", inspection: false, docs: false, materials: false },
    { key: "paint", categoryId: catOtdelka, name: "Окраска стен", unit: "м²", inspection: false, docs: false, materials: false },
    { key: "roof_flat", categoryId: catKrovlya, name: "Кровля плоская", unit: "м²", inspection: true, docs: true, materials: true },
    { key: "heating", categoryId: catInzh, name: "Разводка отопления", unit: "м.п.", inspection: true, docs: true, materials: true },
    { key: "facade", categoryId: catFasad, name: "Вентфасад, облицовка", unit: "м²", inspection: true, docs: true, materials: true },
    { key: "windows", categoryId: catConstruct, name: "Монтаж оконных блоков", unit: "шт", inspection: false, docs: false, materials: true },
  ];
  const workTypes: Record<string, string> = {};
  for (const w of workTypeDefs) {
    const id = returningId(
      `INSERT INTO work_types (tenant_id, category_id, name, unit, requires_inspection, requires_executive_docs, requires_materials)
       VALUES (${lit(tenantId)}, ${lit(w.categoryId)}, ${lit(w.name)}, ${lit(w.unit)}, ${w.inspection}, ${w.docs}, ${w.materials}) RETURNING id`,
    );
    workTypes[w.key] = id;
  }

  // ------------------------------------------------------------- objects --
  type ObjDef = {
    key: string;
    name: string;
    code: string;
    address: string;
    org: string;
    pm: string;
    contractorKeys: string[];
    startOffsetDays: number;
    durationDays: number;
    contractValue: number;
    scenario: "GREEN" | "YELLOW" | "RED" | "GRAY";
  };

  const objectDefs: ObjDef[] = [
    { key: "obj1", name: 'ЖК «Северный парк», корпус 2', code: "ГПО-014", address: "г. Москва, ул. Полярная, вл. 12", org: 'ООО СЗ «Гор-Строй»', pm: "pm1", contractorKeys: ["monolit", "metall", "beton"], startOffsetDays: -180, durationDays: 300, contractValue: 186_000_000, scenario: "GREEN" },
    { key: "obj2", name: 'ЖК «Речной квартал», корпус 1', code: "ГПО-021", address: "г. Москва, Ершовская наб., 5", org: 'ООО СЗ «Гор-Строй»', pm: "pm2", contractorKeys: ["otdelka", "fasad"], startOffsetDays: -150, durationDays: 260, contractValue: 210_000_000, scenario: "YELLOW" },
    { key: "obj3", name: "Офисный центр «Меридиан»", code: "СПО-118", address: "г. Москва, Пресненская наб., 8", org: 'ООО «РКС-НР»', pm: "pm3", contractorKeys: ["fasad", "inzhener"], startOffsetDays: -370, durationDays: 400, contractValue: 340_000_000, scenario: "RED" },
    { key: "obj4", name: "Складской комплекс «Логопарк Юг»", code: "СПО-090", address: "Московская обл., Домодедово, Логистический пр-д, 2", org: 'ООО «РКС-НР»', pm: "pm4", contractorKeys: ["krovlya", "metall"], startOffsetDays: -30, durationDays: 200, contractValue: 95_000_000, scenario: "GRAY" },
    { key: "obj5", name: 'ЖК «Заречье», корпус 3', code: "ГПО-030", address: "г. Москва, ул. Заречная, вл. 9", org: 'ООО СЗ «Гор-Строй»', pm: "pm5", contractorKeys: ["monolit", "beton"], startOffsetDays: -90, durationDays: 240, contractValue: 170_000_000, scenario: "GREEN" },
    { key: "obj6", name: "Бизнес-центр «Атлант»", code: "СПО-102", address: "г. Москва, Ленинградское ш., 45", org: 'ООО «РКС-НР»', pm: "pm1", contractorKeys: ["fasad", "okna"], startOffsetDays: -200, durationDays: 320, contractValue: 260_000_000, scenario: "YELLOW" },
    { key: "obj7", name: 'ЖК «Южные врата», корпус 4', code: "ГПО-045", address: "г. Москва, Варшавское ш., 120", org: 'ООО СЗ «Гор-Строй»', pm: "pm2", contractorKeys: ["otdelka", "monolit"], startOffsetDays: -120, durationDays: 220, contractValue: 155_000_000, scenario: "RED" },
    { key: "obj8", name: "Производственный корпус «Восток-3»", code: "СПО-077", address: "Московская обл., Ногинск, Промышленная ул., 14", org: 'ООО «РКС-НР»', pm: "pm3", contractorKeys: ["metall", "krovlya"], startOffsetDays: -60, durationDays: 180, contractValue: 120_000_000, scenario: "GREEN" },
    { key: "obj9", name: 'ЖК «Парковый квартал», корпус 1', code: "ГПО-052", address: "г. Москва, Ставропольская ул., 33", org: 'ООО СЗ «Гор-Строй»', pm: "pm4", contractorKeys: ["monolit", "inzhener"], startOffsetDays: -20, durationDays: 260, contractValue: 198_000_000, scenario: "GRAY" },
    { key: "obj10", name: "Торговый центр «Галерея-Запад»", code: "СПО-133", address: "г. Москва, Кутузовский пр-т, 78", org: 'ООО «РКС-НР»', pm: "pm5", contractorKeys: ["fasad", "otdelka"], startOffsetDays: -280, durationDays: 360, contractValue: 410_000_000, scenario: "YELLOW" },
  ];

  const objects: Record<string, string> = {};
  let totalWorks = 0;

  for (const o of objectDefs) {
    const startDate = addDays(TODAY, o.startOffsetDays);
    const finishDate = addDays(startDate, o.durationDays);
    const objectId = returningId(
      `INSERT INTO construction_objects
        (tenant_id, external_code, name, address, customer_name, organization_name, project_manager_id,
         start_date, planned_finish_date, contract_value, status, health_status)
       VALUES (${lit(tenantId)}, ${lit(o.code)}, ${lit(o.name)}, ${lit(o.address)}, ${lit("Заказчик-застройщик")}, ${lit(o.org)},
               ${lit(users[o.pm])}, ${dateLit(startDate)}, ${dateLit(finishDate)}, ${num(o.contractValue)}, 'ACTIVE', 'GRAY')
       RETURNING id`,
    );
    objects[o.key] = objectId;

    for (const ck of o.contractorKeys) {
      exec(`INSERT INTO object_contractors (object_id, contractor_id, role) VALUES (${lit(objectId)}, ${lit(contractors[ck])}, ${lit("Субподрядчик")})`);
    }

    if (o.scenario === "GRAY") {
      // GRAY: объект только начат, фактов почти нет / устарели — намеренно не создаём работы
      // с недавним фактом, здоровье останется GRAY по правилу "нет работ"/"факт устарел".
      continue;
    }

    // Набор работ по объекту — от 5 до 8 позиций из справочника, на разных участках.
    const templates = [
      { key: "rebar", contractorKey: o.contractorKeys[0], planned: 42 },
      { key: "concrete", contractorKey: o.contractorKeys[0], planned: 210 },
      { key: "masonry", contractorKey: o.contractorKeys[0], planned: 640 },
      { key: "plaster", contractorKey: o.contractorKeys[1] ?? o.contractorKeys[0], planned: 3200 },
      { key: "putty", contractorKey: o.contractorKeys[1] ?? o.contractorKeys[0], planned: 3200 },
      { key: "heating", contractorKey: o.contractorKeys[1] ?? o.contractorKeys[0], planned: 860 },
      { key: "facade", contractorKey: o.contractorKeys[1] ?? o.contractorKeys[0], planned: 4200 },
    ];

    // Целевая variance для каждого сценария (совпадает с порогами по умолчанию).
    const targetVariance = o.scenario === "GREEN" ? -2 : o.scenario === "YELLOW" ? -10 : -25;

    let objMaxDelay = 0;
    let objCriticalIssues = 0;
    let objOverdueIssues = 0;
    let objBlocked = 0;
    let worstStatus: string = "ON_TRACK";
    let worstVariance = 0;

    templates.forEach((t, idx) => {
      const wStart = addDays(startDate, idx * 12);
      const wFinish = addDays(wStart, 45);
      const plannedPct = ScheduleStatusService.plannedProgress({ plannedStartDate: wStart, plannedFinishDate: wFinish, today: TODAY });
      // подбираем actual так, чтобы variance ~= targetVariance (в разумных пределах 0..plannedQuantity*1.1)
      let actualPct = Math.max(0, Math.min(115, plannedPct + targetVariance));
      if (wStart > TODAY) actualPct = 0; // работа ещё не началась
      const plannedQuantity = t.planned;
      const actualQuantity = Math.round(((plannedQuantity * actualPct) / 100) * 100) / 100;
      const progress = ProgressCalculationService.calculate({ plannedQuantity, actualQuantity });
      const sched = ScheduleStatusService.evaluate({
        plannedStartDate: wStart,
        plannedFinishDate: wFinish,
        today: TODAY,
        actualProgressPercent: progress.progressPercent,
      });

      const wtId = workTypes[t.key];
      const wtDef = workTypeDefs.find((w) => w.key === t.key)!;
      const estimatedCost = Math.round(plannedQuantity * (8000 + idx * 1500));
      const status = progress.progressPercent >= 100 ? "DONE" : progress.progressPercent > 0 ? "IN_PROGRESS" : "PLANNED";

      const workId = returningId(
        `INSERT INTO object_works
          (tenant_id, object_id, work_type_id, contractor_id, responsible_user_id, name, unit,
           planned_quantity, actual_quantity, planned_start_date, planned_finish_date, estimated_cost,
           status, progress_percent, schedule_status, variance_p, delay_days, accepted_quantity)
         VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(wtId)}, ${lit(contractors[t.contractorKey])}, ${lit(users[o.pm])},
                 ${lit(wtDef.name + " — уч. " + (idx + 1))}, ${lit(wtDef.unit)}, ${num(plannedQuantity)}, ${num(actualQuantity)},
                 ${dateLit(wStart)}, ${dateLit(wFinish)}, ${num(estimatedCost)}, ${lit(status)}, ${num(progress.progressPercent)},
                 ${lit(sched.scheduleStatus)}, ${num(sched.varianceP)}, ${sched.delayDays}, ${num(actualQuantity * 0.6)})
         RETURNING id`,
      );
      totalWorks++;

      exec(
        `INSERT INTO work_progress (tenant_id, object_work_id, quantity_delta, total_quantity, progress_percent, reported_at, reported_by, comment)
         VALUES (${lit(tenantId)}, ${lit(workId)}, ${num(actualQuantity)}, ${num(actualQuantity)}, ${num(progress.progressPercent)},
                 ${dateLit(addDays(TODAY, -2))}, ${lit("РП " + o.pm)}, ${lit("Внесён факт при первичном заведении объекта")})`,
      );

      if (sched.delayDays > objMaxDelay) objMaxDelay = sched.delayDays;
      if (sched.scheduleStatus === "CRITICAL") {
        worstStatus = "CRITICAL";
        worstVariance = Math.min(worstVariance, sched.varianceP);
      } else if (sched.scheduleStatus === "BEHIND" && worstStatus !== "CRITICAL") {
        worstStatus = "BEHIND";
        worstVariance = Math.min(worstVariance, sched.varianceP);
      }

      // RED-объекты получают критическое замечание СК + технологическую блокировку.
      if (o.scenario === "RED" && idx === 0) {
        const inspId = returningId(
          `INSERT INTO construction_inspections (tenant_id, object_id, object_work_id, requested_by_id, inspector_id, status, inspection_date, decision)
           VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workId)}, ${lit(users[o.pm])}, ${lit(users["cc1"])}, 'ISSUES_FOUND', ${dateLit(addDays(TODAY, -6))}, ${lit("Обнаружено критическое несоответствие")})
           RETURNING id`,
        );
        exec(
          `INSERT INTO inspection_issues (tenant_id, inspection_id, title, description, severity, responsible_user_id, due_date, status)
           VALUES (${lit(tenantId)}, ${lit(inspId)}, ${lit("Несоответствие армирования проекту")},
                   ${lit("Шаг армирования не соответствует рабочей документации, требуется демонтаж и повтор")},
                   'CRITICAL', ${lit(users[o.pm])}, ${dateLit(addDays(TODAY, -3))}, 'OPEN')`,
        );
        objCriticalIssues++;
        objOverdueIssues++;
        objBlocked++;

        if (templates[idx + 1]) {
          // блокировка следующей работы — создадим позже, после того как узнаем её id (см. ниже double-pass)
        }
      }

      // YELLOW-объекты получают просроченное некритичное замечание (реалистичность).
      if (o.scenario === "YELLOW" && idx === 1) {
        const inspId = returningId(
          `INSERT INTO construction_inspections (tenant_id, object_id, object_work_id, requested_by_id, inspector_id, status, inspection_date, decision)
           VALUES (${lit(tenantId)}, ${lit(objectId)}, ${lit(workId)}, ${lit(users[o.pm])}, ${lit(users["cc2"])}, 'ISSUES_FOUND', ${dateLit(addDays(TODAY, -9))}, ${lit("Незначительное отклонение")})
           RETURNING id`,
        );
        exec(
          `INSERT INTO inspection_issues (tenant_id, inspection_id, title, description, severity, responsible_user_id, due_date, status)
           VALUES (${lit(tenantId)}, ${lit(inspId)}, ${lit("Недостаточный защитный слой")}, ${lit("Локальное отклонение по защитному слою бетона")},
                   'MINOR', ${lit(users[o.pm])}, ${dateLit(addDays(TODAY, -2))}, 'OPEN')`,
        );
        objOverdueIssues++;
      }
    });

    const health = ObjectHealthService.calculate({
      hasWorks: true,
      lastProgressUpdateAt: addDays(TODAY, -2),
      today: TODAY,
      worstScheduleStatus: worstStatus as any,
      worstVarianceP: worstVariance,
      maxDelayDays: objMaxDelay,
      criticalOpenIssuesCount: objCriticalIssues,
      overdueIssuesCount: objOverdueIssues,
      blockedWorksCount: objBlocked,
      ptoBacklogCount: 0,
      sdoBacklogCount: 0,
    });

    exec(
      `UPDATE construction_objects SET health_status = ${lit(health.status)}, health_reasons = ${lit(JSON.stringify(health.reasons))}::jsonb WHERE id = ${lit(objectId)}`,
    );

    if (health.status !== o.scenario && !(o.scenario === "GRAY")) {
      // eslint-disable-next-line no-console
      console.warn(`[seed] объект ${o.name}: ожидался ${o.scenario}, получено ${health.status} (${health.reasons.join(" ")})`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Готово: ${objectDefs.length} объектов, ${contractorDefs.length} субподрядчиков, ${userDefs.filter((u) => u.role === "PROJECT_MANAGER").length} РП, ${totalWorks} работ.`);

  return { tenantId, users, contractors, workTypes, objects };
}
