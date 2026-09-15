import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * PrismaModule — единственный держатель PrismaService на весь процесс.
 *
 * ХАРДЕНИНГ (обнаружено при аудите): раньше каждый из 13+ feature-модулей
 * (objects, works, inspections, pto, sdo, financial, contractors,
 * materials, notifications, users, dictionaries, audit, bitrix, health)
 * САМОСТОЯТЕЛЬНО регистрировал `providers: [PrismaService, ...]`. В NestJS
 * провайдер, зарегистрированный локально в модуле, не является глобальным
 * синглтоном — каждый такой модуль получал СВОЙ ЭКЗЕМПЛЯР PrismaService, а
 * значит свой собственный `PrismaClient` и свой собственный пул соединений
 * с PostgreSQL. Для процесса с 13+ модулями это означало бы 13+ независимых
 * пулов соединений на один backend-инстанс — неоправданный расход
 * соединений БД и абсолютно ненужная избыточность.
 *
 * Теперь PrismaService — глобальный провайдер (`@Global()`), заводится один
 * раз (см. app.module.ts), и все feature-модули получают один и тот же
 * экземпляр через DI, просто указывая `PrismaService` в конструкторе — без
 * необходимости перечислять его в своих собственных `providers:`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
