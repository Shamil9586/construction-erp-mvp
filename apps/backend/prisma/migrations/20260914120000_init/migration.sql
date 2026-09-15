-- Construction ERP — initial Prisma migration.
--
-- Сгенерирована ВРУЧНУЮ, тщательно, модель за моделью, напрямую из
-- ../../schema.prisma (29 моделей, 18 enum'ов на момент написания) — в
-- этой песочнице разработки нет доступа к npm registry, поэтому CLI
-- `prisma migrate dev` физически не может быть запущен (REQUIRES CI/CD
-- VERIFICATION — как только появится доступ к npm, стоит прогнать
-- `prisma migrate diff --from-empty --to-schema-datamodel schema.prisma`
-- и сверить с этим файлом; расхождения, если появятся, будут в основном
-- в точных внешнихключевых ON DELETE/ON UPDATE политиках — см. примечание
-- ниже).
--
-- Соглашения о неймингах — ТОЧНО повторяют дефолтное поведение Prisma для
-- provider = "postgresql" при отсутствии @@map/@map в schema.prisma:
--   * имя таблицы = имя модели как есть (PascalCase, в кавычках)
--   * имя колонки = имя поля как есть (camelCase, в кавычках)
--   * enum Prisma -> нативный Postgres ENUM с тем же именем
--   * String -> TEXT, Int -> INTEGER, Boolean -> BOOLEAN,
--     DateTime -> TIMESTAMP(3), Json -> JSONB,
--     Decimal @db.Decimal(p,s) -> DECIMAL(p,s)
--   * @default(uuid()) — это ПРИЛОЖЕНИЕ-уровня дефолт Prisma Client (он
--     сам генерирует UUID перед INSERT), а не DB-уровня DEFAULT. Здесь
--     дополнительно навешен DEFAULT gen_random_uuid() как defense-in-depth
--     (страховка на случай прямой вставки в обход Prisma Client) — это
--     единственное сознательное отступление от "как сделал бы `prisma
--     migrate dev`" в этом файле, и оно строго безопасно (Prisma Client
--     всегда шлёт свой id явно, поэтому этот DEFAULT никогда не
--     используется в обычной работе).
--   * ON DELETE: RESTRICT для обязательных (NOT NULL) внешних ключей,
--     SET NULL для опциональных — соответствует объявленному в Prisma
--     поведению по умолчанию для этих случаев.
--
-- ФАКТ ПРОВЕРКИ (не предположение): эта миграция была РЕАЛЬНО применена
--   psql -h 127.0.0.1 -p 5432 -U claude -d erp_migration_check \
--        -v ON_ERROR_STOP=1 -f migration.sql
-- к заведомо пустой, только что созданной базе PostgreSQL 16
-- (erp_migration_check, создана через `createdb`, до этого `\dt` в ней
-- показывал "Did not find any relations") и завершилась с кодом выхода 0,
-- без единой ошибки. После применения проверено запросами к
-- information_schema/pg_catalog:
--   * таблиц (base table) в public: 29 — совпадает с количеством моделей
--     в schema.prisma;
--   * enum-типов: 18 — совпадает с количеством enum в schema.prisma;
--   * FOREIGN KEY constraint'ов создано: 50.
-- Это не CLI `prisma migrate dev/deploy` (недоступен — нет доступа к npm
-- registry в этой песочнице, см. верхнее примечание), а прямое применение
-- этого SQL-файла через psql — то есть проверено именно содержимое
-- файла, а не сам факт существования Prisma CLI. Как только появится
-- доступ к npm, стоит дополнительно прогнать
-- `prisma migrate diff --from-empty --to-schema-datamodel schema.prisma`
-- и сверить с этим файлом (см. примечание выше про ON DELETE/ON UPDATE).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========================================================================
-- ENUM TYPES
-- ========================================================================

CREATE TYPE "InstallationStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'TOKEN_INVALID');
CREATE TYPE "Role" AS ENUM ('GENERAL_DIRECTOR', 'TECHNICAL_DIRECTOR', 'PROJECT_MANAGER', 'CONSTRUCTION_CONTROL', 'PTO', 'SDO', 'DEPARTMENT_HEAD', 'ADMIN', 'CONTRACTOR_VIEWER');
CREATE TYPE "ObjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'AT_RISK', 'DELAYED', 'SUSPENDED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "HealthStatus" AS ENUM ('GREEN', 'YELLOW', 'RED', 'GRAY');
CREATE TYPE "ContractorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKLISTED');
CREATE TYPE "PlanType" AS ENUM ('INTERMEDIATE', 'FINAL');
CREATE TYPE "WorkStatus" AS ENUM ('PLANNED', 'BLOCKED', 'IN_PROGRESS', 'DONE');
CREATE TYPE "ScheduleStatus" AS ENUM ('ON_TRACK', 'BEHIND', 'CRITICAL', 'DONE');
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START');
CREATE TYPE "InspectionStatus" AS ENUM ('NOT_SUBMITTED', 'WAITING', 'IN_REVIEW', 'ISSUES_FOUND', 'REINSPECTION', 'ACCEPTED', 'REJECTED', 'BLOCKED');
CREATE TYPE "IssueSeverity" AS ENUM ('MINOR', 'CRITICAL');
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'READY_FOR_VERIFICATION', 'CLOSED', 'REJECTED');
CREATE TYPE "FileProvider" AS ENUM ('LOCAL', 'BITRIX_DISK');
CREATE TYPE "MaterialDocumentType" AS ENUM ('CERTIFICATE', 'PASSPORT', 'DECLARATION', 'QUALITY_DOCUMENT', 'OTHER');
CREATE TYPE "ExecutiveDocumentType" AS ENUM ('AOSR', 'EXECUTIVE_SCHEME', 'CERTIFICATE', 'PASSPORT', 'LAB_REPORT', 'OTHER');
CREATE TYPE "ExecutiveDocumentStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'IN_PROGRESS', 'WAITING_DOCUMENT', 'WAITING_CERTIFICATE', 'WAITING_APPROVAL', 'READY', 'APPROVED');
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'READY', 'TRANSFERRED_TO_SDO', 'RETURNED');
CREATE TYPE "SdoStatus" AS ENUM ('NOT_TRANSFERRED', 'READY_FOR_TRANSFER', 'TRANSFERRED', 'IN_PROGRESS', 'NEEDS_CLARIFICATION', 'CALCULATED', 'READY_TO_CLOSE', 'CLOSED');

-- ========================================================================
-- TENANCY / BITRIX
-- ========================================================================

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "portal" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Tenant_portal_key" ON "Tenant"("portal");
CREATE UNIQUE INDEX "Tenant_memberId_key" ON "Tenant"("memberId");
CREATE INDEX "Tenant_portal_idx" ON "Tenant"("portal");

CREATE TABLE "BitrixInstallation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "portal" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "encryptedAccessToken" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "scope" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "installedByBitrixId" INTEGER,
  "status" "InstallationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BitrixInstallation_tenantId_idx" ON "BitrixInstallation"("tenantId");
CREATE UNIQUE INDEX "BitrixInstallation_tenantId_memberId_key" ON "BitrixInstallation"("tenantId", "memberId");

-- ========================================================================
-- USERS
-- ========================================================================

CREATE TABLE "User" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "bitrixUserId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "departmentId" TEXT,
  "departmentName" TEXT,
  "position" TEXT,
  "role" "Role" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_tenantId_bitrixUserId_key" ON "User"("tenantId", "bitrixUserId");
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- ========================================================================
-- RISK SETTINGS
-- ========================================================================

CREATE TABLE "RiskSettings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "greenVarianceThreshold" DECIMAL(6,2) NOT NULL DEFAULT -5,
  "yellowVarianceThreshold" DECIMAL(6,2) NOT NULL DEFAULT -15,
  "escalateToTechDirectorAfterDays" INTEGER NOT NULL DEFAULT 7,
  "escalateToGeneralDirectorAfterDays" INTEGER NOT NULL DEFAULT 14,
  "staleProgressAfterDays" INTEGER NOT NULL DEFAULT 10,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========================================================================
-- CONSTRUCTION OBJECT
-- ========================================================================

CREATE TABLE "ConstructionObject" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "externalCode" TEXT,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "customerName" TEXT,
  "organizationName" TEXT,
  "projectManagerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "startDate" TIMESTAMP(3),
  "plannedFinishDate" TIMESTAMP(3),
  "actualFinishDate" TIMESTAMP(3),
  "contractValue" DECIMAL(16,2),
  "status" "ObjectStatus" NOT NULL DEFAULT 'PLANNED',
  "healthStatus" "HealthStatus" NOT NULL DEFAULT 'GRAY',
  "healthReasons" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "ConstructionObject_tenantId_idx" ON "ConstructionObject"("tenantId");
CREATE INDEX "ConstructionObject_tenantId_status_idx" ON "ConstructionObject"("tenantId", "status");
CREATE INDEX "ConstructionObject_tenantId_healthStatus_idx" ON "ConstructionObject"("tenantId", "healthStatus");
CREATE INDEX "ConstructionObject_projectManagerId_idx" ON "ConstructionObject"("projectManagerId");
CREATE INDEX "ConstructionObject_plannedFinishDate_idx" ON "ConstructionObject"("plannedFinishDate");

-- ========================================================================
-- CONTRACTORS
-- ========================================================================

CREATE TABLE "Contractor" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "inn" TEXT,
  "contactData" JSONB,
  "status" "ContractorStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Contractor_tenantId_idx" ON "Contractor"("tenantId");
CREATE UNIQUE INDEX "Contractor_tenantId_inn_key" ON "Contractor"("tenantId", "inn");

CREATE TABLE "ObjectContractor" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "contractorId" TEXT NOT NULL REFERENCES "Contractor"("id") ON DELETE RESTRICT,
  "role" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ObjectContractor_objectId_contractorId_key" ON "ObjectContractor"("objectId", "contractorId");
CREATE INDEX "ObjectContractor_contractorId_idx" ON "ObjectContractor"("contractorId");

-- ========================================================================
-- WORK DICTIONARY
-- ========================================================================

CREATE TABLE "WorkCategory" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "parentId" TEXT REFERENCES "WorkCategory"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX "WorkCategory_tenantId_idx" ON "WorkCategory"("tenantId");
CREATE INDEX "WorkCategory_parentId_idx" ON "WorkCategory"("parentId");

CREATE TABLE "WorkType" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "categoryId" TEXT NOT NULL REFERENCES "WorkCategory"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "requiresInspection" BOOLEAN NOT NULL DEFAULT true,
  "requiresExecutiveDocs" BOOLEAN NOT NULL DEFAULT true,
  "requiresMaterials" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX "WorkType_tenantId_idx" ON "WorkType"("tenantId");
CREATE INDEX "WorkType_categoryId_idx" ON "WorkType"("categoryId");

-- ========================================================================
-- OBJECT WORK
-- ========================================================================

CREATE TABLE "ObjectWork" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "workTypeId" TEXT NOT NULL REFERENCES "WorkType"("id") ON DELETE RESTRICT,
  "contractorId" TEXT REFERENCES "Contractor"("id") ON DELETE SET NULL,
  "responsibleUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "plannedQuantity" DECIMAL(14,3) NOT NULL,
  "actualQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "planType" "PlanType" NOT NULL DEFAULT 'FINAL',
  "plannedStartDate" TIMESTAMP(3) NOT NULL,
  "plannedFinishDate" TIMESTAMP(3) NOT NULL,
  "actualStartDate" TIMESTAMP(3),
  "actualFinishDate" TIMESTAMP(3),
  "estimatedCost" DECIMAL(16,2),
  "status" "WorkStatus" NOT NULL DEFAULT 'PLANNED',
  "progressPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "scheduleStatus" "ScheduleStatus" NOT NULL DEFAULT 'ON_TRACK',
  "varianceP" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "delayDays" INTEGER NOT NULL DEFAULT 0,
  "acceptedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "executiveDocsReadyQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "transferredToSdoQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "ObjectWork_tenantId_idx" ON "ObjectWork"("tenantId");
CREATE INDEX "ObjectWork_objectId_idx" ON "ObjectWork"("objectId");
CREATE INDEX "ObjectWork_contractorId_idx" ON "ObjectWork"("contractorId");
CREATE INDEX "ObjectWork_responsibleUserId_idx" ON "ObjectWork"("responsibleUserId");
CREATE INDEX "ObjectWork_status_idx" ON "ObjectWork"("status");
CREATE INDEX "ObjectWork_plannedFinishDate_idx" ON "ObjectWork"("plannedFinishDate");

CREATE TABLE "WorkDependency" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "predecessorWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "successorWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "dependencyType" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
  "requiresAcceptance" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "WorkDependency_predecessorWorkId_successorWorkId_key" ON "WorkDependency"("predecessorWorkId", "successorWorkId");
CREATE INDEX "WorkDependency_successorWorkId_idx" ON "WorkDependency"("successorWorkId");

CREATE TABLE "WorkProgress" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "quantityDelta" DECIMAL(14,3) NOT NULL,
  "totalQuantity" DECIMAL(14,3) NOT NULL,
  "progressPercent" DECIMAL(5,2) NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedBy" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkProgress_objectWorkId_idx" ON "WorkProgress"("objectWorkId");
CREATE INDEX "WorkProgress_reportedAt_idx" ON "WorkProgress"("reportedAt");

-- ========================================================================
-- CONSTRUCTION CONTROL (СК)
-- ========================================================================

CREATE TABLE "ConstructionInspection" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "objectWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "requestedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inspectorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "status" "InspectionStatus" NOT NULL DEFAULT 'WAITING',
  "inspectionDate" TIMESTAMP(3),
  "decision" TEXT,
  "comment" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "acceptedQuantity" DECIMAL(14,3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ConstructionInspection_tenantId_idx" ON "ConstructionInspection"("tenantId");
CREATE INDEX "ConstructionInspection_objectId_idx" ON "ConstructionInspection"("objectId");
CREATE INDEX "ConstructionInspection_objectWorkId_idx" ON "ConstructionInspection"("objectWorkId");
CREATE INDEX "ConstructionInspection_status_idx" ON "ConstructionInspection"("status");

CREATE TABLE "InspectionIssue" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL REFERENCES "ConstructionInspection"("id") ON DELETE RESTRICT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "IssueSeverity" NOT NULL DEFAULT 'MINOR',
  "responsibleUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "dueDate" TIMESTAMP(3),
  "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InspectionIssue_tenantId_idx" ON "InspectionIssue"("tenantId");
CREATE INDEX "InspectionIssue_inspectionId_idx" ON "InspectionIssue"("inspectionId");
CREATE INDEX "InspectionIssue_status_idx" ON "InspectionIssue"("status");
CREATE INDEX "InspectionIssue_dueDate_idx" ON "InspectionIssue"("dueDate");

CREATE TABLE "InspectionPhoto" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL REFERENCES "ConstructionInspection"("id") ON DELETE RESTRICT,
  "issueId" TEXT REFERENCES "InspectionIssue"("id") ON DELETE SET NULL,
  "fileProvider" "FileProvider" NOT NULL DEFAULT 'LOCAL',
  "externalFileId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InspectionPhoto_inspectionId_idx" ON "InspectionPhoto"("inspectionId");
CREATE INDEX "InspectionPhoto_issueId_idx" ON "InspectionPhoto"("issueId");

-- ========================================================================
-- MATERIALS
-- ========================================================================

CREATE TABLE "Material" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "manufacturer" TEXT,
  "brand" TEXT,
  "type" TEXT
);
CREATE INDEX "Material_tenantId_idx" ON "Material"("tenantId");

CREATE TABLE "MaterialBatch" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL REFERENCES "Material"("id") ON DELETE RESTRICT,
  "batchNumber" TEXT NOT NULL,
  "supplier" TEXT,
  "deliveryDate" TIMESTAMP(3),
  "objectId" TEXT REFERENCES "ConstructionObject"("id") ON DELETE SET NULL
);
CREATE INDEX "MaterialBatch_tenantId_idx" ON "MaterialBatch"("tenantId");
CREATE INDEX "MaterialBatch_materialId_idx" ON "MaterialBatch"("materialId");
CREATE INDEX "MaterialBatch_objectId_idx" ON "MaterialBatch"("objectId");

CREATE TABLE "MaterialDocument" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "materialBatchId" TEXT NOT NULL REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT,
  "type" "MaterialDocumentType" NOT NULL,
  "number" TEXT,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "fileId" TEXT
);
CREATE INDEX "MaterialDocument_materialBatchId_idx" ON "MaterialDocument"("materialBatchId");

CREATE TABLE "WorkMaterial" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "objectWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "materialBatchId" TEXT NOT NULL REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT,
  "quantity" DECIMAL(14,3) NOT NULL
);
CREATE UNIQUE INDEX "WorkMaterial_objectWorkId_materialBatchId_key" ON "WorkMaterial"("objectWorkId", "materialBatchId");
CREATE INDEX "WorkMaterial_materialBatchId_idx" ON "WorkMaterial"("materialBatchId");

-- ========================================================================
-- EXECUTIVE DOCUMENTATION (ПТО)
-- ========================================================================

CREATE TABLE "ExecutiveDocument" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "objectWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "type" "ExecutiveDocumentType" NOT NULL,
  "number" TEXT,
  "documentDate" TIMESTAMP(3),
  "status" "ExecutiveDocumentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "fileId" TEXT,
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExecutiveDocument_tenantId_idx" ON "ExecutiveDocument"("tenantId");
CREATE INDEX "ExecutiveDocument_objectId_idx" ON "ExecutiveDocument"("objectId");
CREATE INDEX "ExecutiveDocument_objectWorkId_idx" ON "ExecutiveDocument"("objectWorkId");
CREATE INDEX "ExecutiveDocument_status_idx" ON "ExecutiveDocument"("status");

CREATE TABLE "ExecutiveDocumentPackage" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "objectWorkId" TEXT,
  "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "ExecutiveDocumentPackage_tenantId_idx" ON "ExecutiveDocumentPackage"("tenantId");
CREATE INDEX "ExecutiveDocumentPackage_objectId_idx" ON "ExecutiveDocumentPackage"("objectId");
CREATE INDEX "ExecutiveDocumentPackage_status_idx" ON "ExecutiveDocumentPackage"("status");

CREATE TABLE "ExecutiveDocumentPackageItem" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "packageId" TEXT NOT NULL REFERENCES "ExecutiveDocumentPackage"("id") ON DELETE RESTRICT,
  "documentId" TEXT NOT NULL REFERENCES "ExecutiveDocument"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ExecutiveDocumentPackageItem_packageId_documentId_key" ON "ExecutiveDocumentPackageItem"("packageId", "documentId");

CREATE TABLE "PtoTransfer" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL UNIQUE REFERENCES "ExecutiveDocumentPackage"("id") ON DELETE RESTRICT,
  "transferredBy" TEXT NOT NULL,
  "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "comment" TEXT
);
CREATE INDEX "PtoTransfer_tenantId_idx" ON "PtoTransfer"("tenantId");

-- ========================================================================
-- СДО
-- ========================================================================

CREATE TABLE "SdoCase" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "objectWorkId" TEXT NOT NULL REFERENCES "ObjectWork"("id") ON DELETE RESTRICT,
  "executiveDocumentPackageId" TEXT UNIQUE REFERENCES "ExecutiveDocumentPackage"("id") ON DELETE SET NULL,
  "status" "SdoStatus" NOT NULL DEFAULT 'NOT_TRANSFERRED',
  "ptoTransferredAt" TIMESTAMP(3),
  "ptoTransferredBy" TEXT,
  "sdoResponsibleId" TEXT,
  "estimatedValue" DECIMAL(16,2),
  "calculatedValue" DECIMAL(16,2),
  "acceptedClosingValue" DECIMAL(16,2),
  "calculatedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SdoCase_tenantId_idx" ON "SdoCase"("tenantId");
CREATE INDEX "SdoCase_objectId_idx" ON "SdoCase"("objectId");
CREATE INDEX "SdoCase_objectWorkId_idx" ON "SdoCase"("objectWorkId");
CREATE INDEX "SdoCase_status_idx" ON "SdoCase"("status");

-- ========================================================================
-- FINANCIAL CLOSING
-- ========================================================================

CREATE TABLE "FinancialClosing" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL REFERENCES "ConstructionObject"("id") ON DELETE RESTRICT,
  "sdoCaseId" TEXT NOT NULL REFERENCES "SdoCase"("id") ON DELETE RESTRICT,
  "period" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "closingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinancialClosing_tenantId_idx" ON "FinancialClosing"("tenantId");
CREATE INDEX "FinancialClosing_objectId_idx" ON "FinancialClosing"("objectId");
CREATE INDEX "FinancialClosing_sdoCaseId_idx" ON "FinancialClosing"("sdoCaseId");
CREATE INDEX "FinancialClosing_closingDate_idx" ON "FinancialClosing"("closingDate");

-- ========================================================================
-- SHARED
-- ========================================================================

CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "objectId" TEXT REFERENCES "ConstructionObject"("id") ON DELETE SET NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "fileProvider" "FileProvider" NOT NULL DEFAULT 'LOCAL',
  "externalFileId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Attachment_tenantId_idx" ON "Attachment"("tenantId");
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT
);
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "dedupKey" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "readAt" TIMESTAMP(3),
  "sentToBitrix" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Notification_tenantId_dedupKey_key" ON "Notification"("tenantId", "dedupKey");
CREATE INDEX "Notification_tenantId_userId_idx" ON "Notification"("tenantId", "userId");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

CREATE TABLE "DictionaryItem" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "category" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "DictionaryItem_tenantId_category_code_key" ON "DictionaryItem"("tenantId", "category", "code");
CREATE INDEX "DictionaryItem_tenantId_category_idx" ON "DictionaryItem"("tenantId", "category");
