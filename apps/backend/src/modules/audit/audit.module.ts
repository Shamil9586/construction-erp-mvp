import { Module } from "@nestjs/common";
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "./audit.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { Permission } from "@construction-erp/domain";

@ApiTags("audit")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("audit")
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  @RequirePermissions(Permission.OBJECT_VIEW)
  findRecent(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    return this.audit.findRecent(user.tenantId, limit ? Number(limit) : undefined);
  }

  @Get(":entityType/:entityId")
  @RequirePermissions(Permission.OBJECT_VIEW)
  findForEntity(@CurrentUser() user: AuthenticatedUser, @Param("entityType") entityType: string, @Param("entityId") entityId: string) {
    return this.audit.findForEntity(user.tenantId, entityType, entityId);
  }
}

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
