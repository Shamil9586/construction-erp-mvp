import { Body, Controller, HttpCode, Logger, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { encryptToken } from "./crypto.util";

/**
 * Обработчик события ONAPPINSTALL (ТЗ п.60 шаг 11, docs/bitrix24-integration.md §2).
 * Регистрируется как event_handler URL при создании локального приложения
 * в настройках разработчика Bitrix24.
 *
 * REQUIRES BITRIX24 TEST PORTAL VERIFICATION — этот endpoint НЕ проверен
 * реальным вызовом от портала (нет доступа к тестовому порталу в этой
 * среде разработки). Реализация основана только на документированной
 * структуре payload (apidocs.bitrix24.com) и НЕ считается
 * production-secure: у Bitrix24 REST/events нет общедоступного механизма
 * криптографической проверки подлинности самого первого ONAPPINSTALL-вызова
 * (это ограничение самого протокола, не пробел в реализации) — подлинность
 * связки client_id/client_secret подтверждается только последующим успешным
 * обменом кода на токен через oauth.bitrix.info, который тоже ещё не
 * проверялся на реальном портале. Поэтому:
 *
 * 1) ХАРДЕНИНГ-ФИКС (эта итерация) — fail-closed feature flag
 *    BITRIX_INSTALL_ENABLED: по умолчанию (не задан/не "true") endpoint
 *    ничего не пишет в БД и отвечает `{ result: false }` — production
 *    развёртывание не может случайно открыть непроверенный installation
 *    flow просто потому что взяло этот образ. Включать только осознанно,
 *    после проверки на тестовом портале.
 * 2) Максимально строгая валидация формата входных полей (domain, member_id,
 *    токены, application_token) — без придумывания несуществующего
 *    протокола подписи, только то, что реально документировано в §2.
 */
@ApiExcludeController()
@Controller("bitrix")
export class BitrixInstallController {
  private readonly logger = new Logger("BitrixInstall");

  constructor(private prisma: PrismaService) {}

  // Bitrix24 member_id документирован как 32-символьный hex-идентификатор
  // портала. REQUIRES BITRIX24 TEST PORTAL VERIFICATION — если реальный
  // формат отличается, регэксп нужно будет скорректировать по факту, не
  // раньше.
  private static readonly MEMBER_ID_RE = /^[a-f0-9]{32}$/i;
  // Синтаксически валидный hostname (облачный портал вида *.bitrix24.ru
  // ИЛИ домен коробочной версии — оба варианта официально существуют,
  // поэтому не сужаем до *.bitrix24.*, чтобы не изобретать несуществующее
  // ограничение протокола).
  private static readonly DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  @Post("install")
  @HttpCode(200)
  async onInstall(@Body() body: any) {
    if (process.env.BITRIX_INSTALL_ENABLED !== "true") {
      this.logger.warn(
        "ONAPPINSTALL отклонён: BITRIX_INSTALL_ENABLED не установлен в \"true\" (fail-closed по умолчанию — см. docs/bitrix24-integration.md, REQUIRES BITRIX24 TEST PORTAL VERIFICATION)",
      );
      return { result: false };
    }

    // Ожидаемая форма payload ONAPPINSTALL (см. docs/bitrix24-integration.md §2):
    // { event: "ONAPPINSTALL", auth: { access_token, refresh_token, expires_in, domain, member_id, application_token, scope } }
    const auth = body?.auth ?? body; // некоторые обёртки шлют поля auth[...] плоско — нормализуем на уровне DTO в проде
    const domain: string | undefined = typeof auth?.domain === "string" ? auth.domain.trim() : undefined;
    const memberId: string | undefined = typeof auth?.member_id === "string" ? auth.member_id.trim() : undefined;
    const accessToken: string | undefined = typeof auth?.access_token === "string" ? auth.access_token : undefined;
    const refreshToken: string | undefined = typeof auth?.refresh_token === "string" ? auth.refresh_token : undefined;
    const applicationToken: string | undefined = typeof auth?.application_token === "string" ? auth.application_token : undefined;
    const expiresIn: number = Number(auth?.expires_in ?? 3600);

    if (!domain || !memberId || !accessToken || !refreshToken) {
      this.logger.warn("ONAPPINSTALL: неполный payload — см. docs/bitrix24-integration.md для проверки на тестовом портале");
      return { result: false };
    }
    if (!BitrixInstallController.DOMAIN_RE.test(domain) || domain.length > 253) {
      this.logger.warn(`ONAPPINSTALL: domain не похож на валидный hostname (отклонено)`);
      return { result: false };
    }
    if (!BitrixInstallController.MEMBER_ID_RE.test(memberId)) {
      this.logger.warn(`ONAPPINSTALL: member_id не соответствует ожидаемому формату (32 hex-символа) — отклонено`);
      return { result: false };
    }
    if (accessToken.length < 10 || accessToken.length > 500 || refreshToken.length < 10 || refreshToken.length > 500) {
      this.logger.warn("ONAPPINSTALL: access_token/refresh_token не проходят проверку формата (длина) — отклонено");
      return { result: false };
    }
    if (!applicationToken) {
      // application_token присутствует в каждом документированном payload
      // ONAPPINSTALL (§2) — его отсутствие означает, что это не настоящий
      // вызов от Bitrix24 (либо устаревшая/некорректная интеграция).
      //
      // ХАРДЕНИНГ-ФИКС (integrity pass, п.5): раньше этот токен после
      // проверки присутствия отбрасывался и нигде не сохранялся — теперь он
      // записывается (зашифрованным, см. ниже) как эталон для сверки во
      // ВСЕХ последующих event-хендлерах через
      // BitrixTokenService.verifyApplicationToken() (member_id +
      // application_token, timing-safe сравнение — по официальной
      // документации Bitrix24 это штатный способ подтверждать подлинность
      // запросов после установки). Само по себе присутствие
      // application_token именно в этом, самом первом вызове НЕ является
      // криптографическим подтверждением подлинности ЭТОГО вызова — с этим
      // эталоном ещё не с чем сравнивать до того, как он сохранён — поэтому
      // для первого контакта статус по-прежнему REQUIRES BITRIX24 TEST
      // PORTAL VERIFICATION (см. class-level комментарий выше и
      // docs/bitrix24-integration.md §2).
      this.logger.warn("ONAPPINSTALL: отсутствует application_token — не похоже на настоящий вызов Bitrix24, отклонено");
      return { result: false };
    }
    if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86_400) {
      this.logger.warn("ONAPPINSTALL: expires_in вне разумного диапазона — отклонено");
      return { result: false };
    }

    const tenant = await this.prisma.tenant.upsert({
      where: { memberId },
      update: { portal: domain },
      create: { portal: domain, memberId, name: domain },
    });

    await this.prisma.bitrixInstallation.upsert({
      where: { tenantId_memberId: { tenantId: tenant.id, memberId } },
      update: {
        encryptedAccessToken: encryptToken(accessToken),
        encryptedRefreshToken: encryptToken(refreshToken),
        encryptedApplicationToken: encryptToken(applicationToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        status: "ACTIVE",
        scope: auth?.scope,
      },
      create: {
        tenantId: tenant.id,
        portal: domain,
        memberId,
        encryptedAccessToken: encryptToken(accessToken),
        encryptedRefreshToken: encryptToken(refreshToken),
        encryptedApplicationToken: encryptToken(applicationToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: auth?.scope,
      },
    });

    this.logger.log(`Приложение установлено для портала ${domain} (member_id=${memberId}); токены зашифрованы и сохранены`);
    return { result: true };
  }
}
