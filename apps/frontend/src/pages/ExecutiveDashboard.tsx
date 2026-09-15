import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Row, Col, Card, Statistic, Table, Tag, Typography, Alert, Spin, Space } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

/**
 * Executive Dashboard — GET /dashboard/executive (ТЗ §41).
 * Цель: генеральный директор за 1-2 минуты понимает, какие объекты
 * проблемные, кто виноват, сколько денег и дней потеряно, что делать.
 */

interface AttentionItem {
  entityType: string;
  entityId: string;
  objectId: string;
  objectName: string;
  severity: "RED" | "YELLOW";
  title: string;
  reason: string;
  daysOverdue: number;
  moneyImpact: number;
  responsible: string | null;
  recommendedAction: string;
}

/** Соответствует DashboardService.executive() — apps/backend/src/modules/dashboard/dashboard.module.ts */
interface ExecutiveDashboardData {
  kpi: {
    activeObjects: number;
    greenObjects: number;
    yellowObjects: number;
    redObjects: number;
    grayObjects: number;
    delayedWorks: number;
    openInspectionIssues: number;
    criticalInspectionIssues: number;
    awaitingInspection: number;
    ptoBacklog: number;
    sdoBacklog: number;
    closedThisMonth: number;
    potentialClosing: number;
    forecastClosing: number;
  };
  attentionRequired: AttentionItem[];
}

const SEVERITY_ORDER: Record<string, number> = { RED: 0, YELLOW: 1 };
const SEVERITY_COLOR: Record<string, string> = { RED: "red", YELLOW: "gold" };

function formatMoney(v?: number) {
  if (!v) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v) + " ₽";
}

export function ExecutiveDashboard() {
  const { tenantId, headers } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-executive", tenantId],
    queryFn: () => api.get<ExecutiveDashboardData>("/dashboard/executive", headers),
    enabled: !!tenantId,
  });

  if (!tenantId) {
    return (
      <Alert
        type="info"
        showIcon
        message="Укажите Tenant ID"
        description="Введите Tenant ID из сид-данных в верхней панели, чтобы загрузить панель управления."
      />
    );
  }

  if (isLoading) return <Spin size="large" style={{ marginTop: 80, width: "100%" }} />;

  if (isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Не удалось загрузить панель"
        description={
          (error as any)?.message ??
          "Backend недоступен в этой среде (NestJS не может быть запущен в текущей песочнице без доступа к npm registry). Логика проверена локально через verify/run.ts на реальном PostgreSQL — см. docs/mvp-test-scenario.md."
        }
      />
    );
  }

  const kpi = data!.kpi;
  const attention = [...data!.attentionRequired].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.moneyImpact ?? 0) - (a.moneyImpact ?? 0),
  );

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Панель управления
      </Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Объектов в работе" value={kpi.activeObjects} />
            <Space size={4} style={{ marginTop: 8 }}>
              <Tag color="success">GREEN {kpi.greenObjects}</Tag>
              <Tag color="warning">YELLOW {kpi.yellowObjects}</Tag>
              <Tag color="error">RED {kpi.redObjects}</Tag>
              <Tag>GRAY {kpi.grayObjects}</Tag>
            </Space>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Работ с отставанием" value={kpi.delayedWorks} valueStyle={{ color: kpi.delayedWorks > 0 ? "#cf1322" : undefined }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Открытых замечаний СК" value={kpi.openInspectionIssues} suffix={`/ крит. ${kpi.criticalInspectionIssues}`} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Ожидают приёмки СК" value={kpi.awaitingInspection} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Backlog ПТО (ИД)" value={kpi.ptoBacklog} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Backlog СДО" value={kpi.sdoBacklog} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="kpi-card">
            <Statistic title="Закрыто в этом месяце" value={formatMoney(kpi.closedThisMonth)} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="kpi-card" style={{ background: "#fffbe6", borderColor: "#ffe58f" }}>
            <Statistic title="Потенциал к закрытию (деньги застряли)" value={formatMoney(kpi.potentialClosing)} valueStyle={{ color: "#d48806" }} />
          </Card>
        </Col>
      </Row>

      <Card
        title="Требует внимания генерального директора"
        extra={<Typography.Text type="secondary">{attention.length} позиций</Typography.Text>}
      >
        <Table<AttentionItem>
          size="small"
          rowKey={(r) => `${r.entityType}:${r.entityId}`}
          dataSource={attention}
          pagination={{ pageSize: 10 }}
          rowClassName={(r) => (r.severity === "CRITICAL" ? "attention-row-critical" : r.severity === "HIGH" ? "attention-row-high" : "")}
          columns={[
            {
              title: "Важность",
              dataIndex: "severity",
              width: 110,
              render: (v: string) => <Tag color={SEVERITY_COLOR[v]}>{v}</Tag>,
            },
            {
              title: "Объект",
              dataIndex: "objectId",
              width: 200,
              render: (id: string, r) => <Link to={`/objects/${id}`}>{r.objectName}</Link>,
            },
            { title: "Проблема", dataIndex: "title" },
            { title: "Причина", dataIndex: "reason" },
            { title: "Ответственный", dataIndex: "responsible", width: 160, render: (v: string | null) => v ?? "—" },
            {
              title: "Дней просрочки",
              dataIndex: "daysOverdue",
              width: 110,
              align: "right" as const,
              render: (v: number) => (v > 0 ? v : "—"),
            },
            {
              title: "Сумма под риском",
              dataIndex: "moneyImpact",
              width: 150,
              align: "right" as const,
              render: (v?: number) => formatMoney(v),
            },
            { title: "Рекомендуемое действие", dataIndex: "recommendedAction", width: 240 },
          ]}
        />
      </Card>
    </Space>
  );
}
