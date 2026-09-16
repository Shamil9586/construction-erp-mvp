import { Module, Injectable, Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, NotFoundException, ConflictException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsString, IsOptional, IsDateString, IsNumber, IsIn, IsUUID } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { Permission, ObjectHealthService, ScheduleStatusService, HealthStatus, ScheduleStatus, RiskThresholds, DEFAULT_RISK_THRESHOLDS } from "@construction-erp/domain";

export class CreateObjectDto {
  @IsOptional() @IsString() externalCode?: string;
  @IsString() name!: string;
  @IsString() address!: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() organizationName?: string;
  @IsOptional() @IsUUID() projectManagerId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() plannedFinishDate?: string;
  @IsOptional() @IsNumber() contractValue?: number;
}

export class UpdateObjectDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsUUID() projectManagerId?: string;
  @IsOptional() @IsDateString() plannedFinishDate?: string;
  @IsOptional() @IsIn(["PLANNED", "ACTIVE", "AT_RISK", "DELAYED", "SUSPENDED", "COMPLETED", "ARCHIVED"]) status?: string;
  @IsNumber() version!: number; // optimistic concurrency (ТЗ п.48)
}

/**
 * Назначение субподрядчика/контрагента объекту (ТЗ — связь «Объект ↔
 * Субподрядчик» через ObjectContractor). ХАРДЕНИНГ-ФИКС (эта итерация):
 * раньше модель ObjectContractor существовала в схеме, но не было ни
 * одного backend endpoint для её заполнения — назначения существовали
 * только в seed-данных. role — свободная строка (генподрядчик /
 * субподрядчик / поставщик и т.п.), намеренно не enum: реальный список
 * ролей участия подрядчиков нигде в ТЗ не зафиксирован как закрытый.
 */
export class AssignContractorDto {
  @IsUUID() contractorId!: string;
  @IsOptional() @IsString() role?: string;
}

/**
 * ObjectsService — ConstructionObject CRUD + пересчёт healthStatus
 * (ObjectHealthService — реальный вызов domain-сервиса, не заглушка).
 */
