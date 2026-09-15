import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
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
} from "./adapters/interfaces";
import {
  MockBitrixUserProvider,
  MockFileStorageProvider,
  MockNotificationProvider,
  MockOrganizationProvider,
  MockTaskProvider,
} from "./adapters/mock-bitrix.adapter";
import {
  RealBitrixUserProvider,
  RealFileStorageProvider,
  RealNotificationProvider,
  RealOrganizationProvider,
  RealTaskProvider,
} from "./adapters/real-bitrix.adapter";

/**
 * BitrixGatewayService — единая точка входа в Bitrix-порты для business-модулей.
 * На каждый вызов проверяет, есть ли у tenant активная установка Bitrix24
 * (BitrixInstallation.status = ACTIVE); если да — делегирует в RealBitrixAdapter,
 * если нет — в MockBitrixAdapter. Domain/application слои НЕ знают об этом
 * переключении и никогда не импортируют Bitrix REST напрямую (ТЗ п.36).
 */
@Injectable()
export class BitrixGatewayService implements BitrixUserProvider, OrganizationProvider, NotificationProvider, TaskProvider, FileStorageProvider {
  private readonly logger = new Logger("BitrixGatewayService");

  constructor(
    private prisma: PrismaService,
    private mockUsers: MockBitrixUserProvider,
    private mockOrg: MockOrganizationProvider,
    private mockNotify: MockNotificationProvider,
    private mockTasks: MockTaskProvider,
    private mockFiles: MockFileStorageProvider,
    private realUsers: RealBitrixUserProvider,
    private realOrg: RealOrganizationProvider,
    private realNotify: RealNotificationProvider,
    private realTasks: RealTaskProvider,
    private realFiles: RealFileStorageProvider,
  ) {}

  private async isReal(tenantId: string): Promise<boolean> {
    const count = await this.prisma.bitrixInstallation.count({ where: { tenantId, status: "ACTIVE" } });
    return count > 0;
  }

  async getUsers(tenantId: string): Promise<BitrixUser[]> {
    return (await this.isReal(tenantId)) ? this.realUsers.getUsers(tenantId) : this.mockUsers.getUsers(tenantId);
  }

  async getUser(tenantId: string, bitrixUserId: number): Promise<BitrixUser | null> {
    return (await this.isReal(tenantId)) ? this.realUsers.getUser(tenantId, bitrixUserId) : this.mockUsers.getUser(tenantId, bitrixUserId);
  }

  async getDepartments(tenantId: string): Promise<BitrixDepartment[]> {
    return (await this.isReal(tenantId)) ? this.realOrg.getDepartments(tenantId) : this.mockOrg.getDepartments(tenantId);
  }

  async notify(tenantId: string, bitrixUserId: number, message: string): Promise<void> {
    return (await this.isReal(tenantId)) ? this.realNotify.notify(tenantId, bitrixUserId, message) : this.mockNotify.notify(tenantId, bitrixUserId, message);
  }

  async createTask(tenantId: string, params: { title: string; description: string; responsibleBitrixUserId: number }): Promise<{ taskId: string }> {
    return (await this.isReal(tenantId)) ? this.realTasks.createTask(tenantId, params) : this.mockTasks.createTask(tenantId, params);
  }

  async upload(tenantId: string, params: { fileName: string; buffer: Buffer; folder?: string }): Promise<UploadedFileRef> {
    return (await this.isReal(tenantId)) ? this.realFiles.upload(tenantId, params) : this.mockFiles.upload(tenantId, params);
  }

  async download(tenantId: string, externalFileId: string): Promise<DownloadedFile | null> {
    return (await this.isReal(tenantId)) ? this.realFiles.download(tenantId, externalFileId) : this.mockFiles.download(tenantId, externalFileId);
  }
}
