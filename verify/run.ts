import path from "node:path";
import { resetSchema } from "./db";
import { seed } from "./seed";
import { runE2E } from "./e2e";

function main() {
  console.log("== 1/3: поднимаем схему PostgreSQL (verify/schema.sql) ==");
  resetSchema(path.join(__dirname, "schema.sql"));

  console.log("\n== 2/3: seed (10 объектов / 8 субподрядчиков / 5 РП / 50+ работ) ==");
  const seedIds = seed();

  console.log("\n== 3/3: E2E-сценарий (ТЗ п.53) ==");
  const { steps } = runE2E(seedIds);

  console.log("\n---------------------------------------------------------------");
  for (const s of steps) {
    console.log(`${s.ok ? "✅" : "❌"} ${s.step}\n   -> ${s.detail}`);
  }
  console.log("---------------------------------------------------------------");
  const failed = steps.filter((s) => !s.ok);
  if (failed.length > 0) {
    console.error(`\nE2E FAILED: ${failed.length} шаг(ов) не пройдено.`);
    process.exit(1);
  }
  console.log(`\nE2E PASSED: все ${steps.length} шагов сценария выполнены и проверены на настоящем PostgreSQL.`);
}

main();
