import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
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
 * MockBitrixAdapter (ТЗ п.36) — приложение обязано полностью запускаться на
 * этом адаптере без реального Bitrix24-портала: для разработки, тестов,
 * демонстраций и CI. Реализует все Bitrix-порты через локальные заглушки/лог,
 * с той же сигнатурой, что и RealBitrixAdapter — переключение прозрачно для
 * domain/application слоёв.
 *
 * IMPLEMENTED AND VERIFIED LOCALLY. Реальные вызовы Bitrix REST — см.
 * real-bitrix.adapter.ts и docs/bitrix24-integration.md (REQUIRES BITRIX24
 * TEST PORTAL VERIFICATION).
 */
@Injectable()
export class MockBitrixUserProvider implements BitrixUserProvider {
  private readonly logger = new Logger("MockBitrixUserProvider");

  private readonly fixture: BitrixUser[] = [
    { bitrixUserId: 1, name: "Соколов Игорь Петрович", email: "sokolov@stroygeneral.test", position: "Генеральный директор", isActive: true },
    { bitrixUserId: 10, name: "Ким Роман Сергеевич", email: "kim@stroygeneral.test", position: "Руководитель проекта", isActive: true },
    { bitrixUserId: 20, name: "Орлова Татьяна Ивановна", email: "orlova@stroygeneral.test", position: "Инженер СК", isActive: true },
  ];

  async getUsers(tenantId: string): Promise<BitrixUser[]> {
    this.logger.debug(`[MOCK] user.get для tenant ${tenantId}`);
    return this.fixture;
  }

  async getUser(tenantId: string, bitrixUserId: number): Promise<BitrixUser | null> {
    return this.fixture.find((u) => u.bitrixUserId === bitrixUserId) ?? null;
  }
}

@Injectable()
export class MockOrganizationProvider implements OrganizationProvider {
  async getDepartments(_tenantId: string): Promise<BitrixDepartment[]> {
    return [
      { id: "1", name: "Дирекция" },
      { id: "2", name: "Производственный отдел", parentId: "1" },
      { id: "3", name: "Строительный контроль", parentId: "1" },
      { id: "4", name: "ПТО", parentId: "1" },
      { id: "5", name: "СДО", parentId: "1" },
    ];
  }
}

@Injectable()
export class MockNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger("MockNotificationProvider");

  async notify(tenantId: string, bitrixUserId: number, message: string): Promise<void> {
    this.logger.log(`[MOCK im.notify.system.add] tenant=${tenantId} to=${bitrixUserId}: ${message}`);
  }
}

@Injectable()
export class MockTaskProvider implements TaskProvider {
  private readonly logger = new Logger("MockTaskProvider");

  async createTask(
    tenantId: string,
    params: { title: string; description: string; responsibleBitrixUserId: number },
  ): Promise<{ taskId: string }> {
    const taskId = `mock-task-${randomUUID()}`;
    this.logger.log(`[MOCK tasks.task.add] tenant=${tenantId} -> ${params.responsibleBitrixUserId}: "${params.title}" (${taskId})`);
    return { taskId };
  }
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};

/**
 * Один сегмент безопасного внутреннего пути (tenantId или сгенерированное
 * имя файла). Разрешены только `[a-zA-Z0-9._-]`, без ведущей точки и без
 * `..` — используется и на upload (для tenantId), и на download (для
 * externalFileId, который целиком приходит из БД/запроса и в общем случае
 * недоверенный ввод). НИКОГДА не используется пользовательский `fileName`
 * напрямую — только эта санитизированная форма.
 */
function safeSegment(raw: string): string | null {
  if (!raw || raw === "." || raw === ".." || raw.startsWith(".")) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(raw)) return null;
  if (raw.includes("..")) return null;
  return raw;
}

/** Безопасное расширение из пользовательского fileName — белый список символов, короткая длина, дефолт при отсутствии/подозрительном значении. */
function safeExtension(fileName: string): string {
  const ext = path.extname(fileName || "").toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".bin";
}

