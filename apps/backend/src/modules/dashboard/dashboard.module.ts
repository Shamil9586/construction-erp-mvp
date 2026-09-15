import { Module, Injectable, Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { FinancialModule } from "../financial/financial.module";
import { FinancialService } from "../financial/financial.module";
import { Permission } from "@construction-erp/domain";

export interface AttentionItem {
  entityType: string;
  entityId: string;
  objectId: string;
  objectName: string;
  severity: "YELLOW" | "RED";
  title: string;
  reason: string;
  daysOverdue: number;
  moneyImpact: number;
  responsible: string | null;
  recommendedAction: string;
}

/**
 * GET /dashboard/executive (ТЗ п.33, 41) — экран генерального директора.
 * Не описание, а реальная агрегация из Prisma + domain-сервисов
 * (EscalationService, PotentialClosingService через FinancialService).
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private financial: FinancialService) {}

  async executive(tenantId: string) {
    const objects = await this.prisma.constructionObject.findMany({
      where: { tenantId, status: { in: ["ACTIVE", "AT_RISK", "DELAYED"] } },
      include: { projectManager: { select: { name: true } }, contractors: { include: { contractor: true } } },
    });

    const kpi = {
      activeObjects: objects.length,
      greenObjects: objects.filter((o) => o.healthStatus === "GREEN").length,
      yellowObjects: objects.filter((o) => o.healthStatus === "YELLOW").length,
      redObjects: objects.filter((o) => o.healthStatus === "RED").length,
      grayObjects: objects.filter((o) => o.healthStatus === "GRAY").length,
      delayedWorks: await this.prisma.objectWork.count({ where: { tenantId, scheduleStatus: { in: ["BEHIND", "CRITICAL"] } } }),
      openInspectionIssues: await this.prisma.inspectionIssue.count({ where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      criticalInspectionIssues: await this.prisma.inspectionIssue.count({ where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, severity: "CRITICAL" } }),
      awaitingInspection: await this.prisma.constructionInspection.count({ where: { tenantId, status: { in: ["WAITING", "IN_REVIEW", "REINSPECTION"] } } }),
      ptoBacklog: await this.prisma.executiveDocumentPackage.count({ where: { tenantId, status: { in: ["DRAFT", "IN_PROGRESS", "READY"] } } }),
      sdoBacklog: await this.prisma.sdoCase.count({ where: { tenantId, status: { in: ["TRANSFERRED", "IN_PROGRESS", "NEEDS_CLARIFICATION"] } } }),
      closedThisMonth: 0,
      potentialClosing: 0,
      forecastClosing: 0,
    };

    let potentialTotal = 0;
    let closedThisMonthTotal = 0;
    const monthPrefix = new Date().toISOString().slice(0, 7);

    const attentionRequired: AttentionItem[] = [];

    for (const object of objects) {
      const summary = await this.financial.objectSummary(tenantId, object.id);
      potentialTotal += summary.potentialClosing;

      const closings = await this.prisma.financialClosing.findMany({ where: { tenantId, objectId: object.id, period: monthPrefix } });
      closedThisMonthTotal += closings.reduce((s, c) => s + Number(c.amount), 0);

      const worksAtRisk = await this.prisma.objectWork.findMany({
        where: { tenantId, objectId: object.id, scheduleStatus: { in: ["BEHIND", "CRITICAL"] } },
        include: { responsibleUser: { select: { name: true } } },
      });
      for (const w of worksAtRisk) {
        attentionRequired.push({
          entityType: "ObjectWork",
          entityId: w.id,
          objectId: object.id,
          objectName: object.name,
          severity: w.scheduleStatus === "CRITICAL" ? "RED" : "YELLOW",
          title: w.name,
          reason: `Факт ${Number(w.progressPercent).toFixed(0)}%, отклонение ${Number(w.varianceP).toFixed(0)} п.п.`,
          daysOverdue: w.delayDays,
          moneyImpact: w.estimatedCost ? (Number(w.estimatedCost) * Math.abs(Number(w.varianceP))) / 100 : 0,
          responsible: w.responsibleUser?.name ?? null,
          recommendedAction: w.scheduleStatus === "CRITICAL" ? "Требуется вмешательство руководства — эскалация" : "Проконтролировать темп выполнения на этой неделе",
        });
      }

      const criticalIssues = await this.prisma.inspectionIssue.findMany({
        where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, severity: "CRITICAL", inspection: { objectId: object.id } },
        include: { responsibleUser: { select: { name: true } }, inspection: { include: { objectWork: true } } },
      });
      for (const issue of criticalIssues) {
        const daysOpen = Math.round((Date.now() - issue.createdAt.getTime()) / 86_400_000);
        attentionRequired.push({
          entityType: "InspectionIssue",
          entityId: issue.id,
          objectId: object.id,
          objectName: object.name,
          severity: "RED",
          title: `Критическое замечание: ${issue.title}`,
          reason: `По работе «${issue.inspection.objectWork.name}» — технологическая блокировка следующих этапов`,
          daysOverdue: daysOpen,
          moneyImpact: 0,
          responsible: issue.responsibleUser?.name ?? null,
          recommendedAction: "Устранить замечание — блокирует технологический переход",
        });
      }

      if (summary.potentialClosing > 1_000_000) {
        attentionRequired.push({
          entityType: "ConstructionObject",
          entityId: object.id,
          objectId: object.id,
          objectName: object.name,
          severity: "YELLOW",
          title: "Большой потенциал закрытия",
          reason: `${(summary.potentialClosing / 1_000_000).toFixed(1)} млн ₽ потенциального закрытия ещё не отражены в финансах`,
          daysOverdue: 0,
          moneyImpact: summary.potentialClosing,
          responsible: object.projectManager?.name ?? null,
          recommendedAction: "Ускорить продвижение по воронке ПТО -> СДО -> закрытие",
        });
      }
    }

    kpi.potentialClosing = potentialTotal;
    kpi.forecastClosing = potentialTotal + closedThisMonthTotal;
    kpi.closedThisMonth = closedThisMonthTotal;

    attentionRequired.sort((a, b) => (b.severity === "RED" ? 1 : 0) - (a.severity === "RED" ? 1 : 0) || b.moneyImpact - a.moneyImpact);

    return { kpi, attentionRequired: attentionRequired.slice(0, 50) };
  }
}

@ApiTags("dashboard")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get("executive")
  @RequirePermissions(Permission.OBJECT_VIEW)
  executive(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.executive(user.tenantId);
  }
}

@Module({
  imports: [FinancialModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
