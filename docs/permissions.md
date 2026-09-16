# Права доступа (RBAC)

Источник истины: `packages/domain/src/rbac.ts`. Backend — единственное место, где
разрешения реально проверяются (`PermissionsGuard` +
`@RequirePermissions(...)` на контроллерах). Frontend может скрывать кнопки на
основе той же таблицы, но это исключительно UX — не механизм защиты.

## Роли (9, ТЗ §12)

| Роль | Назначение |
|---|---|
| `GENERAL_DIRECTOR` | Генеральный директор — только просмотр, Executive Dashboard |
| `TECHNICAL_DIRECTOR` | Технический директор — просмотр, редактирование объекта, управление назначениями подрядчиков, верификация замечаний |
| `PROJECT_MANAGER` (РП) | Ведёт объект: создаёт объекты/работы, назначает субподрядчиков, вносит факт, предъявляет на СК |
| `CONSTRUCTION_CONTROL` (СК) | Строительный контроль: принимает/отклоняет работы, создаёт замечания |
| `PTO` | Формирует и подтверждает исполнительную документацию, передаёт пакеты в СДО |
| `SDO` | Вносит расчётную стоимость, закрывает финансово |
| `DEPARTMENT_HEAD` | Руководитель направления — просмотр для эскалаций |
| `ADMIN` | Полный доступ (все permission) — администрирование справочников/пользователей |
| `CONTRACTOR_VIEWER` | Субподрядчик — только просмотр объектов/работ, в которых участвует |

## Permission ⇄ роль

| Permission | GD | ТехД | РП | СК | ПТО | СДО | Рук.напр. | Admin | Подрядчик |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| OBJECT_VIEW | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| OBJECT_CREATE | | | ✅ | | | | | ✅ | |
| OBJECT_EDIT | | ✅ | | | | | | ✅ | |
| OBJECT_MANAGE_CONTRACTORS | | ✅ | ✅ | | | | | ✅ | |
| WORK_VIEW | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WORK_CREATE | | | ✅ | | | | | ✅ | |
| WORK_UPDATE_PROGRESS | | | ✅ | | | | | ✅ | |
| INSPECTION_REQUEST | | | ✅ | | | | | ✅ | |
| INSPECTION_ACCEPT / REJECT | | | | ✅ | | | | ✅ | |
| ISSUE_CREATE | | | | ✅ | | | | ✅ | |
| ISSUE_RESOLVE | | | ✅ | | | | | ✅ | |
| ISSUE_VERIFY | | ✅ | | ✅ | | | | ✅ | |
| PTO_VIEW | | | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| PTO_EDIT / PTO_TRANSFER_SDO | | | | | ✅ | | | ✅ | |
| SDO_VIEW | ✅ | ✅ | ✅ | | ✅ | ✅ | ✅ | ✅ | |
| SDO_EDIT / SDO_CLOSE | | | | | | ✅ | | ✅ | |
| FINANCE_VIEW | ✅ | ✅ | ✅ | | | ✅ | ✅ | ✅ | |
| FINANCE_EDIT | | | | | | ✅ | | ✅ | |
| ADMIN_USERS / ADMIN_DICTIONARIES | | | | | | | | ✅ | |

Полный список — `Permission` enum в `packages/domain/src/types.ts`.

`OBJECT_MANAGE_CONTRACTORS` намеренно отделён от `OBJECT_EDIT`: РП может
назначать/снимать субподрядчиков объекта, но это не даёт ему право менять
карточку объекта, сроки, статус или назначенного РП. Это поведение проверено
реальным HTTP E2E (`Jest + Supertest`) в Railway TEST 2026-09-16.

## Как это подключено на backend

Каждый защищённый контроллер навешивает `BitrixAuthGuard`,
`PermissionsGuard` и конкретный `@RequirePermissions(...)`.

```ts
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("objects")
export class ObjectsController {
  @Get()
  @RequirePermissions(Permission.OBJECT_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) { ... }
}
```

- `BitrixAuthGuard` определяет пользователя. В текущем TEST-стенде используется
  `AUTH_MODE=demo` с `X-Tenant-Id`/`X-Bitrix-User-Id`; переход на реальный
  Bitrix24-контекст выполняется только на отдельном тестовом портале.
- `PermissionsGuard` вызывает `hasPermission(user.role, requiredPermission)`.
- 2026-09-16 дополнительно проверены positive/negative RBAC через публичный
  Render → Railway API и полный сквозной HTTP E2E: 40/40 тестов PASS.

## Идентификация пользователя

`User.bitrixUserId` — первичный внешний идентификатор (НЕ email, ТЗ §12).
Роль пользователя хранится в таблице `users` (`role` колонка) и
синхронизируется/назначается администратором; привязка к оргструктуре
Bitrix24 (`department.get`) — см. `docs/bitrix24-integration.md`.
