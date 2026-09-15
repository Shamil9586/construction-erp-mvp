# ER-диаграмма

Отражает реальную схему `apps/backend/prisma/schema.prisma` /
`verify/schema.sql` (обе мирроpят друг друга — см.
`docs/mvp-test-scenario.md`). Не все служебные поля показаны — только
ключи и связи, важные для понимания модели.

```mermaid
erDiagram
    TENANT ||--o{ CONSTRUCTION_OBJECT : has
    TENANT ||--o{ USER : has
    TENANT ||--o{ CONTRACTOR : has
    TENANT ||--o| BITRIX_INSTALLATION : has
    TENANT ||--o| RISK_SETTINGS : has

    CONSTRUCTION_OBJECT ||--o{ OBJECT_WORK : has
    CONSTRUCTION_OBJECT ||--o{ OBJECT_CONTRACTOR : has
    CONSTRUCTION_OBJECT ||--o{ CONSTRUCTION_INSPECTION : has
    CONSTRUCTION_OBJECT ||--o{ EXECUTIVE_DOCUMENT : has
    CONSTRUCTION_OBJECT ||--o{ EXECUTIVE_DOCUMENT_PACKAGE : has
    CONSTRUCTION_OBJECT ||--o{ SDO_CASE : has
    CONSTRUCTION_OBJECT ||--o{ FINANCIAL_CLOSING : has
    CONSTRUCTION_OBJECT }o--|| USER : "projectManager"

    CONTRACTOR ||--o{ OBJECT_CONTRACTOR : "participates via"
    CONTRACTOR ||--o{ OBJECT_WORK : performs

    WORK_CATEGORY ||--o{ WORK_TYPE : contains
    WORK_TYPE ||--o{ OBJECT_WORK : instantiates

    OBJECT_WORK ||--o{ WORK_PROGRESS : "history of"
    OBJECT_WORK ||--o{ WORK_DEPENDENCY : "predecessor of"
    OBJECT_WORK ||--o{ WORK_DEPENDENCY : "successor of"
    OBJECT_WORK ||--o{ CONSTRUCTION_INSPECTION : "inspected by"
    OBJECT_WORK ||--o{ EXECUTIVE_DOCUMENT : documented_by
    OBJECT_WORK ||--o{ WORK_MATERIAL : consumes
    OBJECT_WORK ||--o| SDO_CASE : "closed via"
    OBJECT_WORK }o--|| USER : "responsibleUser"

    CONSTRUCTION_INSPECTION ||--o{ INSPECTION_ISSUE : raises
    CONSTRUCTION_INSPECTION ||--o{ INSPECTION_PHOTO : has
    INSPECTION_ISSUE ||--o{ INSPECTION_PHOTO : "attached to"
    INSPECTION_ISSUE }o--|| USER : "responsibleUser"

    MATERIAL ||--o{ MATERIAL_BATCH : "batched as"
    MATERIAL_BATCH ||--o{ MATERIAL_DOCUMENT : certified_by
    MATERIAL_BATCH ||--o{ WORK_MATERIAL : "used in"

    EXECUTIVE_DOCUMENT_PACKAGE ||--o{ EXECUTIVE_DOCUMENT_PACKAGE_ITEM : contains
    EXECUTIVE_DOCUMENT ||--o{ EXECUTIVE_DOCUMENT_PACKAGE_ITEM : "included in"
    EXECUTIVE_DOCUMENT_PACKAGE ||--o| SDO_CASE : "transferred to"

    SDO_CASE ||--o{ FINANCIAL_CLOSING : "closed by"

    CONSTRUCTION_OBJECT ||--o{ AUDIT_LOG : "logged (entityType=ConstructionObject)"
    OBJECT_WORK ||--o{ AUDIT_LOG : "logged (entityType=ObjectWork)"
    USER ||--o{ AUDIT_LOG : performs

    CONSTRUCTION_OBJECT {
        uuid id PK
        uuid tenantId FK
        string name
        string address
        enum status
        enum healthStatus
        decimal contractValue
        int version
    }
    OBJECT_WORK {
        uuid id PK
        uuid objectId FK
        uuid workTypeId FK
        uuid contractorId FK
        decimal plannedQuantity
        decimal actualQuantity
        decimal progressPercent
        enum scheduleStatus
        decimal varianceP
        int delayDays
        int version
    }
    CONSTRUCTION_INSPECTION {
        uuid id PK
        uuid objectId FK
        uuid objectWorkId FK
        enum status
        decimal acceptedQuantity
    }
    INSPECTION_ISSUE {
        uuid id PK
        uuid inspectionId FK
        enum severity
        enum status
    }
    EXECUTIVE_DOCUMENT {
        uuid id PK
        uuid objectId FK
        uuid objectWorkId FK
        enum type
        enum status
    }
    EXECUTIVE_DOCUMENT_PACKAGE {
        uuid id PK
        uuid objectId FK
        enum status
    }
    SDO_CASE {
        uuid id PK
        uuid objectId FK
        uuid objectWorkId FK
        enum status
        decimal calculatedValue
    }
    FINANCIAL_CLOSING {
        uuid id PK
        uuid objectId FK
        uuid sdoCaseId FK
        decimal amount
        string period
    }
    AUDIT_LOG {
        uuid id PK
        uuid tenantId FK
        string entityType
        string entityId
        string action
        json oldValue
        json newValue
    }
```

Полные определения таблиц с индексами и уникальными ограничениями —
`apps/backend/prisma/schema.prisma` (29 моделей, 18 enum-типов — точный
подсчёт: `grep -c "^model " schema.prisma`) и два независимых, реально
выполненных способа его проверить на настоящем PostgreSQL 16 в этой среде:
1) `apps/backend/prisma/migrations/20260914120000_init/migration.sql` —
   настоящая Prisma-миграция (см. её заголовочный комментарий про
   применение через `psql` к заведомо пустой базе — 29 таблиц, 18
   enum-типов, 50 FOREIGN KEY, без единой ошибки);
2) `verify/schema.sql` — прагматичный (snake_case) SQL-эквивалент для
   independent-проверки бизнес-логики без Prisma Client (см.
   `verify/run.ts`, реально выполняется и проходит).
