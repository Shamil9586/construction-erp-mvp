# Архитектура

Решение о том, ПОЧЕМУ система устроена именно так — в
[ADR-0001](./adr-0001-architecture.md). Этот документ — про то, КАК это
устроено технически: слои, границы, структура репозитория, поток
запроса, поверхность API, безопасность.

## Структура монорепозитория

```
construction-erp/
├── apps/
│   ├── backend/     # NestJS REST API
│   └── frontend/    # React + Vite SPA
├── packages/
│   └── domain/      # Чистая доменная логика (0 зависимостей от фреймворков)
├── verify/          # Локальный верификационный harness (см. ниже)
├── docs/
└── infra/           # Docker/Caddy для тестового развёртывания
```

`packages/domain` — единственный источник бизнес-правил. Импортируется и
`apps/backend` (реальный REST API поверх Prisma/PostgreSQL), и
`verify/` (harness, исполняющий ту же логику против настоящего
PostgreSQL средствами `psql` CLI — без npm install, см.
`docs/mvp-test-scenario.md`, раздел «Известные ограничения среды» в
README). Один и тот же код `ProgressCalculationService`,
`ScheduleStatusService`, `WorkTransitionPolicy`, `ObjectHealthService`,
`PtoPackageValidationService`, `PotentialClosingService`,
`EscalationService`, RBAC — работает в обоих местах. Это не два
параллельных, потенциально расходящихся описания бизнес-логики — это
одна реализация с двумя потребителями.

## Слои (hexagonal / ports & adapters)

```
┌─────────────────────────────────────────────────────────────┐
│  Presentation   apps/frontend (React) · apps/backend/*/  .controller
├─────────────────────────────────────────────────────────────┤
│  Application    apps/backend/*/  .service  (оркестрация,     │
│                 транзакции, вызовы domain-сервисов)          │
├─────────────────────────────────────────────────────────────┤
│  Domain         packages/domain  — чистые функции/классы,    │
│                 0 зависимостей от NestJS/Prisma/React/Node   │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure Prisma (PostgreSQL) · Bitrix-адаптеры         │
└─────────────────────────────────────────────────────────────┘
```

Правило зависимостей — только внутрь: domain ничего не знает про NestJS,
Prisma или Bitrix. Application-слой (NestJS-сервисы) знает про domain и
про Prisma, но domain никогда не импортирует их обратно. Это то, что
позволяет тестировать бизнес-логику (44 юнит-теста +
22-шаговый E2E-сценарий) без поднятия HTTP-сервера.

## Bitrix24 — порты и адаптеры

```
BitrixGatewayService  (implements все 5 портов)
   │
   ├── BitrixUserProvider / OrganizationProvider / NotificationProvider
   │   / TaskProvider / FileStorageProvider   (интерфейсы, apps/backend/src/bitrix/adapters/interfaces.ts)
   │
   ├── MockBitrixAdapter   — всегда доступен, детерминированные данные,
   │                         используется в этой среде разработки (нет
   │                         тестового портала — REQUIRES BITRIX24 TEST
   │                         PORTAL VERIFICATION)
   │
   └── RealBitrixAdapter   — настоящие HTTP-вызовы к
                             https://{domain}/rest/{method}.json,
                             написан по актуальной документации
                             (docs/bitrix24-integration.md), не
                             вызывался против реального портала
```

`BitrixGatewayService` выбирает Mock/Real **на тенанта**
(`BitrixInstallation.status`), так что демо-тенанты и реальные порталы
могут сосуществовать без изменения кода приложения.

## Поток запроса (backend)

