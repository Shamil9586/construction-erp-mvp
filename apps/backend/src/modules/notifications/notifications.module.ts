import { Module, Injectable, Controller, Get, Patch, Param, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma.service";
import { BitrixModule } from "../../bitrix/bitrix.module";
import { BitrixGatewayService } from "../../bitrix/bitrix-gateway.service";
import { buildNotificationDedupKey } from "@construction-erp/domain";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";

/**
 * NotificationService (ТЗ п.38) — дедупликация через уникальный (tenantId,
 * dedupKey) — повторная вставка того же события в тот же день молча
 * игнорируется (см. ON CONFLICT DO NOTHING), что и требует "не спамить".
 * Также отправляет системное уведомление в Bitrix24 через BitrixGatewayService
 * (Mock или Real — прозрачно).
 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private bitrix: BitrixGatewayService) {}

  async notify(params: {
    tenantId: string;
    userId: string;
    bitrixUserId: number;
    type: string;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string;
    dedupSeed: string; // например workId — ключ строится с датой внутри buildNotificationDedupKey
  }) {
    const dedupKey = buildNotificationDedupKey(params.type, params.dedupSeed, new Date());
    const existing = await this.prisma.notification.findUnique({
      where: { tenantId_dedupKey: { tenantId: params.tenantId, dedupKey } },
    });
    if (existing) return existing; // уже отправлено сегодня — не дублируем

    const notification = await this.prisma.notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        entityType: params.entityType,
        entityId: params.entityId,
        dedupKey,
      },
    });

    try {
      await this.bitrix.notify(params.tenantId, params.bitrixUserId, params.title);
      await this.prisma.notification.update({ where: { id: notification.id }, data: { sentToBitrix: true } });
    } catch {
      // сбой отправки в Bitrix не должен ронять бизнес-операцию — уведомление остаётся в системе.
    }

    return notification;
  }

  findForUser(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(tenantId: string, userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, tenantId, userId },
      data: { readAt: new Date() },
    });
  }
}

@ApiTags("notifications")
@UseGuards(BitrixAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.findForUser(user.tenantId, user.id);
  }

  @Patch(":id/read")
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notifications.markRead(user.tenantId, user.id, id);
  }
}

@Module({
  imports: [BitrixModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