/**
 * MockFileStorageProvider (integrity-fix pass) — реальное локальное
 * demo-хранилище на диске, а не просто генератор фиктивного ID.
 *
 * ХАРДЕНИНГ-ФИКС: раньше `upload()` отбрасывал переданный Buffer и только
 * генерировал `mock-file-*` — это не было фотофиксацией, сохранялись
 * только метаданные (InspectionPhoto.fileName в PostgreSQL), а самого
 * файла нигде не существовало. Теперь байты реально пишутся на диск в
 * каталог `LOCAL_FILE_STORAGE_PATH` (env, по умолчанию
 * `<cwd>/storage/local-uploads`), под tenant-скоупированным подкаталогом.
 *
 * Внутреннее имя файла — `randomUUID() + безопасное расширение`,
 * пользовательский `fileName` НИКОГДА не используется как часть пути
 * (только как metadata для Content-Disposition при отдаче) — иначе
 * `fileName` вида `../../etc/passwd` или с null-байтом стал бы path
 * traversal. `download()` дополнительно проверяет, что итоговый
 * резолвленный путь не вышел за пределы корня хранилища.
 *
 * Это НЕ production file storage — явно demo/локальное хранилище для
 * среды без реального Bitrix24-портала. Реальная загрузка в
 * Bitrix24.Disk — отдельный непроверенный этап (RealFileStorageProvider,
 * REQUIRES BITRIX24 TEST PORTAL VERIFICATION).
 */
@Injectable()
export class MockFileStorageProvider implements FileStorageProvider {
  private readonly logger = new Logger("MockFileStorageProvider");
  private readonly root = process.env.LOCAL_FILE_STORAGE_PATH || path.join(process.cwd(), "storage", "local-uploads");

  private tenantDir(tenantId: string): string {
    const safeTenant = safeSegment(tenantId);
    // tenantId в реальности всегда приходит из нашей же БД/guard'а (UUID),
    // но проверяем defensively — то же правило, что и для fileName.
    if (!safeTenant) throw new Error(`Некорректный tenantId для файлового хранилища: "${tenantId}"`);
    return path.join(this.root, safeTenant);
  }

  async upload(tenantId: string, params: { fileName: string; buffer: Buffer; folder?: string }): Promise<UploadedFileRef> {
    const dir = this.tenantDir(tenantId);
    await fs.mkdir(dir, { recursive: true });
    const internalName = `${randomUUID()}${safeExtension(params.fileName)}`;
    const fullPath = path.join(dir, internalName);
    await fs.writeFile(fullPath, params.buffer);
    this.logger.log(
      `[MOCK disk.folder.uploadfile — реально сохранено локально] tenant=${tenantId} folder=${params.folder ?? "/"} file="${params.fileName}" (${params.buffer.length} bytes) -> ${internalName} (${fullPath})`,
    );
    return { fileProvider: "LOCAL", externalFileId: internalName, fileName: params.fileName };
  }

  async download(tenantId: string, externalFileId: string): Promise<DownloadedFile | null> {
    const dir = this.tenantDir(tenantId);
    const safeFile = safeSegment(externalFileId);
    if (!safeFile) return null;
    const fullPath = path.join(dir, safeFile);
    // Defense-in-depth: убеждаемся, что резолвленный путь не вышел за
    // пределы корня хранилища тенанта (safeSegment уже должен был это
    // гарантировать, но path.resolve — независимая вторая проверка).
    if (!path.resolve(fullPath).startsWith(path.resolve(dir) + path.sep)) return null;
    try {
      const buffer = await fs.readFile(fullPath);
      const contentType = CONTENT_TYPE_BY_EXT[path.extname(safeFile)] ?? "application/octet-stream";
      return { buffer, contentType };
    } catch {
      return null; // файла нет — не ошибка, а ожидаемый результат отсутствия
    }
  }
}
