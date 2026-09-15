# Changelog — integrity pass (2026-09-15)

Третья, узкая итерация поверх текущего `construction-erp-mvp`. Это НЕ новый
hardening-pass и НЕ расширение продукта — исправлены строго 5 перечисленных
дефектов целостности из инструкции этой итерации, затем статическая
разработка остановлена. Архитектура не менялась, новый проект не
создавался, реальный Bitrix24-портал не подключался. Предыдущие отчёты —
`docs/verification-report-2026-09-14.md` (первая проверка),
`docs/changelog-hardening-pass-2.md` (второй hardening-pass) — этот файл их
не переписывает и не дублирует.

## Окружение проверки в этой итерации

Как и раньше, в этой песочнице нет доступа к `registry.npmjs.org` (проверено
заново: `curl` до registry возвращает HTTP 403 через прокси) и нет демона
Docker (`/var/run/docker.sock` отсутствует, хотя бинарник `docker` в PATH
есть) — т.е. `npm install`, `npm run build/test:*`, `docker compose build/up`
физически невозможно выполнить здесь, как и в предыдущих итерациях.

Новое в этой итерации: **PostgreSQL 16 реально запущен и доступен локально**
(`127.0.0.1:5432`), поэтому обе новые Prisma-миграции были не просто
написаны, а **реально применены** через `psql` к настоящей базе
(`erp_migration_check`) и **функционально проверены** прямыми SQL-запросами
в транзакциях с откатом (`BEGIN ... ROLLBACK`) — это не эмуляция и не
статический анализ, а действительно выполненные `INSERT`/`ALTER TABLE`
против реального PostgreSQL. Это НЕ равнозначно `npx prisma migrate deploy`
(отдельный инструмент со своей книгой миграций/таблицей `_prisma_migrations`,
которая здесь не создавалась и не проверялась) и НЕ равнозначно запуску
приложения через `@prisma/client` (не установлен) — граница честно
зафиксирована в разделе «NOT VERIFIED» ниже.

TypeScript/TSX-файлы проверены компилятором `typescript` (глобально
установлен в этой среде) через `ts.transpileModule()` — это синтаксическая
транспиляция с `reportDiagnostics: true` (ловит синтаксические ошибки и
ошибки, видимые без резолвинга модулей/типов из `node_modules`), но **не**
полноценная проверка типов `tsc --noEmit`/`ts-jest` (нет `@nestjs/*`,
`@prisma/client`, `class-validator` и т.д. в `node_modules` — их типы
резолвить не из чего). Логика `MockFileStorageProvider`
(санитизация путей) и `BitrixTokenService.verifyApplicationToken`
(шифрование + timing-safe сравнение) дополнительно проверена **реальным
выполнением** эквивалентного кода в чистом Node.js (без NestJS-обёртки,
т.к. `@nestjs/common` не установлен) — против настоящего диска и настоящего
`node:crypto`, не просто прочитана глазами.

## FIXED IN CODE

1. **`ExecutiveDocumentPackage` ↔ `SdoCase`: один-ко-многим**
   (`apps/backend/prisma/schema.prisma`,
   `apps/backend/prisma/migrations/20260915070000_sdo_case_one_to_many/`).
   Раньше `SdoCase.executiveDocumentPackageId` был `@unique` (один пакет —
   максимум один `SdoCase`), что несовместимо с
   `PtoService.transferToSdo()`, создающим по одному `SdoCase` на каждый
   `objectWorkId` пакета: пакет, покрывающий ДВЕ разные работы, падал бы на
   конфликте уникальности при создании второго `SdoCase`. Теперь
   `ExecutiveDocumentPackage.sdoCases SdoCase[]` (1:N), одиночный `@unique`
   снят, дубль на конкретную пару пакет+работа предотвращается новым
   `@@unique([executiveDocumentPackageId, objectWorkId])`. Миграция
   написана НОВЫМ файлом поверх уже применённой начальной миграции (не
   переписывает её) и реально применена + проверена против PostgreSQL (см.
   выше): вставка двух `SdoCase` для одного пакета с разными работами
   проходит, попытка вставить дубль (тот же пакет + та же работа) корректно
   отклоняется `UNIQUE`-нарушением. Попутно исправлена связанная логика в
   `PtoService.transferToSdo()`: проверка "уже есть `SdoCase` на эту
   работу" теперь идёт по паре `(executiveDocumentPackageId, objectWorkId)`,
   а не только по `objectWorkId` — иначе после смены схемы на 1:N старая
   проверка была бы СЛИШКОМ широкой (пропускала бы создание нового
   `SdoCase` для работы, уже имеющей дело СДО от ДРУГОГО пакета).
   E2E: `critical-path.e2e-spec.ts`, тест «п.1» — пакет с APPROVED-АОСР по
   двум разным работам → `transfer-sdo` → два `SdoCase`, один `PtoTransfer`,
   у обеих работ корректный `transferredToSdoQuantity`.

