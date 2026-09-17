/**
 * critical-path.e2e-spec.ts — сквозной интеграционный тест ТЗ п.53 через
 * настоящий HTTP-слой NestJS + supertest, а не через прямые SQL-запросы
 * (в отличие от `verify/e2e.ts`, который проверяет то же самое через
 * `verify/db.ts`/raw psql потому что в песочнице разработки нет доступа к
 * npm registry — см. ниже "ЧЕСТНЫЙ СТАТУС").
 *
 * Сценарий (тот же самый, что и verify/e2e.ts, шаги 1-25 ТЗ п.53):
 *   создать объект -> назначить РП/субподрядчика -> добавить работу ->
 *   внести факт (2 раза, с проверкой план/факт-светофора) -> предъявить
 *   строительному контролю -> СК создаёт критическое замечание -> следующая
 *   работа блокируется технологической зависимостью -> РП устраняет
 *   замечание -> СК принимает работу -> зависимая работа разблокируется ->
 *   материалы заведены и привязаны -> ПТО формирует и подтверждает
 *   исполнительную документацию -> формируется пакет ИД ->
 *   PtoPackageValidationService пропускает пакет в СДО -> СДО осметивает ->
 *   финансовое закрытие -> AuditLog содержит полную историю.
 *
 * Дополнительно (то, что НЕ проверяется в verify/e2e.ts, потому что там нет
 * HTTP-слоя и `PermissionsGuard`): реальная проверка RBAC поверх HTTP —
 * пользователь без нужного permission получает 403 Forbidden на попытке
 * выполнить чужое по роли действие (РП пытается принять работу СК;
 * СК пытается объявить финансовое закрытие).
 *
 * ДОПОЛНЕНО в static hardening pass (эта итерация, шаги 1б/1в/2в/17б/25):
 *   1б — назначение субподрядчика на объект (POST /objects/:id/contractors)
 *        + фильтр объектов по ?contractorId=;
 *   1в — tenant isolation для назначения/удаления ObjectContractor (чужой
 *        tenantId получает 404, а не доступ/утечку);
 *   2в — создание работы с contractorId без предварительного назначения
 *        ObjectContractor отклоняется 400 с понятной ошибкой;
 *   17б — атомарность/идемпотентность передачи ПТО→СДО: повторная передача
 *        уже переданного пакета отклоняется, PtoTransfer реально записан
 *        (ранее мёртвая сущность), SdoCase не задваивается;
 *   25 — ObjectsService.recalculateHealth() реально считает
 *        ptoBacklogCount/sdoBacklogCount из PostgreSQL (раньше — всегда 0).
 *
 * ============================================================================
 * ЧЕСТНЫЙ СТАТУС (ТЗ п.7, 12): NOT VERIFIED — этот файл НЕ ЗАПУСКАЛСЯ.
 * ============================================================================
 * В этой песочнице разработки нет доступа к registry.npmjs.org (см. README
 * «Известные ограничения среды»), поэтому НЕ установлены ни @nestjs/testing,
 * ни jest, ни supertest, ни @prisma/client — соответственно `npm run
 * test:e2e` физически не может быть выполнен здесь. Файл написан вручную,
 * построчно сверен с реальными контроллерами/DTO/guard'ами из
 * `src/modules/**\/*.module.ts` (импорты, маршруты, тела запросов, коды
 * permission'ов — не выдуманы, а переписаны из реального кода), но
 * СИНТАКСИЧЕСКАЯ и РАНТАЙМ-корректность НЕ подтверждена компилятором/
 * тест-раннером. Эквивалентный сценарий бизнес-логики (те же 25 шагов)
 * РЕАЛЬНО выполнен и проходит через `verify/run.ts` против настоящего
 * PostgreSQL — см. docs/mvp-test-scenario.md и итоговый отчёт о проверке.
 * Как только появится доступ к npm registry:
 *   cd apps/backend && npm install && npm run test:e2e
 * и результат (pass/fail) должен быть внесён в отчёт вместо этой пометки.
 *
 * ДОПОЛНЕНО (integrity pass, 2026-09-15): второй describe в конце файла —
 * точечные сценарии для 5 дефектов целостности этой итерации (SdoCase 1:N,
 * tenant/object-проверки ПТО, guard ObjectContractor, реальное локальное
 * фотохранилище + endpoint отдачи файла, application_token). Тот же
 * ЧЕСТНЫЙ СТАТУС: NOT VERIFIED, не запускался.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { BitrixTokenService } from "../src/bitrix/bitrix-token.service";
import { decryptToken } from "../src/bitrix/crypto.util";

// AUTH_MODE=demo (по умолчанию) — тест намеренно работает через demo-заголовки
// X-Tenant-Id/X-Bitrix-User-Id, как и predусмотрено для локальной/CI среды
// без подключённого Bitrix24-портала (см. modules/auth/bitrix-auth.guard.ts).
process.env.AUTH_MODE = process.env.AUTH_MODE ?? "demo";
if (process.env.NODE_ENV === "production") {
  throw new Error("Этот e2e-тест нельзя запускать с NODE_ENV=production (demo-режим авторизации запрещён fail-closed guard'ом)");
}

describe("Критический путь ТЗ §53 (объект -> факт -> СК -> ПТО -> СДО -> закрытие)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Учётные данные тестовых пользователей — тот же набор ролей, что и в
  // verify/seed.ts, но заведены напрямую через Prisma (foundation-данные:
  // тенант/пользователи/справочник работ — вне периметра HTTP API теста,
  // ровно как и в verify/seed.ts, который заводит их напрямую в БД, а не
  // через несуществующий "создать тенанта" endpoint).
  let tenantId: string;
  const pm = { bitrixUserId: 100, name: "Ким Роман Сергеевич", role: "PROJECT_MANAGER" as const };
  const cc = { bitrixUserId: 200, name: "Орлова Татьяна Ивановна", role: "CONSTRUCTION_CONTROL" as const };
  const pto = { bitrixUserId: 300, name: "Волкова Елена Сергеевна", role: "PTO" as const };
  const sdo = { bitrixUserId: 400, name: "Белова Наталья Владимировна", role: "SDO" as const };

  let contractorId: string;
  let workTypeId: string;
  let workTypeNoDocsId: string; // работа без требования ИД/материалов — для проверки блокировки зависимости

  function asUser(user: { bitrixUserId: number }) {
    return { "X-Tenant-Id": tenantId, "X-Bitrix-User-Id": String(user.bitrixUserId) };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    // Реплицируем main.ts bootstrap 1:1 (ValidationPipe/globalPrefix) — иначе
    // тест проверяет не то поведение, которое реально отдаёт production-процесс.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix("api", { exclude: ["health", "ready"] });
    await app.init();

    prisma = app.get(PrismaService);

    // ---- Foundation-данные (тенант/пользователи/справочник) — напрямую через Prisma,
    // ---- аналогично verify/seed.ts, но здесь бизнес-сценарий дальше идёт через HTTP.
    const tenant = await prisma.tenant.create({
      data: { portal: "e2e-test.bitrix24.ru", memberId: `e2e-member-${Date.now()}`, name: "ООО «E2E Тест»" },
    });
    tenantId = tenant.id;
    await prisma.riskSettings.create({ data: { tenantId } });

    for (const u of [pm, cc, pto, sdo]) {
      await prisma.user.create({
        data: { tenantId, bitrixUserId: u.bitrixUserId, name: u.name, role: u.role, position: u.role, isActive: true },
      });
    }

    const contractor = await prisma.contractor.create({ data: { tenantId, name: "ООО «E2E СтройПодряд»", inn: "7799998888" } });
    contractorId = contractor.id;

    const category = await prisma.workCategory.create({ data: { tenantId, name: "Конструктив", code: "CONSTRUCT", sortOrder: 1 } });
    const workType = await prisma.workType.create({
      data: { tenantId, categoryId: category.id, name: "Армирование фундамента", unit: "т", requiresInspection: true, requiresExecutiveDocs: true, requiresMaterials: true },
    });
    workTypeId = workType.id;
    const workTypeNoDocs = await prisma.workType.create({
      data: { tenantId, categoryId: category.id, name: "Бетонирование", unit: "м³", requiresInspection: false, requiresExecutiveDocs: false, requiresMaterials: false },
    });
    workTypeNoDocsId = workTypeNoDocs.id;
  });

  afterAll(async () => {
    // Удаляем только то, что создал этот тест (по tenantId) — не трогаем
    // остальные данные в тестовой БД (напр. верифицированные через verify/).
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.financialClosing.deleteMany({ where: { tenantId } });
      await prisma.sdoCase.deleteMany({ where: { tenantId } });
      await prisma.ptoTransfer.deleteMany({ where: { package: { tenantId } },});
      await prisma.executiveDocumentPackageItem.deleteMany({ where: { package: { tenantId } } });
      await prisma.executiveDocumentPackage.deleteMany({ where: { tenantId } });
      await prisma.executiveDocument.deleteMany({ where: { tenantId } });
      await prisma.workMaterial.deleteMany({ where: { objectWork: { tenantId } } });
      await prisma.materialDocument.deleteMany({ where: { materialBatch: { tenantId } } });
      await prisma.materialBatch.deleteMany({ where: { tenantId } });
      await prisma.material.deleteMany({ where: { tenantId } });
      await prisma.inspectionIssue.deleteMany({ where: { tenantId } });
      await prisma.constructionInspection.deleteMany({ where: { tenantId } });
      await prisma.workDependency.deleteMany({ where: { predecessorWork: { tenantId } } });
      await prisma.workProgress.deleteMany({ where: { tenantId } });
      await prisma.objectWork.deleteMany({ where: { tenantId } });
      await prisma.workType.deleteMany({ where: { tenantId } });
      await prisma.workCategory.deleteMany({ where: { tenantId } });
      await prisma.objectContractor.deleteMany({ where: { object: { tenantId } } });
      await prisma.constructionObject.deleteMany({ where: { tenantId } });
      await prisma.contractor.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.riskSettings.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  let objectId: string;
  let workId: string;
  let blockedWorkId: string;
  let inspectionId: string;
  let issueId: string;
  let materialBatchId: string;
  let docAosrId: string;
  let docSchemeId: string;
  let packageId: string;
  let sdoCaseId: string;

  it("1. РП создаёт объект", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/objects")
      .set(asUser(pm))
      .send({ name: "ЖК «Тестовый», корпус 1", address: "г. Москва, ул. Тестовая, 1", contractValue: 10_000_000 })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe("PLANNED");
    objectId = res.body.id;
  });

  it("1б. РП назначает субподрядчика на объект (ObjectContractor) — ХАРДЕНИНГ-ФИКС: обязательная предпосылка для шага 2 (создание работы с contractorId), см. ObjectsService.assignContractor/WorksService.create", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/contractors`)
      .set(asUser(pm))
      .send({ contractorId, role: "субподрядчик" })
      .expect(201);
    expect(res.body.contractor.id).toBe(contractorId);
    expect(res.body.role).toBe("субподрядчик");

    const obj = await request(app.getHttpServer()).get(`/api/objects/${objectId}`).set(asUser(pm)).expect(200);
    expect(obj.body.contractors.some((c: any) => c.contractor.id === contractorId)).toBe(true);

    // Фильтр объектов по субподрядчику (ObjectsService.findAll ?contractorId=) —
    // до этого хардненинг-фикса на UI не было способа заполнить связь для
    // объектов, созданных не из seed-данных, поэтому фильтр физически не мог
    // сработать для реального созданного через UI/API объекта.
    const filtered = await request(app.getHttpServer()).get(`/api/objects?contractorId=${contractorId}`).set(asUser(pm)).expect(200);
    expect(filtered.body.some((o: any) => o.id === objectId)).toBe(true);

    const filteredOther = await request(app.getHttpServer()).get(`/api/objects?contractorId=00000000-0000-0000-0000-000000000000`).set(asUser(pm)).expect(200);
    expect(filteredOther.body.some((o: any) => o.id === objectId)).toBe(false);
  });

  it("1в. Назначение подрядчика на объект чужого тенанта / удаление связи чужим тенантом — 404 (tenant isolation)", async () => {
    const otherTenant = await prisma.tenant.create({ data: { portal: "e2e-other.bitrix24.ru", memberId: `e2e-other-member-${Date.now()}`, name: "ООО «Чужой Тенант»" } });
    const otherUser = await prisma.user.create({
      data: { tenantId: otherTenant.id, bitrixUserId: 900, name: "Чужой ПМ", role: "PROJECT_MANAGER", position: "PROJECT_MANAGER", isActive: true },
    });
    try {
      await request(app.getHttpServer())
        .post(`/api/objects/${objectId}/contractors`)
        .set({ "X-Tenant-Id": otherTenant.id, "X-Bitrix-User-Id": String(otherUser.bitrixUserId) })
        .send({ contractorId, role: "чужой" })
        .expect(404); // объект принадлежит другому tenantId — не найден, а не молча изменён

      await request(app.getHttpServer())
        .delete(`/api/objects/${objectId}/contractors/${contractorId}`)
        .set({ "X-Tenant-Id": otherTenant.id, "X-Bitrix-User-Id": String(otherUser.bitrixUserId) })
        .expect(404); // связь не может быть снята из чужого tenant — findFirst со scoping через object.tenantId не находит её
    } finally {
      await prisma.user.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    }
  });

  it("2. РП добавляет работу с плановым объёмом 20 т", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/works`)
      .set(asUser(pm))
      .send({
        workTypeId,
        contractorId,
        name: "Армирование фундамента Ф-1",
        unit: "т",
        plannedQuantity: 20,
        plannedStartDate: "2026-08-01",
        plannedFinishDate: "2026-09-10",
        estimatedCost: 900_000,
      })
      .expect(201);
    workId = res.body.id;
    expect(Number(res.body.plannedQuantity)).toBe(20);
  });

  it("2б. РП добавляет вторую (зависимую) работу — «Бетонирование»", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/works`)
      .set(asUser(pm))
      .send({
        workTypeId: workTypeNoDocsId,
        contractorId,
        name: "Бетонирование фундамента Ф-1",
        unit: "м³",
        plannedQuantity: 45,
        plannedStartDate: "2026-09-05",
        plannedFinishDate: "2026-09-20",
      })
      .expect(201);
    blockedWorkId = res.body.id;

    await request(app.getHttpServer())
      .post("/api/work-dependencies")
      .set(asUser(pm))
      .send({ predecessorWorkId: workId, successorWorkId: blockedWorkId, requiresAcceptance: true })
      .expect(201);

    const check = await request(app.getHttpServer()).get(`/api/works/${blockedWorkId}/start`).set(asUser(pm)).expect(200);
    expect(check.body.allowed).toBe(false);
  });

  it("2в. Создание работы с contractorId БЕЗ предварительного назначения ObjectContractor отклоняется — 400 с понятной ошибкой (ХАРДЕНИНГ-ФИКС)", async () => {
    const strangerContractor = await prisma.contractor.create({ data: { tenantId, name: "ООО «Непроверенный субподрядчик»", inn: "1112223330" } });
    const res = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/works`)
      .set(asUser(pm))
      .send({
        workTypeId: workTypeNoDocsId,
        contractorId: strangerContractor.id,
        name: "Работа с неназначенным подрядчиком",
        unit: "м³",
        plannedQuantity: 1,
        plannedStartDate: "2026-09-05",
        plannedFinishDate: "2026-09-06",
      })
      .expect(400);
    expect(res.body.message).toMatch(/не назначен/i);
    // Подрядчик tenant-scoped — очистится вместе с остальными contractor-строками в afterAll (deleteMany по tenantId).
  });

  it("3. РП вносит факт 10 т -> 50%", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/works/${workId}/progress`)
      .set(asUser(pm))
      .send({ actualQuantity: 10, comment: "Первая партия армирования" })
      .expect(201);
    expect(res.body.progress.progressPercent).toBe(50);
  });

  it("4. РП доводит факт до 100%", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/works/${workId}/progress`)
      .set(asUser(pm))
      .send({ actualQuantity: 20 })
      .expect(201);
    expect(res.body.progress.progressPercent).toBe(100);
  });

  it("5. РП предъявляет работу строительному контролю", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/inspections")
      .set(asUser(pm))
      .send({ objectWorkId: workId, comment: "Готово к приёмке" })
      .expect(201);
    inspectionId = res.body.id;
    expect(res.body.status).toBe("WAITING");
  });

  it("6. RBAC: РП не может принять работу СК напрямую (403)", async () => {
    await request(app.getHttpServer())
      .post(`/api/inspections/${inspectionId}/accept`)
      .set(asUser(pm))
      .send({ acceptedQuantity: 20 })
      .expect(403);
  });

  it("7. СК создаёт критическое замечание", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/inspections/${inspectionId}/issues`)
      .set(asUser(cc))
      .send({ title: "Несоответствие армирования проекту", description: "Шаг армирования не по РД", severity: "CRITICAL" })
      .expect(201);
    issueId = res.body.id;
    expect(res.body.status).toBe("OPEN");
  });

  it("8. Технологическая блокировка: «Бетонирование» по-прежнему заблокировано", async () => {
    const check = await request(app.getHttpServer()).get(`/api/works/${blockedWorkId}/start`).set(asUser(pm)).expect(200);
    expect(check.body.allowed).toBe(false);
  });

  it("9. RBAC: СК не может закрыть финансовое закрытие (нет SDO_CLOSE) — но до этого шага дела СДО ещё не существует, поэтому проверяем на уже известном закрытом маршруте finance-closings без permission", async () => {
    await request(app.getHttpServer()).get(`/api/financial-closings/objects/${objectId}`).set(asUser(cc)).expect(403);
  });

  it("10. РП устраняет замечание", async () => {
    const res = await request(app.getHttpServer()).post(`/api/inspections/issues/${issueId}/resolve`).set(asUser(pm)).expect(201);
    expect(res.body.status).toBe("READY_FOR_VERIFICATION");
  });

  it("11. СК принимает работу (объём 20 т)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/inspections/${inspectionId}/accept`)
      .set(asUser(cc))
      .send({ acceptedQuantity: 20, comment: "Принято после устранения замечания" })
      .expect(201);
    expect(res.body.updatedInspection.status).toBe("ACCEPTED");
    expect(Number(res.body.updatedWork.acceptedQuantity)).toBe(20);
  });

  it("12. «Бетонирование» разблокировано", async () => {
    const check = await request(app.getHttpServer()).get(`/api/works/${blockedWorkId}/start`).set(asUser(pm)).expect(200);
    expect(check.body.allowed).toBe(true);
  });

  it("13. ПТО заводит партию материала и привязывает к работе", async () => {
    const batch = await request(app.getHttpServer())
      .post("/api/materials/batches")
      .set(asUser(pto))
      .send({ materialName: "Арматура А500С 12мм", batchNumber: "E2E-BATCH-1", supplier: "ООО «МеталлТорг»", objectId })
      .expect(201);
    materialBatchId = batch.body.id;

    await request(app.getHttpServer())
      .post(`/api/materials/batches/${materialBatchId}/documents`)
      .set(asUser(pto))
      .send({ type: "CERTIFICATE", number: "СЕРТ-001" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/materials/link")
      .set(asUser(pto))
      .send({ objectWorkId: workId, materialBatchId, quantity: 20 })
      .expect(201);
  });

  it("14. ПТО формирует документы АОСР и Исполнительную схему (DRAFT)", async () => {
    const aosr = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/executive-documents`)
      .set(asUser(pto))
      .send({ objectWorkId: workId, type: "AOSR" })
      .expect(201);
    docAosrId = aosr.body.id;
    expect(aosr.body.status).toBe("DRAFT");

    const scheme = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/executive-documents`)
      .set(asUser(pto))
      .send({ objectWorkId: workId, type: "EXECUTIVE_SCHEME" })
      .expect(201);
    docSchemeId = scheme.body.id;
  });

  it("15. ПТО подтверждает оба документа (-> APPROVED, воронка продвигается)", async () => {
    await request(app.getHttpServer()).post(`/api/executive-documents/${docAosrId}/approve`).set(asUser(pto)).send({}).expect(201);
    await request(app.getHttpServer()).post(`/api/executive-documents/${docSchemeId}/approve`).set(asUser(pto)).send({}).expect(201);

    const work = await request(app.getHttpServer()).get(`/api/works/${workId}`).set(asUser(pto)).expect(200);
    expect(Number(work.body.executiveDocsReadyQuantity)).toBe(20);
  });

  it("16. ПТО формирует пакет ИД из обоих документов", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/executive-packages`)
      .set(asUser(pto))
      .send({ documentIds: [docAosrId, docSchemeId] })
      .expect(201);
    packageId = res.body.id;
    expect(res.body.status).toBe("DRAFT");
  });

  it("17. ПТО передаёт пакет в СДО (PtoPackageValidationService пропускает)", async () => {
    const res = await request(app.getHttpServer()).post(`/api/executive-packages/${packageId}/transfer-sdo`).set(asUser(pto)).expect(201);
    expect(res.body.status).toBe("TRANSFERRED_TO_SDO");

    const work = await request(app.getHttpServer()).get(`/api/works/${workId}`).set(asUser(pto)).expect(200);
    expect(Number(work.body.transferredToSdoQuantity)).toBe(20);
  });

  it("17б. Атомарность передачи ПТО→СДО: повторная передача уже переданного пакета отклоняется, и PtoTransfer реально записан в рамках транзакции (ХАРДЕНИНГ-ФИКС)", async () => {
    // Идемпотентность — прямое следствие того, что PtoTransfer.packageId @unique
    // теперь пишется ВНУТРИ той же транзакции, что и смена статуса пакета:
    // повторный вызов должен быть отклонён явной проверкой статуса, а не
    // упасть на сыром конфликте уникальности Prisma (P2002).
    await request(app.getHttpServer()).post(`/api/executive-packages/${packageId}/transfer-sdo`).set(asUser(pto)).expect(400);

    // Полный HTTP-сценарий не может искусственно оборвать транзакцию
    // посередине (это ограничение теста, не утверждение о нём) — но можно
    // подтвердить результат: что переход действительно был атомарным по
    // всем трём частям (статус пакета + SdoCase + funnel), включая
    // использование ранее мёртвой сущности PtoTransfer, которую эта же
    // транзакция обязана была создать ровно один раз.
    const transfer = await prisma.ptoTransfer.findUnique({ where: { packageId } });
    expect(transfer).not.toBeNull();
    expect(transfer!.tenantId).toBe(tenantId);
    expect(transfer!.transferredBy).toBe(pto.name);

    const sdoCasesForWork = await prisma.sdoCase.findMany({ where: { tenantId, objectWorkId: workId } });
    expect(sdoCasesForWork.length).toBe(1); // не задублировался при повторном (отклонённом) вызове

    const workAfter = await prisma.objectWork.findUnique({ where: { id: workId } });
    expect(Number(workAfter!.transferredToSdoQuantity)).toBe(20); // воронка не откатилась и не задвоилась
  });

  it("18. СДО находит дело, осметивает", async () => {
    const cases = await request(app.getHttpServer()).get(`/api/sdo/objects/${objectId}`).set(asUser(sdo)).expect(200);
    expect(cases.body.length).toBeGreaterThan(0);
    sdoCaseId = cases.body[0].id;

    const res = await request(app.getHttpServer())
      .post(`/api/sdo/${sdoCaseId}/calculate`)
      .set(asUser(sdo))
      .send({ calculatedValue: 902_700, comment: "Осмечено в Гранд-Смете вне системы" })
      .expect(201);
    expect(res.body.status).toBe("CALCULATED");
  });

  it("19. RBAC: ПТО не может закрыть финансовое закрытие (нет SDO_CLOSE) — 403", async () => {
    await request(app.getHttpServer())
      .post(`/api/sdo/${sdoCaseId}/close`)
      .set(asUser(pto))
      .send({ period: "2026-09", amount: 902_700 })
      .expect(403);
  });

  it("20. СДО формирует финансовое закрытие", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/sdo/${sdoCaseId}/close`)
      .set(asUser(sdo))
      .send({ period: "2026-09", amount: 902_700 })
      .expect(201);
    expect(Number(res.body.amount)).toBe(902_700);
  });

  it("21. Сводка по объекту пересчитана: потенциал закрытия обнулился по этой работе", async () => {
    const res = await request(app.getHttpServer()).get(`/api/financial-closings/objects/${objectId}/summary`).set(asUser(pm)).expect(200);
    expect(res.body.closedTotal).toBe(902_700);
  });

  it("22. AuditLog содержит полную историю по объекту и по работе", async () => {
    const objectAudit = await request(app.getHttpServer()).get(`/api/audit/ConstructionObject/${objectId}`).set(asUser(pm)).expect(200);
    expect(objectAudit.body.length).toBeGreaterThan(0);

    const workAudit = await request(app.getHttpServer()).get(`/api/audit/ObjectWork/${workId}`).set(asUser(pm)).expect(200);
    // Минимум: создание работы + 2 внесения факта + разблокировка зависимой работы.
    expect(workAudit.body.length).toBeGreaterThanOrEqual(3);

    const inspectionAudit = await request(app.getHttpServer()).get(`/api/audit/ConstructionInspection/${inspectionId}`).set(asUser(pm)).expect(200);
    expect(inspectionAudit.body.some((a: any) => /принят/i.test(a.action))).toBe(true);
  });

  it("23. Без заголовков идентификации — 401", async () => {
    await request(app.getHttpServer()).get(`/api/objects/${objectId}`).expect(401);
  });

  it("24. С чужим tenantId — объект не найден (изоляция тенантов)", async () => {
    await request(app.getHttpServer())
      .get(`/api/objects/${objectId}`)
      .set({ "X-Tenant-Id": "00000000-0000-0000-0000-000000000000", "X-Bitrix-User-Id": String(pm.bitrixUserId) })
      .expect(401); // пользователь с таким bitrixUserId не существует в чужом tenantId
  });

  it("25. Светофор реально реагирует на backlog ПТО/СДО (ptoBacklogCount/sdoBacklogCount больше не захардкожены нулями) — ХАРДЕНИНГ-ФИКС", async () => {
    // Свежий факт по существующей работе — чтобы не попасть в ранний
    // GRAY-выход ObjectHealthService.calculate() по staleProgressAfterDays
    // (используется тем же порогом, что и backlog-cutoff, см. комментарий
    // в ObjectsService.loadRiskThresholds/recalculateHealth).
    await request(app.getHttpServer())
      .post(`/api/works/${blockedWorkId}/progress`)
      .set(asUser(pm))
      .send({ actualQuantity: 1, comment: "Поддерживаем факт свежим для теста backlog" })
      .expect(201);

    // "Зависший" пакет ИД: создан, но НЕ передан в СДО (остаётся DRAFT) и
    // искусственно состарен за пределы staleProgressAfterDays (по умолчанию
    // в RiskSettings — 10 дней; см. apps/backend/prisma/seed.ts).
    const staleDoc = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/executive-documents`)
      .set(asUser(pto))
      .send({ objectWorkId: blockedWorkId, type: "AOSR" })
      .expect(201);
    const stalePackage = await request(app.getHttpServer())
      .post(`/api/objects/${objectId}/executive-packages`)
      .set(asUser(pto))
      .send({ documentIds: [staleDoc.body.id] })
      .expect(201);
    await prisma.executiveDocumentPackage.update({
      where: { id: stalePackage.body.id },
      data: { createdAt: new Date(Date.now() - 15 * 86_400_000) },
    });

    // "Зависшее" дело СДО: заведено напрямую (в реальном сценарии его
    // создаёт транзакция transferToSdo) со статусом, отличным от CLOSED, и
    // ptoTransferredAt за пределами порога — имитирует объём, который
    // застрял в СДО дольше настроечного порога.
    await prisma.sdoCase.create({
      data: {
        tenantId,
        objectId,
        objectWorkId: blockedWorkId,
        status: "TRANSFERRED",
        ptoTransferredAt: new Date(Date.now() - 20 * 86_400_000),
        ptoTransferredBy: pto.name,
      },
    });

    const health = await request(app.getHttpServer()).post(`/api/objects/${objectId}/recalculate-health`).set(asUser(pm)).expect(201);
    expect(health.body.status).not.toBe("GREEN");
    expect(health.body.status).not.toBe("GRAY");
    expect(health.body.reasons.some((r: string) => /ПТО/.test(r))).toBe(true);
    expect(health.body.reasons.some((r: string) => /СДО/.test(r))).toBe(true);
  });
});

/**
 * ============================================================================
 * ИНТЕГРИТИ-ФИКС (integrity pass, 2026-09-15) — точечные E2E-сценарии для
 * пяти дефектов целостности из этой итерации (см. п.1-5 инструкции). Это НЕ
 * расширение продукта — отдельный describe с собственным tenant/данными,
 * изолированный от основного критического пути выше, чтобы не менять и не
 * рисковать сломать уже написанные assertions основного сценария.
 *
 * ЧЕСТНЫЙ СТАТУС — тот же, что и для всего файла (см. комментарий в начале
 * файла): NOT VERIFIED, этот блок НЕ ЗАПУСКАЛСЯ (нет доступа к npm registry
 * в этой песочнице). Написан вручную, построчно сверен с реальным кодом
 * PtoService/ObjectsService/InspectionsService/BitrixTokenService/
 * BitrixInstallController после их правки в этой итерации.
 * ============================================================================
 */
