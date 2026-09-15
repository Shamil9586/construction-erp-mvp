# syntax=docker/dockerfile:1
# Multi-stage build для NestJS backend (ТЗ §59 — тестовое развёртывание).
# ПРИМЕЧАНИЕ: docker build НЕ выполнялся в песочнице разработки — здесь нет
# демона Docker (только CLI-бинарь без /var/run/docker.sock), и отдельно нет
# доступа к registry.npmjs.org. Dockerfile написан по стандартному паттерну
# NestJS + Prisma и должен быть готов к сборке в среде с интернетом и
# Docker-демоном — REQUIRES CI/CD VERIFICATION.
#
# ВАЖНО: `npm ci` ниже требует существующего package-lock.json. В этом
# репозитории он пока НЕ закоммичен (см. docs/deployment.md, раздел
# «package-lock.json — честный статус») — его нужно один раз сгенерировать
# через `npm install` в корне в среде с доступом к npm registry и закоммитить,
# иначе этот шаг сборки завершится ошибкой "can only install with an existing
# package-lock.json".

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/domain ./packages/domain
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --workspace=@construction-erp/backend --workspace=@construction-erp/domain --include-workspace-root

COPY apps/backend ./apps/backend
RUN npm run -w @construction-erp/domain build \
 && npm run -w @construction-erp/backend prisma:generate \
 && npm run -w @construction-erp/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ХАРДЕНИНГ-ФИКС (эта итерация): раньше здесь стояла ещё одна строка —
# `COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules`.
# Это в принципе не то, что производит `npm ci` для npm workspaces: при
# стандартном workspaces-хостинге (root "workspaces": ["apps/*", "packages/*"])
# npm ставит общие зависимости ОДИН раз в корневой /app/node_modules и
# симлинкает туда же сами workspace-пакеты (/app/node_modules/@construction-erp/backend
# -> ../../apps/backend, /app/node_modules/@construction-erp/domain ->
# ../../packages/domain) — отдельного /app/apps/backend/node_modules при
# отсутствии конфликтов версий между workspaces не возникает вовсе. Эта
# строка почти гарантированно валила бы сборку на самом COPY (source path
# not found), либо (в редком случае конфликта версий, когда npm всё же
# создаёт вложенный node_modules) копировала бы неполный/неверный набор
# зависимостей — в обоих случаях это дефект, а не подстраховка. Node
# резолвит зависимости из /app/apps/backend, поднимаясь вверх по дереву
# каталогов до /app/node_modules (копия ниже) — этого достаточно, ничего
# копировать в apps/backend/node_modules не нужно.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/domain ./packages/domain
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json

WORKDIR /app/apps/backend
EXPOSE 3000

# Применяем миграции, затем стартуем — безопасно для повторного запуска
# (prisma migrate deploy идемпотентна). НЕ выполняет migrate reset и НЕ
# трогает существующие данные (ТЗ: запрет необратимых операций).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
