import { Permission, Role } from "./types";

/**
 * RBAC (ТЗ п.12). Backend — источник истины для security; frontend-проверки
 * используются только для UX (скрыть кнопку), но не заменяют backend-проверку.
 */

const P = Permission;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),

  [Role.GENERAL_DIRECTOR]: [
    P.OBJECT_VIEW,
    P.WORK_VIEW,
    P.PTO_VIEW,
    P.SDO_VIEW,
    P.FINANCE_VIEW,
  ],

  [Role.TECHNICAL_DIRECTOR]: [
    P.OBJECT_VIEW,
    P.OBJECT_EDIT,
    P.OBJECT_MANAGE_CONTRACTORS,
    P.WORK_VIEW,
    P.PTO_VIEW,
    P.SDO_VIEW,
    P.FINANCE_VIEW,
    P.ISSUE_VERIFY,
  ],

  [Role.PROJECT_MANAGER]: [
    P.OBJECT_VIEW,
    P.OBJECT_CREATE,
    P.OBJECT_MANAGE_CONTRACTORS,
    P.WORK_VIEW,
    P.WORK_CREATE,
    P.WORK_UPDATE_PROGRESS,
    P.INSPECTION_REQUEST,
    P.ISSUE_RESOLVE,
    P.PTO_VIEW,
    P.SDO_VIEW,
    P.FINANCE_VIEW,
  ],

  [Role.CONSTRUCTION_CONTROL]: [
    P.OBJECT_VIEW,
    P.WORK_VIEW,
    P.INSPECTION_ACCEPT,
    P.INSPECTION_REJECT,
    P.ISSUE_CREATE,
    P.ISSUE_VERIFY,
    P.PTO_VIEW,
  ],

  [Role.PTO]: [
    P.OBJECT_VIEW,
    P.WORK_VIEW,
    P.PTO_VIEW,
    P.PTO_EDIT,
    P.PTO_TRANSFER_SDO,
    P.SDO_VIEW,
  ],

  [Role.SDO]: [
    P.OBJECT_VIEW,
    P.WORK_VIEW,
    P.PTO_VIEW,
    P.SDO_VIEW,
    P.SDO_EDIT,
    P.SDO_CLOSE,
    P.FINANCE_VIEW,
    P.FINANCE_EDIT,
  ],

  [Role.DEPARTMENT_HEAD]: [
    P.OBJECT_VIEW,
    P.WORK_VIEW,
    P.PTO_VIEW,
    P.SDO_VIEW,
    P.FINANCE_VIEW,
  ],

  [Role.CONTRACTOR_VIEWER]: [P.OBJECT_VIEW, P.WORK_VIEW],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
