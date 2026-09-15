import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { decryptToken, encryptToken } from "./crypto.util";

/**
 * Хранение и обновление OAuth-токенов Bitrix24 (ТЗ п.3, 10).
 * REQUIRES BITRIX24 TEST PORTAL VERIFICATION для реального refresh-запроса —
 * см. docs/bitrix24-integration.md §3.
 */
@Injectable()
export class BitrixTokenService {
  private readonly logger = new Logger("BitrixTokenService");

  constructor(private prisma: PrismaService) {}

  /**
   * ХАРДЕНИНГ-ФИКС (integrity pass, п.5) — общий helper для ВСЕХ будущих
   * Bitrix24 event-хендлеров (кроме самого первого ONAPPINSTALL, у которого
   * ещё нет с чем сверять — см. install.controller.ts). По официальной
   * документации Bitrix24 входящий запрос должен сверяться по паре
   * member_id + application_token с тем, что было сохранено при установке.
   * Сравнение — timing-safe (`crypto.timingSafeEqual`), чтобы не давать
   * оракул по времени ответа на посимвольный подбор токена. Buffer разной
   * длины `timingSafeEqual` сравнивать не умеет (бросает исключение) — при
   * несовпадении длины сразу возвращаем false, не вызывая её.
   *
   * Возвращает false (а не бросает) на любой "не подтверждено" исход —
   * отсутствие установки, отсутствие сохранённого эталона, несовпадение —
   * чтобы вызывающий код единообразно решал, что делать с отказом.
   */
  async verifyApplicationToken(memberId: string, incomingApplicationToken: string | undefined | null): Promise<boolean> {
    if (!memberId || !incomingApplicationToken) return false;

    const installation = await this.prisma.bitrixInstallation.findFirst({
      where: { memberId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    if (!installation?.encryptedApplicationToken) return false;

    let stored: string;
    try {
      stored = decryptToken(installation.encryptedApplicationToken);
    } catch {
      this.logger.warn(`verifyApplicationToken: не удалось расшифровать сохранённый application_token для member_id=${memberId}`);
      return false;
    }

    const a = Buffer.from(stored, "utf8");
    const b = Buffer.from(incomingApplicationToken, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async getValidAccessToken(tenantId: string): Promise<{ domain: string; accessToken: string }> {
    const installation = await this.prisma.bitrixInstallation.findFirst({
      where: { tenantId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    if (!installation) {
      throw new NotFoundException(`Для tenant ${tenantId} нет активной установки Bitrix24 — используется MockBitrixAdapter`);
    }

    if (installation.expiresAt.getTime() - Date.now() < 60_000) {
      return this.refresh(installation.id, installation.portal, decryptToken(installation.encryptedRefreshToken));
    }

    return { domain: installation.portal, accessToken: decryptToken(installation.encryptedAccessToken) };
  }

  private async refresh(installationId: string, domain: string, refreshToken: string): Promise<{ domain: string; accessToken: string }> {
    const clientId = process.env.BITRIX_CLIENT_ID;
    const clientSecret = process.env.BITRIX_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("BITRIX_CLIENT_ID/BITRIX_CLIENT_SECRET не заданы — обновление токена невозможно");
    }
    const url = new URL("https://oauth.bitrix.info/oauth/token/");
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("refresh_token", refreshToken);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Не удалось обновить токен Bitrix24: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

    await this.prisma.bitrixInstallation.update({
      where: { id: installationId },
      data: {
        encryptedAccessToken: encryptToken(json.access_token),
        encryptedRefreshToken: encryptToken(json.refresh_token),
        expiresAt: new Date(Date.now() + json.expires_in * 1000),
      },
    });
    this.logger.log(`Токен обновлён для установки ${installationId} (без вывода значения токена в лог)`);

    return { domain, accessToken: json.access_token };
  }
}