2. **Tenant/object-целостность в ПТО** (`apps/backend/src/modules/pto/pto.module.ts`).
   `createDocument()` теперь одновременно проверяет: объект из URL
   принадлежит текущему tenant; работа (`objectWorkId`) принадлежит текущему
   tenant; работа действительно относится к ЭТОМУ объекту
   (`work.objectId === objectId`) — иначе 404/400. `createPackage()` перед
   созданием пакета теперь проверяет: объект существует у tenant; ВСЕ
   переданные `documentIds` найдены (без потерь при дедупликации); каждый
   документ принадлежит текущему tenant; каждый документ принадлежит
   именно этому объекту; пустой массив документов отклоняется на уровне
   `ValidationPipe` (`@ArrayNotEmpty` в `CreatePackageDto`) ещё до вызова
   сервиса. Package items не создаются, пока не пройдены все проверки (весь
   список проверок — до `$transaction`).
   E2E: тесты «п.2а»-«п.2г» — документ с чужого объекта того же tenant не
   создаётся; пакет не собирается из документа другого объекта того же
   tenant; пакет не собирается из документа другого tenant; пустой пакет
   отклоняется.

3. **Снятие `ObjectContractor`** (`apps/backend/src/modules/objects/objects.module.ts`,
   `ObjectsService.removeContractor()`). Раньше связь можно было снять в
   любой момент, даже когда на объекте уже есть `ObjectWork` с этим же
   `contractorId` — работа оставалась «повисшей» у формально не
   назначенного подрядчика. Теперь при наличии таких работ снятие связи
   отклоняется `409 ConflictException` с понятным сообщением, требующим
   сначала переназначить/очистить подрядчика у этих работ.
   `contractorId` у существующих работ НЕ очищается автоматически (это
   было бы скрытым массовым изменением чужих данных без явного решения
   пользователя). E2E: тест «п.3» — 409 при попытке снять подрядчика,
   когда есть ссылающиеся работы (связь физически не удалена); тест «п.3б»
   — контрольный положительный случай: снятие проходит, когда ссылающихся
   работ нет.

