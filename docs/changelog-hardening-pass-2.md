# Changelog — второй статический hardening-pass (2026-09-15)

Короткий changelog поверх текущей второй версии `construction-erp-mvp`.
Архитектура не менялась, новый проект не создавался, реальный Bitrix24
не подключался. Полный архитектурный отчёт и предыдущая проверка —
`docs/verification-report-2026-09-14.md`, этот файл его не переписывает.

Как и всё остальное в проекте: в этой песочнице по-прежнему нет доступа к
`registry.npmjs.org` и нет демона Docker (`/var/run/docker.sock`
отсутствует) — см. `docs/deployment.md`. Все изменения ниже проверены
единственным реально доступным здесь способом: `esbuild.transform()`
(синтаксическая/JSX-проверка без резолвинга импортов и БЕЗ проверки типов)
плюс ручная построчная сверка с реальным кодом соседних модулей. Ничего из
перечисленного ниже НЕ было скомпилировано `tsc`, НЕ запускалось в NestJS,
НЕ вызывалось по HTTP и НЕ проверялось `docker build`.

## FIXED IN CODE

1. **Backend Dockerfile под npm workspaces** (`apps/backend/Dockerfile`) —
   убрана строка `COPY --from=builder /app/apps/backend/node_modules
   ./apps/backend/node_modules`, рассчитывавшая на несуществующий при
   стандартном hoisting-е каталог; остальные `COPY`/`RUN`-инструкции обоих
   Dockerfile сверены со структурой npm workspaces и оставлены как есть
   (frontend Dockerfile этой проблемы не имел — runtime-стадия там
   `nginx`, node_modules не копируется вовсе).

2. **Корневой `test:e2e`** — добавлен `"test:e2e": "npm run test:e2e
   --workspace apps/backend"` в `package.json`. Проведён построчный аудит
   всех команд, упомянутых в README/deployment.md/verification-report,
   против реальных `scripts` в 4 `package.json` (root/backend/frontend/
   domain) — расхождений, кроме уже устранённого, не найдено.

3. **Атомарность ПТО→СДО** (`PtoService.transferToSdo`,
   `apps/backend/src/modules/pto/pto.module.ts`) — смена статуса пакета,
   создание/поиск `SdoCase` и обновление
   `ObjectWork.transferredToSdoQuantity` теперь выполняются внутри одной
   `prisma.$transaction`. Добавлен `tenantId` в ранее нескопированный
   запрос `sdoCase.findFirst`. Ранее не использовавшаяся модель
   `PtoTransfer` теперь реально создаётся (одна запись на пакет) в той же
   транзакции — как структурированная запись факта передачи, отдельно от
   общего `AuditLog`. Добавлена проверка идемпотентности (повторная
   передача уже переданного пакета -> 400), необходимая из-за
   `PtoTransfer.packageId @unique`.

4. **Связь «Объект ↔ Субподрядчик»** — добавлены `POST
   /objects/:id/contractors` и `DELETE /objects/:id/contractors/:contractorId`
   (`ObjectsService.assignContractor`/`removeContractor`,
   `apps/backend/src/modules/objects/objects.module.ts`; первое
   использование `@Delete` в этом кодбейзе). Tenant-принадлежность
   проверяется через связанные `ConstructionObject`/`Contractor`, так как у
   `ObjectContractor` нет собственного `tenantId`. `WorksService.create()`
   теперь требует существующего `ObjectContractor` при указании
   `contractorId` в работе (400 с понятным сообщением, если подрядчик не
   назначен), и заодно (сопутствующее исправление) проверяет
   принадлежность объекта тенанту, чего раньше не делал вовсе. Frontend:
   назначение/снятие подрядчика в карточке объекта (вкладка «Обзор»),
   фильтр объектов по подрядчику в списке объектов (`ObjectsList.tsx`,
   реально использует ранее не имевший UI backend-параметр
   `?contractorId=`).

5. **Светофор объекта считает реальный ПТО/СДО backlog**
   (`ObjectsService.recalculateHealth`) — `ptoBacklogCount`/
   `sdoBacklogCount` больше не захардкожены нулями, а считаются запросами
   к PostgreSQL. Backlog определён как «пакет/дело не в терминальном
   статусе дольше порога `staleProgressAfterDays`», потому что
   промежуточные значения `PackageStatus`/`SdoStatus` (`READY`,
   `IN_PROGRESS`, `RETURNED`, `READY_FOR_TRANSFER` и т.д.) нигде в коде
   реально не устанавливаются — фильтрация по ним всегда давала бы 0.
   Пороги теперь реально читаются из `RiskSettings` тенанта (раньше
   `ObjectHealthService.calculate()` всегда вызывался без второго
   аргумента, то есть RiskSettings в БД полностью игнорировались); при
   отсутствии строки — безопасный fallback на `DEFAULT_RISK_THRESHOLDS`.
   Отдельный новый хардкодный порог для backlog не добавлялся — переиспользован
   уже существующий `staleProgressAfterDays`.

