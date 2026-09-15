import React from "react";
import { Layout as AntLayout, Menu, Select, Input, Typography, Alert } from "antd";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth, DEMO_IDENTITIES } from "../lib/auth";

const { Header, Content } = AntLayout;

/** Главное меню (ТЗ п.40). */
const MENU_ITEMS = [
  { key: "/", label: <Link to="/">Панель</Link> },
  { key: "/objects", label: <Link to="/objects">Объекты</Link> },
  { key: "/contractors", label: <Link to="/contractors">Субподрядчики</Link> },
  { key: "/inspections", label: <Link to="/inspections">Строительный контроль</Link> },
];

export function AppLayout() {
  const location = useLocation();
  const { authMode, tenantId, setTenantId, identity, setIdentity } = useAuth();
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
        {authMode === "bitrix" && <Typography.Text type="secondary">Режим Bitrix24 (сессия из placement)</Typography.Text>}
      </Header>
      <Content style={{ padding: 24 }}>
        {authMode === "bitrix" && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Приложение в production-режиме авторизации (AUTH_MODE=bitrix)"
            description="Demo-переключатель личности отключён — это ожидаемо и является хардненингом безопасности (ТЗ п.9), а не ошибкой. Получение сессии из подтверждённого Bitrix24 placement-контекста ещё не подключено в этой среде разработки (REQUIRES BITRIX24 TEST PORTAL VERIFICATION) — без действительного сессионного токена запросы к API будут отклонены backend'ом."
          />
        )}
        <Outlet />
      </Content>
    </AntLayout>
  );
}
