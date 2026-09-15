import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Typography,
  Space,
  Alert,
  Spin,
  Descriptions,
  Tabs,
  Table,
  Tag,
  Card,
  Progress,
  Button,
  Modal,
  InputNumber,
  Form,
  Row,
  Col,
  Statistic,
  Timeline,
  Empty,
  Select,
  Input,
  Popconfirm,
  message,
} from "antd";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import { hasPermission, Permission } from "@construction-erp/domain";
import { HealthBadge, ScheduleBadge } from "../components/StatusBadge";
import { Gantt, GanttTask } from "../components/Gantt";
import { ObjectFormModal } from "../components/ObjectFormModal";
import { CreateWorkModal } from "../components/CreateWorkModal";
import { ControlTab } from "../components/tabs/ControlTab";
import { MaterialsTab } from "../components/tabs/MaterialsTab";
import { PtoTab } from "../components/tabs/PtoTab";
import { SdoTab } from "../components/tabs/SdoTab";
import { PhotosTab } from "../components/tabs/PhotosTab";

/**
 * Карточка объекта — центральный экран для РП/ГД (ТЗ §42-43).
 * Формы ответов ТОЧНО повторяют то, что реально возвращают контроллеры
 * apps/backend/src/modules/* (см. комментарии у каждого интерфейса) — это
 * не "предположительный" контракт, а зеркало написанного backend-кода.
 */

interface ContractorRef {
  id: string;
  role: string | null;
  contractor: { id: string; name: string };
}

/** ObjectsService.findOne() */
interface ObjectOverview {
  id: string;
  name: string;
  address: string;
  status: string;
  healthStatus: string;
  version: number;
  customerName?: string | null;
  organizationName?: string | null;
  startDate?: string | null;
  plannedFinishDate?: string | null;
  contractValue?: number | string | null;
  projectManager?: { id: string; name: string } | null;
  contractors: ContractorRef[];
}

/** WorksService.findForObject() */
interface WorkRow {
  id: string;
  name: string;
  unit: string;
  plannedQuantity: number | string;
  actualQuantity: number | string;
  progressPercent: number | string;
  varianceP: number | string;
  delayDays: number;
  scheduleStatus: string;
  status: string;
  plannedStartDate: string;
  plannedFinishDate: string;
  workType?: { name: string; category?: { name: string } | null };
  responsibleUser?: { name: string } | null;
}

/** InspectionsService.findQueue() — без issues (список), findOne() — с issues (при раскрытии строки) */
interface InspectionRow {
  id: string;
  objectId: string;
  objectWorkId: string;
  object: { name: string };
  objectWork: { name: string };
  status: string;
  requestedAt: string;
}

interface InspectionIssue {
  id: string;
  title: string;
  description: string;
  severity: "MINOR" | "CRITICAL";
  status: string;
}

/** PtoService.findPackagesForObject() */
interface PtoPackageRow {
  id: string;
  status: string;
  createdBy?: string | null;
  createdAt: string;
  documents: { document: { id: string; type: string; status: string; number?: string | null } }[];
}

/** FinancialService.objectSummary() */
interface FinancialSummary {
  contractValue: number | string | null;
  closedTotal: number;
  remaining: number | null;
  potentialClosing: number;
  stages: { stage: number; label: string; amount: number }[];
  byWork: { workId: string; workName: string; potential: number }[];
}

/** AuditService.findForEntity() */
interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  user?: { name: string; role: string } | null;
}

function formatMoney(v?: number | string | null) {
  if (!v) return "0 ₽";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(v)) + " ₽";
}

