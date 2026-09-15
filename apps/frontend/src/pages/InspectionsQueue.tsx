import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, Typography, Space, Alert, Spin, Tag } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

/**
 * Очередь строительного контроля — заявки на приёмку работ (ТЗ §26-27).
 * Соответствует InspectionsService.findQueue() — по умолчанию показывает
 * WAITING/IN_REVIEW/REINSPECTION (ещё не закрытые проверки).
 */
interface InspectionRow {
  id: string;
  objectId: string;
  object: { name: string };
  objectWork: { name: string };
  status: string;
  requestedAt: string;
  requestedBy?: { name: string } | null;
}

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  WAITING: { color: "blue", label: "Ожидает проверки" },
  IN_REVIEW: { color: "processing", label: "В процессе" },
  ISSUES_FOUND: { color: "error", label: "Есть замечания" },
  REINSPECTION: { color: "gold", label: "Повторно на проверке" },
  ACCEPTED: { color: "success", label: "Принята" },
  REJECTED: { color: "error", label: "Отклонена" },
};

export function InspectionsQueue() {
  const { tenantId, headers } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["inspections", tenantId],
    queryFn: () => api.get<InspectionRow[]>("/inspections", headers),
    enabled: !!tenantId,
  });

  if (!tenantId) return <Alert type="info" showIcon message="Укажите Tenant ID в верхней панели" />;
  if (isLoading) return <Spin size="large" style={{ marginTop: 80, width: "100%" }} />;
  if (isError) return <Alert type="error" showIcon message="Не удалось загрузить очередь строительного контроля" />;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Строительный контроль — очередь проверок
      </Typography.Title>
      <Table<InspectionRow>
        rowKey="id"
        dataSource={data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: "Объект",
            dataIndex: "objectId",
            width: 220,
            render: (objId: string, r) => <Link to={`/objects/${objId}`}>{r.object?.name ?? objId.slice(0, 8)}</Link>,
          },
          { title: "Работа", dataIndex: "objectWork", render: (v: { name: string }) => v?.name },
          {
            title: "Статус",
            dataIndex: "status",
            width: 170,
            render: (v: string) => {
              const info = STATUS_LABEL[v] ?? { color: "default", label: v };
              return <Tag color={info.color}>{info.label}</Tag>;
            },
          },
          { title: "Запрошена", dataIndex: "requestedAt", width: 140, render: (v: string) => new Date(v).toLocaleDateString("ru-RU") },
          { title: "Запросил", dataIndex: "requestedBy", width: 160, render: (v?: { name: string } | null) => v?.name ?? "—" },
        ]}
      />
    </Space>
  );
}