4. **`MockFileStorageProvider` — реальное локальное demo-хранилище**
   (`apps/backend/src/bitrix/adapters/mock-bitrix.adapter.ts`,
   `apps/backend/src/bitrix/adapters/interfaces.ts`,
   `apps/backend/src/bitrix/adapters/real-bitrix.adapter.ts`,
   `apps/backend/src/bitrix/bitrix-gateway.service.ts`,
   `apps/backend/src/modules/inspections/inspections.module.ts`,
   `apps/frontend/src/components/tabs/PhotosTab.tsx`,
   `docker-compose.yml`, `.env.example`). Раньше `upload()` только
   генерировал `mock-file-*` и отбрасывал переданный `Buffer` — сохранялись
   только метаданные (`InspectionPhoto.fileName`), самого файла не
   существовало. Теперь байты реально пишутся на диск в каталог
   `LOCAL_FILE_STORAGE_PATH` (env, по умолчанию
   `<cwd>/storage/local-uploads`), под tenant-скоупированным подкаталогом;
   внутреннее имя файла — `randomUUID()` + безопасное расширение,
   пользовательский `fileName` НИКОГДА не используется как часть пути на
   диске (только как метаданные) — что закрывает path traversal через
   `fileName` вида `../../etc/passwd`. Добавлен `FileStorageProvider.download()`
   (интерфейс + обе реализации): `MockFileStorageProvider.download()`
   реально читает файл с диска с дополнительной проверкой, что резолвленный
   путь не вышел за пределы корня хранилища тенанта;
   `RealFileStorageProvider.download()` — явно не реализован (бросает
   понятную ошибку REQUIRES BITRIX24 TEST PORTAL VERIFICATION), т.к.
   стратегию (проксировать байты vs отдавать временную ссылку) нужно
   выбирать по факту поведения реального портала, а не вслепую — это
   отдельный непроверенный этап, отделённый от demo-хранилища, которое
   реально работает уже сейчас. Backend: новый endpoint
   `GET /inspections/photos/:photoId/file` (tenant-scoped через
   `InspectionPhoto.tenantId`, `StreamableFile` + корректные
   `Content-Type`/`Content-Disposition`/`Cache-Control`). Frontend:
   `PhotosTab.tsx` теперь может реально открыть фото («Открыть фото» —
   `fetch(..., { headers })` вручную, т.к. авторизация идёт через
   заголовки, а не cookie, → Blob-URL → новая вкладка, открытая синхронно
   до `await`, чтобы не попасть под блокировку всплывающих окон). Docker:
   `docker-compose.yml` — новый именованный volume `local_uploads`,
   смонтированный в backend-сервис по `LOCAL_FILE_STORAGE_PATH`, чтобы
   файлы переживали пересоздание контейнера; `.env.example` документирует
   переменную.
   Верификация: (а) логика санитизации/upload/download реально выполнена в
   чистом Node.js против настоящего диска — round-trip, нейтрализация
   вредоносного `fileName`, отказ на path traversal через `externalFileId`,
   изоляция между tenant, `null` на отсутствующий файл — все 5 проверок
   пройдены; (б) E2E: тест «п.4» — загрузка PNG с провокационным `fileName`
   (`../../../etc/passwd.png`), `GET .../file` реально возвращает те же
   байты с `Content-Type: image/png`, чужой tenant получает 404, несуществующий
   `photoId` — 404 (не 500).

5. **Bitrix24 `application_token`** (`apps/backend/prisma/schema.prisma` +
   `apps/backend/prisma/migrations/20260915080000_bitrix_application_token/`,
   `apps/backend/src/bitrix/bitrix-token.service.ts`,
   `apps/backend/src/bitrix/install.controller.ts`,
   `docs/bitrix24-integration.md`). На `ONAPPINSTALL` `application_token`
   раньше проверялся только на присутствие и отбрасывался — сверять
   последующие вызовы было не с чем. Теперь он сохраняется ЗАШИФРОВАННЫМ
   (той же схемой AES-256-GCM, что и OAuth-токены) в новом поле
   `BitrixInstallation.encryptedApplicationToken` (nullable — у записей до
   миграции эталона нет). Новый общий helper
   `BitrixTokenService.verifyApplicationToken(memberId, incomingToken)` —
   timing-safe сравнение (`crypto.timingSafeEqual`, с безопасным ранним
   `false` при несовпадении длины, а не исключением) — предназначен для
   использования ВСЕМИ будущими Bitrix24 event-хендлерами (кроме самого
   `ONAPPINSTALL`, для которого сверивать ещё не с чем). Явно НЕ
   утверждается, что сам первый `ONAPPINSTALL`-вызов криптографически
   подтверждён самим фактом наличия `application_token` — для первого
   контакта статус по-прежнему REQUIRES BITRIX24 TEST PORTAL VERIFICATION
   (нет предварительно разделённого секрета для проверки именно ПЕРВОГО
   вызова). Исправлена ошибочная формулировка в
   `docs/bitrix24-integration.md` §2, которая раньше создавала впечатление,
   что хранение/проверка `application_token` в принципе невозможны или
   являются фундаментальным ограничением протокола — это не так: ограничен
   именно и только первый контакт, а `application_token` — штатный,
   документированный Bitrix24 механизм для ПОСЛЕДУЮЩИХ вызовов, и теперь он
   реально сохраняется и может сверяться.
   Верификация: (а) миграция реально применена к PostgreSQL, колонка
   подтверждена через `\d`, round-trip `INSERT`/`SELECT` в транзакции с
   откатом; (б) `encryptToken`/`decryptToken` +
   `verifyApplicationToken()` реально выполнены в чистом Node.js против
   настоящего `node:crypto` на 7 сценариях (верный токен → true; неверный
   → false; неизвестный `member_id` → false, без исключения; токен другой
   длины → false, без исключения — `timingSafeEqual` бросил бы на разной
   длине; отсутствующий входящий токен → false; установка без сохранённого
   эталона → false; сохранённое значение реально отличается от исходного
   текста) — все 7 пройдены; (в) E2E: тест «п.5» — `POST /bitrix/install`
   (с временно включённым `BITRIX_INSTALL_ENABLED=true`) сохраняет
   зашифрованный токен, `verifyApplicationToken()` через реальный Nest DI
   (`app.get(BitrixTokenService)`) подтверждает верный и отклоняет неверный/
   чужой/отсутствующий; тест «п.5б» — fail-closed поведение по умолчанию
   (`BITRIX_INSTALL_ENABLED` не `"true"`) не изменилось, в БД ничего не
   пишется.

