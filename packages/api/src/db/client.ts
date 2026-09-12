import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// int8 → number (ids are bigserial; we will not exceed 2^53 rows), timestamptz → ISO string.
// Applies to raw db.execute() results too, which is where the API reads from.
pg.types.setTypeParser(20, (v) => Number(v));
// int8[] (e.g. array_agg over ids) → number[]; reuse the int4[] parser, which yields numbers.
type Oid = Parameters<typeof pg.types.setTypeParser>[0];
const INT8_ARRAY = 1016 as Oid;
const INT4_ARRAY = 1007 as Oid;
pg.types.setTypeParser(INT8_ARRAY, (v) => pg.types.getTypeParser(INT4_ARRAY, "text")(v) as number[]);
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());

export const pool = new pg.Pool({ connectionString: url, max: 10 });
export const db = drizzle(pool, { schema });
export { schema };
