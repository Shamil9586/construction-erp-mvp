/**
 * Порты (интерфейсы) для интеграции с Bitrix24 (ТЗ п.36). Domain/application
 * слои зависят ТОЛЬКО от этих интерфейсов, никогда напрямую от Bitrix REST.
 * Implementations: MockBitrixAdapter (по умолчанию, без реального портала) и
 * RealBitrixAdapter (см. bitrix.module.ts — переключается по наличию
 * BitrixInstallation с валидным токеном).
 */

export interface BitrixUser {
  bitrixUserId: number;
  name: string;
  email?: string;
  departmentId?: string;
  departmentName?: string;
  position?: string;
  isActive: boolean;
}

export interface BitrixDepartment {
  id: string;
  name: string;
  parentId?: string;
}

export interface BitrixUserProvider {
  getUsers(tenantId: string): Promise<BitrixUser[]>;
  getUser(tenantId: string, bitrixUserId: number): Promise<BitrixUser | null>;
}

export interface OrganizationProvider {
  getDepartments(tenantId: string): Promise<BitrixDepartment[]>;
}

export interface NotificationProvider {
  /** Системное уведомление пользователю портала (im.notify.system.add). */
  notify(tenantId: string, bitrixUserId: number, message: string): Promise<void>;
}

export interface TaskProvider {
  /** Создание задачи в Bitrix24 (tasks.task.add) — напр. эскалация. */
  createTask(tenantId: string, params: { title: string; description: string; responsibleBitrixUserId: number }): Promise<{ taskId: string }>;
}

export interface UploadedFileRef {
  fileProvider: "LOCAL" | "BITRIX_DISK";
  externalFileId: string;
  fileName: string;
  url?: string;
}

export interface DownloadedFile {
  buffer: Buffer;
  contentType: string;
}

export interface FileStorageProvider {
  /** Загрузка файла (фото инспекции, скан АОСР, сертификат) в хранилище. */
  upload(tenantId: string, params: { fileName: string; buffer: Buffer; folder?: string }): Promise<UploadedFileRef>;
  /**
   * Получение ранее загруженного файла обратно (просмотр/скачивание,
   * integrity-fix pass). `externalFileId` — то же значение, что вернул
   * `upload()` в `UploadedFileRef.externalFileId`. `null`, если файл не
   * найден (не путать с ошибкой — отсутствие файла это ожидаемый результат).
   */
  download(tenantId: string, externalFileId: string): Promise<DownloadedFile | null>;
}

export const BITRIX_USER_PROVIDER = Symbol("BitrixUserProvider");
export const ORGANIZATION_PROVIDER = Symbol("OrganizationProvider");
export const NOTIFICATION_PROVIDER = Symbol("NotificationProvider");
export const TASK_PROVIDER = Symbol("TaskProvider");
export const FILE_STORAGE_PROVIDER = Symbol("FileStorageProvider");