```
HTTP → Helmet (CSP frame-ancestors) → CORS (только ALLOWED_BITRIX_DOMAIN)
     → ThrottlerGuard (rate limit)
     → BitrixAuthGuard (идентификация пользователя)
     → PermissionsGuard + @RequirePermissions (RBAC, packages/domain/rbac.ts)
     → ValidationPipe (class-validator DTO, whitelist/forbidNonWhitelisted)
     → Controller → Service (оркестрация + вызов domain-сервисов, при
       необходимости — prisma.$transaction) → AuditService.log(...)
     → AuditInterceptor (структурированный HTTP-лог с requestId)
```

Критические операции — атомарны: приёмка СК
(`InspectionsService.accept`), передача в СДО
(`PtoService.transferToSdo`), финансовое закрытие
(`SdoService.close`), внесение факта (`WorksService.reportProgress`) —
все выполняются внутри `prisma.$transaction`, чтобы избежать
частично применённых изменений (ТЗ §48).

## Поверхность REST API (ТЗ §45)

Полный список — `apps/backend/src/modules/*/*.module.ts` (каждый
`@Controller` = раздел ниже). Ключевые группы:

| Группа | Примеры маршрутов |
|---|---|
| Объекты | `GET/POST /objects`, `GET/PATCH /objects/:id`, `POST /objects/:id/recalculate-health` |
| Работы | `GET/POST /objects/:objectId/works`, `GET /works/:id`, `POST /works/:id/progress`, `GET /works/:id/start`, `POST /work-dependencies` |
| Строительный контроль | `GET/POST /inspections`, `GET /inspections/:id`, `POST /inspections/:id/issues`, `POST /issues/:issueId/resolve`, `POST /inspections/:id/accept`, `POST /inspections/:id/reject` |
| ПТО | `GET/POST /objects/:objectId/executive-documents`, `POST /executive-documents/:id/approve`, `GET/POST /objects/:objectId/executive-packages`, `POST /executive-packages/:id/transfer-sdo` |
| Финансы | `GET /financial-closings/objects/:objectId`, `GET /financial-closings/objects/:objectId/summary` |
| Субподрядчики | `GET /contractors`, `GET /contractors/:id`, `POST /contractors` |
| Дашборд | `GET /dashboard/executive` |
| Аудит | `GET /audit`, `GET /audit/:entityType/:entityId` |
| Bitrix | `POST /bitrix/install` (ONAPPINSTALL) |

Swagger/OpenAPI поднимается на `/api/docs` (только в dev/test —
см. `apps/backend/src/main.ts`).

## Безопасность (ТЗ §49, §57)

- **RBAC** — backend единственный источник истины (`docs/permissions.md`).
- **Секреты Bitrix** (access/refresh token) — AES-256-GCM в БД
  (`src/bitrix/crypto.util.ts`), никогда не логируются и не отдаются на
  frontend.
- **CSP** — `frame-ancestors` ограничен `ALLOWED_BITRIX_DOMAIN`, чтобы
  приложение встраивалось только в свой портал.
- **Rate limiting** — `ThrottlerModule` (60 сек / 300 запросов, глобальный
  guard).
- **Optimistic concurrency** — `version` на `ConstructionObject`/
  `ObjectWork`, конфликт → `409`.
- **Аудит** — неизменяемый для обычных пользователей журнал всех
  значимых изменений.
- Явные ограничения ТЗ соблюдены по умолчанию: без разрешения
  пользователя не подключаться к боевому Bitrix24, не публиковать в
  Marketplace, не изменять production-данные, не выполнять необратимые
  операции — разработка и проверка велись только на
  `MockBitrixAdapter` + локальном PostgreSQL.

## Дальше

- Сущности и связи — [domain-model.md](./domain-model.md),
  [er-diagram.md](./er-diagram.md).
- Формулы и правила — [business-rules.md](./business-rules.md).
- Роли и права — [permissions.md](./permissions.md).
- Интеграция с Bitrix24 — [bitrix24-integration.md](./bitrix24-integration.md).
- Что реально проверено и как — [mvp-test-scenario.md](./mvp-test-scenario.md).
- Развёртывание — [deployment.md](./deployment.md).
