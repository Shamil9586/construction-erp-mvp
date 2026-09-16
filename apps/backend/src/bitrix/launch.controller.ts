import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import { Role } from "@construction-erp/domain";
import { PrismaService } from "../common/prisma.service";
import { createSessionToken } from "../modules/auth/session.util";
import { BitrixTokenService } from "./bitrix-token.service";
import { encryptToken } from "./crypto.util";

interface BitrixUiContext {
  domain: string;
  memberId: string;
  authId: string;
  refreshId?: string;
  applicationToken: string;
  applicationScope?: string;
  authExpires: number;
}

interface BitrixCurrentUser {
  ID: string | number;
  ACTIVE?: boolean | "Y" | "N";
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: string;
  WORK_POSITION?: string;
  UF_DEPARTMENT?: Array<string | number>;
}

/**
 * Browser-facing Bitrix24 boundary for a server-side Local Application with UI.
 *
 * Bitrix24 opens both the installation page and the normal handler with a
 * short-lived user OAuth token (AUTH_ID), member_id and APPLICATION_TOKEN.
 * Those OAuth values never reach the React bundle. The backend verifies the
 * portal/application context, resolves the current Bitrix24 user via
 * user.current and mints a short-lived Construction ERP HMAC session token.
 */
@Controller("bitrix")
export class BitrixUiController {
  private static readonly MEMBER_ID_RE = /^[a-f0-9]{32}$/i;
  private static readonly DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: BitrixTokenService,
  ) {}

  /**
   * External JS is used instead of inline script so the installation page can
   * keep a strict CSP (no unsafe-inline). BX24.installFinish() reloads the app
   * into its regular Handler path after the installation is marked complete.
   */
  @Get("install-finish.js")
  @Header("Content-Type", "application/javascript; charset=utf-8")
  installFinishScript() {
    return [
      'document.addEventListener("DOMContentLoaded", function () {',
      '  if (typeof BX24 === "undefined") return;',
      '  BX24.init(function () { BX24.installFinish(); });',
      '});',
    ].join("\n");
  }

  /** Initial installation path for the Bitrix24 Local Application. */
  @Post("install-ui")
  async installUi(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>, @Res() response: Response) {
    if (process.env.BITRIX_INSTALL_ENABLED !== "true") {
      return response.status(503).type("text/plain").send("Bitrix24 installation flow is disabled");
    }

    const context = this.parseContext(query, body, true);
    this.assertAllowedPortal(context.domain);
    const currentUser = await this.fetchCurrentUser(context.domain, context.authId);
    const bitrixUserId = this.userId(currentUser);
    const name = this.userName(currentUser, bitrixUserId);
    const now = Date.now();

    await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { memberId: context.memberId },
        update: { portal: context.domain },
        create: { portal: context.domain, memberId: context.memberId, name: context.domain },
      });

      const existingUser = await tx.user.findUnique({
        where: { tenantId_bitrixUserId: { tenantId: tenant.id, bitrixUserId } },
      });
      const activeAdminCount = await tx.user.count({
        where: { tenantId: tenant.id, role: Role.ADMIN, isActive: true },
      });
      const bootstrapRole = existingUser?.role ?? (activeAdminCount === 0 ? Role.ADMIN : Role.CONTRACTOR_VIEWER);

      await tx.user.upsert({
        where: { tenantId_bitrixUserId: { tenantId: tenant.id, bitrixUserId } },
        update: {
          name,
          email: currentUser.EMAIL || null,
          departmentId: this.departmentId(currentUser),
          position: currentUser.WORK_POSITION || null,
          isActive: this.isActive(currentUser),
        },
        create: {
          tenantId: tenant.id,
          bitrixUserId,
          name,
          email: currentUser.EMAIL || null,
          departmentId: this.departmentId(currentUser),
          position: currentUser.WORK_POSITION || null,
          role: bootstrapRole,
          isActive: this.isActive(currentUser),
        },
      });

      await tx.bitrixInstallation.upsert({
        where: { tenantId_memberId: { tenantId: tenant.id, memberId: context.memberId } },
        update: {
          portal: context.domain,
          encryptedAccessToken: encryptToken(context.authId),
          encryptedRefreshToken: encryptToken(context.refreshId!),
          encryptedApplicationToken: encryptToken(context.applicationToken),
          expiresAt: new Date(now + context.authExpires * 1000),
          installedByBitrixId: bitrixUserId,
          status: "ACTIVE",
          scope: context.applicationScope,
        },
        create: {
          tenantId: tenant.id,
          portal: context.domain,
          memberId: context.memberId,
          encryptedAccessToken: encryptToken(context.authId),
          encryptedRefreshToken: encryptToken(context.refreshId!),
          encryptedApplicationToken: encryptToken(context.applicationToken),
          expiresAt: new Date(now + context.authExpires * 1000),
          installedByBitrixId: bitrixUserId,
          status: "ACTIVE",
          scope: context.applicationScope,
        },
      });
    });

    return response.status(200).type("html").send(this.installationPage());
  }

  /** Normal Handler path opened by Bitrix24 for every application launch. */
  @Post("launch")
  async launch(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>, @Res() response: Response) {
    if ((process.env.AUTH_MODE ?? "demo").toLowerCase() !== "bitrix") {
      throw new ServiceUnavailableException("Bitrix24 launch is available only when AUTH_MODE=bitrix");
    }

    const context = this.parseContext(query, body, false);
    this.assertAllowedPortal(context.domain);

    const installation = await this.prisma.bitrixInstallation.findFirst({
      where: { memberId: context.memberId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    if (!installation || installation.portal.toLowerCase() !== context.domain.toLowerCase()) {
      throw new UnauthorizedException("Bitrix24 installation is not registered for this portal");
    }

    const applicationTokenValid = await this.tokens.verifyApplicationToken(context.memberId, context.applicationToken);
    if (!applicationTokenValid) {
      throw new UnauthorizedException("Bitrix24 APPLICATION_TOKEN verification failed");
    }

    const currentUser = await this.fetchCurrentUser(context.domain, context.authId);
    const bitrixUserId = this.userId(currentUser);
    const name = this.userName(currentUser, bitrixUserId);

    await this.prisma.user.upsert({
      where: { tenantId_bitrixUserId: { tenantId: installation.tenantId, bitrixUserId } },
      update: {
        name,
        email: currentUser.EMAIL || null,
        departmentId: this.departmentId(currentUser),
        position: currentUser.WORK_POSITION || null,
        isActive: this.isActive(currentUser),
      },
      create: {
        tenantId: installation.tenantId,
        bitrixUserId,
        name,
        email: currentUser.EMAIL || null,
        departmentId: this.departmentId(currentUser),
        position: currentUser.WORK_POSITION || null,
        role: Role.CONTRACTOR_VIEWER,
        isActive: this.isActive(currentUser),
      },
    });

    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret || sessionSecret.length < 16) {
      throw new ServiceUnavailableException("SESSION_SECRET is not configured for Bitrix24 auth mode");
    }
    const frontendUrl = this.frontendUrl();
    const sessionToken = createSessionToken(
      { tenantId: installation.tenantId, bitrixUserId },
      sessionSecret,
      Math.min(Math.max(context.authExpires, 300), 3600),
    );

    // The fragment is never sent to the Render web server. React moves the
    // token into sessionStorage immediately and removes it from the address.
    frontendUrl.hash = new URLSearchParams({ cerp_session: sessionToken }).toString();
    return response.redirect(303, frontendUrl.toString());
  }

  private parseContext(query: Record<string, unknown>, body: Record<string, unknown>, requireRefresh: boolean): BitrixUiContext {
    const nestedAuth = body && typeof body.auth === "object" && body.auth ? (body.auth as Record<string, unknown>) : {};
    const merged = { ...body, ...nestedAuth };

    const domain = this.stringValue(query.DOMAIN, merged.DOMAIN, merged.domain)?.toLowerCase();
    const memberId = this.stringValue(merged.member_id, merged.memberId);
    const authId = this.stringValue(merged.AUTH_ID, merged.access_token);
    const refreshId = this.stringValue(merged.REFRESH_ID, merged.refresh_token);
    const applicationToken = this.stringValue(merged.APPLICATION_TOKEN, merged.application_token);
    const applicationScope = this.stringValue(merged.APPLICATION_SCOPE, merged.scope);
    const authExpires = Number(merged.AUTH_EXPIRES ?? merged.expires_in ?? 3600);

    if (!domain || !BitrixUiController.DOMAIN_RE.test(domain) || domain.length > 253) {
      throw new BadRequestException("Invalid Bitrix24 DOMAIN");
    }
    if (!memberId || !BitrixUiController.MEMBER_ID_RE.test(memberId)) {
      throw new BadRequestException("Invalid Bitrix24 member_id");
    }
    if (!authId || authId.length < 10 || authId.length > 500) {
      throw new BadRequestException("Invalid Bitrix24 AUTH_ID");
    }
    if (requireRefresh && (!refreshId || refreshId.length < 10 || refreshId.length > 500)) {
      throw new BadRequestException("Invalid Bitrix24 REFRESH_ID");
    }
    if (!applicationToken || applicationToken.length < 8 || applicationToken.length > 500) {
      throw new BadRequestException("Invalid Bitrix24 APPLICATION_TOKEN");
    }
    if (!Number.isFinite(authExpires) || authExpires <= 0 || authExpires > 86_400) {
      throw new BadRequestException("Invalid Bitrix24 AUTH_EXPIRES");
    }

    return { domain, memberId, authId, refreshId, applicationToken, applicationScope, authExpires };
  }

  private assertAllowedPortal(domain: string) {
    const allowed = process.env.ALLOWED_BITRIX_DOMAIN?.trim().toLowerCase();
    if (!allowed) {
      throw new ServiceUnavailableException("ALLOWED_BITRIX_DOMAIN is not configured");
    }
    if (allowed !== domain.toLowerCase()) {
      throw new UnauthorizedException("Bitrix24 portal domain is not allowed");
    }
  }

  private frontendUrl(): URL {
    const raw = process.env.FRONTEND_URL?.trim();
    if (!raw) throw new ServiceUnavailableException("FRONTEND_URL is not configured");

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ServiceUnavailableException("FRONTEND_URL is invalid");
    }
    const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
      throw new ServiceUnavailableException("FRONTEND_URL must use HTTPS");
    }
    url.search = "";
    url.hash = "";
    return url;
  }

  private async fetchCurrentUser(domain: string, authId: string): Promise<BitrixCurrentUser> {
    const url = `https://${domain}/rest/user.current.json`;
    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ auth: authId }),
      });
    } catch {
      throw new BadGatewayException("Bitrix24 user.current request failed");
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new BadGatewayException("Bitrix24 user.current returned invalid JSON");
    }
    if (!res.ok || json?.error || !json?.result) {
      throw new UnauthorizedException("Bitrix24 did not confirm the current user");
    }
    return json.result as BitrixCurrentUser;
  }

  private userId(user: BitrixCurrentUser): number {
    const id = Number(user.ID);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadGatewayException("Bitrix24 user.current returned an invalid user ID");
    }
    return id;
  }

  private userName(user: BitrixCurrentUser, bitrixUserId: number): string {
    const name = `${user.LAST_NAME ?? ""} ${user.NAME ?? ""}`.trim();
    return name || `Bitrix24 user ${bitrixUserId}`;
  }

  private departmentId(user: BitrixCurrentUser): string | null {
    return Array.isArray(user.UF_DEPARTMENT) && user.UF_DEPARTMENT.length > 0 ? String(user.UF_DEPARTMENT[0]) : null;
  }

  private isActive(user: BitrixCurrentUser): boolean {
    return user.ACTIVE !== false && user.ACTIVE !== "N";
  }

  private stringValue(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  }

  private installationPage(): string {
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Construction ERP — установка</title>
  <script defer src="https://api.bitrix24.com/api/v1/"></script>
  <script defer src="/api/bitrix/install-finish.js"></script>
</head>
<body>
  <p>Construction ERP: параметры тестовой установки сохранены. Завершаем установку в Bitrix24…</p>
</body>
</html>`;
  }
}
