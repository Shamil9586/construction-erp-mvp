import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { BitrixTokenService } from "../bitrix-token.service";
import {
  BitrixDepartment,
  BitrixUser,
  BitrixUserProvider,
  DownloadedFile,
  FileStorageProvider,
  NotificationProvider,
  OrganizationProvider,
  TaskProvider,
  UploadedFileRef,
} from "./interfaces";

/**
 * RealBitrixAdapter — реальные вызовы Bitrix24 REST через OAuth access_token
 * (см. docs/bitrix24-integration.md). Не задействуется, пока для tenant нет
 * BitrixInstallation со статусом ACTIVE — иначе приложение продолжает
 * работать на MockBitrixAdapter (ТЗ п.36, 56: без явного разрешения не
 * подключаться к боевому порталу).
 *
 * REQUIRES BITRIX24 TEST PORTAL VERIFICATION — методы и payload соответствуют
 * официальной документации на момент разработки (сентябрь 2026), но ни один
 * вызов не был выполнен против реального портала (нет credentials в этой
 * среде). Перед продакшен-включением — см. docs/bitrix24-integration.md п.11.
 */
async function callBitrixMethod<T = any>(domain: string, method: string, accessToken: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = `https://${domain}/rest/${method}.json`;
  const body = new URLSearchParams({ auth: accessToken, ...flattenParams(params) });
  const res = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!res.ok) {
    throw new Error(`Bitrix24 REST ${method} failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as any;
  if (json.error) {
    throw new Error(`Bitrix24 REST ${method} error: ${json.error} — ${json.error_description ?? ""}`);
  }
  return json.result as T;
}

function flattenParams(params: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const k = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenParams(value as Record<string, unknown>, k));
    } else {
      out[k] = String(value);
    }
  }
  return out;
}

@Injectable()
export class RealBitrixUserProvider implements BitrixUserProvider {
  private readonly logger = new Logger("RealBitrixUserProvider");
  constructor(private prisma: PrismaService, private tokens: BitrixTokenService) {}

  async getUsers(tenantId: string): Promise<BitrixUser[]> {
    const { domain, accessToken } = await this.tokens.getValidAccessToken(tenantId);
    // REQUIRES VERIFICATION: точная форма ответа user.get на актуальном портале.
    const result = await callBitrixMethod<any[]>(domain, "user.get", accessToken, { ACTIVE: true });
    return result.map((u) => ({
      bitrixUserId: Number(u.ID),
      name: `${u.LAST_NAME ?? ""} ${u.NAME ?? ""}`.trim(),
      email: u.EMAIL,
      departmentId: Array.isArray(u.UF_DEPARTMENT) ? String(u.UF_DEPARTMENT[0]) : undefined,
      position: u.WORK_POSITION,
      isActive: u.ACTIVE !== false,
    }));
  }

  async getUser(tenantId: string, bitrixUserId: number): Promise<BitrixUser | null> {
    const { domain, accessToken } = await this.tokens.getValidAccessToken(tenantId);
    const result = await callBitrixMethod<any[]>(domain, "user.get", accessToken, { ID: bitrixUserId });
    const u = result[0];
    if (!u) return null;
    return {
      bitrixUserId: Number(u.ID),
      name: `${u.LAST_NAME ?? ""} ${u.NAME ?? ""}`.trim(),
      email: u.EMAIL,
      position: u.WORK_POSITION,
      isActive: u.ACTIVE !== false,
    };
  }
}

@Injectable()
export class RealOrganizationProvider implements OrganizationProvider {
  constructor(private tokens: BitrixTokenService) {}

  async getDepartments(tenantId: string): Promise<BitrixDepartment[]> {
    const { domain, accessToken } = await this.tokens.getValidAccessToken(tenantId);
    const result = await callBitrixMethod<any[]>(domain, "department.get", accessToken);
    return result.map((d) => ({ id: String(d.ID), name: d.NAME, parentId: d.PARENT ? String(d.PARENT) : undefined }));
  }
}

@Injectable()
export class RealNotificationProvider implements NotificationProvider {
  constructor(private tokens: BitrixTokenService) {}

  async notify(tenantId: string, bitrixUserId: number, message: string): Promise<void> {
    const { domain, accessToken } = await this.tokens.getValidAccessToken(tenantId);
    await callBitrixMethod(domain, "im.notify.system.add", accessToken, { USER_ID: bitrixUserId, MESSAGE: message });
  }
}

@Injectable()
export class RealTaskProvider implements TaskProvider {
  constructor(private tokens: BitrixTokenService) {}

  async createTask(tenantId: string, params: { title: string; description: string; responsibleBitrixUserId: number }): Promise<{ taskId: string }> {
    const { domain, accessToken } = await this.tokens.getValidAccessToken(tenantId);
    const result = await callBitrixMethod<{ task: { id: string } }>(domain, "tasks.task.add", accessToken, {
      fields: { TITLE: params.title, DESCRIPTION: params.description, RESPONSIBLE_ID: params.responsibleBitrixUserId },
    });
    return { taskId: String(result.task.id) };
  }
}

@Injectable()
export class RealFileStorageProvider implements FileStorageProvider {
  constructor(private tokens: BitrixTokenService) {}

  async upload(tenantId: string, params: { fileName: string; buffer: Buffer; folder?: string }): Promise<UploadedFileRef> {
    // REQUIRES VERIFICATION: disk.folder.uploadfile ожидает multipart с полем fileContent
    // в формате [fileName, base64] — уточнить на тестовом портале (docs/bitrix24-integration.md §7).
    const { domain, accessToken } = await this.tokens.getValidAccessToken(tenantId);
    const result = await callBitrixMethod<{ ID: string }>(domain, "disk.folder.uploadfile", accessToken, {
      id: params.folder ?? "root",
      fileContent: [params.fileName, params.buffer.toString("base64")],
    });
    return { fileProvider: "BITRIX_DISK", externalFileId: String(result.ID), fileName: params.fileName };
  }

  /**
   * REQUIRES BITRIX24 TEST PORTAL VERIFICATION — не реализовано намеренно.
   * По документации `disk.file.get` возвращает `DOWNLOAD_URL` с
   * ограниченным сроком жизни; правильную стратегию (проксировать байты
   * через backend vs отдавать frontend временную ссылку напрямую) нужно
   * выбирать по факту поведения реального портала, не вслепую. Явно
   * бросаем ошибку вместо того, чтобы притвориться рабочей реализацией —
   * это отдельный непроверенный этап, отделённый от demo-хранилища
   * (MockFileStorageProvider), которое реально работает уже сейчас.
   */
  async download(_tenantId: string, _externalFileId: string): Promise<DownloadedFile | null> {
    throw new Error(
      "RealFileStorageProvider.download() не реализован — REQUIRES BITRIX24 TEST PORTAL VERIFICATION (disk.file.get/DOWNLOAD_URL, см. docs/bitrix24-integration.md §7)",
    );
  }
}
