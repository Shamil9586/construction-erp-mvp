# Verification report — 2026-09-16

## Scope

Фактическая проверка standalone-core Construction ERP MVP перед подключением
Bitrix24 test portal. Проверки выполнялись только на TEST-инфраструктуре:
Railway project `construction-erp-mvp-test`, Render frontend test service и
тестовой PostgreSQL. Основной Railway project `construction-erp-mvp` и Bitrix24
production не изменялись.

## Verified revision

Production-code fixes были проверены HTTP E2E и перенесены в `master`.
Контрольный E2E выполнен на `master` commit `16cc57fae4f6a880c8c366043c8217f12811c975`.
После него обычный Railway deploy этого commit завершился `SUCCESS`, Render —
`live`.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| PostgreSQL deployment | PASS | Railway Postgres `SUCCESS`; 3 Prisma migrations, `No pending migrations to apply` |
| Backend build | PASS | Railway Railpack build: domain build + Prisma generate + Nest build |
| Backend runtime | PASS | Nest application started, port 3000, `/health` successful |
| Frontend build/runtime | PASS | Render build successful, Vite preview live |
| Render → Railway → PostgreSQL | PASS | public `/api/auth/mode`, `/api/objects`, `/api/dashboard/executive` returned 200 with demo DB data; matching Railway HTTP logs |
| Demo seed | PASS | 10 objects, 8 subcontractors, 5 PMs, 56 works |
| Positive RBAC | PASS | PM / Construction Control / PTO / SDO allowed read operations returned 200 |
| Negative RBAC | PASS | four forbidden cross-role operations returned 403 with expected permission names |
| Railway file persistence | PASS | inspection photo persisted in `/app/storage`; same photo ID downloadable after backend redeploy; SHA-256 unchanged |
| Full HTTP Jest + Supertest E2E | PASS | `Test Suites: 1 passed, 1 total`; `Tests: 40 passed, 40 total`; 5.755 s on exact production code from `master@16cc57f` (temporary harness-only repeatability patch applied inside test container) |
| Bitrix24 production | NOT TOUCHED | `BITRIX_INSTALL_ENABLED=false`; no production portal calls |

## File persistence evidence

- inspection ID: `f6b98abd-dc1d-43a0-ac70-ebcbc8eb0636`
- photo ID: `f487f9b3-2b3f-4e07-9aac-e47cd0092748`
- test file size: 68 bytes
- SHA-256 before/after backend redeploy:
  `55557b1ff09809d8d938206cdaa2a981d74ea34d0ee4df29d6c212135f19e7d6`

The identical hash after redeploy confirms that the Railway volume mounted at
`/app/storage` is persistent for the tested file path.

## HTTP E2E coverage

The 40 passing tests cover the critical path and integrity scenarios, including:

- PM creates object, assigns subcontractor, creates works and reports physical progress;
- ObjectContractor tenant isolation and assignment guard;
- construction-control submission, critical issue, resolution and acceptance;
- technological dependency block/unblock;
- materials and certificate linkage;
- PTO executive documents, package creation and transfer to SDO;
- atomic/idempotent PtoTransfer behavior;
- SdoCase 1:N package flow;
- SDO calculation and financial closing;
- executive financial summary and audit trail;
- RBAC denials and missing-auth 401;
- cross-tenant isolation;
- health/traffic-light reaction to PTO/SDO backlog;
- real inspection-photo byte upload/download and tenant isolation;
- encrypted `application_token` storage/verification;
- fail-closed behavior when `BITRIX_INSTALL_ENABLED` is not `true`.

## Defects found and fixed during real E2E

1. Contractor assignment endpoints required broad `OBJECT_EDIT`, while PM must
   be able to assign subcontractors without gaining permission to edit the
   complete object card. Added scoped `OBJECT_MANAGE_CONTRACTORS`, granted to
   PROJECT_MANAGER / TECHNICAL_DIRECTOR (ADMIN receives all permissions), and
   applied it only to assign/remove contractor endpoints.
2. Construction-control acceptance treated a critical issue already in
   `READY_FOR_VERIFICATION` as still blocking, even though the same acceptance
   transaction is designed to close such issues. `READY_FOR_VERIFICATION` is
   now eligible for final verification/acceptance while OPEN/IN_PROGRESS
   critical issues still block acceptance.

Both fixes are included in `master@16cc57f` and were part of the 40/40 run.

## Test-harness repeatability note

For the exact-master Railway run, two test-only adjustments were applied inside
the ephemeral pre-deploy container, without changing production source:

1. delete `PtoTransfer` before deleting its package during E2E cleanup;
2. use a unique `e2e-apptoken-<member-prefix>.bitrix24.ru` portal in the
   application-token test so repeated runs do not collide with a previous
   test tenant.

These are harness repeatability fixes, not production behavior changes. They
should be committed to `apps/backend/test/critical-path.e2e-spec.ts` when that
file is next edited.

## Remaining boundary

Standalone-core is green for the tested scope. The next unverified boundary is
real Bitrix24 TEST integration: local-app installation callback/ONAPPINSTALL,
real token lifecycle, placements/iframe, user + department synchronization,
tasks/notifications and Bitrix24.Disk. No production Bitrix24 integration is
considered verified by this report.
