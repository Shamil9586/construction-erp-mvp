import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Role } from "@construction-erp/domain";

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  bitrixUserId: number;
  name: string;
  role: Role;
}

/**
 * Заполняется BitrixAuthGuard (см. modules/auth) из сессии/JWT, выданного
 * после установки/входа через Bitrix24 OAuth. На MockBitrixAdapter —
 * фиксированный тестовый пользователь (см. modules/auth/mock-session.ts).
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