6. **Фотофиксация строительного контроля** — вкладка «Фото» реализована
   вместо информационной заглушки: `POST /inspections/:id/photos`
   (опционально с `issueId` — прикрепление к конкретному замечанию) и `GET
   /inspections/:id/photos` (`apps/backend/src/modules/inspections/
   inspections.module.ts`), запись `InspectionPhoto` в PostgreSQL, загрузка
   через уже существующий порт `FileStorageProvider`
   (`BitrixGatewayService.upload`, который в demo-режиме — без активной
   `BitrixInstallation` — прозрачно делегирует в `MockFileStorageProvider`).
   Файл передаётся как base64 в JSON-теле, а не через `multer`/
   `FileInterceptor`: `multer`/`@types/multer` не объявлены зависимостью
   backend, а `npm install` здесь недоступен — проверить их подключение
   было невозможно, поэтому выбран вариант без новых рантайм-зависимостей.
   Frontend: `PhotosTab.tsx` — выбор проверки/замечания, загрузка файла
   (`FileReader` → base64), список фото.

7. **Граница Bitrix24 install усилена** (`apps/backend/src/bitrix/
   install.controller.ts`) — добавлен fail-closed feature-флаг
   `BITRIX_INSTALL_ENABLED` (по умолчанию не `"true"` в любом окружении,
   включая production; endpoint без него не пишет в БД и отвечает `{
   result: false }`), добавлен в `.env.example` и `docker-compose.yml`.
   Добавлена строгая валидация формата `domain` (hostname-regex),
   `member_id` (32-символьный hex — документированный Bitrix24-формат),
   длины `access_token`/`refresh_token`, обязательности
   `application_token` (документирован в §2 `bitrix24-integration.md`, но
   раньше не проверялся вовсе) и диапазона `expires_in`. `application_token`
   не сохраняется (нет отдельного поля в схеме — новое поле не добавлялось
   без необходимости) и криптографически не проверяется — это
   принципиальное ограничение самого протокола ONAPPINSTALL, а не пробел
   реализации; endpoint по-прежнему промаркирован REQUIRES BITRIX24 TEST
   PORTAL VERIFICATION в коде и в `docs/bitrix24-integration.md`.

8. **Production Bitrix-auth** — проверено: код уже (из предыдущей
   итерации) честно помечает `AUTH_MODE=bitrix`/frontend-flow как
   `REQUIRES BITRIX24 TEST PORTAL VERIFICATION` (guard, `auth.tsx`, видимый
   UI-баннер в `Layout.tsx`), нигде не найдено заявлений о завершённости
   production-авторизации. Дополнительных изменений не потребовалось.

9. **E2E-тест расширен** (`apps/backend/test/critical-path.e2e-spec.ts`,
   шаги 1б/1в/2в/17б/25) — назначение субподрядчика на объект + фильтр по
   `?contractorId=`; tenant isolation для новых `contractors`-эндпоинтов
   (чужой tenant получает 404); отказ создать работу с `contractorId` без
   предварительного назначения; идемпотентность повторной передачи
   ПТО→СДО + прямая проверка записанного `PtoTransfer`/несдублированного
   `SdoCase` через Prisma; реальный расчёт `ptoBacklogCount`/
   `sdoBacklogCount` в светофоре (искусственно состаренные пакет/дело).

## STILL NOT VERIFIED DUE TO ENVIRONMENT

Ничего из следующего не выполнялось в этой сессии — ни разу, ни частично:

- `npm install` (registry.npmjs.org отдаёт 403 в этой песочнице).
- `npm run build` (backend/frontend/domain) — компиляция `tsc`/`vite build`.
- `npm run test:backend`, `npm run test:e2e` — Jest/Supertest НЕ
  установлены и НЕ запускались; `critical-path.e2e-spec.ts` (включая
  новые шаги 1б/1в/2в/17б/25) проверен только `esbuild.transform()`
  (синтаксис/JSX, без резолвинга импортов, без проверки типов).
- `docker build` / `docker compose up` — Docker CLI есть, демона
  (`/var/run/docker.sock`) нет.
- Любой реальный вызов от Bitrix24 (ONAPPINSTALL, OAuth-обмен,
  placement-контекст) — нет доступа к тестовому порталу.

Никаких заявлений `npm install PASS`, `backend build PASS`, `vite build
PASS`, `docker build PASS`, `test:e2e PASS` в этом документе нет и не
должно появляться, пока соответствующая команда не будет реально
выполнена.

## Следующий обязательный шаг

Не продолжать разработку вслепую поверх этого архива. Следующий этап —
распаковать в среде с доступом к npm registry и Docker-демону, выполнить
`npm install`, `npm run build`, `npm run test:e2e`, `docker compose build`
и фактически устранить все всплывшие compile/runtime/test ошибки — они
статистически вероятны (типовые несовпадения, которые синтаксическая
esbuild-проверка в принципе не ловит), и это ожидаемо, а не признак того,
что эта итерация была сделана некачественно.
