import { Module, Injectable, Controller, Get, Post, Param, Body, UseGuards, NotFoundException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsString, IsOptional, IsUUID, IsNumber, IsIn, IsDateString } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { Permission } from "@construction-erp/domain";

export class CreateMaterialBatchDto {
  @IsString() materialName!: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsString() batchNumber!: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsUUID() objectId?: string;
}

export class AddMaterialDocumentDto {
  @IsIn(["CERTIFICATE", "PASSPORT", "DECLARATION", "QUALITY_DOCUMENT", "OTHER"]) type!: string;
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validUntil?: string;
}

export class LinkMaterialToWorkDto {
  @IsUUID() objectWorkId!: string;
  @IsUUID() materialBatchId!: string;
  @IsNumber() quantity!: number;
}

/**
 * Материалы (ТЗ п.28): Работа -> материал -> партия -> сертификаты/паспорт.
 * Foundation для MVP — без полноценного складского учёта.
 */
@Injectable()
export class MaterialsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async createBatch(tenantId: string, user: AuthenticatedUser, dto: CreateMaterialBatchDto) {
    let material = await this.prisma.material.findFirst({ where: { tenantId, name: dto.materialName } });
    if (!material) {
      material = await this.prisma.material.create({ data: { tenantId, name: dto.materialName, manufacturer: dto.manufacturer } });
    }
    const batch = await this.prisma.materialBatch.create({
      data: {
        tenantId,
        materialId: material.id,
        batchNumber: dto.batchNumber,
        supplier: dto.supplier,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
        objectId: dto.objectId,
      },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "MaterialBatch", entityId: batch.id, action: `Заведена партия материала «${dto.materialName}» (${dto.batchNumber})` });
    return batch;
  }

  async addDocument(tenantId: string, user: AuthenticatedUser, batchId: string, dto: AddMaterialDocumentDto) {
    const batch = await this.prisma.materialBatch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw new NotFoundException("Партия не найдена");
    const doc = await this.prisma.materialDocument.create({
      data: {
        tenantId,
        materialBatchId: batchId,
        type: dto.type as any,
        number: dto.number,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "MaterialDocument", entityId: doc.id, action: `Прикреплён документ «${dto.type}» к партии` });
    return doc;
  }

  async linkToWork(tenantId: string, user: AuthenticatedUser, dto: LinkMaterialToWorkDto) {
    const link = await this.prisma.workMaterial.create({
      data: { objectWorkId: dto.objectWorkId, materialBatchId: dto.materialBatchId, quantity: dto.quantity },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "WorkMaterial", entityId: link.id, action: `Материал привязан к работе — ${dto.quantity}` });
    return link;
  }

  findForObject(tenantId: string, objectId: string) {
    return this.prisma.materialBatch.findMany({
      where: { tenantId, objectId },
      include: { material: true, documents: true, workLinks: { include: { objectWork: { select: { name: true } } } } },
      orderBy: { deliveryDate: "desc" },
    });
  }
}

@ApiTags("materials")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("materials")
export class MaterialsController {
  constructor(private materials: MaterialsService) {}

  @Post("batches")
  @RequirePermissions(Permission.PTO_EDIT)
  createBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMaterialBatchDto) {
    return this.materials.createBatch(user.tenantId, user, dto);
  }

  @Post("batches/:id/documents")
  @RequirePermissions(Permission.PTO_EDIT)
  addDocument(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: AddMaterialDocumentDto) {
    return this.materials.addDocument(user.tenantId, user, id, dto);
  }

  @Post("link")
  @RequirePermissions(Permission.PTO_EDIT)
  link(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkMaterialToWorkDto) {
    return this.materials.linkToWork(user.tenantId, user, dto);
  }

  @Get("objects/:objectId")
  @RequirePermissions(Permission.PTO_VIEW)
  findForObject(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.materials.findForObject(user.tenantId, objectId);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
