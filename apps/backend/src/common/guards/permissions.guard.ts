import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, Permission } from "@construction-erp/domain";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";

/**
 * PermissionsGuard — единая точка проверки RBAC на backend (ТЗ п.12, 49).
 * Работает поверх AuthenticatedUser.role, заполненного BitrixAuthGuard.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException("Не авторизован");

    const allowed = required.every((p) => hasPermission(user.role, p));
    if (!allowed) {
      throw new ForbiddenException(`Недостаточно прав. Требуется: ${required.join(", ")}`);
    }
    return true;
  }
}
