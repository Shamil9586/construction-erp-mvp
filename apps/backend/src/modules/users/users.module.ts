import { Module, Injectable, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma.service";
import { BitrixModule } from "../../bitrix/bitrix.module";
import { BitrixGatewayService } from "../../bitrix/bitrix-gateway.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { Permission, Role } from "@construction-erp/domain";

/**
 * UsersService.syncFromBitrix — BitrixUserProvider.getUsers() (Mock или Real)
 * -> upsert локальных User по bitrixUserId (ТЗ п.11: основной внешний ID,
 * НЕ email). Роль/права остаются управляемыми внутри приложения (ADMIN_USERS),
 * Bitrix24 не диктует RBAC этой системы.
 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private bitrix: BitrixGatewayService) {}

  findAll(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  }

  async syncFromBitrix(tenantId: string) {
    const bitrixUsers = await this.bitrix.getUsers(tenantId);
    let created = 0;
    let updated = 0;
    for (const bu of bitrixUsers) {
      const existing = await this.prisma.user.findUnique({ where: { tenantId_bitrixUserId: { tenantId, bitrixUserId: bu.bitrixUserId } } });
      if (existing) {
        await this.prisma.user.update({ where: { id: existing.id }, data: { name: bu.name, email: bu.email, position: bu.position, isActive: bu.isActive } });
        updated++;
      } else {
        await this.prisma.user.create({
          data: { tenantId, bitrixUserId: bu.bitrixUserId, name: bu.name, email: bu.email, position: bu.position, isActive: bu.isActive, role: Role.CONTRACTOR_VIEWER },
        });
        created++;
      }
    }
    return { created, updated, total: bitrixUsers.length };
  }
}

@ApiTags("users")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("users")
export class UsersController {
  constructor(private users: UsersService) {}

  // ХАРДЕНИНГ-ФИКС (эта итерация): раньше требовал ADMIN_USERS, из-за чего ни
  // один реальный пользователь (кроме ADMIN) не мог получить список
  // сотрудников — а он нужен фронтенду для самых обычных операций: выбрать
  // РП при создании/редактировании объекта, выбрать ответственного за
  // замечание СК и т.д. Список пользователей (id/имя/роль) сам по себе не
  // более чувствителен, чем список объектов — понижено до OBJECT_VIEW
  // (есть у всех ролей, см. packages/domain/src/rbac.ts). Административные
  // операции (синхронизация с Bitrix24) остаются за ADMIN_USERS ниже.
  @Get()
  @RequirePermissions(Permission.OBJECT_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findAll(user.tenantId);
  }

  @Post("sync")
  @RequirePermissions(Permission.ADMIN_USERS)
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.users.syncFromBitrix(user.tenantId);
  }
}

@Module({
  imports: [BitrixModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
