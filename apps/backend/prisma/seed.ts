/**
 * Prisma seed (ТЗ п.51): 10 объектов, 8 субподрядчиков, 5 РП, 50+ работ,
 * сценарии GREEN/YELLOW/RED/GRAY, технологическая блокировка, просроченные
 * замечания, ПТО/СДО backlog, потенциал закрытия. Реальные данные похожи на
 * строительные (не lorem ipsum) — тот же набор, что проверен через
 * verify/seed.ts против настоящего PostgreSQL в среде без доступа к npm
 * (см. README «Как это было проверено»). Запуск: `npm run prisma:seed`.
 */
import { PrismaClient } from "@prisma/client";
import { ProgressCalculationService, ScheduleStatusService, ObjectHealthService, ScheduleStatus } from "@construction-erp/domain";

const prisma = new PrismaClient();
const TODAY = new Date("2026-09-14T00:00:00Z");
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { memberId: "mock-member-1" },
    update: { portal: "stroygeneral.bitrix24.ru", name: 'ООО «СтройГенерал»' },
    create: { portal: "stroygeneral.bitrix24.ru", memberId: "mock-member-1", name: 'ООО «СтройГенерал»' },
  });
  await prisma.riskSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id },
  });

  const userDefs = [
    { bitrixUserId: 1, name: "Соколов Игорь Петрович", role: "GENERAL_DIRECTOR" as const, position: "Генеральный директор" },
    { bitrixUserId: 2, name: "Марков Денис Олегович", role: "TECHNICAL_DIRECTOR" as const, position: "Технический директор" },
    { bitrixUserId: 3, name: "Егорова Светлана Игоревна", role: "ADMIN" as const, position: "Администратор системы" },
    { bitrixUserId: 10, name: "Ким Роман Сергеевич", role: "PROJECT_MANAGER" as const, position: "Руководитель проекта" },
    { bitrixUserId: 11, name: "Захарова Анна Викторовна", role: "PROJECT_MANAGER" as const, position: "Руководитель проекта" },
    { bitrixUserId: 12, name: "Дорофеев Павел Николаевич", role: "PROJECT_MANAGER" as const, position: "Руководитель проекта" },
    { bitrixUserId: 13, name: "Никитина Ольга Дмитриевна", role: "PROJECT_MANAGER" as const, position: "Руководитель проекта" },
    { bitrixUserId: 14, name: "Савельев Артём Юрьевич", role: "PROJECT_MANAGER" as const, position: "Руководитель проекта" },
    { bitrixUserId: 20, name: "Орлова Татьяна Ивановна", role: "CONSTRUCTION_CONTROL" as const, position: "Инженер СК" },
    { bitrixUserId: 21, name: "Прохоров Илья Андреевич", role: "CONSTRUCTION_CONTROL" as const, position: "Инженер СК" },
    { bitrixUserId: 30, name: "Волкова Елена Сергеевна", role: "PTO" as const, position: "Инженер ПТО" },
    { bitrixUserId: 40, name: "Белова Наталья Владимировна", role: "SDO" as const, position: "Сметчик СДО" },
    { bitrixUserId: 50, name: "Гринёв Константин Семёнович", role: "DEPARTMENT_HEAD" as const, position: "Руководитель направления" },
  ];
  const users: Record<number, string> = {};
  for (const u of userDefs) {
    const created = await prisma.user.upsert({
      where: { tenantId_bitrixUserId: { tenantId: tenant.id, bitrixUserId: u.bitrixUserId } },
      update: { name: u.name, role: u.role, position: u.position, isActive: true },
      create: { tenantId: tenant.id, ...u },
    });
    users[u.bitrixUserId] = created.id;
  }
  const pmIds = [10, 11, 12, 13, 14].map((id) => users[id]);

  const contractorDefs = [
    { name: 'ООО «МонолитСтрой»', inn: "7701234501" },
    { name: 'ООО «АртОтделка»', inn: "7701234502" },
    { name: 'ООО «ИнжСетиМонтаж»', inn: "7701234503" },
    { name: 'ООО «ФасадПро»', inn: "7701234504" },
    { name: 'ООО «КровляСервис»', inn: "7701234505" },
    { name: 'ООО «МеталлТорг»', inn: "7701234506" },
    { name: 'ООО «БетонСервис»', inn: "7701234507" },
    { name: 'ООО «ОконныеСистемы»', inn: "7701234508" },
  ];
  const contractors = [];
  for (const c of contractorDefs) {
    contractors.push(
      await prisma.contractor.upsert({
        where: { tenantId_inn: { tenantId: tenant.id, inn: c.inn } },
        update: { name: c.name, status: "ACTIVE" },
        create: { tenantId: tenant.id, ...c },
      }),
    );
  }

  async function ensureCategory(args: { name: string; code: string; sortOrder: number; parentId?: string }) {
    const existing = await prisma.workCategory.findFirst({
      where: { tenantId: tenant.id, code: args.code },
    });
    if (existing) return existing;
    return prisma.workCategory.create({ data: { tenantId: tenant.id, ...args } });
  }

  const catConstruct = await ensureCategory({ name: "Конструктив", code: "CONSTRUCT", sortOrder: 1 });
  const catFundament = await ensureCategory({ parentId: catConstruct.id, name: "Фундаменты", code: "FOUNDATION", sortOrder: 1 });
  const catOtdelka = await ensureCategory({ name: "Отделочные работы", code: "FINISH", sortOrder: 2 });
  const catInzh = await ensureCategory({ name: "Инженерные сети", code: "MEP", sortOrder: 4 });
  const catFasad = await ensureCategory({ name: "Фасады", code: "FACADE", sortOrder: 5 });

  const workTypeDefs = [
    { key: "rebar", categoryId: catFundament.id, name: "Армирование фундамента", unit: "т", requiresInspection: true, requiresExecutiveDocs: true, requiresMaterials: true },
    { key: "concrete", categoryId: catFundament.id, name: "Бетонирование фундамента", unit: "м³", requiresInspection: true, requiresExecutiveDocs: true, requiresMaterials: true },
    { key: "masonry", categoryId: catConstruct.id, name: "Кладка стен", unit: "м³", requiresInspection: true, requiresExecutiveDocs: true, requiresMaterials: true },
    { key: "plaster", categoryId: catOtdelka.id, name: "Штукатурка стен", unit: "м²", requiresInspection: false, requiresExecutiveDocs: true, requiresMaterials: false },
    { key: "putty", categoryId: catOtdelka.id, name: "Шпаклёвка стен", unit: "м²", requiresInspection: false, requiresExecutiveDocs: false, requiresMaterials: false },
    { key: "heating", categoryId: catInzh.id, name: "Разводка отопления", unit: "м.п.", requiresInspection: true, requiresExecutiveDocs: true, requiresMaterials: true },
    { key: "facade", categoryId: catFasad.id, name: "Вентфасад, облицовка", unit: "м²", requiresInspection: true, requiresExecutiveDocs: true, requiresMaterials: true },
  ];
  const workTypes: Record<string, { id: string; name: string; unit: string }> = {};
  for (const w of workTypeDefs) {
    const { key, ...workTypeData } = w;
    const existing = await prisma.workType.findFirst({
      where: { tenantId: tenant.id, categoryId: w.categoryId, name: w.name },
    });
    const created =
      existing ??
      (await prisma.workType.create({
        data: { tenantId: tenant.id, ...workTypeData },
      }));
    workTypes[key] = created;
  }

  type ObjDef = {
    name: string; code: string; address: string; org: string; pmIndex: number; contractorIdx: number[];
    startOffsetDays: number; durationDays: number; contractValue: number; scenario: "GREEN" | "YELLOW" | "RED" | "GRAY";
  };
  const objectDefs: ObjDef[] = [
    { name: 'ЖК «Северный парк», корпус 2', code: "ГПО-014", address: "г. Москва, ул. Полярная, вл. 12", org: 'ООО СЗ «Гор-Строй»', pmIndex: 0, contractorIdx: [0, 5, 6], startOffsetDays: -180, durationDays: 300, contractValue: 186_000_000, scenario: "GREEN" },
    { name: 'ЖК «Речной квартал», корпус 1', code: "ГПО-021", address: "г. Москва, Ершовская наб., 5", org: 'ООО СЗ «Гор-Строй»', pmIndex: 1, contractorIdx: [1, 3], startOffsetDays: -150, durationDays: 260, contractValue: 210_000_000, scenario: "YELLOW" },
    { name: "Офисный центр «Меридиан»", code: "СПО-118", address: "г. Москва, Пресненская наб., 8", org: 'ООО «РКС-НР»', pmIndex: 2, contractorIdx: [3, 2], startOffsetDays: -370, durationDays: 400, contractValue: 340_000_000, scenario: "RED" },
    { name: "Складской комплекс «Логопарк Юг»", code: "СПО-090", address: "Московская обл., Домодедово, Логистический пр-д, 2", org: 'ООО «РКС-НР»', pmIndex: 3, contractorIdx: [4, 5], startOffsetDays: -30, durationDays: 200, contractValue: 95_000_000, scenario: "GRAY" },
    { name: 'ЖК «Заречье», корпус 3', code: "ГПО-030", address: "г. Москва, ул. Заречная, вл. 9", org: 'ООО СЗ «Гор-Строй»', pmIndex: 4, contractorIdx: [0, 6], startOffsetDays: -90, durationDays: 240, contractValue: 170_000_000, scenario: "GREEN" },
    { name: "Бизнес-центр «Атлант»", code: "СПО-102", address: "г. Москва, Ленинградское ш., 45", org: 'ООО «РКС-НР»', pmIndex: 0, contractorIdx: [3, 7], startOffsetDays: -200, durationDays: 320, contractValue: 260_000_000, scenario: "YELLOW" },
    { name: 'ЖК «Южные врата», корпус 4', code: "ГПО-045", address: "г. Москва, Варшавское ш., 120", org: 'ООО СЗ «Гор-Строй»', pmIndex: 1, contractorIdx: [1, 0], startOffsetDays: -120, durationDays: 220, contractValue: 155_000_000, scenario: "RED" },
    { name: "Производственный корпус «Восток-3»", code: "СПО-077", address: "Московская обл., Ногинск, Промышленная ул., 14", org: 'ООО «РКС-НР»', pmIndex: 2, contractorIdx: [5, 4], startOffsetDays: -60, durationDays: 180, contractValue: 120_000_000, scenario: "GREEN" },
    { name: 'ЖК «Парковый квартал», корпус 1', code: "ГПО-052", address: "г. Москва, Ставропольская ул., 33", org: 'ООО СЗ «Гор-Строй»', pmIndex: 3, contractorIdx: [0, 2], startOffsetDays: -20, durationDays: 260, contractValue: 198_000_000, scenario: "GRAY" },
    { name: "Торговый центр «Галерея-Запад»", code: "СПО-133", address: "г. Москва, Кутузовский пр-т, 78", org: 'ООО «РКС-НР»', pmIndex: 4, contractorIdx: [3, 1], startOffsetDays: -280, durationDays: 360, contractValue: 410_000_000, scenario: "YELLOW" },
  ];

  const existingObjectCount = await prisma.constructionObject.count({ where: { tenantId: tenant.id } });
  if (existingObjectCount === objectDefs.length) {
    // eslint-disable-next-line no-console
    console.log(`Seed уже применён: найдено ${existingObjectCount} демо-объектов; повторный запуск пропущен.`);
    return;
  }
  if (existingObjectCount !== 0) {
    throw new Error(
      `Seed остановлен: найден частичный набор объектов (${existingObjectCount}/${objectDefs.length}). ` +
        "Очистите/восстановите TEST-данные вручную, чтобы не создавать дубли.",
    );
  }

  let totalWorks = 0;
  for (const o of objectDefs) {
    const startDate = addDays(TODAY, o.startOffsetDays);
    const finishDate = addDays(startDate, o.durationDays);
    const object = await prisma.constructionObject.create({
      data: {
        tenantId: tenant.id,
        externalCode: o.code,
        name: o.name,
        address: o.address,
        customerName: "Заказчик-застройщик",
        organizationName: o.org,
        projectManagerId: pmIds[o.pmIndex],
        startDate,
        plannedFinishDate: finishDate,
        contractValue: o.contractValue,
        status: "ACTIVE",
        healthStatus: "GRAY",
      },
    });
    for (const idx of o.contractorIdx) {
      await prisma.objectContractor.create({ data: { objectId: object.id, contractorId: contractors[idx].id, role: "Субподрядчик" } });
    }
    if (o.scenario === "GRAY") continue;

    const templates = [
      { key: "rebar", contractorIdx: o.contractorIdx[0], planned: 42 },
      { key: "concrete", contractorIdx: o.contractorIdx[0], planned: 210 },
      { key: "masonry", contractorIdx: o.contractorIdx[0], planned: 640 },
      { key: "plaster", contractorIdx: o.contractorIdx[1] ?? o.contractorIdx[0], planned: 3200 },
      { key: "putty", contractorIdx: o.contractorIdx[1] ?? o.contractorIdx[0], planned: 3200 },
      { key: "heating", contractorIdx: o.contractorIdx[1] ?? o.contractorIdx[0], planned: 860 },
      { key: "facade", contractorIdx: o.contractorIdx[1] ?? o.contractorIdx[0], planned: 4200 },
    ];
    const targetVariance = o.scenario === "GREEN" ? -2 : o.scenario === "YELLOW" ? -10 : -25;
    let worstStatus: ScheduleStatus = ScheduleStatus.ON_TRACK;
    let worstVariance = 0;
    let maxDelay = 0;

    for (let idx = 0; idx < templates.length; idx++) {
      const t = templates[idx];
      const wStart = addDays(startDate, idx * 12);
      const wFinish = addDays(wStart, 45);
      const plannedPct = ScheduleStatusService.plannedProgress({ plannedStartDate: wStart, plannedFinishDate: wFinish, today: TODAY });
      let actualPct = Math.max(0, Math.min(115, plannedPct + targetVariance));
      if (wStart > TODAY) actualPct = 0;
      const plannedQuantity = t.planned;
      const actualQuantity = Math.round(((plannedQuantity * actualPct) / 100) * 100) / 100;
      const progress = ProgressCalculationService.calculate({ plannedQuantity, actualQuantity });
      const sched = ScheduleStatusService.evaluate({ plannedStartDate: wStart, plannedFinishDate: wFinish, today: TODAY, actualProgressPercent: progress.progressPercent });
      const wt = workTypes[t.key];
      const estimatedCost = Math.round(plannedQuantity * (8000 + idx * 1500));
      const status = progress.progressPercent >= 100 ? "DONE" : progress.progressPercent > 0 ? "IN_PROGRESS" : "PLANNED";

      const work = await prisma.objectWork.create({
        data: {
          tenantId: tenant.id,
          objectId: object.id,
          workTypeId: wt.id,
          contractorId: contractors[t.contractorIdx].id,
          responsibleUserId: pmIds[o.pmIndex],
          name: `${wt.name} — уч. ${idx + 1}`,
          unit: wt.unit,
          plannedQuantity,
          actualQuantity,
          plannedStartDate: wStart,
          plannedFinishDate: wFinish,
          estimatedCost,
          status: status as any,
          progressPercent: progress.progressPercent,
          scheduleStatus: sched.scheduleStatus as any,
          varianceP: sched.varianceP,
          delayDays: sched.delayDays,
        },
      });
      totalWorks++;

      await prisma.workProgress.create({
        data: { tenantId: tenant.id, objectWorkId: work.id, quantityDelta: actualQuantity, totalQuantity: actualQuantity, progressPercent: progress.progressPercent, reportedBy: `РП ${userDefs[3 + o.pmIndex].name}`, reportedAt: addDays(TODAY, -2), comment: "Внесён факт при первичном заведении объекта" },
      });

      const order = [ScheduleStatus.ON_TRACK, ScheduleStatus.BEHIND, ScheduleStatus.CRITICAL];
      if (order.indexOf(sched.scheduleStatus) > order.indexOf(worstStatus)) {
        worstStatus = sched.scheduleStatus;
        worstVariance = sched.varianceP;
      }
      if (sched.delayDays > maxDelay) maxDelay = sched.delayDays;

      if (o.scenario === "RED" && idx === 0) {
        const inspection = await prisma.constructionInspection.create({
          data: { tenantId: tenant.id, objectId: object.id, objectWorkId: work.id, requestedById: pmIds[o.pmIndex], inspectorId: users[20], status: "ISSUES_FOUND", inspectionDate: addDays(TODAY, -6), decision: "Обнаружено критическое несоответствие" },
        });
        await prisma.inspectionIssue.create({
          data: { tenantId: tenant.id, inspectionId: inspection.id, title: "Несоответствие армирования проекту", description: "Шаг армирования не соответствует рабочей документации, требуется демонтаж и повтор", severity: "CRITICAL", responsibleUserId: pmIds[o.pmIndex], dueDate: addDays(TODAY, -3), status: "OPEN" },
        });
      }
      if (o.scenario === "YELLOW" && idx === 1) {
        const inspection = await prisma.constructionInspection.create({
          data: { tenantId: tenant.id, objectId: object.id, objectWorkId: work.id, requestedById: pmIds[o.pmIndex], inspectorId: users[21], status: "ISSUES_FOUND", inspectionDate: addDays(TODAY, -9), decision: "Незначительное отклонение" },
        });
        await prisma.inspectionIssue.create({
          data: { tenantId: tenant.id, inspectionId: inspection.id, title: "Недостаточный защитный слой", description: "Локальное отклонение по защитному слою бетона", severity: "MINOR", responsibleUserId: pmIds[o.pmIndex], dueDate: addDays(TODAY, -2), status: "OPEN" },
        });
      }
    }

    const criticalIssues = await prisma.inspectionIssue.count({ where: { tenantId: tenant.id, severity: "CRITICAL", status: { in: ["OPEN", "IN_PROGRESS"] }, inspection: { objectId: object.id } } });
    const overdueIssues = await prisma.inspectionIssue.count({ where: { tenantId: tenant.id, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: TODAY }, inspection: { objectId: object.id } } });

    const health = ObjectHealthService.calculate({
      hasWorks: true,
      lastProgressUpdateAt: addDays(TODAY, -2),
      today: TODAY,
      worstScheduleStatus: worstStatus,
      worstVarianceP: worstVariance,
      maxDelayDays: maxDelay,
      criticalOpenIssuesCount: criticalIssues,
      overdueIssuesCount: overdueIssues,
      blockedWorksCount: o.scenario === "RED" ? 1 : 0,
      ptoBacklogCount: 0,
      sdoBacklogCount: 0,
    });
    await prisma.constructionObject.update({ where: { id: object.id }, data: { healthStatus: health.status as any, healthReasons: health.reasons as any } });
  }

  // eslint-disable-next-line no-console
  console.log(`Seed завершён: ${objectDefs.length} объектов, ${contractorDefs.length} субподрядчиков, ${pmIds.length} РП, ${totalWorks} работ.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