@Injectable()
export class ObjectsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  findAll(tenantId: string, filters: { status?: string; healthStatus?: string; contractorId?: string }) {
    return this.prisma.constructionObject.findMany({
      where: {
        tenantId,
        status: filters.status as any,
        healthStatus: filters.healthStatus as any,
        ...(filters.contractorId ? { contractors: { some: { contractorId: filters.contractorId } } } : {}),
      },
      include: { projectManager: { select: { id: true, name: true } }, contractors: { include: { contractor: true } } },
      orderBy: { name: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const object = await this.prisma.constructionObject.findFirst({
      where: { id, tenantId },
      include: {
        projectManager: { select: { id: true, name: true } },
        contractors: { include: { contractor: true } },
        works: { include: { workType: true, contractor: true, responsibleUser: { select: { name: true } } } },
      },
    });
    if (!object) throw new NotFoundException("Объект не найден");
    return object;
  }

  async create(tenantId: string, user: AuthenticatedUser, dto: CreateObjectDto) {
    const object = await this.prisma.constructionObject.create({
      data: {
        tenantId,
        externalCode: dto.externalCode,
        name: dto.name,
        address: dto.address,
        customerName: dto.customerName,
        organizationName: dto.organizationName,
        projectManagerId: dto.projectManagerId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        plannedFinishDate: dto.plannedFinishDate ? new Date(dto.plannedFinishDate) : undefined,
        contractValue: dto.contractValue,
        status: "PLANNED",
        healthStatus: "GRAY",
      },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ConstructionObject", entityId: object.id, action: `Создан объект «${object.name}»`, newValue: dto });
    return object;
  }

  async update(tenantId: string, user: AuthenticatedUser, id: string, dto: UpdateObjectDto) {
    const existing = await this.prisma.constructionObject.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Объект не найден");
    if (existing.version !== dto.version) {
      throw new ConflictException("Объект был изменён другим пользователем — обновите страницу (optimistic concurrency, ТЗ п.48)");
    }
    const updated = await this.prisma.constructionObject.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        projectManagerId: dto.projectManagerId,
        plannedFinishDate: dto.plannedFinishDate ? new Date(dto.plannedFinishDate) : undefined,
        status: dto.status as any,
        version: { increment: 1 },
      },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ConstructionObject", entityId: id, action: "Изменён объект", oldValue: existing, newValue: updated });
    return updated;
  }

  /**
   * Назначить субподрядчика объекту (создать/обновить ObjectContractor).
   * ХАРДЕНИНГ-ФИКС (эта итерация): единственный способ заполнить эту связь
   * раньше был прямой INSERT в seed-скрипте — через UI/API не было способа
   * назначить субподрядчика на объект, созданный вручную. ObjectContractor
   * не имеет собственного tenantId — принадлежность тенанту проверяется
   * через явные tenant-scoped выборки object/contractor ДО записи связи,
   * а не через сам upsert. upsert (не create) выбран намеренно: повторное
   * "назначение" уже привязанного подрядчика не должно падать конфликтом
   * уникальности — оно просто обновляет role.
   */
  async assignContractor(tenantId: string, user: AuthenticatedUser, objectId: string, dto: AssignContractorDto) {
    const object = await this.prisma.constructionObject.findFirst({ where: { id: objectId, tenantId } });
    if (!object) throw new NotFoundException("Объект не найден");
    const contractor = await this.prisma.contractor.findFirst({ where: { id: dto.contractorId, tenantId } });
    if (!contractor) throw new NotFoundException("Подрядчик не найден");

    const link = await this.prisma.objectContractor.upsert({
      where: { objectId_contractorId: { objectId, contractorId: dto.contractorId } },
      update: { role: dto.role },
      create: { objectId, contractorId: dto.contractorId, role: dto.role },
      include: { contractor: true },
    });
    await this.audit.log({
      tenantId,
      userId: user.id,
      entityType: "ConstructionObject",
      entityId: objectId,
      action: `Назначен подрядчик «${contractor.name}»${dto.role ? ` (роль: ${dto.role})` : ""}`,
    });
    return link;
  }

  /**
   * Снять субподрядчика с объекта (удалить ObjectContractor). Первое
   * использование @Delete в этом кодбейзе — удаление здесь безопасно:
   * это обратимая административная связь, а не запись аудита/истории.
   * Принадлежность тенанту проверяется через вложенный relational where
   * (object: { tenantId }), т.к. у ObjectContractor нет своего tenantId.
   */
  /**
   * ХАРДЕНИНГ-ФИКС (integrity pass): раньше связь можно было снять в любой
   * момент, в том числе когда на объекте уже есть ObjectWork с этим же
   * contractorId — работа оставалась «повисшей» у формально не назначенного
   * подрядчика: фильтр объектов по contractorId и карточка объекта её
   * больше не видели бы, а сама работа продолжала бы принадлежать
   * подрядчику. Теперь при наличии таких работ снятие связи отклоняется
   * 409 с понятным сообщением — а не молча рвёт целостность. contractorId
   * у существующих работ НЕ очищается автоматически (это было бы скрытым
   * массовым изменением чужих данных без явного решения пользователя).
   */
  async removeContractor(tenantId: string, user: AuthenticatedUser, objectId: string, contractorId: string) {
    const link = await this.prisma.objectContractor.findFirst({
      where: { objectId, contractorId, object: { tenantId } },
      include: { contractor: true },
    });
    if (!link) throw new NotFoundException("Связь «объект — подрядчик» не найдена");

    const worksCount = await this.prisma.objectWork.count({ where: { objectId, tenantId, contractorId } });
    if (worksCount > 0) {
      throw new ConflictException(
        `Нельзя снять подрядчика «${link.contractor.name}» — на объекте есть ${worksCount} работ(ы) с этим подрядчиком. Сначала переназначьте или очистите подрядчика у этих работ.`,
      );
    }

    await this.prisma.objectContractor.delete({ where: { id: link.id } });
    await this.audit.log({
      tenantId,
      userId: user.id,
      entityType: "ConstructionObject",
      entityId: objectId,
      action: `Снят подрядчик «${link.contractor.name}»`,
    });
    return { ok: true };
  }

  /**
   * Читает RiskSettings тенанта (настраиваемые пороги светофора, ТЗ п.32) и
   * приводит Prisma Decimal-поля к RiskThresholds. ХАРДЕНИНГ-ФИКС (эта
   * итерация): раньше ObjectHealthService.calculate() всегда вызывался БЕЗ
   * второго аргумента thresholds, т.е. молча использовал захардкоженный
   * DEFAULT_RISK_THRESHOLDS из домена, даже когда в БД для тенанта уже
   * существует своя строка RiskSettings (seed.ts её создаёт) — настройки
   * порогов существовали в схеме, но нигде не читались. Если строки нет
   * (тенант создан не через seed) — используем DEFAULT_RISK_THRESHOLDS как
   * безопасный fallback, не изобретая новых значений по умолчанию.
   */
  private async loadRiskThresholds(tenantId: string): Promise<RiskThresholds> {
    const settings = await this.prisma.riskSettings.findUnique({ where: { tenantId } });
    if (!settings) return DEFAULT_RISK_THRESHOLDS;
    return {
      greenVarianceThreshold: Number(settings.greenVarianceThreshold),
      yellowVarianceThreshold: Number(settings.yellowVarianceThreshold),
      escalateToTechDirectorAfterDays: settings.escalateToTechDirectorAfterDays,
      escalateToGeneralDirectorAfterDays: settings.escalateToGeneralDirectorAfterDays,
      staleProgressAfterDays: settings.staleProgressAfterDays,
    };
  }

  /**
   * Пересчёт светофора объекта (ObjectHealthService, ТЗ п.32) на основе
   * агрегации по его работам/замечаниям/backlog. Вызывается после любой
   * операции, влияющей на состояние (факт, инспекция, ПТО, СДО) — см. events.
   *
   * ХАРДЕНИНГ-ФИКС (эта итерация): ptoBacklogCount/sdoBacklogCount раньше
   * всегда передавались как 0 — светофор физически не мог отреагировать на
   * зависшую исполнительную документацию или объёмы, застрявшие в СДО, даже
   * если ObjectHealthService в домене это умеет. Теперь считаем реальные
   * значения из PostgreSQL.
   *
   * Определение "зависшего" пакета/дела: ExecutiveDocumentPackage.status и
   * SdoCase.status в текущем коде реально принимают только подмножество
   * значений своих enum'ов (PackageStatus: только DRAFT и TRANSFERRED_TO_SDO
   * — IN_PROGRESS/READY/RETURNED нигде не устанавливаются; SdoStatus: только
   * TRANSFERRED (стартовое)/CALCULATED/CLOSED — остальные значения тоже
   * нигде не устанавливаются, см. pto.module.ts/sdo.module.ts). Поэтому
   * backlog считается не по конкретному "промежуточному" статусу (которого
   * реально не бывает), а как "не в терминальном статусе (не передан / не
   * закрыт) дольше порога staleProgressAfterDays из RiskSettings" — это
   * единственное определение, которое реально совпадает с данными в БД, а
   * не с недостижимыми состояниями enum'а. Используется существующий
   * настраиваемый порог staleProgressAfterDays (а не новый хардкодный
   * "N дней"), т.к. отдельного порога backlog-а для ПТО/СДО в архитектуре
   * (RiskSettings/RiskThresholds) не предусмотрено, а инструкция прямо
   * требует не добавлять новые хардкодные пороги без необходимости.
   */
  async recalculateHealth(tenantId: string, objectId: string) {
    const thresholds = await this.loadRiskThresholds(tenantId);
    const backlogCutoff = new Date(Date.now() - thresholds.staleProgressAfterDays * 86_400_000);

    const works = await this.prisma.objectWork.findMany({ where: { objectId, tenantId } });
    const lastProgress = await this.prisma.workProgress.findFirst({
      where: { objectWork: { objectId } },
      orderBy: { reportedAt: "desc" },
    });
    const openIssues = await this.prisma.inspectionIssue.count({
      where: { tenantId, inspection: { objectId }, status: { in: ["OPEN", "IN_PROGRESS"] }, severity: "CRITICAL" },
    });
    const overdueIssues = await this.prisma.inspectionIssue.count({
      where: { tenantId, inspection: { objectId }, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() } },
    });
    const blocked = await this.prisma.objectWork.count({ where: { objectId, tenantId, status: "BLOCKED" } });
    const ptoBacklogCount = await this.prisma.executiveDocumentPackage.count({
      where: { tenantId, objectId, status: { not: "TRANSFERRED_TO_SDO" }, createdAt: { lte: backlogCutoff } },
    });
    const sdoBacklogCount = await this.prisma.sdoCase.count({
      where: { tenantId, objectId, status: { not: "CLOSED" }, ptoTransferredAt: { lte: backlogCutoff } },
    });

    let worstStatus: ScheduleStatus | null = null;
    let worstVariance = 0;
    let maxDelay = 0;
    const order = [ScheduleStatus.ON_TRACK, ScheduleStatus.BEHIND, ScheduleStatus.CRITICAL];
    for (const w of works) {
      const s = w.scheduleStatus as ScheduleStatus;
      if (!worstStatus || order.indexOf(s) > order.indexOf(worstStatus)) {
        worstStatus = s;
        worstVariance = Number(w.varianceP);
      }
      if (w.delayDays > maxDelay) maxDelay = w.delayDays;
    }

    const result = ObjectHealthService.calculate(
      {
        hasWorks: works.length > 0,
        lastProgressUpdateAt: lastProgress?.reportedAt ?? null,
        today: new Date(),
        worstScheduleStatus: worstStatus,
        worstVarianceP: worstVariance,
        maxDelayDays: maxDelay,
        criticalOpenIssuesCount: openIssues,
        overdueIssuesCount: overdueIssues,
        blockedWorksCount: blocked,
        ptoBacklogCount,
        sdoBacklogCount,
      },
      thresholds,
    );

    await this.prisma.constructionObject.update({
      where: { id: objectId },
      data: { healthStatus: result.status as any, healthReasons: result.reasons as any },
    });
    return result;
  }
}

@ApiTags("objects")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("objects")
export class ObjectsController {
  constructor(private objects: ObjectsService) {}

  @Get()
  @RequirePermissions(Permission.OBJECT_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("status") status?: string, @Query("healthStatus") healthStatus?: string, @Query("contractorId") contractorId?: string) {
    return this.objects.findAll(user.tenantId, { status, healthStatus, contractorId });
  }

  @Get(":id")
  @RequirePermissions(Permission.OBJECT_VIEW)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.objects.findOne(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(Permission.OBJECT_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateObjectDto) {
    return this.objects.create(user.tenantId, user, dto);
  }

  @Patch(":id")
  @RequirePermissions(Permission.OBJECT_EDIT)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateObjectDto) {
    return this.objects.update(user.tenantId, user, id, dto);
  }

  @Post(":id/recalculate-health")
  @RequirePermissions(Permission.OBJECT_VIEW)
  recalcHealth(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.objects.recalculateHealth(user.tenantId, id);
  }

  @Post(":id/contractors")
  @RequirePermissions(Permission.OBJECT_MANAGE_CONTRACTORS)
  assignContractor(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: AssignContractorDto) {
    return this.objects.assignContractor(user.tenantId, user, id, dto);
  }

  @Delete(":id/contractors/:contractorId")
  @RequirePermissions(Permission.OBJECT_MANAGE_CONTRACTORS)
  removeContractor(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("contractorId") contractorId: string) {
    return this.objects.removeContractor(user.tenantId, user, id, contractorId);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [ObjectsController],
  providers: [ObjectsService],
  exports: [ObjectsService],
})
export class ObjectsModule {}
