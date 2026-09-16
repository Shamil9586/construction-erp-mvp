import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { decryptToken } from "../src/bitrix/crypto.util";

describe("Bitrix24 TEST auth boundary", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fetchSpy: jest.SpyInstance;
  let tenantId = "";
  let installerUserId = "";
  let bearerToken = "";

  const domain = `e2e-bitrix-auth-${Date.now()}.bitrix24.ru`;
  const memberId = randomBytes(16).toString("hex");
  const applicationToken = randomBytes(24).toString("hex");
  const authId = `auth-${randomBytes(24).toString("hex")}`;
  const refreshId = `refresh-${randomBytes(24).toString("hex")}`;
  const installerBitrixUserId = 777;

  const previousEnv = {
    AUTH_MODE: process.env.AUTH_MODE,
    BITRIX_INSTALL_ENABLED: process.env.BITRIX_INSTALL_ENABLED,
    ALLOWED_BITRIX_DOMAIN: process.env.ALLOWED_BITRIX_DOMAIN,
    FRONTEND_URL: process.env.FRONTEND_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };

  beforeAll(async () => {
    if (process.env.NODE_ENV === "production") throw new Error("Bitrix auth-boundary e2e must not run against NODE_ENV=production");

    process.env.AUTH_MODE = "demo";
    process.env.BITRIX_INSTALL_ENABLED = "false";
    process.env.ALLOWED_BITRIX_DOMAIN = domain;
    process.env.FRONTEND_URL = "https://frontend.example.test/";
    process.env.SESSION_SECRET = "e2e-session-secret-at-least-32-chars";

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix("api", { exclude: ["health", "ready"] });
    await app.init();
    prisma = app.get(PrismaService);

    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          ID: String(installerBitrixUserId),
          ACTIVE: true,
          NAME: "Тестовый",
          LAST_NAME: "Администратор",
          EMAIL: "admin@example.test",
          WORK_POSITION: "Администратор портала",
          UF_DEPARTMENT: [1],
        },
      }),
    }) as any);
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (tenantId) {
      await prisma.bitrixInstallation.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await app?.close();

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("install-ui remains fail-closed while BITRIX_INSTALL_ENABLED is false", async () => {
    const disabledMember = randomBytes(16).toString("hex");
    await request(app.getHttpServer())
      .post(`/api/bitrix/install-ui?DOMAIN=${encodeURIComponent(domain)}`)
      .type("form")
      .send({ AUTH_ID: authId, REFRESH_ID: refreshId, AUTH_EXPIRES: "3600", APPLICATION_TOKEN: applicationToken, member_id: disabledMember })
      .expect(503);
    await expect(prisma.tenant.findFirst({ where: { memberId: disabledMember } })).resolves.toBeNull();
  });

  it("install-ui stores encrypted credentials and bootstraps the first local ADMIN", async () => {
    process.env.BITRIX_INSTALL_ENABLED = "true";
    const res = await request(app.getHttpServer())
      .post(`/api/bitrix/install-ui?DOMAIN=${encodeURIComponent(domain)}`)
      .type("form")
      .send({
        AUTH_ID: authId,
        REFRESH_ID: refreshId,
        AUTH_EXPIRES: "3600",
        APPLICATION_TOKEN: applicationToken,
        APPLICATION_SCOPE: "user,department,placement,task,im,disk",
        member_id: memberId,
      })
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain("https://api.bitrix24.com/api/v1/");
    expect(res.text).toContain("/api/bitrix/install-finish.js");

    const tenant = await prisma.tenant.findUnique({ where: { memberId } });
    expect(tenant).not.toBeNull();
    tenantId = tenant!.id;
    const installation = await prisma.bitrixInstallation.findFirst({ where: { tenantId } });
    expect(installation).not.toBeNull();
    expect(installation!.installedByBitrixId).toBe(installerBitrixUserId);
    expect(decryptToken(installation!.encryptedAccessToken)).toBe(authId);
    expect(decryptToken(installation!.encryptedRefreshToken)).toBe(refreshId);
    expect(decryptToken(installation!.encryptedApplicationToken!)).toBe(applicationToken);

    const installer = await prisma.user.findUnique({ where: { tenantId_bitrixUserId: { tenantId, bitrixUserId: installerBitrixUserId } } });
    expect(installer).not.toBeNull();
    expect(installer!.role).toBe("ADMIN");
    installerUserId = installer!.id;
  });

  it("launch verifies APPLICATION_TOKEN, mints a session and ignores spoofed demo headers", async () => {
    process.env.AUTH_MODE = "bitrix";
    const launch = await request(app.getHttpServer())
      .post(`/api/bitrix/launch?DOMAIN=${encodeURIComponent(domain)}`)
      .type("form")
      .send({ AUTH_ID: authId, AUTH_EXPIRES: "3600", APPLICATION_TOKEN: applicationToken, member_id: memberId, PLACEMENT: "DEFAULT" })
      .expect(303);

    const location = new URL(launch.headers.location);
    expect(location.origin).toBe("https://frontend.example.test");
    bearerToken = new URLSearchParams(location.hash.slice(1)).get("cerp_session") || "";
    expect(bearerToken).toContain(".");

    const users = await request(app.getHttpServer())
      .get("/api/users")
      .set("Authorization", `Bearer ${bearerToken}`)
      .set("X-Tenant-Id", "00000000-0000-0000-0000-000000000000")
      .set("X-Bitrix-User-Id", "999999")
      .expect(200);
    expect(users.body.some((user: any) => user.bitrixUserId === installerBitrixUserId)).toBe(true);
  });

  it("launch rejects a forged APPLICATION_TOKEN", async () => {
    process.env.AUTH_MODE = "bitrix";
    await request(app.getHttpServer())
      .post(`/api/bitrix/launch?DOMAIN=${encodeURIComponent(domain)}`)
      .type("form")
      .send({ AUTH_ID: authId, AUTH_EXPIRES: "3600", APPLICATION_TOKEN: "forged-application-token", member_id: memberId })
      .expect(401);
  });

  it("ADMIN_USERS can assign roles, but the last active ADMIN cannot demote itself", async () => {
    const target = await prisma.user.create({ data: { tenantId, bitrixUserId: 778, name: "Новый сотрудник", role: "CONTRACTOR_VIEWER", isActive: true } });
    const promoted = await request(app.getHttpServer())
      .patch(`/api/users/${target.id}/role`)
      .set("Authorization", `Bearer ${bearerToken}`)
      .send({ role: "PROJECT_MANAGER" })
      .expect(200);
    expect(promoted.body.role).toBe("PROJECT_MANAGER");

    await request(app.getHttpServer())
      .patch(`/api/users/${installerUserId}/role`)
      .set("Authorization", `Bearer ${bearerToken}`)
      .send({ role: "PROJECT_MANAGER" })
      .expect(409);
  });
});
