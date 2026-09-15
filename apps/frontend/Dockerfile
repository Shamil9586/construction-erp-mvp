# syntax=docker/dockerfile:1
# Multi-stage build для React/Vite frontend + nginx как статический сервер
# и реверс-прокси до backend (ТЗ §59). Не собирался в песочнице разработки —
# см. apps/backend/Dockerfile о причине (нет Docker-демона + нет
# package-lock.json, см. docs/deployment.md). REQUIRES CI/CD VERIFICATION.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/domain ./packages/domain
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm ci --workspace=@construction-erp/frontend --workspace=@construction-erp/domain --include-workspace-root

COPY apps/frontend ./apps/frontend
RUN npm run -w @construction-erp/frontend build

FROM nginx:1.27-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
