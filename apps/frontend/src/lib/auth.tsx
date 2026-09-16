import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Role } from "@construction-erp/domain";
import { apiUrl } from "./api";

const BITRIX_SESSION_STORAGE_KEY = "cerp.bitrixSession";

function bootstrapBitrixSession(): string {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const incoming = params.get("cerp_session");
  if (incoming) {
    sessionStorage.setItem(BITRIX_SESSION_STORAGE_KEY, incoming);
    params.delete("cerp_session");
    const cleanHash = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${cleanHash ? `#${cleanHash}` : ""}`);
    return incoming;
  }
  return sessionStorage.getItem(BITRIX_SESSION_STORAGE_KEY) || "";
}

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
  hasBitrixSession: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [sessionToken] = useState(bootstrapBitrixSession);
  const [tenantId, setTenantIdState] = useState(() => localStorage.getItem("cerp.tenantId") || "");
  const [identity, setIdentityState] = useState<DemoIdentity>(() => {
    const saved = localStorage.getItem("cerp.bitrixUserId");
    return DEMO_IDENTITIES.find((i) => String(i.bitrixUserId) === saved) ?? DEMO_IDENTITIES[0];
  });

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/auth/mode"))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.mode === "bitrix") {
          setAuthMode("bitrix");
          return;
        }
        setAuthMode("demo");
        if (typeof data?.tenantId === "string" && data.tenantId) {
          setTenantIdState((current) => {
            if (current) return current;
            localStorage.setItem("cerp.tenantId", data.tenantId);
            return data.tenantId;
          });
        }
      })
      .catch(() => {
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

  const headers = useMemo<Record<string, string>>((): Record<string, string> => {
    if (authMode === "bitrix") {
      return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
    }
    if (authMode !== "demo") return {};
    return {
      "X-Tenant-Id": tenantId,
      "X-Bitrix-User-Id": String(identity.bitrixUserId),
    };
  }, [authMode, tenantId, identity, sessionToken]);

  const value: AuthContextValue = {
    authMode,
    tenantId,
    setTenantId,
    identity,
    setIdentity,
    headers,
    hasBitrixSession: authMode === "bitrix" && Boolean(sessionToken),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
