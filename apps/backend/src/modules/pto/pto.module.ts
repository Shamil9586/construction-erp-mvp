import { Module, Injectable, Controller, Get, Post, Param, Body, UseGuards, NotFoundException, BadRequestException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsString, IsOptional, IsUUID, IsIn, IsArray, ArrayNotEmpty, ArrayUnique } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { Permission, PtoPackageValidationService, ExecutiveDocumentType, ExecutiveDocumentStatus } from "@construction-erp/domain";

export class CreateExecutiveDocumentDto {
  @IsUUID() objectWorkId!: string;
  @IsIn(["AOSR", "EXECUTIVE_SCHEME", "CERTIFICATE", "PASSPORT", "LAB_REPORT", "OTHER"]) type!: string;
  @IsOptional() @IsString() number?: string;
}

export class ApproveDocumentDto {
  @IsOptional() @IsString() comment?: string;
}

export class CreatePackageDto {
  // ХАРДЕНИНГ-ФИКС (integrity pass): @ArrayNotEmpty — пустой пакет
  // отклоняется уже на уровне ValidationPipe, до того как сервис вообще
  // увидит запрос. @ArrayUnique — не обязателен по бизнес-логике (сервис
  // всё равно дедуплицирует перед проверкой количества), но ловит
  // очевидно ошибочный ввод раньше, понятным сообщением.
  @IsArray() @ArrayNotEmpty({ message: "Пакет не может быть пустым — укажите хотя бы один документ" }) @ArrayUnique() @IsUUID(undefined, { each: true }) documentIds!: string[];
}

/**
 * PtoPackageValidationService (ТЗ п.26) — пакет ИД нельзя передать в СДО,
 * пока не выполнены обязательные требования. Реальный вызов domain-сервиса
 * перед сменой статуса на TRANSFERRED_TO_SDO.
 */
