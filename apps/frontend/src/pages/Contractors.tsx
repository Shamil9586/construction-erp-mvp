import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, Typography, Space, Alert, Spin, Tag } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

interface ContractorRow {
  id: string;
  name: string;
  inn?: string;
  status: string;
  activeObjectsCount: number;
  openIssuesCount: number;
  delayedWorksCount: number;
}

export function Contractors() {
  const { tenantId, headers } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["contractors", tenantId],
    queryFn: () => api.get<ContractorRow[]>("/contractors", headers),
    enabled: !!tenantId,
  });

  if (!tenantId) return <Alert type="info" showIcon message="Укажите Tenant ID в верхней панели" />;
  if (isLoading) return <Spin size="large" style={{ marginTop: 80, width: "100%" }} />;
  if (isError) return <Alert type="error" showIcon message="Не удалось загрузить список субподрядчиков" />;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Субподрядчики
      </Typography.Title>
      <Table<ContractorRow>
        rowKey="id"
        dataSource={data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Название", dataIndex: "name", render: (name: string, r) => <Link to={`/contractors/${r.id}`}>{name}</Link> },
          { title: "ИНН", dataIndex: "inn", width: 140 },
          { title: "Статус", dataIndex: "status", width: 130, render: (v: string) => <Tag>{v}</Tag> },
          { title: "Активных объектов", dataIndex: "activeObjectsCount", width: 160, align: "right" as const },
          {
            title: "Открытых замечаний",
            dataIndex: "openIssuesCount",
            width: 160,
            align: "right" as const,
            render: (v: number) => (v > 0 ? <Tag color="error">{v}</Tag> : v),
          },
          {
            title: "Работ с отставанием",
            dataIndex: "delayedWorksCount",
            width: 170,
            align: "right" as const,
            render: (v: number) => (v > 0 ? <Tag color="warning">{v}</Tag> : v),
          },
        ]}
      />
    </Space>
  );
}
