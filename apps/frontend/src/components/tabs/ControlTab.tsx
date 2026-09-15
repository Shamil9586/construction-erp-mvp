import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Tag, Space, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Spin, Typography, message } from "antd";
import { hasPermission, Permission, Role } from "@construction-erp/domain";
import { useAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";

/**
 * Вкладка «Строительный контроль» карточки объекта (ТЗ §42-43, 22-24, 47).
 * Раньше — таблица только на чтение. Теперь реально даёт СК выполнить свою
 * работу из UI: создать замечание, принять/отклонить работу; РП — устранить
 * замечание. Backend (InspectionsController) уже умел всё это — не хватало
 * только форм на фронте (ТЗ п.8: "не оставляй рабочие вкладки
 * информационными заглушками, если backend уже есть").
 */
interface InspectionRow {
  id: string;
  objectId: string;
  objectWorkId: string;
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

function IssuesPanel({ inspectionId, canResolve }: { inspectionId: string; canResolve: boolean }) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["inspection-detail", inspectionId],
    queryFn: () => api.get<{ issues: InspectionIssue[] }>(`/inspections/${inspectionId}`, headers),
  });
  const resolveMut = useMutation({
    mutationFn: (issueId: string) => api.post(`/inspections/issues/${issueId}/resolve`, headers, {}),
    onSuccess: () => {
      message.success("Замечание отмечено устранённым, направлено на повторную проверку");
      qc.invalidateQueries({ queryKey: ["inspection-detail", inspectionId] });
      qc.invalidateQueries({ queryKey: ["inspections-queue", tenantId] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось устранить замечание"),
  });

  if (isLoading) return <Spin size="small" />;
  const issues = data?.issues ?? [];
  if (issues.length === 0) return <Typography.Text type="secondary">Замечаний нет.</Typography.Text>;
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={issues}
      pagination={false}
      columns={[
        { title: "Замечание", dataIndex: "title" },
        { title: "Описание", dataIndex: "description" },
        { title: "Критичность", dataIndex: "severity", width: 120, render: (v: string) => <Tag color={v === "CRITICAL" ? "red" : "gold"}>{v}</Tag> },
        { title: "Статус", dataIndex: "status", width: 170, render: (v: string) => <Tag>{v}</Tag> },
        {
          title: "",
          key: "actions",
          width: 140,
          render: (_: any, issue: InspectionIssue) =>
            canResolve && (issue.status === "OPEN" || issue.status === "IN_PROGRESS") ? (
              <Button size="small" loading={resolveMut.isPending} onClick={() => resolveMut.mutate(issue.id)}>
                Устранено
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

export function ControlTab({ inspections, isLoading, role }: { inspections: InspectionRow[]; isLoading: boolean; role: Role }) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [issueModalFor, setIssueModalFor] = React.useState<InspectionRow | null>(null);
  const [acceptModalFor, setAcceptModalFor] = React.useState<InspectionRow | null>(null);
  const [rejectModalFor, setRejectModalFor] = React.useState<InspectionRow | null>(null);
  const [issueForm] = Form.useForm();
  const [acceptForm] = Form.useForm();
  const [rejectForm] = Form.useForm();

  const canCreateIssue = hasPermission(role, Permission.ISSUE_CREATE);
  const canAccept = hasPermission(role, Permission.INSPECTION_ACCEPT);
  const canReject = hasPermission(role, Permission.INSPECTION_REJECT);
  const canResolve = hasPermission(role, Permission.ISSUE_RESOLVE);

  function invalidateAfterAction() {
    qc.invalidateQueries({ queryKey: ["inspections-queue", tenantId] });
    qc.invalidateQueries({ queryKey: ["object-works"] });
    qc.invalidateQueries({ queryKey: ["object"] });
  }

  const createIssueMut = useMutation({
    mutationFn: (values: any) =>
      api.post(`/inspections/${issueModalFor!.id}/issues`, headers, {
        title: values.title,
        description: values.description,
        severity: values.severity,
        dueDate: values.dueDate ? values.dueDate.format("YYYY-MM-DD") : undefined,
      }),
    onSuccess: () => {
      message.success("Замечание создано");
      invalidateAfterAction();
      setIssueModalFor(null);
      issueForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось создать замечание"),
  });

  const acceptMut = useMutation({
    mutationFn: (values: any) => api.post(`/inspections/${acceptModalFor!.id}/accept`, headers, { acceptedQuantity: values.acceptedQuantity, comment: values.comment }),
    onSuccess: () => {
      message.success("Работа принята строительным контролем");
      invalidateAfterAction();
      setAcceptModalFor(null);
      acceptForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось принять работу — есть непогашенные критические замечания?"),
  });

  const rejectMut = useMutation({
    mutationFn: (values: any) => api.post(`/inspections/${rejectModalFor!.id}/reject`, headers, { comment: values.comment }),
    onSuccess: () => {
      message.success("Работа отклонена");
      invalidateAfterAction();
      setRejectModalFor(null);
      rejectForm.resetFields();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось отклонить работу"),
  });

  const actionable = ["WAITING", "IN_REVIEW", "ISSUES_FOUND", "REINSPECTION"];

  return (
    <>
      <Table<InspectionRow>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={inspections}
        pagination={{ pageSize: 10 }}
        expandable={{ expandedRowRender: (r) => <IssuesPanel inspectionId={r.id} canResolve={canResolve} /> }}
        columns={[
          { title: "Работа", dataIndex: "objectWork", render: (v: { name: string }) => v?.name },
          { title: "Статус", dataIndex: "status", width: 170, render: (v: string) => <Tag>{v}</Tag> },
          { title: "Запрошена", dataIndex: "requestedAt", width: 140, render: (v: string) => v?.slice(0, 10) },
          {
            title: "Действия",
            key: "actions",
            width: 320,
            render: (_: any, r: InspectionRow) =>
              actionable.includes(r.status) ? (
                <Space>
                  {canCreateIssue && (
                    <Button size="small" onClick={() => setIssueModalFor(r)}>
                      Замечание
                    </Button>
                  )}
                  {canAccept && (
                    <Button size="small" type="primary" onClick={() => setAcceptModalFor(r)}>
                      Принять
                    </Button>
                  )}
                  {canReject && (
                    <Button size="small" danger onClick={() => setRejectModalFor(r)}>
                      Отклонить
                    </Button>
                  )}
                </Space>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
        ]}
      />

      <Modal
        title={`Новое замечание — ${issueModalFor?.objectWork.name ?? ""}`}
        open={!!issueModalFor}
        onCancel={() => setIssueModalFor(null)}
        confirmLoading={createIssueMut.isPending}
        onOk={() => issueForm.validateFields().then((v) => createIssueMut.mutate(v))}
        destroyOnClose
      >
        <Form form={issueForm} layout="vertical">
          <Form.Item label="Заголовок" name="title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Описание" name="description" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="Критичность" name="severity" rules={[{ required: true }]} initialValue="MINOR">
            <Select
              options={[
                { value: "MINOR", label: "Некритично" },
                { value: "CRITICAL", label: "Критично (блокирует приёмку и зависимые работы)" },
              ]}
            />
          </Form.Item>
          <Form.Item label="Срок устранения" name="dueDate">
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Принять работу — ${acceptModalFor?.objectWork.name ?? ""}`}
        open={!!acceptModalFor}
        onCancel={() => setAcceptModalFor(null)}
        confirmLoading={acceptMut.isPending}
        onOk={() => acceptForm.validateFields().then((v) => acceptMut.mutate(v))}
        destroyOnClose
      >
        <Form form={acceptForm} layout="vertical">
          <Form.Item label="Принятый объём" name="acceptedQuantity" rules={[{ required: true, message: "Укажите принятый объём" }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item label="Комментарий" name="comment">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Отклонить работу — ${rejectModalFor?.objectWork.name ?? ""}`}
        open={!!rejectModalFor}
        onCancel={() => setRejectModalFor(null)}
        confirmLoading={rejectMut.isPending}
        onOk={() => rejectForm.validateFields().then((v) => rejectMut.mutate(v))}
        destroyOnClose
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item label="Причина отклонения" name="comment" rules={[{ required: true, message: "Укажите причину" }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
