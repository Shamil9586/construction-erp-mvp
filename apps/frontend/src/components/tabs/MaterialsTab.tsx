import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Tag, Space, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Typography, message, Empty } from "antd";
import { hasPermission, Permission, Role } from "@construction-erp/domain";
import { useAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";

/**
 * Вкладка «Материалы» карточки объекта (ТЗ §28, §42: "work with materials
 * and documents"). Раньше — статичный Alert-заглушка, хотя
 * MaterialsController уже полностью реализован на backend. Теперь: список
 * партий с сертификатами/паспортами, форма завести партию, прикрепить
 * документ, привязать партию к конкретной работе объекта (это и проверяет
 * PtoPackageValidationService при передаче пакета ИД в СДО — см. вкладку ПТО).
 */
interface MaterialBatchRow {
  id: string;
  batchNumber: string;
  supplier?: string | null;
  deliveryDate?: string | null;
  material: { name: string; manufacturer?: string | null };
  documents: { id: string; type: string; number?: string | null }[];
  workLinks: { id: string; quantity: number | string; objectWork: { name: string } }[];
}
interface WorkOption {
  id: string;
  name: string;
}

const DOC_TYPE_OPTIONS = [
  { value: "CERTIFICATE", label: "Сертификат соответствия" },
  { value: "PASSPORT", label: "Паспорт качества" },
  { value: "DECLARATION", label: "Декларация соответствия" },
  { value: "QUALITY_DOCUMENT", label: "Документ о качестве" },
  { value: "OTHER", label: "Другое" },
];

export function MaterialsTab({ objectId, works, role }: { objectId: string; works: WorkOption[]; role: Role }) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [batchModal, setBatchModal] = React.useState(false);
  const [docModalFor, setDocModalFor] = React.useState<MaterialBatchRow | null>(null);
  const [linkModalFor, setLinkModalFor] = React.useState<MaterialBatchRow | null>(null);
  const [batchForm] = Form.useForm();
  const [docForm] = Form.useForm();
  const [linkForm] = Form.useForm();

  const canEdit = hasPermission(role, Permission.PTO_EDIT);

  const batchesQ = useQuery({
    queryKey: ["object-materials", tenantId, objectId],
    queryFn: () => api.get<MaterialBatchRow[]>(`/materials/objects/${objectId}`, headers),
    enabled: !!tenantId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["object-materials", tenantId, objectId] });
  }

  const createBatchMut = useMutation({
    mutationFn: (values: any) =>
      api.post("/materials/batches", headers, {
        materialName: values.materialName,
        manufacturer: values.manufacturer || undefined,
        batchNumber: values.batchNumber,
        supplier: values.supplier || undefined,
        deliveryDate: values.deliveryDate ? values.deliveryDate.format("YYYY-MM-DD") : undefined,
        objectId,
      }),
    onSuccess: () => {
      message.success("Партия материала заведена");
      invalidate();
      setBatchModal(false);
      batchForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось завести партию"),
  });

  const addDocMut = useMutation({
    mutationFn: (values: any) => api.post(`/materials/batches/${docModalFor!.id}/documents`, headers, { type: values.type, number: values.number || undefined }),
    onSuccess: () => {
      message.success("Документ прикреплён");
      invalidate();
      setDocModalFor(null);
      docForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось прикрепить документ"),
  });

  const linkMut = useMutation({
    mutationFn: (values: any) => api.post("/materials/link", headers, { objectWorkId: values.objectWorkId, materialBatchId: linkModalFor!.id, quantity: values.quantity }),
    onSuccess: () => {
      message.success("Материал привязан к работе");
      invalidate();
      setLinkModalFor(null);
      linkForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось привязать материал"),
  });

  const workOptions = works.map((w) => ({ value: w.id, label: w.name }));

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {canEdit && (
        <Button type="primary" onClick={() => setBatchModal(true)}>
          Завести партию материала
        </Button>
      )}
      <Table<MaterialBatchRow>
        size="small"
        rowKey="id"
        loading={batchesQ.isLoading}
        dataSource={batchesQ.data ?? []}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="Материалы ещё не заведены" /> }}
        columns={[
          { title: "Материал", key: "material", render: (_: any, r) => r.material.name },
          { title: "Партия №", dataIndex: "batchNumber", width: 140 },
          { title: "Поставщик", dataIndex: "supplier", width: 180, render: (v?: string | null) => v ?? "—" },
          {
            title: "Документы",
            dataIndex: "documents",
            width: 220,
            render: (docs: MaterialBatchRow["documents"]) =>
              docs.length === 0 ? (
                <Typography.Text type="secondary">нет</Typography.Text>
              ) : (
                docs.map((d) => (
                  <Tag key={d.id} color="blue">
                    {DOC_TYPE_OPTIONS.find((o) => o.value === d.type)?.label ?? d.type}
                  </Tag>
                ))
              ),
          },
          {
            title: "Привязано к работам",
            dataIndex: "workLinks",
            render: (links: MaterialBatchRow["workLinks"]) =>
              links.length === 0 ? <Typography.Text type="secondary">не привязано</Typography.Text> : links.map((l) => `${l.objectWork.name} (${l.quantity})`).join(", "),
          },
          {
            title: "Действия",
            key: "actions",
            width: 220,
            render: (_: any, r: MaterialBatchRow) =>
              canEdit && (
                <Space>
                  <Button size="small" onClick={() => setDocModalFor(r)}>
                    + документ
                  </Button>
                  <Button size="small" onClick={() => setLinkModalFor(r)}>
                    Привязать к работе
                  </Button>
                </Space>
              ),
          },
        ]}
      />

      <Modal
        title="Новая партия материала"
        open={batchModal}
        onCancel={() => setBatchModal(false)}
        confirmLoading={createBatchMut.isPending}
        onOk={() => batchForm.validateFields().then((v) => createBatchMut.mutate(v))}
        destroyOnClose
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item label="Материал" name="materialName" rules={[{ required: true }]}>
            <Input placeholder="Арматура А500С 12мм" />
          </Form.Item>
          <Form.Item label="Производитель" name="manufacturer">
            <Input />
          </Form.Item>
          <Form.Item label="Номер партии" name="batchNumber" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Поставщик" name="supplier">
            <Input />
          </Form.Item>
          <Form.Item label="Дата поставки" name="deliveryDate">
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Документ к партии ${docModalFor?.batchNumber ?? ""}`}
        open={!!docModalFor}
        onCancel={() => setDocModalFor(null)}
        confirmLoading={addDocMut.isPending}
        onOk={() => docForm.validateFields().then((v) => addDocMut.mutate(v))}
        destroyOnClose
      >
        <Form form={docForm} layout="vertical">
          <Form.Item label="Тип документа" name="type" rules={[{ required: true }]}>
            <Select options={DOC_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item label="Номер" name="number">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Привязать партию ${linkModalFor?.batchNumber ?? ""} к работе`}
        open={!!linkModalFor}
        onCancel={() => setLinkModalFor(null)}
        confirmLoading={linkMut.isPending}
        onOk={() => linkForm.validateFields().then((v) => linkMut.mutate(v))}
        destroyOnClose
      >
        <Form form={linkForm} layout="vertical">
          <Form.Item label="Работа" name="objectWorkId" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={workOptions} />
          </Form.Item>
          <Form.Item label="Количество" name="quantity" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
