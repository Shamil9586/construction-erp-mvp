/**
 * Domain types — framework-agnostic (нет зависимостей от NestJS/Prisma/React/Bitrix).
 * Используются одновременно:
 *  - реальным backend (apps/backend) как контракт domain-слоя;
 *  - локальным верификационным harness (verify/), который исполняет эти же
 *    функции против настоящего PostgreSQL без npm install (см. README).
 */

export enum ObjectStatus {
  PLANNED = "PLANNED",
  ACTIVE = "ACTIVE",
  AT_RISK = "AT_RISK",
  DELAYED = "DELAYED",
  SUSPENDED = "SUSPENDED",
  COMPLETED = "COMPLETED",
  ARCHIVED = "ARCHIVED",
}

export enum HealthStatus {
  GREEN = "GREEN",
  YELLOW = "YELLOW",
  RED = "RED",
  GRAY = "GRAY",
}

export enum ScheduleStatus {
  ON_TRACK = "ON_TRACK",
  BEHIND = "BEHIND",
  CRITICAL = "CRITICAL",
  DONE = "DONE",
}

export enum DependencyType {
  FINISH_TO_START = "FINISH_TO_START",
}

export enum InspectionStatus {
  NOT_SUBMITTED = "NOT_SUBMITTED",
  WAITING = "WAITING",
  IN_REVIEW = "IN_REVIEW",
  ISSUES_FOUND = "ISSUES_FOUND",
  REINSPECTION = "REINSPECTION",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  BLOCKED = "BLOCKED",
}

export enum IssueSeverity {
  MINOR = "MINOR",
  CRITICAL = "CRITICAL",
}

export enum IssueStatus {
  OPEN = "OPEN",
  IN_PROGRESS = "IN_PROGRESS",
  READY_FOR_VERIFICATION = "READY_FOR_VERIFICATION",
  CLOSED = "CLOSED",
  REJECTED = "REJECTED",
}

export enum ExecutiveDocumentType {
  AOSR = "AOSR",
  EXECUTIVE_SCHEME = "EXECUTIVE_SCHEME",
  CERTIFICATE = "CERTIFICATE",
  PASSPORT = "PASSPORT",
  LAB_REPORT = "LAB_REPORT",
  OTHER = "OTHER",
}

export enum ExecutiveDocumentStatus {
  NOT_STARTED = "NOT_STARTED",
  DRAFT = "DRAFT",
  IN_PROGRESS = "IN_PROGRESS",
  WAITING_DOCUMENT = "WAITING_DOCUMENT",
  WAITING_CERTIFICATE = "WAITING_CERTIFICATE",
  WAITING_APPROVAL = "WAITING_APPROVAL",
  READY = "READY",
  APPROVED = "APPROVED",
}

export enum PackageStatus {
  DRAFT = "DRAFT",
  IN_PROGRESS = "IN_PROGRESS",
  READY = "READY",
  TRANSFERRED_TO_SDO = "TRANSFERRED_TO_SDO",
  RETURNED = "RETURNED",
}

export enum SdoStatus {
  NOT_TRANSFERRED = "NOT_TRANSFERRED",
  READY_FOR_TRANSFER = "READY_FOR_TRANSFER",
  TRANSFERRED = "TRANSFERRED",
  IN_PROGRESS = "IN_PROGRESS",
  NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION",
  CALCULATED = "CALCULATED",
  READY_TO_CLOSE = "READY_TO_CLOSE",
  CLOSED = "CLOSED",
}

export enum Role {
  GENERAL_DIRECTOR = "GENERAL_DIRECTOR",
  TECHNICAL_DIRECTOR = "TECHNICAL_DIRECTOR",
  PROJECT_MANAGER = "PROJECT_MANAGER",
  CONSTRUCTION_CONTROL = "CONSTRUCTION_CONTROL",
  PTO = "PTO",
  SDO = "SDO",
  DEPARTMENT_HEAD = "DEPARTMENT_HEAD",
  ADMIN = "ADMIN",
  CONTRACTOR_VIEWER = "CONTRACTOR_VIEWER",
}

export enum Permission {
  OBJECT_VIEW = "OBJECT_VIEW",
  OBJECT_CREATE = "OBJECT_CREATE",
  OBJECT_EDIT = "OBJECT_EDIT",
  OBJECT_MANAGE_CONTRACTORS = "OBJECT_MANAGE_CONTRACTORS",
  WORK_VIEW = "WORK_VIEW",
  WORK_CREATE = "WORK_CREATE",
  WORK_UPDATE_PROGRESS = "WORK_UPDATE_PROGRESS",
  INSPECTION_REQUEST = "INSPECTION_REQUEST",
  INSPECTION_ACCEPT = "INSPECTION_ACCEPT",
  INSPECTION_REJECT = "INSPECTION_REJECT",
  ISSUE_CREATE = "ISSUE_CREATE",
  ISSUE_RESOLVE = "ISSUE_RESOLVE",
  ISSUE_VERIFY = "ISSUE_VERIFY",
  PTO_VIEW = "PTO_VIEW",
  PTO_EDIT = "PTO_EDIT",
  PTO_TRANSFER_SDO = "PTO_TRANSFER_SDO",
  SDO_VIEW = "SDO_VIEW",
  SDO_EDIT = "SDO_EDIT",
  SDO_CLOSE = "SDO_CLOSE",
  FINANCE_VIEW = "FINANCE_VIEW",
  FINANCE_EDIT = "FINANCE_EDIT",
  ADMIN_USERS = "ADMIN_USERS",
  ADMIN_DICTIONARIES = "ADMIN_DICTIONARIES",
}

/** Пороговые настройки светофора — не хардкодятся, читаются из RiskSettings в БД. */
export interface RiskThresholds {
  /** Отклонение (п.п.), выше которого работа/объект ещё GREEN. По умолчанию -5. */
  greenVarianceThreshold: number;
  /** Отклонение (п.п.), выше которого работа/объект ещё YELLOW (иначе RED). По умолчанию -15. */
  yellowVarianceThreshold: number;
  /** Через сколько дней в RED эскалировать техническому директору. */
  escalateToTechDirectorAfterDays: number;
  /** Через сколько дней в RED эскалировать генеральному директору. */
  escalateToGeneralDirectorAfterDays: number;
  /** Через сколько дней без обновления факта считать данные "протухшими". */
  staleProgressAfterDays: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  greenVarianceThreshold: -5,
  yellowVarianceThreshold: -15,
  escalateToTechDirectorAfterDays: 7,
  escalateToGeneralDirectorAfterDays: 14,
  staleProgressAfterDays: 10,
};
