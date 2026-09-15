import { Module, Injectable, Controller, Get, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, IsNumber } from "class-validator";
import { PrismaService } from "../../common/prisma.service";
import { BitrixAuthGuard } from "../auth/bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { Permission } from "@construction-erp/domain";

export class CreateWorkCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() parentId?: string;
}

export class CreateWorkTypeDto {
  @IsUUID() categoryId!: string;
  @IsString() name!: string;
  @IsString() unit!: string;
}

/**
 * Справочники (ТЗ п.16) — расширяемые администратором: WorkCategory (иерархия),
 * WorkType. GET /dictionaries — сводная выдача для frontend-селектов.
 */
@Injectable()
export class DictionariesService {
  constructor(private prisma: PrismaService) {}

  async getAll(tenantId: string) {
    const [categories, workTypes, dictionaryItems] = await Promise.all([
      this.prisma.workCategory.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.workType.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
      this.prisma.dictionaryItem.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } }),
    ]);
    return { categories, workTypes, dictionaryItems };
  }

  createCategory(tenantId: string, dto: CreateWorkCategoryDto) {
    return this.prisma.workCategory.create({ data: { tenantId, name: dto.name, code: dto.code, parentId: dto.parentId } });
  }

  createWorkType(tenantId: string, dto: CreateWorkTypeDto) {
    return this.prisma.workType.create({ data: { tenantId, categoryId: dto.categoryId, name: dto.name, unit: dto.unit } });
  }
}

@ApiTags("dictionaries")
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("dictionaries")
export class DictionariesController {
  constructor(private dictionaries: DictionariesService) {}

  @Get()
  @RequirePermissions(Permission.WORK_VIEW)
  getAll(@CurrentUser() user: AuthenticatedUser) {
    return this.dictionaries.getAll(user.tenantId);
  }

  @Post("categories")
  @RequirePermissions(Permission.ADMIN_DICTIONARIES)
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkCategoryDto) {
    return this.dictionaries.createCategory(user.tenantId, dto);
  }

  @Post("work-types")
  @RequirePermissions(Permission.ADMIN_DICTIONARIES)
  createWorkType(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkTypeDto) {
    return this.dictionaries.createWorkType(user.tenantId, dto);
  }
}

@Module({
  controllers: [DictionariesController],
  providers: [DictionariesService],
})
export class DictionariesModule {}
