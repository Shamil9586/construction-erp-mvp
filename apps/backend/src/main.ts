import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";

function configuredWebOrigins(): string[] | true {
  const explicit = (process.env.ALLOWED_WEB_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  const frontend = process.env.FRONTEND_URL?.trim();
  if (frontend) {
    try {
      return [new URL(frontend).origin];
    } catch {
      // Invalid FRONTEND_URL is handled by the Bitrix launch endpoint. Keep
      // legacy permissive demo CORS here so the standalone demo still boots.
    }
  }
  return true;
}

/**
 * Bootstrap. The Bitrix portal is an iframe parent, while the React SPA is a
 * separate web origin (Render in TEST). They are intentionally configured by
 * different env variables: ALLOWED_BITRIX_DOMAIN controls frame-ancestors;
 * ALLOWED_WEB_ORIGINS / FRONTEND_URL control browser CORS to the API.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  const webOrigins = configuredWebOrigins();
  app.enableCors({
    origin:
      webOrigins === true
        ? true
        : (origin, callback) => {
            if (!origin || webOrigins.includes(origin)) return callback(null, true);
            return callback(new Error("CORS origin is not allowed"), false);
          },
    credentials: true,
  });

  const bitrixDomain = process.env.ALLOWED_BITRIX_DOMAIN?.trim();
  const frameAncestors = bitrixDomain ? ["'self'", `https://${bitrixDomain}`] : ["'self'"];

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "https://api.bitrix24.com"],
          "frame-ancestors": frameAncestors,
        },
      },
      xFrameOptions: false,
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
