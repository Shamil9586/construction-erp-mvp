import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Tag, Space, Button, Modal, Form, InputNumber, Input, Typography, message, Empty } from "antd";
import { hasPermission, Permission, Role } from "@construction-erp/domain";
import { useAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";

/**
 * Вкладка «СДО» карточки объекта (ТЗ §29-31, §42: "enter SDO amount after
 * Гранд-Смета calculation; financial closing"). Раньше — статичный
 * Alert-заглушка, хотя SdoController уже полностью реализован на backend.
 * Теперь: список дел СДО (переданных ПТО пакетов), форма ввести результат
 * осмечивания (выполненного во внешней Гранд-Смете — система её НЕ
 * заменяет, см. docs/business-rules.md), форма финансового закрытия.
 */
interface SdoCaseRow {
  id: string;
  status: string;
  calculatedValue?: number | string | null;
  acceptedClosingValue?: number | string | null;
  objectWork: { name: string; unit: string };
  financialClosings: { id: string; period: string; amount: number | string }[];
}

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  NOT_TRANSFERRED: { color: "default", label: "Не передано" },
  READY_FOR_TRANSFER: { color: "processing", label: "Готово к передаче" },
  TRANSFERRED: { color: "blue", label: "Передано в СДО" },
  IN_PROGRESS: { color: "processing", label: "В работе" },
  NEEDS_CLARIFICATION: { color: "warning", label: "Нужны уточнения" },
  CALCULATED: { color: "gold", label: "Осметено" },
  READY_TO_CLOSE: { color: "cyan", label: "Готово к закрытию" },
  CLOSED: { color: "success", label: "Закрыто" },
};

function formatMoney(v?: number | string | null) {
  if (!v) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(v)) + " ₽";
}

export function SdoTab({ objectId, role }: { objectId: string; role: Role }) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [calcModalFor, setCalcModalFor] = React.useState<SdoCaseRow | null>(null);
  const [closeModalFor, setCloseModalFor] = React.useState<SdoCaseRow | null>(null);
  const [calcForm] = Form.useForm();
  const [closeForm] = Form.useForm();

  const canEdit = hasPermission(role, Permission.SDO_EDIT);
  const canClose = hasPermission(role, Permission.SDO_CLOSE);

  const casesQ = useQuery({
    queryKey: ["object-sdo", tenantId, objectId],
    queryFn: () => api.get<SdoCaseRow[]>(`/sdo/objects/${objectId}`, headers),
    enabled: !!tenantId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["object-sdo", tenantId, objectId] });
    qc.invalidateQueries({ queryKey: ["object-finance", tenantId, objectId] });
  }

  const calcMut = useMutation({
    mutationFn: (values: any) => api.post(`/sdo/${calcModalFor!.id}/calculate`, headers, { calculatedValue: values.calculatedValue, comment: values.comment || undefined }),
    onSuccess: () => {
      message.success("Результат осмечивания внесён");
      invalidate();
      setCalcModalFor(null);
      calcForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось внести результат осмечивания"),
  });

  const closeMut = useMutation({
    mutationFn: (values: any) => api.post(`/sdo/${closeModalFor!.id}/close`, headers, { period: values.period, amount: values.amount }),
    onSuccess: () => {
      message.success("Финансовое закрытие сформировано");
      invalidate();
      setCloseModalFor(null);
      closeForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось сформировать финансовое закрытие"),
  });

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">
        Осмечивание выполняется вне системы (Гранд-Смета) — здесь только фиксируется результат и финансовое закрытие (ТЗ: система не заменяет сметный
        комплекс и не формирует КС-2).
      </Typography.Text>
      <Table<SdoCaseRow>
        size="small"
        rowKey="id"
        loading={casesQ.isLoading}
        dataSource={casesQ.data ?? []}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="Дела СДО появятся после передачи пакета ИД (вкладка ПТО)" /> }}
        columns={[
          { title: "Работа", dataIndex: "objectWork", render: (v: { name: string }) => v?.name },
          {
            title: "Статус",
            dataIndex: "status",
            width: 180,
            render: (v: string) => {
              const info = STATUS_LABEL[v] ?? { color: "default", label: v };
              return <Tag color={info.color}>{info.label}</Tag>;
            },
          },
          { title: "Осметено", dataIndex: "calculatedValue", width: 140, align: "right" as const, render: formatMoney },
          { title: "Закрыто", dataIndex: "acceptedClosingValue", width: 140, align: "right" as const, render: formatMoney },
          {
            title: "Действия",
            key: "actions",
            width: 220,
            render: (_: any, r: SdoCaseRow) => (
              <Space>
                {canEdit && r.status === "TRANSFERRED" && (
                  <Button size="small" onClick={() => setCalcModalFor(r)}>
                    Осметить
                  </Button>
                )}
                {canClose && r.status === "CALCULATED" && (
                  <Button size="small" type="primary" onClick={() => setCloseModalFor(r)}>
                    Закрыть
                  </Button>
                )}
                {r.status === "CLOSED" && <Typography.Text type="success">Закрыто</Typography.Text>}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={`Внести результат осмечивания — ${calcModalFor?.objectWork.name ?? ""}`}
        open={!!calcModalFor}
        onCancel={() => setCalcModalFor(null)}
        confirmLoading={calcMut.isPending}
        onOk={() => calcForm.validateFields().then((v) => calcMut.mutate(v))}
        destroyOnClose
      >
        <Form form={calcForm} layout="vertical">
          <Form.Item label="Сумма по результатам осмечивания в Гранд-Смете, ₽" name="calculatedValue" rules={[{ required: true, message: "Укажите сумму" }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item label="Комментарий" name="comment">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Финансовое закрытие — ${closeModalFor?.objectWork.name ?? ""}`}
        open={!!closeModalFor}
        onCancel={() => setCloseModalFor(null)}
        confirmLoading={closeMut.isPending}
        onOk={() => closeForm.validateFields().then((v) => closeMut.mutate(v))}
        destroyOnClose
      >
        <Form form={closeForm} layout="vertical" initialValues={{ amount: closeModalFor ? Number(closeModalFor.calculatedValue) : undefined }}>
          <Form.Item label="Период (ГГГГ-ММ)" name="period" rules={[{ required: true, message: "Укажите период, например 2026-09" }]}>
            <Input placeholder="2026-09" />
          </Form.Item>
          <Form.Item label="Сумма закрытия, ₽" name="amount" rules={[{ required: true, message: "Укажите сумму" }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
