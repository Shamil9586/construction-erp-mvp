import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Tag, Space, Button, Modal, Form, Select, Input, Typography, message, Empty, List } from "antd";
import { hasPermission, Permission, Role } from "@construction-erp/domain";
import { useAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";

/**
 * Вкладка «ПТО» карточки объекта (ТЗ §26-27, §42: "PTO work with executive
 * documents; form executive-document package; transfer package to SDO").
 * Раньше — таблица пакетов только на чтение. Теперь: формирование
 * документов (АОСР/схема/...), их подтверждение, сборка пакета из
 * подтверждённых документов и передача в СДО с реальной проверкой
 * PtoPackageValidationService (backend вернёт 400 с конкретными причинами,
 * если пакет ещё нельзя передавать — например, не привязаны материалы с
 * сертификатами, см. вкладку «Материалы»).
 */
interface WorkOption {
  id: string;
  name: string;
}
interface DocumentRow {
  id: string;
  type: string;
  number?: string | null;
  status: string;
  objectWork: { name: string; unit: string };
}
interface PackageRow {
  id: string;
  status: string;
  createdAt: string;
  documents: { document: DocumentRow }[];
}

const DOC_TYPE_OPTIONS = [
  { value: "AOSR", label: "АОСР" },
  { value: "EXECUTIVE_SCHEME", label: "Исполнительная схема" },
  { value: "CERTIFICATE", label: "Сертификат" },
  { value: "PASSPORT", label: "Паспорт" },
  { value: "LAB_REPORT", label: "Лабораторное заключение" },
  { value: "OTHER", label: "Другое" },
];

export function PtoTab({ objectId, works, role }: { objectId: string; works: WorkOption[]; role: Role }) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [docModal, setDocModal] = React.useState(false);
  const [packageModal, setPackageModal] = React.useState(false);
  const [docForm] = Form.useForm();
  const [packageForm] = Form.useForm();

  const canEdit = hasPermission(role, Permission.PTO_EDIT);
  const canTransfer = hasPermission(role, Permission.PTO_TRANSFER_SDO);

  const docsQ = useQuery({
    queryKey: ["object-pto-documents", tenantId, objectId],
    queryFn: () => api.get<DocumentRow[]>(`/objects/${objectId}/executive-documents`, headers),
    enabled: !!tenantId,
  });
  const packagesQ = useQuery({
    queryKey: ["object-pto", tenantId, objectId],
    queryFn: () => api.get<PackageRow[]>(`/objects/${objectId}/executive-packages`, headers),
    enabled: !!tenantId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["object-pto-documents", tenantId, objectId] });
    qc.invalidateQueries({ queryKey: ["object-pto", tenantId, objectId] });
    qc.invalidateQueries({ queryKey: ["object-works"] });
  }

  const createDocMut = useMutation({
    mutationFn: (values: any) => api.post(`/objects/${objectId}/executive-documents`, headers, { objectWorkId: values.objectWorkId, type: values.type, number: values.number || undefined }),
    onSuccess: () => {
      message.success("Документ сформирован (DRAFT)");
      invalidate();
      setDocModal(false);
      docForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось сформировать документ"),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/executive-documents/${id}/approve`, headers, {}),
    onSuccess: () => {
      message.success("Документ подтверждён");
      invalidate();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось подтвердить документ"),
  });

  const createPackageMut = useMutation({
    mutationFn: (values: any) => api.post(`/objects/${objectId}/executive-packages`, headers, { documentIds: values.documentIds }),
    onSuccess: () => {
      message.success("Пакет ИД сформирован");
      invalidate();
      setPackageModal(false);
      packageForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось сформировать пакет"),
  });

  const transferMut = useMutation({
    mutationFn: (id: string) => api.post(`/executive-packages/${id}/transfer-sdo`, headers, undefined),
    onSuccess: () => {
      message.success("Пакет передан в СДО");
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiError && Array.isArray((err.body as any)?.reasons)) {
        Modal.error({
          title: "Пакет нельзя передать в СДО",
          content: (
            <List size="small" dataSource={(err.body as any).reasons as string[]} renderItem={(r) => <List.Item>{r}</List.Item>} />
          ),
        });
      } else {
        message.error(err instanceof ApiError ? err.message : "Не удалось передать пакет в СДО");
      }
    },
  });

  const workOptions = works.map((w) => ({ value: w.id, label: w.name }));
  const documentOptions = (docsQ.data ?? []).map((d) => ({
    value: d.id,
    label: `${DOC_TYPE_OPTIONS.find((o) => o.value === d.type)?.label ?? d.type} — ${d.objectWork.name} (${d.status})`,
  }));

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={5}>Исполнительная документация</Typography.Title>
        {canEdit && (
          <Button type="primary" style={{ marginBottom: 12 }} onClick={() => setDocModal(true)}>
            Сформировать документ
          </Button>
        )}
        <Table<DocumentRow>
          size="small"
          rowKey="id"
          loading={docsQ.isLoading}
          dataSource={docsQ.data ?? []}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="Документы ещё не формировались" /> }}
          columns={[
            { title: "Тип", dataIndex: "type", render: (v: string) => DOC_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v },
            { title: "Работа", dataIndex: "objectWork", render: (v: { name: string }) => v?.name },
            { title: "№", dataIndex: "number", width: 120, render: (v?: string | null) => v ?? "—" },
            { title: "Статус", dataIndex: "status", width: 140, render: (v: string) => <Tag color={v === "APPROVED" ? "success" : "default"}>{v}</Tag> },
            {
              title: "",
              key: "actions",
              width: 140,
              render: (_: any, r: DocumentRow) =>
                canEdit && r.status === "DRAFT" ? (
                  <Button size="small" loading={approveMut.isPending} onClick={() => approveMut.mutate(r.id)}>
                    Подтвердить
                  </Button>
                ) : null,
            },
          ]}
        />
      </div>

      <div>
        <Typography.Title level={5}>Пакеты исполнительной документации</Typography.Title>
        {canEdit && (
          <Button style={{ marginBottom: 12 }} onClick={() => setPackageModal(true)}>
            Сформировать пакет
          </Button>
        )}
        <Table<PackageRow>
          size="small"
          rowKey="id"
          loading={packagesQ.isLoading}
          dataSource={packagesQ.data ?? []}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="Пакеты ещё не формировались" /> }}
          columns={[
            { title: "Пакет", dataIndex: "id", render: (v: string) => `Пакет ${v.slice(0, 8)}` },
            { title: "Статус", dataIndex: "status", width: 200, render: (v: string) => <Tag>{v}</Tag> },
            { title: "Документов", dataIndex: "documents", width: 110, align: "right" as const, render: (v: any[]) => v.length },
            { title: "Сформирован", dataIndex: "createdAt", width: 140, render: (v: string) => v?.slice(0, 10) },
            {
              title: "",
              key: "actions",
              width: 160,
              render: (_: any, r: PackageRow) =>
                canTransfer && r.status === "DRAFT" ? (
                  <Button size="small" type="primary" loading={transferMut.isPending} onClick={() => transferMut.mutate(r.id)}>
                    Передать в СДО
                  </Button>
                ) : null,
            },
          ]}
        />
      </div>

      <Modal
        title="Сформировать документ"
        open={docModal}
        onCancel={() => setDocModal(false)}
        confirmLoading={createDocMut.isPending}
        onOk={() => docForm.validateFields().then((v) => createDocMut.mutate(v))}
        destroyOnClose
      >
        <Form form={docForm} layout="vertical">
          <Form.Item label="Работа" name="objectWorkId" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={workOptions} />
          </Form.Item>
          <Form.Item label="Тип документа" name="type" rules={[{ required: true }]}>
            <Select options={DOC_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item label="Номер" name="number">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Сформировать пакет ИД"
        open={packageModal}
        onCancel={() => setPackageModal(false)}
        confirmLoading={createPackageMut.isPending}
        onOk={() => packageForm.validateFields().then((v) => createPackageMut.mutate(v))}
        destroyOnClose
      >
        <Form form={packageForm} layout="vertical">
          <Form.Item label="Документы" name="documentIds" rules={[{ required: true, message: "Выберите хотя бы один документ" }]}>
            <Select mode="multiple" options={documentOptions} placeholder="Выбрать документы для пакета" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
