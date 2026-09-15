import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Role } from "@construction-erp/domain";

/**
 * Идентификация пользователя во frontend.
 *
 * ХАРДЕНИНГ (ТЗ п.9): demo-переключатель личности (ниже) допустим ТОЛЬКО
 * когда backend сам находится в AUTH_MODE=demo — см.
 * apps/backend/src/modules/auth/bitrix-auth.guard.ts. Frontend не решает
 * это самостоятельно: при загрузке он спрашивает backend через
 * `GET /auth/mode` (единственный публичный, без guard'ов, эндпоинт) и
 * ТОЛЬКО если backend ответил `{mode: "demo"}`, показывает переключатель и
 * шлёт заголовки X-Tenant-Id/X-Bitrix-User-Id. Если backend в
 * AUTH_MODE=bitrix, эти заголовки backend вообще не читает (см. guard) —
 * переключатель скрывается, а получение реальной сессии должно приходить
 * из подтверждённого Bitrix24 placement-контекста, чего в этой среде
 * разработки нет — REQUIRES BITRIX24 TEST PORTAL VERIFICATION.
 */

export interface DemoIdentity {
  bitrixUserId: number;
  name: string;
  role: Role;
  label: string;
}

export const DEMO_IDENTITIES: DemoIdentity[] = [
  { bitrixUserId: 1, name: "Соколов И.П.", role: Role.GENERAL_DIRECTOR, label: "Генеральный директор" },
  { bitrixUserId: 10, name: "Ким Р.С.", role: Role.PROJECT_MANAGER, label: "РП — Ким Р.С." },
  { bitrixUserId: 20, name: "Орлова Т.И.", role: Role.CONSTRUCTION_CONTROL, label: "Строительный контроль — Орлова Т.И." },
  { bitrixUserId: 30, name: "Волкова Е.С.", role: Role.PTO, label: "ПТО — Волкова Е.С." },
  { bitrixUserId: 40, name: "Белова Н.В.", role: Role.SDO, label: "СДО — Белова Н.В." },
];

type AuthMode = "demo" | "bitrix" | "checking";

interface AuthContextValue {
  authMode: AuthMode;
  tenantId: string;
  setTenantId: (id: string) => void;
  identity: DemoIdentity;
  setIdentity: (identity: DemoIdentity) => void;
  headers: Record<string, string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [tenantId, setTenantIdState] = useState(() => localStorage.getItem("cerp.tenantId") || "");
  const [identity, setIdentityState] = useState<DemoIdentity>(() => {
    const saved = localStorage.getItem("cerp.bitrixUserId");
    return DEMO_IDENTITIES.find((i) => String(i.bitrixUserId) === saved) ?? DEMO_IDENTITIES[0];
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/mode")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAuthMode(data?.mode === "bitrix" ? "bitrix" : "demo");
      })
      .catch(() => {
        // Backend недоступен — не притворяемся, что demo-режим работает.
        if (!cancelled) setAuthMode("bitrix");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTenantId = (id: string) => {
    localStorage.setItem("cerp.tenantId", id);
    setTenantIdState(id);
  };
  const setIdentity = (i: DemoIdentity) => {
    localStorage.setItem("cerp.bitrixUserId", String(i.bitrixUserId));
    setIdentityState(i);
  };

  // В demo-режиме шлём заголовки, которые доверчиво читает BitrixAuthGuard.
  // В bitrix-режиме заголовки не помогут (backend их игнорирует) — нужен
  // подписанный токен из ещё не подключённого placement-потока, поэтому
  // headers сознательно пустые, а не подделка.
  const headers = useMemo(
    () => (authMode === "demo" ? { "X-Tenant-Id": tenantId, "X-Bitrix-User-Id": String(identity.bitrixUserId) } : {}),
    [authMode, tenantId, identity],
  );

  const value: AuthContextValue = { authMode, tenantId, setTenantId, identity, setIdentity, headers };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
