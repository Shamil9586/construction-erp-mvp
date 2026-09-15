import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";

import { PrismaModule } from "./common/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./health/health.module";
import { BitrixModule } from "./bitrix/bitrix.module";
import { AuditModule } from "./modules/audit/audit.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UsersModule } from "./modules/users/users.module";
import { ObjectsModule } from "./modules/objects/objects.module";
import { ContractorsModule } from "./modules/contractors/contractors.module";
import { WorksModule } from "./modules/works/works.module";
import { InspectionsModule } from "./modules/inspections/inspections.module";
import { PtoModule } from "./modules/pto/pto.module";
import { MaterialsModule } from "./modules/materials/materials.module";
import { SdoModule } from "./modules/sdo/sdo.module";
import { FinancialModule } from "./modules/financial/financial.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DictionariesModule } from "./modules/dictionaries/dictionaries.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]), // ТЗ п.49: rate limiting
    PrismaModule, // @Global() — единственный PrismaService на процесс (см. common/prisma.module.ts)
    AuthModule,   // @Global() — единственная регистрация BitrixAuthGuard/PermissionsGuard (см. modules/auth/auth.module.ts)
    HealthModule,
    BitrixModule,
    AuditModule,
    NotificationsModule,
    UsersModule,
    ObjectsModule,
    ContractorsModule,
    WorksModule,
    InspectionsModule,
    PtoModule,
    MaterialsModule,
    SdoModule,
    FinancialModule,
    DashboardModule,
    DictionariesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
