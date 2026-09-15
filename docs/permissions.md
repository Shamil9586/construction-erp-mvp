# Права доступа (RBAC)

Источник истины: `packages/domain/src/rbac.ts` (проверено юнит-тестами в
`packages/domain/test/rbac.test.ts`). Backend — единственное место, где
разрешения реально проверяются (`PermissionsGuard` +
`@RequirePermissions(...)` на каждом контроллере, см. §«Как это подключено»
ниже). Frontend может скрывать кнопки на основе той же таблицы, но это
исключительно UX — не механизм защиты.

## Роли (9, ТЗ §12)

| Роль | Назначение |
|---|---|
| `GENERAL_DIRECTOR` | Генеральный директор — только просмотр, Executive Dashboard |
| `TECHNICAL_DIRECTOR` | Технический директор — просмотр + верификация замечаний, эскалации |
| `PROJECT_MANAGER` (РП) | Ведёт объект: создаёт объекты/работы, вносит факт, предъявляет на СК |
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

## Как это подключено на backend

Каждый контроллер (`apps/backend/src/modules/*/*.module.ts`) навешивает:

```ts
@UseGuards(BitrixAuthGuard, PermissionsGuard)
@Controller("objects")
export class ObjectsController {
  @Get()
  @RequirePermissions(Permission.OBJECT_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) { ... }
}
```

- `BitrixAuthGuard` определяет пользователя (в MVP — по заголовкам
  `X-Tenant-Id`/`X-Bitrix-User-Id`, см. `docs/bitrix24-integration.md` о
  переходе на верификацию через placement-контекст).
- `PermissionsGuard` вызывает `hasPermission(user.role, requiredPermission)`
  — тот же самый `packages/domain/src/rbac.ts`, что проверен в
  `packages/domain/test/rbac.test.ts` (12 тестов, PASS).

## Идентификация пользователя

`User.bitrixUserId` — первичный внешний идентификатор (НЕ email, ТЗ §12).
Роль пользователя хранится в таблице `users` (`role` колонка) и
синхронизируется/назначается администратором; привязка к оргструктуре
Bitrix24 (`department.get`) — см. `docs/bitrix24-integration.md`.
