import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";

/**
 * AuditService (ТЗ п.35) — обязательное логирование изменений объёмов, сроков,
 * ответственных, факта, статусов, решений СК, замечаний, допусков, ПТО,
 * передачи в СДО, финансовых сумм. AuditLog неизменяем для обычного
 * пользователя — нет UPDATE/DELETE endpoint-ов в AuditController.
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    tenantId: string;
    userId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    ip?: string;
  }) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId ?? null,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        oldValue: params.oldValue as any,
        newValue: params.newValue as any,
        ip: params.ip,
      },
    });
  }

  async findForEntity(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, role: true } } },
    });
  }

  async findRecent(tenantId: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, role: true } } },
    });
  }
}
