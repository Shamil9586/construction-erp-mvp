/**
 * verify/db.ts — минимальный psql-based клиент PostgreSQL без npm-зависимостей.
 *
 * В этой песочнице нет доступа к npm registry, поэтому нельзя установить `pg`.
 * Реальный backend (apps/backend) использует Prisma Client как обычно —
 * см. docs/deployment.md. Здесь мы говорим с тем же самым настоящим
 * PostgreSQL 16 через CLI `psql`, чтобы по-настоящему выполнить и проверить
 * бизнес-логику, а не просто описать её.
 */
import { execFileSync } from "node:child_process";

const PSQL_BIN = process.env.PSQL_BIN || "psql";
const PGHOST = process.env.PGHOST || "127.0.0.1";
const PGPORT = process.env.PGPORT || "5432";
const PGUSER = process.env.PGUSER || "claude";
const PGDATABASE = process.env.PGDATABASE || "construction_erp";

function psqlArgs(): string[] {
  return ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-v", "ON_ERROR_STOP=1"];
}

/** Экранирование строкового литерала для встраивания в SQL (контролируемые данные seed/E2E, не пользовательский ввод). */
export function lit(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "NULL";
  return String(value);
}

export function dateLit(value: Date | string | null | undefined): string {
  if (!value) return "NULL";
  const iso = typeof value === "string" ? value : value.toISOString().slice(0, 10);
  return `'${iso}'`;
}

/** Выполняет произвольный SQL (DDL/INSERT/UPDATE), выводит ошибку в исключение при сбое. */
export function exec(sql: string): void {
  execFileSync(PSQL_BIN, [...psqlArgs(), "-q", "-c", sql], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

/** Выполняет SELECT и возвращает результат как массив JS-объектов (через json_agg). */
export function queryJson<T = any>(selectSql: string): T[] {
  const wrapped = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${selectSql}) t;`;
  const out = execFileSync(PSQL_BIN, [...psqlArgs(), "-t", "-A", "-c", wrapped], {
    encoding: "utf8",
  });
  const trimmed = out.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

export function queryOne<T = any>(selectSql: string): T | null {
  const rows = queryJson<T>(selectSql);
  return rows[0] ?? null;
}

/**
 * Выполняет INSERT/UPDATE ... RETURNING <col> и возвращает значение первой
 * колонки первой строки как строку (обычно UUID). INSERT/UPDATE нельзя
 * обернуть в `SELECT ... FROM (...)`, поэтому это отдельная функция.
 */
export function returningId(sql: string, column = "id"): string {
  const out = execFileSync(PSQL_BIN, [...psqlArgs(), "-t", "-A", "-c", sql], { encoding: "utf8" });
  const first = out.trim().split("\n")[0]?.trim();
  if (!first) throw new Error(`returningId: пустой результат для запроса: ${sql.slice(0, 120)}...`);
  return first;
}

export function resetSchema(schemaSqlPath: string): void {
  exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  execFileSync(PSQL_BIN, [...psqlArgs(), "-q", "-f", schemaSqlPath], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}
