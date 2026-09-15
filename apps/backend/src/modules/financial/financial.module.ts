import { Module, Injectable, Controller, Get, Param, Query, UseGuards, NotFoundException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { Permission, PotentialClosingService } from "@construction-erp/domain";

/**
 * FinancialService — сводка по объекту (ТЗ п.30-31): стоимость объекта,
 * фактически закрыто, готово к закрытию, в СДО, выполнено физически но не
 * передано, потенциал закрытия (PotentialClosingService — реальный вызов
 * domain-сервиса), остаток.
 */
@Injectable()
export class FinancialService {
  constructor(private prisma: PrismaService) {}

  async findClosingsForObject(tenantId: string, objectId: string) {
    return this.prisma.financialClosing.findMany({ where: { tenantId, objectId }, orderBy: { closingDate: "desc" } });
  }

  async objectSummary(tenantId: string, objectId: string) {
    const object = await this.prisma.constructionObject.findFirst({ where: { id: objectId, tenantId } });
    if (!object) throw new NotFoundException("Объект не найден");

    const works = await this.prisma.objectWork.findMany({ where: { tenantId, objectId } });
    const sdoCases = await this.prisma.sdoCase.findMany({ where: { tenantId, objectId } });
    const closings = await this.prisma.financialClosing.findMany({ where: { tenantId, objectId } });

    const potential = PotentialClosingService.calculate(
      works
        .filter((w) => w.estimatedCost !== null)
        .map((w) => {
          const sdoCase = sdoCases.find((s) => s.objectWorkId === w.id);
          const closedForWork = closings
            .filter((c) => sdoCase && c.sdoCaseId === sdoCase.id)
            .reduce((s, c) => s + Number(c.amount), 0);
          return {
            workId: w.id,
            workName: w.name,
            estimatedCost: Number(w.estimatedCost),
            plannedQuantity: Number(w.plannedQuantity),
            actualQuantity: Number(w.actualQuantity),
            acceptedQuantity: Number(w.acceptedQuantity),
            executiveDocsReadyQuantity: Number(w.executiveDocsReadyQuantity),
            transferredToSdoQuantity: Number(w.transferredToSdoQuantity),
            calculatedValue: sdoCase ? Number(sdoCase.calculatedValue ?? 0) : 0,
            closedValue: closedForWork,
          };
        }),
    );

    const closedTotal = closings.reduce((s, c) => s + Number(c.amount), 0);
    const inSdoNotCalculated = sdoCases.filter((s) => ["TRANSFERRED", "IN_PROGRESS", "NEEDS_CLARIFICATION"].includes(s.status)).length;

    return {
      objectId,
      objectName: object.name,
      contractValue: object.contractValue,
      closedTotal,
      readyToClose: potential.stages.find((s) => s.stage === 5)?.amount ?? 0,
      inSdo: potential.stages.find((s) => s.stage === 4)?.amount ?? 0,
      executedNotTransferred: (potential.stages.find((s) => s.stage === 2)?.amount ?? 0) + (potential.stages.find((s) => s.stage === 3)?.amount ?? 0),
      potentialClosing: potential.potentialClosingValue,
      remaining: object.contractValue ? Number(object.contractValue) - closedTotal : null,
      stages: potential.stages,
      byWork: potential.byWork,
      inSdoBacklogCount: inSdoNotCalculated,
    };
  }
}

@ApiTags("financial")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("financial-closings")
export class FinancialController {
  constructor(private financial: FinancialService) {}

  @Get("objects/:objectId")
  @RequirePermissions(Permission.FINANCE_VIEW)
  findForObject(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.financial.findClosingsForObject(user.tenantId, objectId);
  }

  @Get("objects/:objectId/summary")
  @RequirePermissions(Permission.FINANCE_VIEW)
  summary(@CurrentUser() user: AuthenticatedUser, @Param("objectId") objectId: string) {
    return this.financial.objectSummary(user.tenantId, objectId);
  }
}

@Module({
  controllers: [FinancialController],
  providers: [FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