export function ObjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, headers, identity } = useAuth();
  const qc = useQueryClient();
  const [progressModalWork, setProgressModalWork] = React.useState<WorkRow | null>(null);
  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [addWorkModalOpen, setAddWorkModalOpen] = React.useState(false);
  const [assignContractorOpen, setAssignContractorOpen] = React.useState(false);
  const [form] = Form.useForm();
  const [assignForm] = Form.useForm();

  const enabled = !!tenantId && !!id;

  const overviewQ = useQuery({
    queryKey: ["object", tenantId, id],
    queryFn: () => api.get<ObjectOverview>(`/objects/${id}`, headers),
    enabled,
  });
  const worksQ = useQuery({
    queryKey: ["object-works", tenantId, id],
    queryFn: () => api.get<WorkRow[]>(`/objects/${id}/works`, headers),
    enabled,
  });
  // findQueue() не фильтрует по объекту на backend — фильтруем на клиенте.
  const inspectionsAllQ = useQuery({
    queryKey: ["inspections-queue", tenantId],
    queryFn: () => api.get<InspectionRow[]>(`/inspections`, headers),
    enabled,
  });
  const ptoQ = useQuery({
    queryKey: ["object-pto", tenantId, id],
    queryFn: () => api.get<PtoPackageRow[]>(`/objects/${id}/executive-packages`, headers),
    enabled,
  });
  const financeQ = useQuery({
    queryKey: ["object-finance", tenantId, id],
    queryFn: () => api.get<FinancialSummary>(`/financial-closings/objects/${id}/summary`, headers),
    enabled,
  });
  const auditQ = useQuery({
    queryKey: ["object-audit", tenantId, id],
    queryFn: () => api.get<AuditEntry[]>(`/audit/ConstructionObject/${id}`, headers),
    enabled,
  });
  // Список всех подрядчиков тенанта — для формы назначения (ТЗ: связь
  // «Объект ↔ Субподрядчик», ХАРДЕНИНГ-ФИКС этой итерации).
  const contractorsQ = useQuery({
    queryKey: ["contractors", tenantId],
    queryFn: () => api.get<{ id: string; name: string }[]>("/contractors", headers),
    enabled: assignContractorOpen && !!tenantId,
  });

  const reportProgress = useMutation({
    mutationFn: (payload: { workId: string; actualQuantity: number }) =>
      api.post(`/works/${payload.workId}/progress`, headers, { actualQuantity: payload.actualQuantity }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object-works", tenantId, id] });
      qc.invalidateQueries({ queryKey: ["object", tenantId, id] });
      setProgressModalWork(null);
    },
  });

  const requestInspection = useMutation({
    mutationFn: (objectWorkId: string) => api.post(`/inspections`, headers, { objectWorkId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inspections-queue", tenantId] });
      qc.invalidateQueries({ queryKey: ["object-works", tenantId, id] });
    },
  });

  // POST /objects/:id/contractors — ObjectsService.assignContractor (ХАРДЕНИНГ-ФИКС
  // этой итерации: раньше назначить субподрядчика на объект через UI/API было
  // невозможно вовсе — связь ObjectContractor заполнялась только seed-скриптом).
  const assignContractor = useMutation({
    mutationFn: (payload: { contractorId: string; role?: string }) => api.post(`/objects/${id}/contractors`, headers, payload),
    onSuccess: () => {
      message.success("Субподрядчик назначен");
      qc.invalidateQueries({ queryKey: ["object", tenantId, id] });
      qc.invalidateQueries({ queryKey: ["objects", tenantId] });
      setAssignContractorOpen(false);
      assignForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось назначить субподрядчика"),
  });

  // DELETE /objects/:id/contractors/:contractorId — ObjectsService.removeContractor
  const removeContractor = useMutation({
    mutationFn: (contractorId: string) => api.delete(`/objects/${id}/contractors/${contractorId}`, headers),
    onSuccess: () => {
      message.success("Субподрядчик снят с объекта");
      qc.invalidateQueries({ queryKey: ["object", tenantId, id] });
      qc.invalidateQueries({ queryKey: ["objects", tenantId] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось снять субподрядчика"),
  });

  if (!tenantId) return <Alert type="info" showIcon message="Укажите Tenant ID в верхней панели" />;
  if (overviewQ.isLoading) return <Spin size="large" style={{ marginTop: 80, width: "100%" }} />;
  if (overviewQ.isError || !overviewQ.data) return <Alert type="error" showIcon message="Не удалось загрузить объект" />;

  const o = overviewQ.data;
  const works = worksQ.data ?? [];
  const objectInspections = (inspectionsAllQ.data ?? []).filter((i) => i.objectId === id);
  const ptoPackages = ptoQ.data ?? [];

  const totalPlanned = works.reduce((s, w) => s + Number(w.plannedQuantity), 0);
  const totalActual = works.reduce((s, w) => s + Number(w.actualQuantity), 0);
  const physicalProgressPercent = totalPlanned > 0 ? Math.min(100, (totalActual / totalPlanned) * 100) : 0;

  const ganttTasks: GanttTask[] = works.map((w) => ({
    id: w.id,
    name: w.name,
    plannedStart: w.plannedStartDate,
    plannedFinish: w.plannedFinishDate,
    progressPercent: Number(w.progressPercent),
    plannedProgressPercent: Math.max(0, Math.min(100, Number(w.progressPercent) - Number(w.varianceP))),
    scheduleStatus: w.scheduleStatus,
  }));

  const allDocuments = ptoPackages.flatMap((p) => p.documents.map((d) => ({ ...d.document, packageLabel: p.id.slice(0, 8) })));

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ justifyContent: "space-between", width: "100%" }} align="start">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {o.name}
          </Typography.Title>
          <Typography.Text type="secondary">{o.address}</Typography.Text>
        </div>
        <Space>
          {hasPermission(identity.role, Permission.OBJECT_EDIT) && <Button onClick={() => setEditModalOpen(true)}>Редактировать</Button>}
          <HealthBadge status={o.healthStatus} />
        </Space>
      </Space>

      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: "overview",
            label: "Обзор",
            children: (
              <Row gutter={16}>
                <Col span={16}>
                  <Card>
                    <Descriptions column={2} size="small">
                      <Descriptions.Item label="Статус">
                        <Tag>{o.status}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="РП">{o.projectManager?.name ?? "—"}</Descriptions.Item>
                      <Descriptions.Item label="Плановый старт">{o.startDate?.slice(0, 10) ?? "—"}</Descriptions.Item>
                      <Descriptions.Item label="Плановое завершение">{o.plannedFinishDate?.slice(0, 10) ?? "—"}</Descriptions.Item>
                      <Descriptions.Item label="Сумма договора">{formatMoney(o.contractValue)}</Descriptions.Item>
                      <Descriptions.Item label="Физ. готовность (по работам)">
                        <Progress percent={Math.round(physicalProgressPercent)} style={{ width: 160 }} />
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card
                    title="Субподрядчики"
                    extra={
                      hasPermission(identity.role, Permission.OBJECT_EDIT) && (
                        <Button size="small" onClick={() => setAssignContractorOpen(true)}>
                          Назначить
                        </Button>
                      )
                    }
                  >
                    {o.contractors.length === 0 ? (
                      <Empty description="Не назначены" />
                    ) : (
                      o.contractors.map((c) => (
                        <div key={c.id} style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>
                            <Link to={`/contractors/${c.contractor.id}`}>{c.contractor.name}</Link> {c.role && <Tag>{c.role}</Tag>}
                          </span>
                          {hasPermission(identity.role, Permission.OBJECT_EDIT) && (
                            <Popconfirm
                              title="Снять субподрядчика с объекта?"
                              onConfirm={() => removeContractor.mutate(c.contractor.id)}
                              okText="Снять"
                              cancelText="Отмена"
                            >
                              <Button size="small" type="text" danger loading={removeContractor.isPending}>
                                Снять
                              </Button>
                            </Popconfirm>
                          )}
                        </div>
                      ))
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: "production",
            label: "Производство",
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                {hasPermission(identity.role, Permission.WORK_CREATE) && (
                  <Button type="primary" onClick={() => setAddWorkModalOpen(true)}>
                    Добавить работу
                  </Button>
                )}
                <Table<WorkRow>
                size="small"
                rowKey="id"
                loading={worksQ.isLoading}
                dataSource={works}
                pagination={{ pageSize: 15 }}
                columns={[
                  { title: "Работа", dataIndex: "name" },
                  { title: "Ед.", dataIndex: "unit", width: 70 },
                  { title: "План", dataIndex: "plannedQuantity", width: 90, align: "right" as const },
                  { title: "Факт", dataIndex: "actualQuantity", width: 90, align: "right" as const },
                  {
                    title: "% выполнения",
                    dataIndex: "progressPercent",
                    width: 160,
                    render: (v: number) => <Progress percent={Math.round(v)} size="small" />,
                  },
                  { title: "График", dataIndex: "scheduleStatus", width: 170, render: (v: string) => <ScheduleBadge status={v} /> },
                  {
                    title: "Отклонение / отставание",
                    key: "variance",
                    width: 170,
                    render: (_: any, r: WorkRow) => (Number(r.delayDays) > 0 ? `${Number(r.varianceP).toFixed(0)} п.п., ${r.delayDays} дн.` : "—"),
                  },
                  { title: "Ответственный", dataIndex: "responsibleUser", width: 150, render: (v?: { name: string } | null) => v?.name ?? "—" },
                  {
                    title: "Действия",
                    key: "actions",
                    width: 220,
                    render: (_: any, r: WorkRow) => (
                      <Space>
                        <Button size="small" onClick={() => setProgressModalWork(r)}>
                          Внести факт
                        </Button>
                        <Button size="small" loading={requestInspection.isPending} disabled={r.status !== "IN_PROGRESS" && r.status !== "DONE"} onClick={() => requestInspection.mutate(r.id)}>
                          На приёмку СК
                        </Button>
                      </Space>
                    ),
                  },
                ]}
                />
              </Space>
            ),
          },
          {
            key: "schedule",
            label: "График",
            children: (
              <Card>
                <Gantt tasks={ganttTasks} />
              </Card>
            ),
          },
          {
            key: "control",
            label: "Строительный контроль",
            children: <ControlTab inspections={objectInspections} isLoading={inspectionsAllQ.isLoading} role={identity.role} />,
          },
          {
            key: "pto",
            label: "ПТО",
            children: <PtoTab objectId={id!} works={works} role={identity.role} />,
          },
          {
            key: "materials",
            label: "Материалы",
            children: <MaterialsTab objectId={id!} works={works} role={identity.role} />,
          },
          {
            key: "sdo",
            label: "СДО",
            children: <SdoTab objectId={id!} role={identity.role} />,
          },
          {
            key: "finance",
            label: "Финансы",
            children: financeQ.isLoading ? (
              <Spin />
            ) : financeQ.data ? (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <Row gutter={16}>
                  <Col span={6}>
                    <Card>
                      <Statistic title="Сумма договора" value={formatMoney(financeQ.data.contractValue)} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card>
                      <Statistic title="Закрыто" value={formatMoney(financeQ.data.closedTotal)} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card>
                      <Statistic title="Остаток по договору" value={formatMoney(financeQ.data.remaining)} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card style={{ background: "#fffbe6" }}>
                      <Statistic title="Потенциал к закрытию" value={formatMoney(financeQ.data.potentialClosing)} valueStyle={{ color: "#d48806" }} />
                    </Card>
                  </Col>
                </Row>
                <Card title="Воронка потенциального закрытия (где застряли деньги)">
                  <Table
                    size="small"
                    rowKey="stage"
                    pagination={false}
                    dataSource={financeQ.data.stages}
                    columns={[
                      { title: "Этап", dataIndex: "label" },
                      { title: "Сумма", dataIndex: "amount", width: 160, align: "right" as const, render: formatMoney },
                    ]}
                  />
                </Card>
                {financeQ.data.byWork.length > 0 && (
                  <Card title="По работам">
                    <Table
                      size="small"
                      rowKey="workId"
                      pagination={{ pageSize: 10 }}
                      dataSource={financeQ.data.byWork}
                      columns={[
                        { title: "Работа", dataIndex: "workName" },
                        { title: "Потенциал", dataIndex: "potential", width: 160, align: "right" as const, render: formatMoney },
                      ]}
                    />
                  </Card>
                )}
              </Space>
            ) : (
              <Empty />
            ),
          },
          {
            key: "photos",
            label: "Фото",
            children: <PhotosTab inspections={objectInspections} role={identity.role} />,
          },
          {
            key: "documents",
            label: "Документы",
            children: (
              <Table
                size="small"
                rowKey="id"
                dataSource={allDocuments}
                pagination={{ pageSize: 15 }}
                locale={{ emptyText: "Документы появятся после формирования пакетов ИД (вкладка ПТО)" }}
                columns={[
                  { title: "Тип документа", dataIndex: "type" },
                  { title: "№", dataIndex: "number", width: 120, render: (v?: string | null) => v ?? "—" },
                  { title: "Пакет", dataIndex: "packageLabel", width: 140 },
                  { title: "Статус", dataIndex: "status", width: 140, render: (v: string) => <Tag>{v}</Tag> },
                ]}
              />
            ),
          },
          {
            key: "history",
            label: "История",
            children: auditQ.isLoading ? (
              <Spin />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Показаны записи уровня объекта. Изменения по конкретным работам, проверкам и документам логируются отдельно
                  (та же таблица AuditLog, entityType/entityId соответствующей сущности) — см. docs/business-rules.md §«Аудит».
                </Typography.Text>
                {(auditQ.data ?? []).length === 0 ? (
                  <Empty description="Нет записей" />
                ) : (
                  <Timeline
                    items={(auditQ.data ?? []).map((a) => ({
                      children: (
                        <>
                          {a.action}
                          <br />
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(a.createdAt).toLocaleString("ru-RU")} · {a.user?.name ?? "система"}
                          </Typography.Text>
                        </>
                      ),
                    }))}
                  />
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={progressModalWork ? `Внести факт: ${progressModalWork.name}` : ""}
        open={!!progressModalWork}
        onCancel={() => setProgressModalWork(null)}
        onOk={() => form.validateFields().then((v) => reportProgress.mutate({ workId: progressModalWork!.id, actualQuantity: v.actualQuantity }))}
        confirmLoading={reportProgress.isPending}
      >
        {progressModalWork && (
          <Form form={form} layout="vertical" initialValues={{ actualQuantity: Number(progressModalWork.actualQuantity) }}>
            <Form.Item label={`Фактический объём, накопительно (план ${progressModalWork.plannedQuantity} ${progressModalWork.unit})`} name="actualQuantity" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: "100%" }} addonAfter={progressModalWork.unit} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="Назначить субподрядчика на объект"
        open={assignContractorOpen}
        onCancel={() => setAssignContractorOpen(false)}
        onOk={() => assignForm.validateFields().then((v) => assignContractor.mutate({ contractorId: v.contractorId, role: v.role || undefined }))}
        confirmLoading={assignContractor.isPending}
        destroyOnClose
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item label="Субподрядчик" name="contractorId" rules={[{ required: true, message: "Выберите субподрядчика" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={contractorsQ.isLoading}
              placeholder="Выбрать из справочника"
              options={(contractorsQ.data ?? [])
                .filter((c) => !o.contractors.some((oc) => oc.contractor.id === c.id))
                .map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item label="Роль / тип участия" name="role" tooltip="Например: генподрядчик, субподрядчик, поставщик">
            <Input placeholder="субподрядчик" />
          </Form.Item>
        </Form>
      </Modal>

      <ObjectFormModal open={editModalOpen} onClose={() => setEditModalOpen(false)} initial={{ id: o.id, name: o.name, address: o.address, status: o.status, version: o.version, projectManager: o.projectManager, plannedFinishDate: o.plannedFinishDate }} />
      <CreateWorkModal
        open={addWorkModalOpen}
        onClose={() => setAddWorkModalOpen(false)}
        objectId={id!}
        contractorOptions={o.contractors.map((c) => ({ value: c.contractor.id, label: c.contractor.name }))}
      />
    </Space>
  );
}