describe("ИНТЕГРИТИ-ФИКС (integrity pass): SdoCase 1:N, tenant/object-целостность ПТО, guard ObjectContractor, реальное фотохранилище, application_token", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;

  const pm = { bitrixUserId: 1100, name: "Ким Интегрити П.М.", role: "PROJECT_MANAGER" as const };
  const cc = { bitrixUserId: 1200, name: "Орлова Интегрити С.К.", role: "CONSTRUCTION_CONTROL" as const };
  const pto = { bitrixUserId: 1300, name: "Волкова Интегрити ПТО", role: "PTO" as const };

  function asUser(user: { bitrixUserId: number }) {
    return { "X-Tenant-Id": tenantId, "X-Bitrix-User-Id": String(user.bitrixUserId) };
  }

  let contractorId: string;
  let workTypeId: string; // requiresExecutiveDocs=true, requiresMaterials=false — упрощает сценарий п.1 (не нужно заводить материалы для двух работ)

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix("api", { exclude: ["health", "ready"] });
    await app.init();
    prisma = app.get(PrismaService);

    const tenant = await prisma.tenant.create({
      data: { portal: "e2e-integrity.bitrix24.ru", memberId: `e2e-integrity-member-${Date.now()}`, name: "ООО «Интегрити Тест»" },
    });
    tenantId = tenant.id;
    await prisma.riskSettings.create({ data: { tenantId } });

    for (const u of [pm, cc, pto]) {
      await prisma.user.create({ data: { tenantId, bitrixUserId: u.bitrixUserId, name: u.name, role: u.role, position: u.role, isActive: true } });
    }

    const contractor = await prisma.contractor.create({ data: { tenantId, name: "ООО «Интегрити Подряд»", inn: "5544332211" } });
    contractorId = contractor.id;

    const category = await prisma.workCategory.create({ data: { tenantId, name: "Категория Интегрити", code: "INTEGRITY", sortOrder: 1 } });
    const workType = await prisma.workType.create({
      data: { tenantId, categoryId: category.id, name: "Работа с ИД (интегрити)", unit: "шт", requiresInspection: false, requiresExecutiveDocs: true, requiresMaterials: false },
    });
    workTypeId = workType.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.bitrixInstallation.deleteMany({ where: { tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.ptoTransfer.deleteMany({ where: { tenantId } });
      await prisma.sdoCase.deleteMany({ where: { tenantId } });
      await prisma.executiveDocumentPackageItem.deleteMany({ where: { package: { tenantId } } });
      await prisma.executiveDocumentPackage.deleteMany({ where: { tenantId } });
      await prisma.executiveDocument.deleteMany({ where: { tenantId } });
      await prisma.inspectionPhoto.deleteMany({ where: { tenantId } });
      await prisma.inspectionIssue.deleteMany({ where: { tenantId } });
      await prisma.constructionInspection.deleteMany({ where: { tenantId } });
      await prisma.workProgress.deleteMany({ where: { tenantId } });
      await prisma.objectWork.deleteMany({ where: { tenantId } });
      await prisma.workType.deleteMany({ where: { tenantId } });
      await prisma.workCategory.deleteMany({ where: { tenantId } });
      await prisma.objectContractor.deleteMany({ where: { object: { tenantId } } });
      await prisma.constructionObject.deleteMany({ where: { tenantId } });
      await prisma.contractor.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.riskSettings.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  // ==========================================================================
  // п.1 — ExecutiveDocumentPackage -> SdoCase теперь 1:N (schema.prisma +
  // миграция 20260915080000... нет, 20260915070000_sdo_case_one_to_many).
  // Один пакет с APPROVED-документами по ДВУМ разным работам -> transfer-sdo
  // должен создать ДВА SdoCase (а не упасть на старом одиночном @unique),
  // ОДИН PtoTransfer на пакет, и обе работы должны получить корректный
  // transferredToSdoQuantity.
  // ==========================================================================
  let sharedObjectId: string;
  let workIdA: string;
  let workIdB: string;

  it("п.1: пакет ИД с документами по ДВУМ работам -> transfer-sdo создаёт ДВА SdoCase и ОДИН PtoTransfer", async () => {
    const obj = await request(app.getHttpServer())
      .post("/api/objects")
      .set(asUser(pm))
      .send({ name: "Объект для проверки п.1 (SdoCase 1:N)", address: "г. Москва, ул. Интегрити, 1", contractValue: 1_000_000 })
      .expect(201);
    sharedObjectId = obj.body.id;

    await request(app.getHttpServer()).post(`/api/objects/${sharedObjectId}/contractors`).set(asUser(pm)).send({ contractorId, role: "субподрядчик" }).expect(201);

    const workA = await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/works`)
      .set(asUser(pm))
      .send({ workTypeId, contractorId, name: "Работа A (п.1)", unit: "шт", plannedQuantity: 5, plannedStartDate: "2026-09-01", plannedFinishDate: "2026-09-10" })
      .expect(201);
    workIdA = workA.body.id;

    const workB = await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/works`)
      .set(asUser(pm))
      .send({ workTypeId, contractorId, name: "Работа B (п.1)", unit: "шт", plannedQuantity: 5, plannedStartDate: "2026-09-01", plannedFinishDate: "2026-09-10" })
      .expect(201);
    workIdB = workB.body.id;

    // Факт + приёмка для обеих работ — чтобы transferredToSdoQuantity после
    // передачи в СДО отражал реальный принятый объём, а не 0.
    for (const wId of [workIdA, workIdB]) {
      await request(app.getHttpServer()).post(`/api/works/${wId}/progress`).set(asUser(pm)).send({ actualQuantity: 5 }).expect(201);
      const insp = await request(app.getHttpServer()).post("/api/inspections").set(asUser(pm)).send({ objectWorkId: wId }).expect(201);
      await request(app.getHttpServer()).post(`/api/inspections/${insp.body.id}/accept`).set(asUser(cc)).send({ acceptedQuantity: 5 }).expect(201);
    }

    // По документу АОСР на каждую работу, оба подтверждены ПТО.
    const docA = await request(app.getHttpServer()).post(`/api/objects/${sharedObjectId}/executive-documents`).set(asUser(pto)).send({ objectWorkId: workIdA, type: "AOSR" }).expect(201);
    const docB = await request(app.getHttpServer()).post(`/api/objects/${sharedObjectId}/executive-documents`).set(asUser(pto)).send({ objectWorkId: workIdB, type: "AOSR" }).expect(201);
    await request(app.getHttpServer()).post(`/api/executive-documents/${docA.body.id}/approve`).set(asUser(pto)).send({}).expect(201);
    await request(app.getHttpServer()).post(`/api/executive-documents/${docB.body.id}/approve`).set(asUser(pto)).send({}).expect(201);

    // Один пакет из ОБОИХ документов, покрывающих ДВЕ разные работы —
    // именно это раньше падало бы на UNIQUE(SdoCase.executiveDocumentPackageId)
    // при попытке создать второй SdoCase для того же пакета.
    const pkg = await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/executive-packages`)
      .set(asUser(pto))
      .send({ documentIds: [docA.body.id, docB.body.id] })
      .expect(201);
    const packageId = pkg.body.id;

    const transfer = await request(app.getHttpServer()).post(`/api/executive-packages/${packageId}/transfer-sdo`).set(asUser(pto)).expect(201);
    expect(transfer.body.status).toBe("TRANSFERRED_TO_SDO");

    const sdoCases = await prisma.sdoCase.findMany({ where: { tenantId, executiveDocumentPackageId: packageId } });
    expect(sdoCases.length).toBe(2);
    expect(new Set(sdoCases.map((c) => c.objectWorkId))).toEqual(new Set([workIdA, workIdB]));

    const transfers = await prisma.ptoTransfer.findMany({ where: { tenantId, packageId } });
    expect(transfers.length).toBe(1);

    const wA = await request(app.getHttpServer()).get(`/api/works/${workIdA}`).set(asUser(pto)).expect(200);
    const wB = await request(app.getHttpServer()).get(`/api/works/${workIdB}`).set(asUser(pto)).expect(200);
    expect(Number(wA.body.transferredToSdoQuantity)).toBe(5);
    expect(Number(wB.body.transferredToSdoQuantity)).toBe(5);
  });

  // ==========================================================================
  // п.3 — снятие ObjectContractor блокируется 409, если на объекте есть
  // работы с этим contractorId (переиспользуем объект/работы из п.1: у
  // sharedObjectId уже есть workIdA/workIdB с этим contractorId).
  // ==========================================================================
  it("п.3: снятие подрядчика с объекта, у которого есть работы с этим contractorId, — 409", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/objects/${sharedObjectId}/contractors/${contractorId}`)
      .set(asUser(pm))
      .expect(409);
    expect(res.body.message).toMatch(/Нельзя снять подрядчика/i);

    // Связь физически не удалена — подтверждаем напрямую в БД.
    const stillLinked = await prisma.objectContractor.findFirst({ where: { objectId: sharedObjectId, contractorId } });
    expect(stillLinked).not.toBeNull();
  });

  it("п.3б: снятие подрядчика с объекта БЕЗ ссылающихся работ — проходит успешно (контрольный положительный случай)", async () => {
    const obj = await request(app.getHttpServer())
      .post("/api/objects")
      .set(asUser(pm))
      .send({ name: "Объект без работ у подрядчика (п.3б)", address: "г. Москва, ул. Интегрити, 2" })
      .expect(201);
    const emptyObjectId = obj.body.id;

    await request(app.getHttpServer()).post(`/api/objects/${emptyObjectId}/contractors`).set(asUser(pm)).send({ contractorId, role: "субподрядчик" }).expect(201);

    await request(app.getHttpServer()).delete(`/api/objects/${emptyObjectId}/contractors/${contractorId}`).set(asUser(pm)).expect(200);

    const stillLinked = await prisma.objectContractor.findFirst({ where: { objectId: emptyObjectId, contractorId } });
    expect(stillLinked).toBeNull();
  });

  // ==========================================================================
  // п.2 — tenant/object-целостность ПТО: createDocument/createPackage.
  // ==========================================================================
  it("п.2а: создание документа ИД с objectWorkId от ДРУГОГО объекта того же tenant — 400", async () => {
    const otherObj = await request(app.getHttpServer())
      .post("/api/objects")
      .set(asUser(pm))
      .send({ name: "Другой объект (п.2а)", address: "г. Москва, ул. Интегрити, 3" })
      .expect(201);
    const otherObjectId = otherObj.body.id;
    await request(app.getHttpServer()).post(`/api/objects/${otherObjectId}/contractors`).set(asUser(pm)).send({ contractorId, role: "субподрядчик" }).expect(201);
    const otherWork = await request(app.getHttpServer())
      .post(`/api/objects/${otherObjectId}/works`)
      .set(asUser(pm))
      .send({ workTypeId, contractorId, name: "Работа на другом объекте (п.2а)", unit: "шт", plannedQuantity: 1, plannedStartDate: "2026-09-01", plannedFinishDate: "2026-09-02" })
      .expect(201);

    // objectWorkId принадлежит otherObjectId, а в URL — sharedObjectId.
    const res = await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/executive-documents`)
      .set(asUser(pto))
      .send({ objectWorkId: otherWork.body.id, type: "AOSR" })
      .expect(400);
    expect(res.body.message).toMatch(/другому объекту/i);
  });

  it("п.2б: пакет из документа ДРУГОГО объекта того же tenant — 400", async () => {
    // Документ, реально принадлежащий objectId из п.1 (sharedObjectId), и
    // отдельный документ на другом объекте того же tenant — пробуем собрать
    // пакет ПОД sharedObjectId, подмешав чужой (для sharedObjectId) документ.
    const otherObj = await request(app.getHttpServer())
      .post("/api/objects")
      .set(asUser(pm))
      .send({ name: "Другой объект (п.2б)", address: "г. Москва, ул. Интегрити, 4" })
      .expect(201);
    const otherObjectId = otherObj.body.id;
    await request(app.getHttpServer()).post(`/api/objects/${otherObjectId}/contractors`).set(asUser(pm)).send({ contractorId, role: "субподрядчик" }).expect(201);
    const otherWork = await request(app.getHttpServer())
      .post(`/api/objects/${otherObjectId}/works`)
      .set(asUser(pm))
      .send({ workTypeId, contractorId, name: "Работа на другом объекте (п.2б)", unit: "шт", plannedQuantity: 1, plannedStartDate: "2026-09-01", plannedFinishDate: "2026-09-02" })
      .expect(201);
    const otherDoc = await request(app.getHttpServer())
      .post(`/api/objects/${otherObjectId}/executive-documents`)
      .set(asUser(pto))
      .send({ objectWorkId: otherWork.body.id, type: "AOSR" })
      .expect(201);

    const ownDoc = await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/executive-documents`)
      .set(asUser(pto))
      .send({ objectWorkId: workIdA, type: "CERTIFICATE" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/executive-packages`)
      .set(asUser(pto))
      .send({ documentIds: [ownDoc.body.id, otherDoc.body.id] })
      .expect(400);
    expect(res.body.message).toMatch(/другому объекту/i);

    // Ни пакет, ни его items не должны были создаться.
    const packages = await prisma.executiveDocumentPackage.findMany({ where: { tenantId, objectId: sharedObjectId } });
    // К этому моменту в БД уже есть ровно один пакет — созданный и успешно
    // переданный в СДО в тесте п.1; отклонённая попытка не должна была
    // добавить ещё один.
    expect(packages.length).toBe(1);
  });

  it("п.2в: пакет из документа ДРУГОГО tenant — 400", async () => {
    const otherTenant = await prisma.tenant.create({
      data: { portal: "e2e-other-integrity.bitrix24.ru", memberId: `e2e-other-integrity-member-${Date.now()}`, name: "ООО «Чужой Тенант (интегрити)»" },
    });
    try {
      const otherUser = await prisma.user.create({
        data: { tenantId: otherTenant.id, bitrixUserId: 1900, name: "Чужой ПТО", role: "PTO", position: "PTO", isActive: true },
      });
      const otherContractor = await prisma.contractor.create({ data: { tenantId: otherTenant.id, name: "ООО «Чужой Подряд»", inn: "1231231231" } });
      const otherCategory = await prisma.workCategory.create({ data: { tenantId: otherTenant.id, name: "Категория чужая", code: "OTHERCAT", sortOrder: 1 } });
      const otherWorkType = await prisma.workType.create({
        data: { tenantId: otherTenant.id, categoryId: otherCategory.id, name: "Чужая работа", unit: "шт", requiresInspection: false, requiresExecutiveDocs: true, requiresMaterials: false },
      });
      const otherObject = await prisma.constructionObject.create({ data: { tenantId: otherTenant.id, name: "Чужой объект", address: "где-то", status: "PLANNED" } });
      const otherWork = await prisma.objectWork.create({
        data: {
          tenantId: otherTenant.id,
          objectId: otherObject.id,
          workTypeId: otherWorkType.id,
          contractorId: otherContractor.id,
          name: "Чужая работа (объект)",
          unit: "шт",
          plannedQuantity: 1,
          plannedStartDate: new Date("2026-09-01"),
          plannedFinishDate: new Date("2026-09-02"),
        },
      });
      const otherDoc = await prisma.executiveDocument.create({
        data: { tenantId: otherTenant.id, objectId: otherObject.id, objectWorkId: otherWork.id, type: "AOSR", status: "DRAFT", createdBy: otherUser.name },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/objects/${sharedObjectId}/executive-packages`)
        .set(asUser(pto))
        .send({ documentIds: [otherDoc.id] })
        .expect(400);
      expect(res.body.message).toMatch(/другому tenant/i);
    } finally {
      await prisma.executiveDocument.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.objectWork.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.workType.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.workCategory.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.constructionObject.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.contractor.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.user.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    }
  });

  it("п.2г: пустой пакет (documentIds: []) отклоняется на уровне ValidationPipe — 400", async () => {
    await request(app.getHttpServer())
      .post(`/api/objects/${sharedObjectId}/executive-packages`)
      .set(asUser(pto))
      .send({ documentIds: [] })
      .expect(400);
  });

  // ==========================================================================
  // п.4 — MockFileStorageProvider: реальное локальное demo-хранилище на
  // диске + endpoint для получения содержимого обратно (не только имя файла).
  // ==========================================================================
  it("п.4: загрузка фото инспекции реально сохраняет байты и возвращает их обратно по GET .../file", async () => {
    const insp = await request(app.getHttpServer()).post("/api/inspections").set(asUser(pm)).send({ objectWorkId: workIdA, comment: "Фото для п.4" }).expect(201);
    const inspectionId = insp.body.id;

    // 1x1 прозрачный PNG — маленький, но настоящий валидный PNG.
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const expectedBytes = Buffer.from(pngBase64, "base64");

    // Имя файла нарочно похоже на попытку path traversal — по дизайну
    // (safeSegment/safeExtension в MockFileStorageProvider) оно НИКОГДА не
    // используется как часть пути на диске, только как метаданные, поэтому
    // upload/download обязаны отработать штатно, не потеряв и не подменив
    // содержимое.
    const upload = await request(app.getHttpServer())
      .post(`/api/inspections/${inspectionId}/photos`)
      .set(asUser(cc))
      .send({ fileName: "../../../etc/passwd.png", contentBase64: pngBase64 })
      .expect(201);
    const photoId = upload.body.id;
    expect(upload.body.fileProvider).toBe("LOCAL"); // нет ACTIVE BitrixInstallation для tenantId -> MockFileStorageProvider

    const list = await request(app.getHttpServer()).get(`/api/inspections/${inspectionId}/photos`).set(asUser(pm)).expect(200);
    expect(list.body.some((p: any) => p.id === photoId)).toBe(true);

    const file = await request(app.getHttpServer()).get(`/api/inspections/photos/${photoId}/file`).set(asUser(pm)).expect(200);
    expect(file.headers["content-type"]).toMatch(/^image\/png/);
    expect(Buffer.compare(Buffer.from(file.body), expectedBytes)).toBe(0); // реальные байты, не просто имя файла

    // Tenant isolation: чужой tenant не может получить этот файл по id, даже зная его.
    const otherTenant = await prisma.tenant.create({
      data: { portal: "e2e-photo-other.bitrix24.ru", memberId: `e2e-photo-other-member-${Date.now()}`, name: "ООО «Чужой для фото»" },
    });
    try {
      const otherUser = await prisma.user.create({
        data: { tenantId: otherTenant.id, bitrixUserId: 1950, name: "Чужой наблюдатель", role: "PROJECT_MANAGER", position: "PROJECT_MANAGER", isActive: true },
      });
      await request(app.getHttpServer())
        .get(`/api/inspections/photos/${photoId}/file`)
        .set({ "X-Tenant-Id": otherTenant.id, "X-Bitrix-User-Id": String(otherUser.bitrixUserId) })
        .expect(404);
    } finally {
      await prisma.user.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    }

    // Несуществующий photoId — 404, не 500.
    await request(app.getHttpServer()).get(`/api/inspections/photos/00000000-0000-0000-0000-000000000000/file`).set(asUser(pm)).expect(404);
  });

  // ==========================================================================
  // п.5 — Bitrix24 application_token: сохранение на ONAPPINSTALL + сверка
  // через BitrixTokenService.verifyApplicationToken() (member_id +
  // application_token, timing-safe). Нет отдельного HTTP event-хендлера
  // помимо ONAPPINSTALL (инструкция не просила его добавлять — "не добавляй
  // новых возможностей"), поэтому сверка проверяется напрямую через
  // сервис, разрешённый из реального Nest DI контейнера (app.get), а не
  // придуманным HTTP-роутом.
  // ==========================================================================
  it("п.5: ONAPPINSTALL сохраняет application_token (зашифрованным), verifyApplicationToken() сверяет его timing-safe для последующих вызовов", async () => {
    const prevFlag = process.env.BITRIX_INSTALL_ENABLED;
    process.env.BITRIX_INSTALL_ENABLED = "true";
    try {
      const memberId = randomBytes(16).toString("hex"); // 32 hex-символа, как того требует MEMBER_ID_RE
      const applicationToken = randomBytes(24).toString("hex");
      const payload = {
        auth: {
          domain: "e2e-apptoken.bitrix24.ru",
          member_id: memberId,
          access_token: `access-${randomBytes(16).toString("hex")}`,
          refresh_token: `refresh-${randomBytes(16).toString("hex")}`,
          application_token: applicationToken,
          expires_in: 3600,
          scope: "user,department,placement,task,im,disk",
        },
      };

      const res = await request(app.getHttpServer()).post("/api/bitrix/install").send(payload).expect(200);
      expect(res.body.result).toBe(true);

      const installation = await prisma.bitrixInstallation.findFirst({ where: { memberId } });
      expect(installation).not.toBeNull();
      expect(installation!.encryptedApplicationToken).toBeTruthy();
      // Сохранённое значение реально зашифровано (не хранится в открытом виде),
      // но расшифровывается обратно в исходный application_token.
      expect(installation!.encryptedApplicationToken).not.toBe(applicationToken);
      expect(decryptToken(installation!.encryptedApplicationToken!)).toBe(applicationToken);

      const tokenService = app.get(BitrixTokenService);
      await expect(tokenService.verifyApplicationToken(memberId, applicationToken)).resolves.toBe(true);
      await expect(tokenService.verifyApplicationToken(memberId, "подделанный-токен")).resolves.toBe(false);
      await expect(tokenService.verifyApplicationToken(memberId, undefined)).resolves.toBe(false);
      await expect(tokenService.verifyApplicationToken("00000000000000000000000000000000", applicationToken)).resolves.toBe(false);
    } finally {
      process.env.BITRIX_INSTALL_ENABLED = prevFlag;
    }
  });

  it("п.5б: ONAPPINSTALL по умолчанию (BITRIX_INSTALL_ENABLED не 'true') остаётся fail-closed и ничего не пишет в БД", async () => {
    const prevFlag = process.env.BITRIX_INSTALL_ENABLED;
    delete process.env.BITRIX_INSTALL_ENABLED;
    try {
      const memberId = randomBytes(16).toString("hex");
      const res = await request(app.getHttpServer())
        .post("/api/bitrix/install")
        .send({
          auth: {
            domain: "e2e-apptoken-disabled.bitrix24.ru",
            member_id: memberId,
            access_token: `access-${randomBytes(16).toString("hex")}`,
            refresh_token: `refresh-${randomBytes(16).toString("hex")}`,
            application_token: randomBytes(24).toString("hex"),
            expires_in: 3600,
          },
        })
        .expect(200);
      expect(res.body.result).toBe(false);
      const installation = await prisma.bitrixInstallation.findFirst({ where: { memberId } });
      expect(installation).toBeNull();
    } finally {
      process.env.BITRIX_INSTALL_ENABLED = prevFlag;
    }
  });
});
