import { Module, Injectable, Controller, Get, Post, Param, Body, UseGuards, NotFoundException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsString, IsOptional } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { Permission } from "@construction-erp/domain";

export class CreateContractorDto {
  @IsString() name!: string;
  @IsOptional() @IsString() inn?: string;
}

/**
 * ContractorPerformanceService (ТЗ п.34) — MVP-версия: агрегация факта/плана/
 * отставания/замечаний/финансов по объектам субподрядчика. Архитектурно
 * готова к добавлению рейтинга в следующей итерации (весовые коэффициенты,
 * историческая дисциплина — TODO, вне MVP).
 */
@Injectable()
export class ContractorsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  findAll(tenantId: string) {
    return this.prisma.contractor.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  }

  async findOne(tenantId: string, id: string) {
    const contractor = await this.prisma.contractor.findFirst({ where: { id, tenantId } });
    if (!contractor) throw new NotFoundException("Субподрядчик не найден");

    const works = await this.prisma.objectWork.findMany({
      where: { tenantId, contractorId: id },
      include: { object: { select: { id: true, name: true, healthStatus: true } } },
    });

    const openIssues = await this.prisma.inspectionIssue.count({
      where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, inspection: { objectWork: { contractorId: id } } },
    });
    const overdueIssues = await this.prisma.inspectionIssue.count({
      where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() }, inspection: { objectWork: { contractorId: id } } },
    });

    const totalPlanned = works.reduce(
      (s: number, w: any) => s + Number(w.plannedQuantity),
      0,
    );

    const totalActual = works.reduce(
      (s: number, w: any) => s + Number(w.actualQuantity),
      0,
    );

    const worksByObject = new Map<
      string,
      { objectId: string; objectName: string; healthStatus: string; works: number }
    >();

    for (const w of works) {
      const key = w.objectId;

      const entry =
        worksByObject.get(key) ?? {
          objectId: w.objectId,
          objectName: w.object.name,
          healthStatus: w.object.healthStatus,
          works: 0,
        };

      entry.works++;

      worksByObject.set(key, entry);
    }

return {
  contractor,
  objects: Array.from(worksByObject.values()),
  totalWorks: works.length,
+    avgProgressPercent: works.length
+      ? works.reduce(
+          (s: number, w: any) => s + Number(w.progressPercent),
+          0,
+        ) / works.length
+      : 0,
  openIssues,
  overdueIssues,
  physicalReadinessRatio: totalPlanned > 0
    ? (totalActual / totalPlanned) * 100
    : 0,
};

    return {
      contractor,
      objects: Array.from(worksByObject.values()),
      totalWorks: works.length,
      avgProgressPercent: works.length ? works.reduce((s, w) => s + Number(w.progressPercent), 0) / works.length : 0,
      openIssues,
      overdueIssues,
      physicalReadinessRatio: totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0,
    };
  }

  async create(tenantId: string, user: AuthenticatedUser, dto: CreateContractorDto) {
    const contractor = await this.prisma.contractor.create({ data: { tenantId, name: dto.name, inn: dto.inn } });
    await this.audit.log({ tenantId, userId: user.id, entityType: "Contractor", entityId: contractor.id, action: `Создан субподрядчик «${contractor.name}»` });
    return contractor;
  }
}

@ApiTags("contractors")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("contractors")
export class ContractorsController {
  constructor(private contractors: ContractorsService) {}

  @Get()
  @RequirePermissions(Permission.OBJECT_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.contractors.findAll(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(Permission.OBJECT_VIEW)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.contractors.findOne(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(Permission.ADMIN_DICTIONARIES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContractorDto) {
    return this.contractors.create(user.tenantId, user, dto);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [ContractorsController],
  providers: [ContractorsService],
  exports: [ContractorsService],
})
export class ContractorsModule {}