@Injectable()
export class PtoService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  findDocumentsForObject(tenantId: string, objectId: string) {
    return this.prisma.executiveDocument.findMany({
      where: { tenantId, objectId },
      include: { objectWork: { select: { name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * ХАРДЕНИНГ-ФИКС (integrity pass): раньше проверялось только, что работа
   * существует и принадлежит tenant — но НЕ то, что объект из URL
   * (`objectId`) вообще принадлежит тенанту, и НЕ то, что работа
   * действительно относится к ЭТОМУ объекту. Можно было создать документ
   * по чужой работе, подставив в URL произвольный `objectId` того же
   * tenant (документ записался бы с несогласованными `objectId`/
   * `objectWorkId`) — теперь обе проверки обязательны и выполняются до
   * записи.
   */
  async createDocument(tenantId: string, user: AuthenticatedUser, objectId: string, dto: CreateExecutiveDocumentDto) {
    const object = await this.prisma.constructionObject.findFirst({ where: { id: objectId, tenantId } });
    if (!object) throw new NotFoundException("Объект не найден");
    const work = await this.prisma.objectWork.findFirst({ where: { id: dto.objectWorkId, tenantId } });
    if (!work) throw new NotFoundException("Работа не найдена");
    if (work.objectId !== objectId) {
      throw new BadRequestException("Работа принадлежит другому объекту — objectWorkId не соответствует объекту в URL");
    }
    // Автоматически сформированный документ всегда стартует как DRAFT (ТЗ п.27) — не считается юридически подтверждённым.
    const doc = await this.prisma.executiveDocument.create({
      data: { tenantId, objectId, objectWorkId: dto.objectWorkId, type: dto.type as any, number: dto.number, status: "DRAFT", createdBy: user.name },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ExecutiveDocument", entityId: doc.id, action: `Сформирован документ «${dto.type}» (DRAFT) по «${work.name}»` });
    return doc;
  }

  async approveDocument(tenantId: string, user: AuthenticatedUser, id: string, dto: ApproveDocumentDto) {
    const doc = await this.prisma.executiveDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException("Документ не найден");
    const updated = await this.prisma.executiveDocument.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: user.name, approvedAt: new Date() },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ExecutiveDocument", entityId: id, action: `Документ «${doc.type}» подтверждён ПТО (${user.name})`, newValue: dto });

    // Продвигаем воронку потенциала закрытия (ТЗ §31, этап 2 -> 3): как
    // только у работы ВСЕ сформированные документы ИД подтверждены (APPROVED),
    // считаем принятый объём "готовым по ИД". Реальное обновление
    // ObjectWork.executiveDocsReadyQuantity, а не просто статус документа —
    // именно это поле читает PotentialClosingService через FinancialService.
    const work = await this.prisma.objectWork.findFirst({ where: { id: doc.objectWorkId, tenantId } });
    if (work) {
      const siblingDocs = await this.prisma.executiveDocument.findMany({ where: { tenantId, objectWorkId: work.id } });
      const allApproved = siblingDocs.length > 0 && siblingDocs.every((d) => d.status === "APPROVED");
      if (allApproved && Number(work.executiveDocsReadyQuantity) < Number(work.acceptedQuantity)) {
        await this.prisma.objectWork.update({ where: { id: work.id }, data: { executiveDocsReadyQuantity: work.acceptedQuantity } });
        await this.audit.log({
          tenantId,
          userId: user.id,
          entityType: "ObjectWork",
          entityId: work.id,
          action: `ИД по работе «${work.name}» полностью готова — объём ${work.acceptedQuantity} ${work.unit} готов к передаче в СДО`,
        });
      }
    }
    return updated;
  }

  /**
   * ХАРДЕНИНГ-ФИКС (integrity pass): раньше `executiveDocumentPackageItem`
   * создавались из сырых `dto.documentIds` без единой проверки — ни что
   * объект вообще существует у tenant, ни что документы существуют, ни
   * что они принадлежат ЭТОМУ tenant/объекту. Можно было собрать пакет из
   * документов чужого объекта того же tenant или (что серьёзнее) прямо
   * подставить documentId чужого tenant. Теперь все проверки выполняются
   * ДО транзакции создания пакета — при любом несоответствии не создаётся
   * ни пакет, ни одна package item.
   */
  async createPackage(tenantId: string, user: AuthenticatedUser, objectId: string, dto: CreatePackageDto) {
    const object = await this.prisma.constructionObject.findFirst({ where: { id: objectId, tenantId } });
    if (!object) throw new NotFoundException("Объект не найден");

    const uniqueIds = Array.from(new Set(dto.documentIds));
    if (uniqueIds.length === 0) {
      throw new BadRequestException("Пакет не может быть пустым — укажите хотя бы один документ");
    }

    const documents = await this.prisma.executiveDocument.findMany({ where: { id: { in: uniqueIds } } });
    if (documents.length !== uniqueIds.length) {
      throw new BadRequestException("Один или несколько документов не найдены");
    }
    const wrongTenant = documents.find((d) => d.tenantId !== tenantId);
    if (wrongTenant) {
      throw new BadRequestException("Один или несколько документов принадлежат другому tenant");
    }
    const wrongObject = documents.find((d) => d.objectId !== objectId);
    if (wrongObject) {
      throw new BadRequestException("Один или несколько документов принадлежат другому объекту");
    }

    const pkg = await this.prisma.$transaction(async (tx) => {
      const p = await tx.executiveDocumentPackage.create({ data: { tenantId, objectId, status: "DRAFT", createdBy: user.name } });
      await tx.executiveDocumentPackageItem.createMany({ data: uniqueIds.map((documentId) => ({ packageId: p.id, documentId })) });
      return p;
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "ExecutiveDocumentPackage", entityId: pkg.id, action: `Сформирован пакет ИД из ${uniqueIds.length} документ(ов)` });
    return pkg;
  }

  findPackagesForObject(tenantId: string, objectId: string) {
    return this.prisma.executiveDocumentPackage.findMany({
      where: { tenantId, objectId },
      include: { documents: { include: { document: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Передача пакета в СДО (ТЗ п.26, 29 — endpoint /executive-packages/:id/transfer-sdo).
   * Обязательно прогоняет PtoPackageValidationService — без "зелёного света"
   * от domain-сервиса статус не меняется.
   *
   * ХАРДЕНИНГ-ФИКС (эта итерация): раньше статус пакета, создание SdoCase на
   * каждую работу и продвижение воронки (`transferredToSdoQuantity`)
   * выполнялись отдельными, не связанными между собой запросами — сбой
   * (обрыв соединения с БД, падение процесса) между ними мог оставить
   * пакет уже помеченным TRANSFERRED_TO_SDO, но без части SdoCase или без
   * обновления воронки по части работ: частично применённый бизнес-переход.
   * Теперь весь переход — package.status + SdoCase (создание/поиск) +
   * ObjectWork.transferredToSdoQuantity + запись PtoTransfer — один
   * `$transaction`: либо применяется целиком, либо не применяется вовсе.
   * Также раньше `sdoCase.findFirst` не фильтровался по tenantId (искал
   * "существующее дело СДО на эту работу" без учёта арендатора) — добавлено.
   *
   * `PtoTransfer` (ТЗ-модель для структурированного аудита самого факта
   * передачи — packageId уникален, ровно одна запись на пакет) была
   * объявлена в схеме, но нигде не создавалась — мёртвая сущность.
   * Использована здесь: одна запись `PtoTransfer` на пакет, внутри той же
   * транзакции (не подменяет общий `AuditLog`, который остаётся отдельным,
   * человекочитаемым журналом — `PtoTransfer` даёт структурированную,
   * однозначно адресуемую по `packageId` запись именно акта передачи).
   */
  async transferToSdo(tenantId: string, user: AuthenticatedUser, packageId: string) {
    const pkg = await this.prisma.executiveDocumentPackage.findFirst({
      where: { id: packageId, tenantId },
      include: { documents: { include: { document: { include: { objectWork: { include: { workType: true, workMaterials: { include: { materialBatch: { include: { documents: true } } } } } } } } } } },
    });
    if (!pkg) throw new NotFoundException("Пакет не найден");
    if (pkg.status === "TRANSFERRED_TO_SDO") {
      throw new BadRequestException("Пакет уже передан в СДО");
    }

    const workIds = Array.from(new Set(pkg.documents.map((d) => d.document.objectWorkId)));
    const worksInput = pkg.documents
      .map((d) => d.document.objectWork)
      .filter((w, idx, arr) => arr.findIndex((x) => x.id === w.id) === idx)
      .map((w) => ({
        workId: w.id,
        workName: w.name,
        requiresExecutiveDocs: w.workType.requiresExecutiveDocs,
        requiresMaterials: w.workType.requiresMaterials,
        hasMaterialWithValidDocument: w.workMaterials.some((wm) => wm.materialBatch.documents.length > 0),
      }));
    const docsInput = pkg.documents.map((d) => ({ workId: d.document.objectWorkId, type: d.document.type as ExecutiveDocumentType, status: d.document.status as ExecutiveDocumentStatus }));

    const validation = PtoPackageValidationService.validate(worksInput, docsInput);
    if (!validation.canTransfer) {
      throw new BadRequestException({ message: "Пакет нельзя передать в СДО", reasons: validation.reasons });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedPackage = await tx.executiveDocumentPackage.update({
        where: { id: packageId },
        data: { status: "TRANSFERRED_TO_SDO", completedAt: new Date() },
      });

      for (const workId of workIds) {
        // ХАРДЕНИНГ-ФИКС (integrity pass): существование проверяется по
        // паре (executiveDocumentPackageId, objectWorkId) — ровно тем же
        // ключом, что и новый @@unique на SdoCase, а не только по
        // objectWorkId. Раньше (при одиночном @unique на пакет) работа с
        // ДВУМЯ разными objectWork в одном пакете падала бы на конфликт
        // уникальности при создании второго SdoCase; после фикса схемы
        // (one-to-many) это больше не проблема, а по objectWorkId-only
        // проверка была бы, наоборот, СЛИШКОМ широкой: она бы пропускала
        // создание нового SdoCase для работы, уже имеющей дело СДО от
        // ДРУГОГО пакета, — что противоречит смыслу нового составного
        // ключа (по одному делу на каждую пару пакет+работа).
        const exists = await tx.sdoCase.findFirst({ where: { tenantId, objectWorkId: workId, executiveDocumentPackageId: packageId } });
        if (!exists) {
          await tx.sdoCase.create({
            data: { tenantId, objectId: pkg.objectId, objectWorkId: workId, executiveDocumentPackageId: packageId, status: "TRANSFERRED", ptoTransferredAt: new Date(), ptoTransferredBy: user.name },
          });
        }
        // Продвигаем воронку (ТЗ §31, этап 3 -> 4): весь объём, готовый по ИД,
        // теперь считается переданным в СДО.
        const work = await tx.objectWork.findFirst({ where: { id: workId, tenantId } });
        if (work && Number(work.transferredToSdoQuantity) < Number(work.executiveDocsReadyQuantity)) {
          await tx.objectWork.update({ where: { id: workId }, data: { transferredToSdoQuantity: work.executiveDocsReadyQuantity } });
        }
      }

      await tx.ptoTransfer.create({
        data: { tenantId, packageId, transferredBy: user.name },
      });

      return updatedPackage;
    });

    await this.audit.log({ tenantId, userId: user.id, entityType: "ExecutiveDocumentPackage", entityId: packageId, action: "Пакет ИД передан в СДО" });
    return updated;
  }
}

@ApiTags("pto")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller()
export class PtoController {
  constructor(private pto: PtoService) {}

  @Get("objects/:objectId/executive-documents")
  @RequirePermissions(Permission.PTO_VIEW)
  findDocuments(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.pto.findDocumentsForObject(user.tenantId, objectId);
  }

  @Post("objects/:objectId/executive-documents")
  @RequirePermissions(Permission.PTO_EDIT)
  createDocument(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string, @Body() dto: CreateExecutiveDocumentDto) {
    return this.pto.createDocument(user.tenantId, user, objectId, dto);
  }

  @Post("executive-documents/:id/approve")
  @RequirePermissions(Permission.PTO_EDIT)
  approveDocument(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ApproveDocumentDto) {
    return this.pto.approveDocument(user.tenantId, user, id, dto);
  }

  @Get("objects/:objectId/executive-packages")
  @RequirePermissions(Permission.PTO_VIEW)
  findPackages(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.pto.findPackagesForObject(user.tenantId, objectId);
  }

  @Post("objects/:objectId/executive-packages")
  @RequirePermissions(Permission.PTO_EDIT)
  createPackage(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string, @Body() dto: CreatePackageDto) {
    return this.pto.createPackage(user.tenantId, user, objectId, dto);
  }

  @Post("executive-packages/:id/transfer-sdo")
  @RequirePermissions(Permission.PTO_TRANSFER_SDO)
  transfer(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.pto.transferToSdo(user.tenantId, user, id);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [PtoController],
  providers: [PtoService],
  exports: [PtoService],
})
export class PtoModule {}
