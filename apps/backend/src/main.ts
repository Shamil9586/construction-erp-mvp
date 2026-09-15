import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";

/**
 * Bootstrap. CORS/CSP настроены под встраиваемый (iframe) контекст Bitrix24:
 * frame-ancestors ограничен доменом портала (см. ALLOWED_BITRIX_DOMAIN в .env),
 * cookies — SameSite=None; Secure за HTTPS-реверс-прокси (см. infra/).
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  const allowedOrigin = process.env.ALLOWED_BITRIX_DOMAIN
    ? `https://${process.env.ALLOWED_BITRIX_DOMAIN}`
    : true;

  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "frame-ancestors": process.env.ALLOWED_BITRIX_DOMAIN
            ? [`https://${process.env.ALLOWED_BITRIX_DOMAIN}`]
            : ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new AuditInterceptor());

  app.setGlobalPrefix("api", { exclude: ["health", "ready"] });

  const config = new DocumentBuilder()
    .setTitle("Construction ERP API")
    .setDescription("Производственное ядро строительной компании — встроено в Bitrix24")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Construction ERP backend listening on :${port} (Swagger: /api/docs)`);
}

bootstrap();
