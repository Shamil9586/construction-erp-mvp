import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Typography, Space, Alert, Spin, Descriptions, Table, Tag, Card, Row, Col, Statistic, Progress } from "antd";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { HealthBadge } from "../components/StatusBadge";

/** Соответствует ContractorsService.findOne() — apps/backend/src/modules/contractors/contractors.module.ts */
interface ContractorDetailData {
  contractor: { id: string; name: string; inn?: string | null; status: string };
  objects: { objectId: string; objectName: string; healthStatus: string; works: number }[];
  totalWorks: number;
  avgProgressPercent: number;
  openIssues: number;
  overdueIssues: number;
  physicalReadinessRatio: number;
}

export function ContractorDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, headers } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["contractor", tenantId, id],
    queryFn: () => api.get<ContractorDetailData>(`/contractors/${id}`, headers),
    enabled: !!tenantId && !!id,
  });

  if (!tenantId) return <Alert type="info" showIcon message="Укажите Tenant ID в верхней панели" />;
  if (isLoading) return <Spin size="large" style={{ marginTop: 80, width: "100%" }} />;
  if (isError || !data) return <Alert type="error" showIcon message="Не удалось загрузить субподрядчика" />;

  const { contractor } = data;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {contractor.name}
      </Typography.Title>

      <Card>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="ИНН">{contractor.inn ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag>{contractor.status}</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Работ всего" value={data.totalWorks} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Ср. % выполнения" value={Math.round(data.avgProgressPercent)} suffix="%" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Открытых замечаний" value={data.openIssues} valueStyle={data.openIssues > 0 ? { color: "#cf1322" } : undefined} suffix={`/ просрочено ${data.overdueIssues}`} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Физическая готовность (план/факт)" value={Math.round(data.physicalReadinessRatio)} suffix="%" />
          </Card>
        </Col>
      </Row>

      <Card title="Объекты">
        <Table
          size="small"
          rowKey="objectId"
          dataSource={data.objects}
          pagination={false}
          columns={[
            { title: "Объект", dataIndex: "objectName", render: (v: string, r) => <Link to={`/objects/${r.objectId}`}>{v}</Link> },
            { title: "Светофор", dataIndex: "healthStatus", width: 130, render: (v: string) => <HealthBadge status={v} /> },
            { title: "Работ на объекте", dataIndex: "works", width: 140, align: "right" as const },
          ]}
        />
      </Card>
    </Space>
  );
}
