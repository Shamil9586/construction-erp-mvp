import { Module, Injectable, Controller, Get, Post, Patch, Param, Body, Query, UseGuards, NotFoundException, BadRequestException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsString, IsOptional, IsDateString, IsNumber, IsUUID, IsBoolean } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { ObjectsModule } from "../objects/objects.module";
import { ObjectsService } from "../objects/objects.module";
import {
  Permission,
  ProgressCalculationService,
  ScheduleStatusService,
  WorkTransitionPolicy,
  DependencyType,
  InspectionStatus,
} from "@construction-erp/domain";

export class CreateWorkDto {
  @IsUUID() workTypeId!: string;
  @IsOptional() @IsUUID() contractorId?: string;
  @IsOptional() @IsUUID() responsibleUserId?: string;
  @IsString() name!: string;
  @IsString() unit!: string;
  @IsNumber() plannedQuantity!: number;
  @IsDateString() plannedStartDate!: string;
  @IsDateString() plannedFinishDate!: string;
  @IsOptional() @IsNumber() estimatedCost?: number;
}

export class ReportProgressDto {
  @IsNumber() actualQuantity!: number; // накопительное значение факта (не дельта)
  @IsOptional() @IsString() comment?: string;
}

export class CreateDependencyDto {
  @IsUUID() predecessorWorkId!: string;
  @IsUUID() successorWorkId!: string;
  @IsOptional() @IsBoolean() requiresAcceptance?: boolean;
}

/**
 * WorksService — ObjectWork + WorkProgress + WorkDependency + WorkTransitionPolicy.
 * Реальные вызовы ProgressCalculationService/ScheduleStatusService/WorkTransitionPolicy
 * (packages/domain) на каждое изменение факта — то же самое, что проверено
 * в verify/e2e.ts против настоящего PostgreSQL.
 */
@Injectable()
export class WorksService {
  constructor(private prisma: PrismaService, private audit: AuditService, private objects: ObjectsService) {}

