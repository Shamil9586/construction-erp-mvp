import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission, getPermissionsForRole } from "../src/rbac";
import { Permission, Role } from "../src/types";

test("ADMIN имеет все права", () => {
  assert.equal(getPermissionsForRole(Role.ADMIN).length, Object.values(Permission).length);
});

test("PROJECT_MANAGER может обновлять факт, но не принимать инспекцию", () => {
  assert.equal(hasPermission(Role.PROJECT_MANAGER, Permission.WORK_UPDATE_PROGRESS), true);
  assert.equal(hasPermission(Role.PROJECT_MANAGER, Permission.INSPECTION_ACCEPT), false);
});

test("CONSTRUCTION_CONTROL может принимать/отклонять инспекции", () => {
  assert.equal(hasPermission(Role.CONSTRUCTION_CONTROL, Permission.INSPECTION_ACCEPT), true);
  assert.equal(hasPermission(Role.CONSTRUCTION_CONTROL, Permission.INSPECTION_REJECT), true);
  assert.equal(hasPermission(Role.CONSTRUCTION_CONTROL, Permission.WORK_UPDATE_PROGRESS), false);
});

test("PTO может передавать пакет в СДО, СДО не может редактировать ПТО", () => {
  assert.equal(hasPermission(Role.PTO, Permission.PTO_TRANSFER_SDO), true);
  assert.equal(hasPermission(Role.SDO, Permission.PTO_EDIT), false);
});

test("CONTRACTOR_VIEWER — только просмотр", () => {
  const perms = getPermissionsForRole(Role.CONTRACTOR_VIEWER);
  assert.ok(perms.every((p) => p.toString().endsWith("_VIEW")));
});

test("GENERAL_DIRECTOR видит финансы, но не редактирует ПТО/СДО", () => {
  assert.equal(hasPermission(Role.GENERAL_DIRECTOR, Permission.FINANCE_VIEW), true);
  assert.equal(hasPermission(Role.GENERAL_DIRECTOR, Permission.PTO_EDIT), false);
  assert.equal(hasPermission(Role.GENERAL_DIRECTOR, Permission.SDO_EDIT), false);
});
