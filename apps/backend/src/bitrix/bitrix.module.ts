import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { BitrixInstallController } from "./install.controller";
import { BitrixTokenService } from "./bitrix-token.service";
import { BitrixGatewayService } from "./bitrix-gateway.service";
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

@Module({
  controllers: [BitrixInstallController],
  providers: [
    BitrixTokenService,
    BitrixGatewayService,
    MockBitrixUserProvider,
    MockOrganizationProvider,
    MockNotificationProvider,
    MockTaskProvider,
    MockFileStorageProvider,
    RealBitrixUserProvider,
    RealOrganizationProvider,
    RealNotificationProvider,
    RealTaskProvider,
    RealFileStorageProvider,
  ],
  exports: [BitrixGatewayService],
})
export class BitrixModule {}
