import { Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixModule } from "../../bitrix/bitrix.module";
import { BitrixGatewayService } from "../../bitrix/bitrix-gateway.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { Permission, Role } from "@construction-erp/domain";

class UpdateUserRoleDto {
  @IsEnum(Role)
  role!: Role;
}

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

  async updateRole(tenantId: string, userId: string, role: Role) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException("Пользователь не найден");

    if (user.role === Role.ADMIN && role !== Role.ADMIN && user.isActive) {
      const activeAdmins = await this.prisma.user.count({ where: { tenantId, role: Role.ADMIN, isActive: true } });
      if (activeAdmins <= 1) {
        throw new ConflictException("Нельзя снять роль ADMIN у последнего активного администратора tenant");
      }
    }

    return this.prisma.user.update({ where: { id: user.id }, data: { role } });
  }
}

@ApiTags("users")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("users")
export class UsersController {
  constructor(private users: UsersService) {}

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

  @Patch(":id/role")
  @RequirePermissions(Permission.ADMIN_USERS)
  updateRole(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateUserRoleDto) {
    return this.users.updateRole(user.tenantId, id, dto.role);
  }
}

@Module({
  imports: [BitrixModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
