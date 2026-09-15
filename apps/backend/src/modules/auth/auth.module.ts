import { Global, Module, Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BitrixAuthGuard } from "./bitrix-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";

/**
 * AuthModule — единственное место, где регистрируются BitrixAuthGuard и
 * PermissionsGuard как провайдеры Nest DI.
 *
 * ХАРДЕНИНГ (критический баг, обнаружен при аудите): оба guard'а
 * использовались через `@UseGuards(BitrixAuthGuard, PermissionsGuard)` в
 * КАЖДОМ контроллере (objects, works, inspections, pto, sdo, financial,
 * contractors, materials, dictionaries, users...), но НИ РАЗУ не были
 * зарегистрированы как провайдер ни в одном модуле — ни локально, ни
 * глобально. NestJS резолвит класс, переданный в `@UseGuards(Class)`,
 * через свой контейнер DI; если класс нигде не зарегистрирован как
 * provider, попытка активировать guard на первом же запросе завершится
 * ошибкой резолва зависимостей при старте/первом запросе (Nest не может
 * создать экземпляр незарегистрированного provider'а). Другими словами —
 * backend в таком виде не смог бы обслужить НИ ОДИН защищённый запрос.
 * Это не гипотеза: `grep` по всем `providers:`-массивам (см. историю
 * хардненинга) подтвердил, что ни BitrixAuthGuard, ни PermissionsGuard не
 * фигурировали нигде, кроме собственных файлов.
 *
 * Модуль глобальный (`@Global()`), регистрируется один раз в app.module.ts
 * — после этого оба guard'а резолвятся в любом контроллере без
 * необходимости импортировать AuthModule в каждый feature-модуль.
 */
@ApiTags("auth")
@Controller("auth")
class AuthStatusController {
  /**
   * GET /auth/mode — единственный публичный (без guard'ов) эндпоинт этого
   * модуля. Frontend обязан спрашивать backend, а не решать сам, показывать
   * ли demo-переключатель личности — иначе сборка с "неправильным" .env
   * могла бы случайно показать demo UI поверх backend'а, реально
   * защищённого AUTH_MODE=bitrix (или наоборот, создать у пользователя
   * ложное ощущение защищённости). См. apps/frontend/src/lib/auth.tsx.
   */
  @Get("mode")
  getMode() {
    const mode = (process.env.AUTH_MODE ?? "demo").toLowerCase();
    return { mode: mode === "bitrix" ? "bitrix" : "demo" };
  }
}

@Global()
@Module({
  controllers: [AuthStatusController],
  providers: [BitrixAuthGuard, PermissionsGuard],
  exports: [BitrixAuthGuard, PermissionsGuard],
})
export class AuthModule {}
