-- verify/schema.sql
--
-- НАЗНАЧЕНИЕ: этот файл НЕ является официальной Prisma-миграцией продакшен
-- приложения. Официальная миграция генерируется командой
-- `npx prisma migrate dev --name init` из apps/backend/prisma/schema.prisma
-- на машине с доступом в npm registry (см. docs/deployment.md).
--
-- Этот файл — прагматичный SQL-слепок той же доменной модели (снэйк-кейс,
-- часть некритичных для верификации полей опущена), который используется
-- ТОЛЬКО локальным верификационным harness (verify/run.ts) для того, чтобы
-- (см. ниже CREATE EXTENSION pgcrypto для gen_random_uuid())
-- реально поднять PostgreSQL и прогнать бизнес-логику пакета
-- @construction-erp/domain против настоящей БД в среде без доступа к
-- npm/Docker registry. Структура таблиц соответствует schema.prisma.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal TEXT UNIQUE NOT NULL,
  member_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE risk_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id),
  green_variance_threshold NUMERIC(6,2) NOT NULL DEFAULT -5,
  yellow_variance_threshold NUMERIC(6,2) NOT NULL DEFAULT -15,
  escalate_to_tech_director_after_days INT NOT NULL DEFAULT 7,
  escalate_to_general_director_after_days INT NOT NULL DEFAULT 14,
  stale_progress_after_days INT NOT NULL DEFAULT 10
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  bitrix_user_id INT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  position TEXT,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, bitrix_user_id)
);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_role ON users(tenant_id, role);

CREATE TABLE contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  inn TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE INDEX idx_contractors_tenant ON contractors(tenant_id);

CREATE TABLE construction_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  external_code TEXT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  customer_name TEXT,
  organization_name TEXT,
  project_manager_id UUID REFERENCES users(id),
  start_date DATE,
  planned_finish_date DATE,
  actual_finish_date DATE,
  contract_value NUMERIC(16,2),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  health_status TEXT NOT NULL DEFAULT 'GRAY',
  health_reasons JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);
CREATE INDEX idx_objects_tenant ON construction_objects(tenant_id);
CREATE INDEX idx_objects_status ON construction_objects(tenant_id, status);
CREATE INDEX idx_objects_health ON construction_objects(tenant_id, health_status);
CREATE INDEX idx_objects_pm ON construction_objects(project_manager_id);
CREATE INDEX idx_objects_finish ON construction_objects(planned_finish_date);

CREATE TABLE object_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  role TEXT,
  UNIQUE (object_id, contractor_id)
);
CREATE INDEX idx_objcontr_contractor ON object_contractors(contractor_id);

CREATE TABLE work_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  parent_id UUID REFERENCES work_categories(id),
  name TEXT NOT NULL,
  code TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_workcat_tenant ON work_categories(tenant_id);

CREATE TABLE work_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category_id UUID NOT NULL REFERENCES work_categories(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  requires_inspection BOOLEAN NOT NULL DEFAULT true,
  requires_executive_docs BOOLEAN NOT NULL DEFAULT true,
  requires_materials BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_worktypes_tenant ON work_types(tenant_id);
CREATE INDEX idx_worktypes_cat ON work_types(category_id);

CREATE TABLE object_works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  work_type_id UUID NOT NULL REFERENCES work_types(id),
  contractor_id UUID REFERENCES contractors(id),
  responsible_user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  planned_quantity NUMERIC(14,3) NOT NULL,
  actual_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  plan_type TEXT NOT NULL DEFAULT 'FINAL',
  planned_start_date DATE NOT NULL,
  planned_finish_date DATE NOT NULL,
  actual_start_date DATE,
  actual_finish_date DATE,
  estimated_cost NUMERIC(16,2),
  status TEXT NOT NULL DEFAULT 'PLANNED',
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  schedule_status TEXT NOT NULL DEFAULT 'ON_TRACK',
  variance_p NUMERIC(6,2) NOT NULL DEFAULT 0,
  delay_days INT NOT NULL DEFAULT 0,
  accepted_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  executive_docs_ready_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  transferred_to_sdo_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);
CREATE INDEX idx_works_tenant ON object_works(tenant_id);
CREATE INDEX idx_works_object ON object_works(object_id);
CREATE INDEX idx_works_contractor ON object_works(contractor_id);
CREATE INDEX idx_works_responsible ON object_works(responsible_user_id);
CREATE INDEX idx_works_status ON object_works(status);
CREATE INDEX idx_works_finish ON object_works(planned_finish_date);

CREATE TABLE work_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_work_id UUID NOT NULL REFERENCES object_works(id),
  successor_work_id UUID NOT NULL REFERENCES object_works(id),
  dependency_type TEXT NOT NULL DEFAULT 'FINISH_TO_START',
  requires_acceptance BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (predecessor_work_id, successor_work_id)
);
CREATE INDEX idx_deps_successor ON work_dependencies(successor_work_id);

