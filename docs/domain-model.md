# Модель предметной области

Источник истины для реальной схемы БД — `apps/backend/prisma/schema.prisma`
(генерируется в `prisma migrate dev` в среде с доступом к npm; в этой
песочнице зеркалируется вручную в `verify/schema.sql` и реально исполняется
против PostgreSQL 16 — см. `docs/mvp-test-scenario.md`). Здесь — обзор
сущностей и их назначения по слоям пайплайна ТЗ: Планирование → СМР →
факт → СК → ИД/ПТО → СДО → финансовое закрытие → аналитика.

## Тенантность и Bitrix24

- **Tenant** — организация-клиент (1 Bitrix24-портал = 1 Tenant, ТЗ §11).
- **BitrixInstallation** — установка приложения на конкретный портал:
  зашифрованные (AES-256-GCM) `accessToken`/`refreshToken`, `domain`,
  `memberId`, `status` (`ACTIVE`/`NOT_INSTALLED`/...). Определяет, работает
  ли тенант через `MockBitrixAdapter` или `RealBitrixAdapter`
  (`BitrixGatewayService.isReal()`).
- **User** — `bitrixUserId` (число) — первичный внешний идентификатор,
  **не email**. Хранит `role` (9 значений, см. `docs/permissions.md`),
  привязку к отделу (для эскалаций).

## Производство

- **Contractor** — субподрядчик/генподрядчик/поставщик.
  **ObjectContractor** — участие субподрядчика в объекте с ролью
  (many-to-many).
- **ConstructionObject** — объект строительства: адрес, суммы договора
  (`Decimal`), `status` (жизненный цикл: PLANNED→ACTIVE→...→COMPLETED/
  ARCHIVED, либо AT_RISK/DELAYED/SUSPENDED), `healthStatus`
  (GREEN/YELLOW/RED/GRAY — светофор, `ObjectHealthService`), `version`
  (оптимистичная блокировка).
- **WorkCategory → WorkType** — иерархический справочник видов работ
  (напр. «Бетонные работы» → «Армирование фундамента»), с флагами
  `requiresExecutiveDocs`/`requiresMaterials`, управляющими требованиями
  `PtoPackageValidationService`.
- **ObjectWork** — конкретная работа на объекте: план/факт объём
  (`Decimal`), даты, `progressPercent`/`scheduleStatus`/`varianceP`/
  `delayDays` (пересчитываются `ProgressCalculationService`/
  `ScheduleStatusService` при каждом факте), `planType`
  (`INTERMEDIATE`/`FINAL` — замена концепции «серый/синий план» из
  исходного Excel-подхода, ТЗ §50), `version`.
- **WorkProgress** — история внесения факта (append-only, не
  перезаписывается — «журнал», а не «текущее значение»).
- **WorkDependency** — технологическая зависимость между работами
  (`FINISH_TO_START`, `requiresAcceptance`), обрабатывается
  `WorkTransitionPolicy`.

## Строительный контроль

- **ConstructionInspection** — заявка/проверка СК по конкретной работе:
  `status` (8 значений), решение, дата, принятый объём.
- **InspectionIssue** — замечание: `severity` (`MINOR`/`CRITICAL`),
  `status` (5 значений: OPEN→IN_PROGRESS→READY_FOR_VERIFICATION→CLOSED,
  либо REJECTED), ответственный, срок устранения.
- **InspectionPhoto** — фотофиксация, привязана к проверке и/или
  конкретному замечанию, хранится через `FileProvider` (Bitrix24.Disk в
  проде, `LOCAL` — заглушка для MVP/теста).

## Материалы (фундамент под будущий полноценный учёт)

- **Material** → **MaterialBatch** (партия) → **MaterialDocument**
  (сертификат/паспорт качества) → **WorkMaterial** (расход материала на
  конкретную работу). Используется `PtoPackageValidationService` для
  проверки «работа, требующая материалов, обеспечена партией с
  действующим документом».

## ПТО / исполнительная документация

- **ExecutiveDocument** — единица ИД (АОСР, исполнительная схема,
  сертификат, паспорт, протокол испытаний, прочее), `status` (8 значений,
  всегда стартует `DRAFT`).
- **ExecutiveDocumentPackage** + **ExecutiveDocumentPackageItem** — пакет
  документов, собираемый ПТО перед передачей в СДО; `status`
  (DRAFT→IN_PROGRESS→READY→TRANSFERRED_TO_SDO, либо RETURNED).

## СДО и финансы

- **SdoCase** — «дело» СДО по конкретной переданной работе: статус
  (`TRANSFERRED`→...→`CALCULATED`→`READY_TO_CLOSE`→`CLOSED`),
  `calculatedValue` (вносится вручную сотрудником СДО — расчёт делается
  **вне системы**, в Гранд-Смете).
- **FinancialClosing** — фактическая сумма закрытия по объекту/работе за
  период (`period`, `amount`, дата) — то, что видно в отчётности.

## Кросс-срезовые сущности

- **AuditLog** — неизменяемый (для обычных пользователей) журнал всех
  значимых изменений: `entityType`/`entityId`/`action`/`oldValue`/
  `newValue`/`userId`/`createdAt`.
- **Notification** — уведомление (Bitrix `im.notify` в проде), с
  `dedupKey` для защиты от дублей.
- **RiskSettings** — настраиваемые пороги светофора/эскалации на тенант
  (не хардкод, см. `docs/business-rules.md` §2, §9).

## Производные (не таблицы) — доменные сервисы

`ProgressCalculationService`, `ScheduleStatusService`,
`WorkTransitionPolicy`, `ObjectHealthService`,
`PtoPackageValidationService`, `PotentialClosingService`,
`EscalationService`, RBAC (`ROLE_PERMISSIONS`) — все в `packages/domain/`,
без зависимостей от Prisma/NestJS/React; подробности и формулы — в
`docs/business-rules.md`. Именно поэтому они одинаково исполняются и в
реальном backend (`apps/backend`), и в локальном верификационном harness
(`verify/`), что и позволило проверить их без доступа к npm registry в
этой среде разработки.
