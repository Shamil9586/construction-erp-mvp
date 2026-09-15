import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * PrismaService — единственная точка доступа к PostgreSQL. Инфраструктурный
 * слой (см. docs/architecture.md): domain-логика (packages/domain) ничего
 * не знает о Prisma и вызывается сервисами модулей ПОСЛЕ чтения данных отсюда.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