CREATE TABLE work_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_work_id UUID NOT NULL REFERENCES object_works(id),
  quantity_delta NUMERIC(14,3) NOT NULL,
  total_quantity NUMERIC(14,3) NOT NULL,
  progress_percent NUMERIC(5,2) NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by TEXT NOT NULL,
  comment TEXT
);
CREATE INDEX idx_progress_work ON work_progress(object_work_id);
CREATE INDEX idx_progress_date ON work_progress(reported_at);

CREATE TABLE construction_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  object_work_id UUID NOT NULL REFERENCES object_works(id),
  requested_by_id UUID REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  inspector_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'WAITING',
  inspection_date DATE,
  decision TEXT,
  comment TEXT,
  accepted_at TIMESTAMPTZ,
  accepted_quantity NUMERIC(14,3)
);
CREATE INDEX idx_insp_object ON construction_inspections(object_id);
CREATE INDEX idx_insp_work ON construction_inspections(object_work_id);
CREATE INDEX idx_insp_status ON construction_inspections(status);

CREATE TABLE inspection_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  inspection_id UUID NOT NULL REFERENCES construction_inspections(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MINOR',
  responsible_user_id UUID REFERENCES users(id),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ
);
CREATE INDEX idx_issue_inspection ON inspection_issues(inspection_id);
CREATE INDEX idx_issue_status ON inspection_issues(status);
CREATE INDEX idx_issue_due ON inspection_issues(due_date);

CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  manufacturer TEXT,
  brand TEXT,
  type TEXT
);

CREATE TABLE material_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  material_id UUID NOT NULL REFERENCES materials(id),
  batch_number TEXT NOT NULL,
  supplier TEXT,
  delivery_date DATE,
  object_id UUID REFERENCES construction_objects(id)
);
CREATE INDEX idx_matbatch_material ON material_batches(material_id);
CREATE INDEX idx_matbatch_object ON material_batches(object_id);

CREATE TABLE material_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  material_batch_id UUID NOT NULL REFERENCES material_batches(id),
  type TEXT NOT NULL,
  number TEXT,
  valid_from DATE,
  valid_until DATE
);
CREATE INDEX idx_matdoc_batch ON material_documents(material_batch_id);

CREATE TABLE work_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_work_id UUID NOT NULL REFERENCES object_works(id),
  material_batch_id UUID NOT NULL REFERENCES material_batches(id),
  quantity NUMERIC(14,3) NOT NULL,
  UNIQUE (object_work_id, material_batch_id)
);

CREATE TABLE executive_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  object_work_id UUID NOT NULL REFERENCES object_works(id),
  type TEXT NOT NULL,
  number TEXT,
  document_date DATE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  created_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ
);
CREATE INDEX idx_execdoc_object ON executive_documents(object_id);
CREATE INDEX idx_execdoc_work ON executive_documents(object_work_id);
CREATE INDEX idx_execdoc_status ON executive_documents(status);

CREATE TABLE executive_document_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_pkg_object ON executive_document_packages(object_id);
CREATE INDEX idx_pkg_status ON executive_document_packages(status);

CREATE TABLE executive_document_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES executive_document_packages(id),
  document_id UUID NOT NULL REFERENCES executive_documents(id),
  UNIQUE (package_id, document_id)
);

CREATE TABLE sdo_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  object_work_id UUID NOT NULL REFERENCES object_works(id),
  executive_document_package_id UUID UNIQUE REFERENCES executive_document_packages(id),
  status TEXT NOT NULL DEFAULT 'NOT_TRANSFERRED',
  pto_transferred_at TIMESTAMPTZ,
  sdo_responsible_id UUID REFERENCES users(id),
  estimated_value NUMERIC(16,2),
  calculated_value NUMERIC(16,2),
  accepted_closing_value NUMERIC(16,2),
  calculated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  comment TEXT
);
CREATE INDEX idx_sdo_object ON sdo_cases(object_id);
CREATE INDEX idx_sdo_work ON sdo_cases(object_work_id);
CREATE INDEX idx_sdo_status ON sdo_cases(status);

CREATE TABLE financial_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  object_id UUID NOT NULL REFERENCES construction_objects(id),
  sdo_case_id UUID NOT NULL REFERENCES sdo_cases(id),
  period TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL,
  closing_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by TEXT NOT NULL
);
CREATE INDEX idx_fc_object ON financial_closings(object_id);
CREATE INDEX idx_fc_sdo ON financial_closings(sdo_case_id);
CREATE INDEX idx_fc_date ON financial_closings(closing_date);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  dedup_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedup_key)
);
CREATE INDEX idx_notif_user ON notifications(tenant_id, user_id);
