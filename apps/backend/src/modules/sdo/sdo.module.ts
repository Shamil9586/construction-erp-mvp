import { Module, Injectable, Controller, Get, Post, Param, Body, UseGuards, NotFoundException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { ObjectsModule } from "../objects/objects.module";
import { ObjectsService } from "../objects/objects.module";
import { Permission } from "@construction-erp/domain";

export class CalculateSdoCaseDto {
  @IsNumber() calculatedValue!: number;
  @IsOptional() @IsString() comment?: string;
}

export class CreateFinancialClosingDto {
  @IsString() period!: string; // "2026-09"
  @IsNumber() amount!: number;
}

/**
 * СДО (ТЗ п.29-30). НЕ создаёт полноценный сметный комплекс и НЕ заменяет
 * Гранд-Смету — только фиксирует результат осмечивания, выполненного вне
 * системы, и финансовое закрытие.
 */
@Injectable()
export class SdoService {
  constructor(private prisma: PrismaService, private audit: AuditService, private objects: ObjectsService) {}

  findForObject(tenantId: string, objectId: string) {
    return this.prisma.sdoCase.findMany({
      where: { tenantId, objectId },
      include: { objectWork: { select: { name: true, unit: true } }, financialClosings: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const sdoCase = await this.prisma.sdoCase.findFirst({ where: { id, tenantId }, include: { objectWork: true, financialClosings: true } });
    if (!sdoCase) throw new NotFoundException("Дело СДО не найдено");
    return sdoCase;
  }

  async calculate(tenantId: string, user: AuthenticatedUser, id: string, dto: CalculateSdoCaseDto) {
    const sdoCase = await this.prisma.sdoCase.findFirst({ where: { id, tenantId } });
    if (!sdoCase) throw new NotFoundException("Дело СДО не найдено");
    const updated = await this.prisma.sdoCase.update({
      where: { id },
      data: { status: "CALCULATED", calculatedValue: dto.calculatedValue, calculatedAt: new Date(), comment: dto.comment },
    });
    await this.audit.log({ tenantId, userId: user.id, entityType: "SdoCase", entityId: id, action: `СДО осметило: ${dto.calculatedValue} ₽` });
    return updated;
  }

  async close(tenantId: string, user: AuthenticatedUser, id: string, dto: CreateFinancialClosingDto) {
    const sdoCase = await this.prisma.sdoCase.findFirst({ where: { id, tenantId } });
    if (!sdoCase) throw new NotFoundException("Дело СДО не найдено");

    const [closing] = await this.prisma.$transaction([
      this.prisma.financialClosing.create({
        data: { tenantId, objectId: sdoCase.objectId, sdoCaseId: id, period: dto.period, amount: dto.amount, createdBy: user.name },
      }),
      this.prisma.sdoCase.update({ where: { id }, data: { status: "CLOSED", acceptedClosingValue: dto.amount, closedAt: new Date() } }),
    ]);

    await this.audit.log({ tenantId, userId: user.id, entityType: "FinancialClosing", entityId: closing.id, action: `Финансовое закрытие: ${dto.amount} ₽ за ${dto.period}` });
    await this.objects.recalculateHealth(tenantId, sdoCase.objectId);
    return closing;
  }
}

@ApiTags("sdo")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("sdo")
export class SdoController {
  constructor(private sdo: SdoService) {}

  @Get("objects/:objectId")
  @RequirePermissions(Permission.SDO_VIEW)
  findForObject(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.sdo.findForObject(user.tenantId, objectId);
  }

  @Get(":id")
  @RequirePermissions(Permission.SDO_VIEW)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.sdo.findOne(user.tenantId, id);
  }

  @Post(":id/calculate")
  @RequirePermissions(Permission.SDO_EDIT)
  calculate(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CalculateSdoCaseDto) {
    return this.sdo.calculate(user.tenantId, user, id, dto);
  }

  @Post(":id/close")
  @RequirePermissions(Permission.SDO_CLOSE)
  close(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreateFinancialClosingDto) {
    return this.sdo.close(user.tenantId, user, id, dto);
  }
}

@Module({
  imports: [AuditModule, ObjectsModule],
  controllers: [SdoController],
  providers: [SdoService],
  exports: [SdoService],
})
export class SdoModule {}
