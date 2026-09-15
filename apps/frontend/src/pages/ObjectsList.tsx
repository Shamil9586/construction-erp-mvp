import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, Typography, Space, Alert, Spin, Input, Tag, Button, Select } from "antd";
import { Link } from "react-router-dom";
import { hasPermission, Permission } from "@construction-erp/domain";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { HealthBadge } from "../components/StatusBadge";
import { ObjectFormModal } from "../components/ObjectFormModal";

/** Соответствует ObjectsService.findAll() — apps/backend/src/modules/objects/objects.module.ts */
interface ObjectRow {
  id: string;
  name: string;
  address: string;
  status: string;
  healthStatus: string;
  contractValue?: number | string | null;
  projectManager?: { id: string; name: string } | null;
  contractors: { id: string; role: string | null; contractor: { id: string; name: string } }[];
}

interface ContractorOption {
  id: string;
  name: string;
}

function formatMoney(v?: number | string | null) {
  if (!v) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(v)) + " ₽";
}

export function ObjectsList() {
  const { tenantId, headers, identity } = useAuth();
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  // Фильтр по субподрядчику (ХАРДЕНИНГ-ФИКС этой итерации): backend уже
  // поддерживал ?contractorId= в GET /objects (ObjectsService.findAll),
  // но у фильтра не было UI — добавлен здесь как отдельный параметр запроса
  // (не клиентская фильтрация), т.к. именно серверный ?contractorId= и
  // нужно было проверить рабочим согласно задаче.
  const [contractorFilter, setContractorFilter] = React.useState<string | undefined>(undefined);

  const contractorsQ = useQuery({
    queryKey: ["contractors", tenantId],
    queryFn: () => api.get<ContractorOption[]>("/contractors", headers),
    enabled: !!tenantId,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["objects", tenantId, contractorFilter],
    queryFn: () => api.get<ObjectRow[]>(`/objects${contractorFilter ? `?contractorId=${contractorFilter}` : ""}`, headers),
    enabled: !!tenantId,
  });

  if (!tenantId) return <Alert type="info" showIcon message="Укажите Tenant ID в верхней панели" />;
  if (isLoading) return <Spin size="large" style={{ marginTop: 80, width: "100%" }} />;
  if (isError) return <Alert type="error" showIcon message="Не удалось загрузить список объектов" />;

  const filtered = (data ?? []).filter(
    (o) => !search || o.name.toLowerCase().includes(search.toLowerCase()) || o.address.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Объекты строительства
        </Typography.Title>
        <Space>
          <Input.Search placeholder="Поиск по названию / адресу" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} allowClear />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Фильтр по субподрядчику"
            style={{ width: 220 }}
            loading={contractorsQ.isLoading}
            value={contractorFilter}
            onChange={(v) => setContractorFilter(v)}
            options={(contractorsQ.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          {hasPermission(identity.role, Permission.OBJECT_CREATE) && (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              Создать объект
            </Button>
          )}
        </Space>
      </Space>
      <Table<ObjectRow>
        rowKey="id"
        dataSource={filtered}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: "Объект",
            dataIndex: "name",
            render: (name: string, r) => <Link to={`/objects/${r.id}`}>{name}</Link>,
          },
          { title: "Адрес", dataIndex: "address" },
          { title: "Светофор", dataIndex: "healthStatus", width: 130, render: (v: string) => <HealthBadge status={v} /> },
          { title: "Статус", dataIndex: "status", width: 120, render: (v: string) => <Tag>{v}</Tag> },
          { title: "Субподрядчики", dataIndex: "contractors", width: 220, render: (v: ObjectRow["contractors"]) => v.map((c) => c.contractor.name).join(", ") || "—" },
          { title: "РП", dataIndex: "projectManager", width: 160, render: (v: ObjectRow["projectManager"]) => v?.name ?? "—" },
          { title: "Сумма договора", dataIndex: "contractValue", width: 150, align: "right" as const, render: formatMoney },
        ]}
      />
      <ObjectFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </Space>
  );
}
