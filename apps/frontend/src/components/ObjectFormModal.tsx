import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal, Form, Input, InputNumber, DatePicker, Select, message } from "antd";
import dayjs from "dayjs";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";

/**
 * Форма создания/редактирования объекта (ТЗ §42 — "create/edit object").
 * Создание: POST /objects (ObjectsController.create, CreateObjectDto).
 * Редактирование: PATCH /objects/:id (UpdateObjectDto) — обязательно
 * передаёт `version` для optimistic concurrency (ТЗ п.48): если объект
 * изменили параллельно, backend вернёт 409 Conflict, который мы показываем
 * пользователю как есть (не затираем чужие изменения молча).
 */
interface UserOption {
  id: string;
  name: string;
  role: string;
}

export interface ObjectFormInitial {
  id: string;
  name: string;
  address: string;
  status: string;
  version: number;
  projectManager?: { id: string; name: string } | null;
  plannedFinishDate?: string | null;
}

const STATUS_OPTIONS = [
  { value: "PLANNED", label: "Планируется" },
  { value: "ACTIVE", label: "В работе" },
  { value: "AT_RISK", label: "Под риском" },
  { value: "DELAYED", label: "Отставание" },
  { value: "SUSPENDED", label: "Приостановлен" },
  { value: "COMPLETED", label: "Завершён" },
  { value: "ARCHIVED", label: "В архиве" },
];

export function ObjectFormModal({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /** Отсутствует -> форма создания. Задан -> форма редактирования (ТЗ п.48: version обязателен). */
  initial?: ObjectFormInitial | null;
}) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const isEdit = !!initial;

  // Список пользователей нужен только для выбора РП — GET /users теперь
  // доступен всем ролям с OBJECT_VIEW (см. users.module.ts, хардненинг-фикс
  // этой итерации: раньше требовал ADMIN_USERS и ни РП, ни ГД не мог сам
  // выбрать себя как РП при создании объекта).
  const usersQ = useQuery({
    queryKey: ["users", tenantId],
    queryFn: () => api.get<UserOption[]>("/users", headers),
    enabled: open && !!tenantId,
  });
  const pmOptions = (usersQ.data ?? [])
    .filter((u) => u.role === "PROJECT_MANAGER" || u.role === "ADMIN")
    .map((u) => ({ value: u.id, label: u.name }));

  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue({
        name: initial.name,
        address: initial.address,
        status: initial.status,
        projectManagerId: initial.projectManager?.id,
        plannedFinishDate: initial.plannedFinishDate ? dayjs(initial.plannedFinishDate) : undefined,
      });
    } else {
      form.resetFields();
    }
  }, [open, initial, form]);

  const createMut = useMutation({
    mutationFn: (values: any) =>
      api.post("/objects", headers, {
        name: values.name,
        address: values.address,
        customerName: values.customerName || undefined,
        organizationName: values.organizationName || undefined,
        projectManagerId: values.projectManagerId || undefined,
        plannedFinishDate: values.plannedFinishDate ? values.plannedFinishDate.format("YYYY-MM-DD") : undefined,
        contractValue: values.contractValue || undefined,
      }),
    onSuccess: () => {
      message.success("Объект создан");
      qc.invalidateQueries({ queryKey: ["objects", tenantId] });
      onClose();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось создать объект"),
  });

  const updateMut = useMutation({
    mutationFn: (values: any) =>
      api.patch(`/objects/${initial!.id}`, headers, {
        name: values.name,
        address: values.address,
        status: values.status,
        projectManagerId: values.projectManagerId || undefined,
        plannedFinishDate: values.plannedFinishDate ? values.plannedFinishDate.format("YYYY-MM-DD") : undefined,
        version: initial!.version,
      }),
    onSuccess: () => {
      message.success("Объект обновлён");
      qc.invalidateQueries({ queryKey: ["objects", tenantId] });
      qc.invalidateQueries({ queryKey: ["object", tenantId, initial!.id] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        message.error("Объект изменён другим пользователем — обновите страницу и повторите (ТЗ п.48, optimistic concurrency)");
      } else {
        message.error(err instanceof ApiError ? err.message : "Не удалось сохранить изменения");
      }
    },
  });

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <Modal
      title={isEdit ? "Редактировать объект" : "Новый объект строительства"}
      open={open}
      onCancel={onClose}
      confirmLoading={pending}
      onOk={() => form.validateFields().then((values) => (isEdit ? updateMut.mutate(values) : createMut.mutate(values)))}
      okText={isEdit ? "Сохранить" : "Создать"}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item label="Название объекта" name="name" rules={[{ required: true, message: "Укажите название" }]}>
          <Input placeholder='ЖК «Северный парк», корпус 2' />
        </Form.Item>
        <Form.Item label="Адрес" name="address" rules={[{ required: true, message: "Укажите адрес" }]}>
          <Input placeholder="г. Москва, ул. ..." />
        </Form.Item>
        {!isEdit && (
          <>
            <Form.Item label="Заказчик" name="customerName">
              <Input />
            </Form.Item>
            <Form.Item label="Организация (юрлицо)" name="organizationName">
              <Input />
            </Form.Item>
          </>
        )}
        <Form.Item label="Руководитель проекта" name="projectManagerId">
          <Select allowClear showSearch optionFilterProp="label" placeholder="Выбрать РП" options={pmOptions} loading={usersQ.isLoading} />
        </Form.Item>
        <Form.Item label="Плановое завершение" name="plannedFinishDate">
          <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
        </Form.Item>
        {!isEdit && (
          <Form.Item label="Сумма договора, ₽" name="contractValue">
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        )}
        {isEdit && (
          <Form.Item label="Статус" name="status" rules={[{ required: true }]}>
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
