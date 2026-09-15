import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal, Form, Input, InputNumber, DatePicker, Select, message } from "antd";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";

/**
 * Добавление работы на объект (ТЗ §42: "create works and enter planned
 * volumes") — POST /objects/:id/works (WorksController.create, CreateWorkDto).
 * Справочник видов работ — GET /dictionaries (DictionariesService.getAll);
 * субподрядчики объекта — из ObjectOverview.contractors, переданы пропом,
 * чтобы не заводить лишний запрос ради уже загруженных данных.
 */
interface WorkTypeOption {
  id: string;
  name: string;
  unit: string;
  categoryId: string;
}

export function CreateWorkModal({
  open,
  onClose,
  objectId,
  contractorOptions,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  contractorOptions: { value: string; label: string }[];
}) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const dictQ = useQuery({
    queryKey: ["dictionaries", tenantId],
    queryFn: () => api.get<{ workTypes: WorkTypeOption[] }>("/dictionaries", headers),
    enabled: open && !!tenantId,
  });

  React.useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const createMut = useMutation({
    mutationFn: (values: any) => {
      const wt = (dictQ.data?.workTypes ?? []).find((w) => w.id === values.workTypeId);
      return api.post(`/objects/${objectId}/works`, headers, {
        workTypeId: values.workTypeId,
        contractorId: values.contractorId || undefined,
        name: values.name,
        unit: wt?.unit ?? "шт",
        plannedQuantity: values.plannedQuantity,
        plannedStartDate: values.dates[0].format("YYYY-MM-DD"),
        plannedFinishDate: values.dates[1].format("YYYY-MM-DD"),
        estimatedCost: values.estimatedCost || undefined,
      });
    },
    onSuccess: () => {
      message.success("Работа добавлена");
      qc.invalidateQueries({ queryKey: ["object-works", tenantId, objectId] });
      qc.invalidateQueries({ queryKey: ["object", tenantId, objectId] });
      onClose();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось добавить работу"),
  });

  const workTypeOptions = (dictQ.data?.workTypes ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.unit})` }));

  return (
    <Modal
      title="Добавить работу"
      open={open}
      onCancel={onClose}
      confirmLoading={createMut.isPending}
      onOk={() => form.validateFields().then((values) => createMut.mutate(values))}
      okText="Добавить"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item label="Вид работ (справочник)" name="workTypeId" rules={[{ required: true, message: "Выберите вид работ" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={dictQ.isLoading}
            options={workTypeOptions}
            placeholder="Например, «Армирование фундамента»"
            onChange={(_, opt: any) => {
              const label = Array.isArray(opt) ? opt[0]?.label : opt?.label;
              if (label && !form.getFieldValue("name")) form.setFieldValue("name", String(label).replace(/\s*\([^)]*\)$/, ""));
            }}
          />
        </Form.Item>
        <Form.Item label="Название работы (участок/секция)" name="name" rules={[{ required: true, message: "Укажите название" }]}>
          <Input placeholder="Армирование фундамента Ф-1" />
        </Form.Item>
        <Form.Item label="Субподрядчик" name="contractorId">
          <Select allowClear showSearch optionFilterProp="label" options={contractorOptions} placeholder="Выбрать субподрядчика объекта" />
        </Form.Item>
        <Form.Item label="Плановый объём" name="plannedQuantity" rules={[{ required: true, message: "Укажите плановый объём" }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label="Плановые сроки" name="dates" rules={[{ required: true, message: "Укажите сроки" }]}>
          <DatePicker.RangePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item label="Плановая стоимость, ₽" name="estimatedCost">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
