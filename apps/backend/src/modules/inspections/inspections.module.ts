import { Module, Injectable, Controller, Get, Post, Param, Body, UseGuards, NotFoundException, BadRequestException, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { IsString, IsOptional, IsUUID, IsIn, IsNumber, IsDateString, IsBase64, MaxLength } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { ObjectsModule } from "../objects/objects.module";
import { ObjectsService } from "../objects/objects.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotificationsService } from "../notifications/notifications.module";
import { BitrixModule } from "../../bitrix/bitrix.module";
import { BitrixGatewayService } from "../../bitrix/bitrix-gateway.service";
import { Permission, WorkTransitionPolicy } from "@construction-erp/domain";

export class RequestInspectionDto {
  @IsUUID() objectWorkId!: string;
  @IsOptional() @IsString() comment?: string;
}

export class CreateIssueDto {
  @IsString() title!: string;
  @IsString() description!: string;
  @IsIn(["MINOR", "CRITICAL"]) severity!: "MINOR" | "CRITICAL";
  @IsOptional() @IsUUID() responsibleUserId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class AcceptInspectionDto {
  @IsNumber() acceptedQuantity!: number;
  @IsOptional() @IsString() comment?: string;
}

export class RejectInspectionDto {
  @IsString() comment!: string;
}

/**
 * Фотофиксация СК (ТЗ — вкладка «Фото», InspectionPhoto). Приём файла в виде
 * base64 в JSON-теле (не multipart/FileInterceptor): `multer`/`@types/multer`
 * не объявлены как зависимости backend (npm install в этой песочнице
 * недоступен — проверить их подключение здесь невозможно), поэтому выбран
 * вариант, не требующий НИ ОДНОЙ новой рантайм-зависимости сверх уже
 * используемых в проекте class-validator/class-transformer. Декодируется в
 * Buffer на сервере и передаётся в FileStorageProvider.upload() — тот же
 * порт, что и везде в проекте (см. BitrixGatewayService). issueId — опционально,
 * позволяет прикрепить фото сразу к конкретному замечанию (ТЗ: "возможность
 * СК приложить фото к замечанию"); без issueId фото прикрепляется к проверке
 * в целом.
 */
export class UploadInspectionPhotoDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsBase64() contentBase64!: string;
  @IsOptional() @IsUUID() issueId?: string;
}

/**
 * InspectionsService — процесс строительного контроля (ТЗ п.22-24, 47).
 * accept() — АТОМАРНАЯ операция (единая DB-транзакция): 1) inspection ->
 * ACCEPTED, 2) обновление work.acceptedQuantity, 3) закрытие блокирующих
 * замечаний, 4) AuditLog, 5) уведомление ПТО (событие ExecutivePackageReady
 * готовится следующим шагом в ПТО-модуле). Именно так проверено в
 * verify/e2e.ts (шаги 11-17).
 */
@Injectable()
export class InspectionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private objects: ObjectsService,
    private notifications: NotificationsService,
    private bitrixGateway: BitrixGatewayService,
  ) {}

  async requestInspection(tenantId: string, user: AuthenticatedUser, dto: RequestInspectionDto) {
    const work = await this.prisma.objectWork.findFirst({ where: { id: dto.objectWorkId, tenantId } });
    if (!work) throw new NotFoundException("Работа не найдена");

    const inspection = await this.prisma.constructionInspection.create({
      data: {
        tenantId,
        objectId: work.objectId,
        objectWorkId: work.id,
        requestedById: user.id,
        status: "WAITING",
        comment: dto.comment,
      },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ConstructionInspection", entityId: inspection.id, action: `Работа «${work.name}» предъявлена строительному контролю` });
    return inspection;
  }

  findQueue(tenantId: string, status?: string) {
    return this.prisma.constructionInspection.findMany({
      where: { tenantId, status: (status as any) ?? { in: ["WAITING", "IN_REVIEW", "REINSPECTION"] } },
      include: { objectWork: true, object: { select: { name: true } }, requestedBy: { select: { name: true } } },
      orderBy: { requestedAt: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const inspection = await this.prisma.constructionInspection.findFirst({
      where: { id, tenantId },
      include: { objectWork: true, issues: true, photos: true },
    });
    if (!inspection) throw new NotFoundException("Проверка не найдена");
    return inspection;
  }

  /**
   * Загрузка фото проверки/замечания (ТЗ — минимальная фотофиксация СК).
   * ХАРДЕНИНГ-ФИКС (эта итерация): вкладка «Фото» была информационной
   * заглушкой, хотя InspectionPhoto уже существует в Prisma и findOne()
   * уже включает `photos: true` в ответ. Реализовано через существующий
   * порт FileStorageProvider (BitrixGatewayService.upload) — в demo/mock
   * режиме (нет ACTIVE BitrixInstallation, что верно для этого проекта
   * всегда, пока не подключён тестовый портал) он прозрачно делегирует в
   * MockFileStorageProvider — безопасное тестовое хранилище, ничего не
   * уходит наружу. Реальная загрузка в Bitrix24.Disk НЕ проверена на
   * тестовом портале — см. docs/bitrix24-integration.md.
   */
  async uploadPhoto(tenantId: string, user: AuthenticatedUser, inspectionId: string, dto: UploadInspectionPhotoDto) {
    const inspection = await this.prisma.constructionInspection.findFirst({ where: { id: inspectionId, tenantId } });
    if (!inspection) throw new NotFoundException("Проверка не найдена");

    if (dto.issueId) {
      const issue = await this.prisma.inspectionIssue.findFirst({ where: { id: dto.issueId, tenantId, inspectionId } });
      if (!issue) throw new NotFoundException("Замечание не найдено в рамках этой проверки");
    }

    const buffer = Buffer.from(dto.contentBase64, "base64");
    const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 МБ — разумный предел для фото со стройплощадки
    if (buffer.length === 0) throw new BadRequestException("Пустой файл");
    if (buffer.length > MAX_PHOTO_BYTES) throw new BadRequestException("Файл слишком большой (максимум 15 МБ)");

    const uploaded = await this.bitrixGateway.upload(tenantId, {
      fileName: dto.fileName,
      buffer,
      folder: `inspections/${inspectionId}`,
    });

    const photo = await this.prisma.inspectionPhoto.create({
      data: {
        tenantId,
        inspectionId,
        issueId: dto.issueId,
        fileProvider: uploaded.fileProvider,
        externalFileId: uploaded.externalFileId,
        fileName: uploaded.fileName,
        uploadedBy: user.name,
      },
    });

    await this.audit.log({
      tenantId,
      userId: user.id,
      entityType: "ConstructionInspection",
      entityId: inspectionId,
      action: `Загружено фото «${dto.fileName}»${dto.issueId ? " к замечанию" : ""}`,
    });
    return photo;
  }

  listPhotos(tenantId: string, inspectionId: string) {
    return this.prisma.inspectionPhoto.findMany({
      where: { tenantId, inspectionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * ХАРДЕНИНГ-ФИКС (integrity pass): раньше не было НИКАКОГО способа
   * получить содержимое фото обратно — только метаданные из списка.
   * Ищем InspectionPhoto tenant-scoped (не по photoId в отрыве от
   * tenant — иначе угадавший чужой id получил бы чужой файл), затем
   * запрашиваем байты через тот же порт FileStorageProvider
   * (BitrixGatewayService.download), что и при загрузке — в demo-режиме
   * прозрачно читает с локального диска (MockFileStorageProvider).
   */
  async getPhotoFile(tenantId: string, photoId: string) {
    const photo = await this.prisma.inspectionPhoto.findFirst({ where: { id: photoId, tenantId } });
    if (!photo) throw new NotFoundException("Фото не найдено");
    const file = await this.bitrixGateway.download(tenantId, photo.externalFileId);
    if (!file) throw new NotFoundException("Файл фото не найден в хранилище (возможно, удалён вне приложения)");
    return { ...file, fileName: photo.fileName };
  }

  async createIssue(tenantId: string, user: AuthenticatedUser, inspectionId: string, dto: CreateIssueDto) {
    const inspection = await this.prisma.constructionInspection.findFirst({ where: { id: inspectionId, tenantId } });
    if (!inspection) throw new NotFoundException("Проверка не найдена");

    const [issue] = await this.prisma.$transaction([
      this.prisma.inspectionIssue.create({
        data: {
          tenantId,
          inspectionId,
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          responsibleUserId: dto.responsibleUserId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: "OPEN",
        },
      }),
      this.prisma.constructionInspection.update({ where: { id: inspectionId }, data: { status: "ISSUES_FOUND" } }),
    ]);

    await this.audit.log({ tenantId, userId: user.id, entityType: "InspectionIssue", entityId: issue.id, action: `Замечание СК (${dto.severity === "CRITICAL" ? "критично" : "некритично"}): ${dto.title}` });
    await this.objects.recalculateHealth(tenantId, inspection.objectId);

    if (dto.responsibleUserId) {
      const responsible = await this.prisma.user.findUnique({ where: { id: dto.responsibleUserId } });
      if (responsible) {
        await this.notifications.notify({
          tenantId,
          userId: responsible.id,
          bitrixUserId: responsible.bitrixUserId,
          type: "ISSUE_CREATED",
          title: `Новое замечание СК: ${dto.title}`,
          entityType: "InspectionIssue",
          entityId: issue.id,
          dedupSeed: issue.id,
        });
      }
    }
    return issue;
  }

  async resolveIssue(tenantId: string, user: AuthenticatedUser, issueId: string) {
    const issue = await this.prisma.inspectionIssue.findFirst({ where: { id: issueId, tenantId } });
    if (!issue) throw new NotFoundException("Замечание не найдено");
    const updated = await this.prisma.inspectionIssue.update({
      where: { id: issueId },
      data: { status: "READY_FOR_VERIFICATION", resolvedAt: new Date(), resolvedBy: user.name },
    });
    await this.prisma.constructionInspection.update({ where: { id: issue.inspectionId }, data: { status: "REINSPECTION" } });
    await this.audit.log({ tenantId, userId: user.id, entityType: "InspectionIssue", entityId: issueId, action: "Замечание устранено, направлено на повторную проверку" });
    return updated;
  }

  /**
   * Приёмка работы СК (ТЗ п.47 — атомарная операция).
   */
  async accept(tenantId: string, user: AuthenticatedUser, inspectionId: string, dto: AcceptInspectionDto) {
    const inspection = await this.prisma.constructionInspection.findFirst({
      where: { id: inspectionId, tenantId },
      include: { objectWork: true, issues: true },
    });
    if (!inspection) throw new NotFoundException("Проверка не найдена");

    const openCritical = inspection.issues.filter((i) => i.severity === "CRITICAL" && !["CLOSED", "REJECTED"].includes(i.status));
    if (openCritical.length > 0) {
      throw new BadRequestException("Нельзя принять работу: есть непогашенные критические замечания");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedInspection = await tx.constructionInspection.update({
        where: { id: inspectionId },
        data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedQuantity: dto.acceptedQuantity, decision: "принято", comment: dto.comment, inspectorId: user.id },
      });
      const updatedWork = await tx.objectWork.update({
        where: { id: inspection.objectWorkId },
        data: { acceptedQuantity: dto.acceptedQuantity },
      });
      // Закрываем замечания, переданные на верификацию в рамках этой проверки.
      await tx.inspectionIssue.updateMany({
        where: { inspectionId, status: "READY_FOR_VERIFICATION" },
        data: { status: "CLOSED", verifiedAt: new Date(), verifiedBy: user.name },
      });
      return { updatedInspection, updatedWork };
    });

    await this.audit.log({
      tenantId,
      userId: user.id,
      entityType: "ConstructionInspection",
      entityId: inspectionId,
      action: `Строительный контроль: работа «${inspection.objectWork.name}» принята в объёме ${dto.acceptedQuantity} ${inspection.objectWork.unit}`,
    });

    // Разблокируем зависимые работы, если условия выполнены (WorkTransitionPolicy — реальный вызов).
    const successors = await this.prisma.workDependency.findMany({ where: { predecessorWorkId: inspection.objectWorkId } });
    for (const dep of successors) {
      const check = WorkTransitionPolicy.canStartWork([
        {
          predecessorWorkId: inspection.objectWorkId,
          predecessorWorkName: inspection.objectWork.name,
          dependencyType: "FINISH_TO_START" as any,
          requiresAcceptance: dep.requiresAcceptance,
          predecessorLatestInspectionStatus: "ACCEPTED" as any,
          predecessorHasOpenCriticalIssues: false,
          predecessorMissingRequiredDocument: false,
        },
      ]);
      if (check.allowed) {
        await this.prisma.objectWork.update({ where: { id: dep.successorWorkId }, data: { status: "PLANNED" } });
        await this.audit.log({ tenantId, userId: user.id, entityType: "ObjectWork", entityId: dep.successorWorkId, action: `Разблокирована после приёмки «${inspection.objectWork.name}»` });
      }
    }

    await this.objects.recalculateHealth(tenantId, inspection.objectId);
    return result;
  }

  async reject(tenantId: string, user: AuthenticatedUser, inspectionId: string, dto: RejectInspectionDto) {
    const inspection = await this.prisma.constructionInspection.findFirst({ where: { id: inspectionId, tenantId } });
    if (!inspection) throw new NotFoundException("Проверка не найдена");
    const updated = await this.prisma.constructionInspection.update({
      where: { id: inspectionId },
      data: { status: "REJECTED", decision: "не принято", comment: dto.comment, inspectorId: user.id },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ConstructionInspection", entityId: inspectionId, action: `Строительный контроль отклонил работу: ${dto.comment}` });
    await this.objects.recalculateHealth(tenantId, inspection.objectId);
    return updated;
  }
}

@ApiTags("inspections")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("inspections")
export class InspectionsController {
  constructor(private inspections: InspectionsService) {}

  @Get()
  @RequirePermissions(Permission.WORK_VIEW)
  findQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.inspections.findQueue(user.tenantId);
  }

  @Post()
  @RequirePermissions(Permission.INSPECTION_REQUEST)
  request(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestInspectionDto) {
    return this.inspections.requestInspection(user.tenantId, user, dto);
  }

  @Get(":id")
  @RequirePermissions(Permission.WORK_VIEW)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.inspections.findOne(user.tenantId, id);
  }

  @Post(":id/issues")
  @RequirePermissions(Permission.ISSUE_CREATE)
  createIssue(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreateIssueDto) {
    return this.inspections.createIssue(user.tenantId, user, id, dto);
  }

  @Post(":id/photos")
  @RequirePermissions(Permission.ISSUE_CREATE)
  uploadPhoto(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UploadInspectionPhotoDto) {
    return this.inspections.uploadPhoto(user.tenantId, user, id, dto);
  }

  @Get(":id/photos")
  @RequirePermissions(Permission.WORK_VIEW)
  listPhotos(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.inspections.listPhotos(user.tenantId, id);
  }

  // Отдельный маршрут вне :id/photos — фото адресуется собственным id
  // (InspectionPhoto.id), tenant-scoping делает getPhotoFile(), не роут.
  @Get("photos/:photoId/file")
  @RequirePermissions(Permission.WORK_VIEW)
  async getPhotoFile(@CurrentUser() user: AuthenticatedUser, @Param("photoId") photoId: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.inspections.getPhotoFile(user.tenantId, photoId);
    res.set({
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
    });
    return new StreamableFile(file.buffer);
  }

  @Post("issues/:issueId/resolve")
  @RequirePermissions(Permission.ISSUE_RESOLVE)
  resolveIssue(@CurrentUser() user: AuthenticatedUser, @Param("issueId") issueId: string) {
    return this.inspections.resolveIssue(user.tenantId, user, issueId);
  }

  @Post(":id/accept")
  @RequirePermissions(Permission.INSPECTION_ACCEPT)
  accept(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: AcceptInspectionDto) {
    return this.inspections.accept(user.tenantId, user, id, dto);
  }

  @Post(":id/reject")
  @RequirePermissions(Permission.INSPECTION_REJECT)
  reject(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: RejectInspectionDto) {
    return this.inspections.reject(user.tenantId, user, id, dto);
  }
}

@Module({
  imports: [AuditModule, ObjectsModule, NotificationsModule, BitrixModule],
  controllers: [InspectionsController],
  providers: [InspectionsService],
  exports: [InspectionsService],
})
export class InspectionsModule {}
