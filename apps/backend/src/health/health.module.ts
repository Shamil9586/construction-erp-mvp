import { Module, Controller, Get } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";

/**
 * GET /health, GET /ready (ТЗ п.57). /health — процесс жив. /ready — процесс
 * готов принимать трафик (успешный SELECT 1 к PostgreSQL).
 */
@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get("health")
  health() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ready" };
    } catch (e: any) {
      return { status: "not_ready", error: e.message };
    }
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
