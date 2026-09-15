import { SetMetadata } from "@nestjs/common";
import { Permission } from "@construction-erp/domain";

export const PERMISSIONS_KEY = "permissions";

/**
 * @RequirePermissions(Permission.WORK_UPDATE_PROGRESS) на контроллере/методе.
 * Backend — источник истины для security (ТЗ п.12); frontend-проверки — только UX.
 */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