## E2E: что добавлено

Новый `describe` в конце `apps/backend/test/critical-path.e2e-spec.ts` —
`«ИНТЕГРИТИ-ФИКС (integrity pass): ...»`, изолированный от основного
критического пути (собственный tenant/данные), 10 сценариев (`it`) на все 5
пунктов выше. Как и весь остальной файл: написан вручную, построчно сверен
с реальным кодом контроллеров/сервисов/DTO после правок этой итерации, но
**НЕ ЗАПУСКАЛСЯ** — см. заголовочный комментарий файла и раздел «NOT
VERIFIED» ниже.

## NOT VERIFIED (требует реального npm/Nest/PostgreSQL/Docker-прогона)

Всё, что в принципе требует `node_modules` (NestJS runtime, Prisma Client,
class-validator, jest/supertest) или Docker-демона, здесь физически не
могло быть запущено и поэтому НЕ проверено:

- `npm install` (нет доступа к `registry.npmjs.org` — подтверждено заново,
  HTTP 403 через прокси в этой сессии).
- `npm run build` — компиляция TypeScript компилятором проекта (не
  `ts.transpileModule()` без типов).
- `npm run test:domain` (пакет `packages/domain`, включая
  `PtoPackageValidationService`, используемый в fix #1).
- `npm run test:backend` (юнит-тесты backend, если есть).
- `npm run test:e2e` — САМ файл `critical-path.e2e-spec.ts`, включая ВЕСЬ
  новый `describe` этой итерации, НЕ запускался ни разу. Синтаксическая
  корректность подтверждена `ts.transpileModule()`, бизнес-логика построчно
  сверена с реальным кодом, но ни рантайм-поведение NestJS DI, ни реальные
  HTTP-ответы, ни фактическое прохождение assertions не проверены
  тест-раннером.
- `npx prisma migrate deploy` / `npx prisma db seed` — обе новые миграции
  проверены напрямую через `psql` (см. выше), но НЕ через сам Prisma CLI
  (нет `@prisma/client`/`prisma` в этой среде) — таблица
  `_prisma_migrations` не создавалась и не обновлялась, `prisma validate`
  на `schema.prisma` не запускался.
- `docker compose build` / `docker compose up` — нет демона Docker
  (`/var/run/docker.sock` отсутствует). Новый volume `local_uploads` и
  переменная `LOCAL_FILE_STORAGE_PATH` в `docker-compose.yml` проверены
  только `python3 -c "import yaml; yaml.safe_load(...)"` (валидный YAML,
  верная вложенность) — реальный `docker compose config`/`up` не
  запускался.
- HTTP smoke-тест реального поднятого backend/frontend через
  `docker compose` — не выполнялся.
- Реальный вызов `ONAPPINSTALL`/любого другого Bitrix24-события от
  настоящего (тестового) портала Bitrix24 — как и во всех предыдущих
  итерациях, нет доступа к тестовому порталу.

## Следующий шаг

Как и требует инструкция этой итерации: следующий шаг — ТОЛЬКО в
окружении, где реально можно выполнить `npm install`, `npm run build`,
`npm run test:domain`, `npm run test:backend`, `npm run test:e2e`,
`npx prisma migrate deploy`, `npx prisma db seed`, `docker compose build`,
`docker compose up`, и HTTP smoke/backend/frontend-проверки. Статическая
разработка на этом останавливается — дальнейшие гипотетические
исправления без реального прогона не производятся.