  findForObject(tenantId: string, objectId: string) {
    return this.prisma.objectWork.findMany({
      where: { tenantId, objectId },
      include: { workType: { include: { category: true } }, contractor: true, responsibleUser: { select: { name: true } } },
      orderBy: { plannedStartDate: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const work = await this.prisma.objectWork.findFirst({
      where: { id, tenantId },
      include: {
        workType: true,
        contractor: true,
        responsibleUser: { select: { name: true } },
        progressHistory: { orderBy: { reportedAt: "desc" }, take: 30 },
        predecessorDependencies: { include: { predecessorWork: true } },
        successorDependencies: { include: { successorWork: true } },
      },
    });
    if (!work) throw new NotFoundException("Работа не найдена");
    return work;
  }

  /**
   * ХАРДЕНИНГ-ФИКС (эта итерация): раньше create() не проверял вообще, что
   * objectId принадлежит tenantId — работу можно было создать под чужим
   * объектом, если бы его id был угадан/подставлен. Добавлена явная
   * tenant-scoped проверка объекта (сопутствующее исправление, не было
   * запрошено напрямую, но бесплатно закрывает реальную дыру рядом с
   * запрошенным изменением).
   *
   * Второе (запрошенное) изменение: если dto.contractorId указан, система
   * теперь требует, чтобы подрядчик был ЗАРАНЕЕ назначен на объект через
   * ObjectContractor (см. ObjectsService.assignContractor) — работа не
   * может явочным порядком создать эту связь неявно. Выбран вариант
   * "потребовать предварительного назначения" (а не авто-создание связи),
   * т.к. авто-создание скрыло бы содержательное решение о role связи.
   */
  async create(tenantId: string, user: AuthenticatedUser, objectId: string, dto: CreateWorkDto) {
    const object = await this.prisma.constructionObject.findFirst({ where: { id: objectId, tenantId } });
    if (!object) throw new NotFoundException("Объект не найден");

    if (dto.contractorId) {
      const link = await this.prisma.objectContractor.findFirst({ where: { objectId, contractorId: dto.contractorId } });
      if (!link) {
        throw new BadRequestException(
          "Подрядчик не назначен на этот объект — сначала назначьте его в карточке объекта (вкладка «Обзор»), затем создавайте работу",
        );
      }
    }

    const work = await this.prisma.objectWork.create({
      data: {
        tenantId,
        objectId,
        workTypeId: dto.workTypeId,
        contractorId: dto.contractorId,
        responsibleUserId: dto.responsibleUserId,
        name: dto.name,
        unit: dto.unit,
        plannedQuantity: dto.plannedQuantity,
        plannedStartDate: new Date(dto.plannedStartDate),
        plannedFinishDate: new Date(dto.plannedFinishDate),
        estimatedCost: dto.estimatedCost,
        status: "PLANNED",
      },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ObjectWork", entityId: work.id, action: `Добавлена работа «${work.name}», план ${dto.plannedQuantity} ${dto.unit}` });
    await this.objects.recalculateHealth(tenantId, objectId);
    return work;
  }

  /**
   * Внесение факта (ТЗ п.17-19). Процент не вводится вручную — считается
   * из plannedQuantity/actualQuantity. Пишет запись в WorkProgress (история,
   * не перезапись), пересчитывает scheduleStatus/variance/delayDays и
   * healthStatus объекта.
   */
  async reportProgress(tenantId: string, user: AuthenticatedUser, workId: string, dto: ReportProgressDto) {
    const work = await this.prisma.objectWork.findFirst({ where: { id: workId, tenantId } });
    if (!work) throw new NotFoundException("Работа не найдена");
    if (dto.actualQuantity < 0) throw new BadRequestException("Фактический объём не может быть отрицательным");

    const previousActual = Number(work.actualQuantity);
    const delta = ProgressCalculationService.delta(previousActual, dto.actualQuantity);

    const progress = ProgressCalculationService.calculate({ plannedQuantity: Number(work.plannedQuantity), actualQuantity: dto.actualQuantity });
    const schedule = ScheduleStatusService.evaluate({
      plannedStartDate: work.plannedStartDate,
      plannedFinishDate: work.plannedFinishDate,
      today: new Date(),
      actualProgressPercent: progress.progressPercent,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.objectWork.update({
        where: { id: workId },
        data: {
          actualQuantity: dto.actualQuantity,
          progressPercent: progress.progressPercent,
          scheduleStatus: schedule.scheduleStatus as any,
          varianceP: schedule.varianceP,
          delayDays: schedule.delayDays,
          status: progress.progressPercent >= 100 ? "DONE" : progress.progressPercent > 0 ? "IN_PROGRESS" : work.status,
          actualStartDate: work.actualStartDate ?? (dto.actualQuantity > 0 ? new Date() : null),
          actualFinishDate: progress.progressPercent >= 100 ? new Date() : null,
          version: { increment: 1 },
        },
      });
      await tx.workProgress.create({
        data: {
          tenantId,
          objectWorkId: workId,
          quantityDelta: delta,
          totalQuantity: dto.actualQuantity,
          progressPercent: progress.progressPercent,
          reportedBy: user.name,
          comment: dto.comment,
        },
      });
      return u;
    });

    await this.audit.log({
      tenantId,
      userId: user.id,
      entityType: "ObjectWork",
      entityId: workId,
      action: `Внесён факт: ${delta >= 0 ? "+" : ""}${delta} ${work.unit} (итого ${dto.actualQuantity}/${work.plannedQuantity} ${work.unit}, ${progress.progressPercent.toFixed(0)}%)`,
      oldValue: { actualQuantity: previousActual },
      newValue: { actualQuantity: dto.actualQuantity, progressPercent: progress.progressPercent },
    });

    await this.objects.recalculateHealth(tenantId, work.objectId);
    return { work: updated, progress, schedule };
  }

  async addDependency(tenantId: string, user: AuthenticatedUser, dto: CreateDependencyDto) {
    const dep = await this.prisma.workDependency.create({
      data: {
        predecessorWorkId: dto.predecessorWorkId,
        successorWorkId: dto.successorWorkId,
        requiresAcceptance: dto.requiresAcceptance ?? true,
      },
    });
    await this.prisma.objectWork.update({ where: { id: dto.successorWorkId }, data: { status: "BLOCKED" } });
    await this.audit.log({ tenantId, userId: user.id, entityType: "WorkDependency", entityId: dep.id, action: "Добавлена технологическая зависимость (FINISH_TO_START)" });
    return dep;
  }

  /**
   * WorkTransitionPolicy.canStartWork (ТЗ п.20-21) — конкретные причины
   * блокировки, не просто "заблокировано". Реальный вызов domain-сервиса.
   */
  async checkCanStart(tenantId: string, workId: string) {
    const deps = await this.prisma.workDependency.findMany({
      where: { successorWorkId: workId },
      include: { predecessorWork: true },
    });

    const inputs = await Promise.all(
      deps.map(async (dep) => {
        const latestInspection = await this.prisma.constructionInspection.findFirst({
          where: { objectWorkId: dep.predecessorWorkId },
          orderBy: { updatedAt: "desc" },
        });
        const openCritical = await this.prisma.inspectionIssue.count({
          where: {
            inspection: { objectWorkId: dep.predecessorWorkId },
            severity: "CRITICAL",
            status: { in: ["OPEN", "IN_PROGRESS", "READY_FOR_VERIFICATION"] },
          },
        });
        return {
          predecessorWorkId: dep.predecessorWorkId,
          predecessorWorkName: dep.predecessorWork.name,
          dependencyType: DependencyType.FINISH_TO_START,
          requiresAcceptance: dep.requiresAcceptance,
          predecessorLatestInspectionStatus: (latestInspection?.status as InspectionStatus) ?? null,
          predecessorHasOpenCriticalIssues: openCritical > 0,
          predecessorMissingRequiredDocument: false, // расширяется вместе с ПТО-модулем при необходимости
        };
      }),
    );

    const result = WorkTransitionPolicy.canStartWork(inputs);
    if (result.allowed) {
      const work = await this.prisma.objectWork.findUnique({ where: { id: workId } });
      if (work?.status === "BLOCKED") {
        await this.prisma.objectWork.update({ where: { id: workId }, data: { status: "PLANNED" } });
      }
    }
    return result;
  }
}

@ApiTags("works")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller()
export class WorksController {
  constructor(private works: WorksService) {}

  @Get("objects/:objectId/works")
  @RequirePermissions(Permission.WORK_VIEW)
  findForObject(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.works.findForObject(user.tenantId, objectId);
  }

  @Post("objects/:objectId/works")
  @RequirePermissions(Permission.WORK_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string, @Body() dto: CreateWorkDto) {
    return this.works.create(user.tenantId, user, objectId, dto);
  }

  @Get("works/:id")
  @RequirePermissions(Permission.WORK_VIEW)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.works.findOne(user.tenantId, id);
  }

  @Post("works/:id/progress")
  @RequirePermissions(Permission.WORK_UPDATE_PROGRESS)
  reportProgress(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ReportProgressDto) {
    return this.works.reportProgress(user.tenantId, user, id, dto);
  }

  @Get("works/:id/start")
  @RequirePermissions(Permission.WORK_VIEW)
  checkStart(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.works.checkCanStart(user.tenantId, id);
  }

  @Post("work-dependencies")
  @RequirePermissions(Permission.WORK_CREATE)
  addDependency(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDependencyDto) {
    return this.works.addDependency(user.tenantId, user, dto);
  }
}

@Module({
  imports: [AuditModule, ObjectsModule],
  controllers: [WorksController],
  providers: [WorksService],
  exports: [WorksService],
})
export class WorksModule {}
