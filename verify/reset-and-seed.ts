import path from "node:path";
import { resetSchema } from "./db";
import { seed } from "./seed";

resetSchema(path.join(__dirname, "schema.sql"));
const ids = seed();
console.log(JSON.stringify({ tenantId: ids.tenantId }, null, 2));
