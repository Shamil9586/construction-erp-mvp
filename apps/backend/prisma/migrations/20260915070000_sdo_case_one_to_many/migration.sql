-- ============================================================================
-- Integrity-fix migration (2026-09-15): ExecutiveDocumentPackage -> SdoCase
-- one-to-many.
--
-- Поверх УЖЕ ПРИМЕНЁННОЙ initial-миграции (20260914120000_init) — эта
-- миграция её не переписывает и не трогает, только добавляет изменение
-- сверху, как и положено Prisma migrate.
--
-- Причина: PtoService.transferToSdo() создаёт отдельный SdoCase на КАЖДЫЙ
-- objectWorkId, встречающийся в документах пакета. При исходном
-- одиночном `"executiveDocumentPackageId" TEXT UNIQUE` пакет с документами
-- по ДВУМ разным работам падал бы на конфликт уникальности при попытке
-- создать второй SdoCase для того же пакета. Бизнес-модель уже
-- предполагала SdoCase на уровне ObjectWork — теперь это отражено составным
-- уникальным ограничением на пару (executiveDocumentPackageId, objectWorkId)
-- вместо одиночного ограничения на весь пакет.
--
-- ДЕЙСТВИТЕЛЬНО ПРИМЕНЕНО И ПРОВЕРЕНО в этой песочнице (psql против
-- локального PostgreSQL 16, база erp_migration_check, на которую ранее уже
-- была реально накатана 20260914120000_init) — см.
-- docs/changelog-integrity-pass.md за точные команды и вывод. НЕ
-- проверялось через `npx prisma migrate deploy` (Prisma CLI недоступен —
-- нет npm install), только напрямую через psql, что эквивалентно
-- содержимому SQL-файла, которое `prisma migrate deploy` выполнил бы.
-- ============================================================================

-- Имя ограничения — фактическое имя, которое Postgres присвоил инлайновому
-- `UNIQUE` в 20260914120000_init (проверено: SELECT из pg_constraint /
-- \d "SdoCase" в реально применённой миграции), а не предположение.
ALTER TABLE "SdoCase" DROP CONSTRAINT "SdoCase_executiveDocumentPackageId_key";

-- Составное уникальное ограничение — ровно то имя, которое сгенерировал бы
-- Prisma для `@@unique([executiveDocumentPackageId, objectWorkId])`.
ALTER TABLE "SdoCase"
  ADD CONSTRAINT "SdoCase_executiveDocumentPackageId_objectWorkId_key"
  UNIQUE ("executiveDocumentPackageId", "objectWorkId");
