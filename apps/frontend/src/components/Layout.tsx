import React from "react";
import { Alert, Input, Layout as AntLayout, Menu, Select, Typography } from "antd";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth, DEMO_IDENTITIES } from "../lib/auth";

const { Header, Content } = AntLayout;

const MENU_ITEMS = [
  { key: "/", label: <Link to="/">Панель</Link> },
  { key: "/objects", label: <Link to="/objects">Объекты</Link> },
  { key: "/contractors", label: <Link to="/contractors">Субподрядчики</Link> },
  { key: "/inspections", label: <Link to="/inspections">Строительный контроль</Link> },
];

export function AppLayout() {
  const location = useLocation();
  const { authMode, tenantId, setTenantId, identity, setIdentity, hasBitrixSession } = useAuth();
  const selectedKey = MENU_ITEMS.find((i) => location.pathname === i.key || (i.key !== "/" && location.pathname.startsWith(i.key)))?.key ?? "/";

  return (
    <AntLayout style={{ minHeight: "100vh" }}>
      <Header style={{ display: "flex", alignItems: "center", gap: 16, background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
        <Typography.Title level={4} style={{ margin: 0, marginRight: 24 }}>
          Construction ERP
        </Typography.Title>
        <Menu mode="horizontal" selectedKeys={[selectedKey]} items={MENU_ITEMS} style={{ flex: 1, borderBottom: "none" }} />
        {authMode === "demo" && (
          <>
            <Input
              size="small"
              style={{ width: 220 }}
              value={tenantId}
              placeholder="Tenant ID (из сид-данных)"
              onChange={(e) => setTenantId(e.target.value)}
            />
            <Select
              size="small"
              style={{ width: 260 }}
              value={identity.bitrixUserId}
              onChange={(val) => setIdentity(DEMO_IDENTITIES.find((i) => i.bitrixUserId === val)!)}
              options={DEMO_IDENTITIES.map((i) => ({ value: i.bitrixUserId, label: i.label }))}
            />
          </>
        )}
        {authMode === "bitrix" && (
          <Typography.Text type="secondary">Bitrix24{hasBitrixSession ? " · сессия активна" : " · нет сессии"}</Typography.Text>
        )}
      </Header>
      <Content style={{ padding: 24 }}>
        {authMode === "bitrix" && !hasBitrixSession && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="Нет подтверждённой сессии Bitrix24"
            description="Откройте приложение из интерфейса Bitrix24. Backend должен проверить placement-контекст и передать в этот SPA короткоживущий сессионный токен. Demo-заголовки в AUTH_MODE=bitrix намеренно не принимаются."
          />
        )}
        <Outlet />
      </Content>
    </AntLayout>
  );
}
