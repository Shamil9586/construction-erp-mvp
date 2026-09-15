import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, InternalServerErrorException, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { verifySessionToken } from "./session.util";

/**
 * BitrixAuthGuard — определяет текущего пользователя и tenant для запроса.
 *
 * ДВА РЕЖИМА, управляемые переменной окружения AUTH_MODE (hardening ТЗ п.9
 * — исходная схема безусловно доверяла клиентским заголовкам, что
 * допустимо только для демонстрации/разработки):
 *
 * - AUTH_MODE=demo (по умолчанию вне production): личность берётся
 *   напрямую из заголовков X-Tenant-Id / X-Bitrix-User-Id, которые задаёт
 *   ЛЮБОЙ клиент — включая demo-переключатель во frontend
 *   (apps/frontend/src/lib/auth.tsx). Это НЕ безопасно для реального
 *   Bitrix24-портала: клиент может прислать чужой bitrixUserId и получить
 *   права другого сотрудника. Подходит только для локальной разработки и
 *   демонстрации на сид-данных.
 *
 * - AUTH_MODE=bitrix (обязателен в production): заголовки X-Tenant-Id/
 *   X-Bitrix-User-Id полностью ИГНОРИРУЮТСЯ. Личность берётся только из
 *   подписанного сервером токена (`Authorization: Bearer <token>`,
 *   session.util.ts, HMAC-SHA256 с секретом SESSION_SECRET), который
 *   backend сам выпускает после проверки подписи Bitrix24 при открытии
 *   placement (см. install.controller.ts). Сам механизм проверки подписи
 *   Bitrix24 и обмена placement-контекста на такой токен —
 *   REQUIRES BITRIX24 TEST PORTAL VERIFICATION (нет доступа к реальному
 *   порталу в этой среде разработки, см. docs/bitrix24-integration.md).
 *   Но сам guard уже сегодня физически не даёт клиенту подменить личность
 *   в этом режиме — подделать HMAC-подпись без SESSION_SECRET невозможно
 *   (см. apps/backend/test/session.util.node-test.ts — 6/6 реально
 *   выполненных тестов, включая попытку подмены bitrixUserId).
 *
 * ЖЁСТКОЕ ОГРАНИЧЕНИЕ: AUTH_MODE=demo в NODE_ENV=production запрещён —
 * приложение отказывается обслуживать запросы (fail closed), а не тихо
 * работает в небезопасном режиме. Это защита от «забыли поменять .env
 * при разворачивании на проде».
 */
@Injectable()
export class BitrixAuthGuard implements CanActivate {
  private readonly logger = new Logger(BitrixAuthGuard.name);

  constructor(private prisma: PrismaService) {}

  private authMode(): "demo" | "bitrix" {
    const mode = (process.env.AUTH_MODE ?? "demo").toLowerCase();
    if (mode !== "demo" && mode !== "bitrix") {
      throw new InternalServerErrorException(`Некорректный AUTH_MODE="${mode}" — допустимо только "demo" или "bitrix"`);
    }
    if (mode === "demo" && process.env.NODE_ENV === "production") {
      // Fail closed: не обслуживаем запросы, а не молча работаем в
      // спуфабельном режиме на боевом окружении.
      throw new InternalServerErrorException(
        "AUTH_MODE=demo запрещён при NODE_ENV=production — установите AUTH_MODE=bitrix и SESSION_SECRET (см. docs/bitrix24-integration.md §«Auth boundary»)",
      );
    }
    return mode;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const mode = this.authMode();

    let tenantId: string;
    let bitrixUserId: number;

    if (mode === "bitrix") {
      const authHeader: string | undefined = request.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
      if (!token) {
        throw new UnauthorizedException("Отсутствует Authorization: Bearer <session token>");
      }
      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        this.logger.error("AUTH_MODE=bitrix, но SESSION_SECRET не задан");
        throw new InternalServerErrorException("Сервер не настроен: отсутствует SESSION_SECRET");
      }
      const result = verifySessionToken(token, secret);
      if (!result.ok) {
        throw new UnauthorizedException(`Недействительный сессионный токен (${result.reason})`);
      }
      // Личность — ТОЛЬКО из проверенного токена. Любые X-Tenant-Id/
      // X-Bitrix-User-Id заголовки клиента в этом режиме не читаются вовсе.
      tenantId = result.payload.tenantId;
      bitrixUserId = result.payload.bitrixUserId;
    } else {
      // demo: доверяем заголовкам клиента (только не-production, см. authMode()).
      const headerTenantId = request.headers["x-tenant-id"];
      const headerBitrixUserId = Number(request.headers["x-bitrix-user-id"]);
      if (!headerTenantId || !headerBitrixUserId) {
        throw new UnauthorizedException("Не переданы X-Tenant-Id / X-Bitrix-User-Id (demo-режим)");
      }
      tenantId = String(headerTenantId);
      bitrixUserId = headerBitrixUserId;
    }

    const user = await this.prisma.user.findFirst({
      where: { tenantId, bitrixUserId, isActive: true },
    });
    if (!user) {
      throw new UnauthorizedException("Пользователь не найден или деактивирован");
    }

    request.user = {
      id: user.id,
      tenantId: user.tenantId,
      bitrixUserId: user.bitrixUserId,
      name: user.name,
      role: user.role,
    };
    return true;
  }
}
