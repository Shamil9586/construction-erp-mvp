import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, tap } from "rxjs";

/**
 * Структурированное логирование запросов + request id (ТЗ п.57).
 * НЕ логирует OAuth-токены, секреты или тела запросов с документами —
 * только метод/путь/статус/длительность/requestId/userId.
 *
 * Бизнес-аудит сущностей (ТЗ п.35: изменение объёмов, сроков, статусов,
 * решений СК и т.д.) — это ОТДЕЛЬНЫЙ, осознанный вызов AuditService внутри
 * конкретных сервисов модулей (см. modules/audit/audit.service.ts), а не
 * автоматический перехват всех HTTP-запросов.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const requestId = randomUUID();
    request.requestId = requestId;
    const start = Date.now();
    const { method, url } = request;
    const userId = request.user?.id ?? "anonymous";

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(`${requestId} ${method} ${url} user=${userId} ${Date.now() - start}ms`);
        },
        error: (err) => {
          this.logger.error(`${requestId} ${method} ${url} user=${userId} ${Date.now() - start}ms ERROR: ${err.message}`);
        },
      }),
    );
  }
}
