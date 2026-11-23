import postgres from "postgres";

let sqlClient;

export function db() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("DATABASE_URL is not configured");
    error.code = "FANTAOS_DB_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: "require"
    });
  }

  return sqlClient;
}

export async function dbHealth() {
  try {
    const sql = db();
    const rows = await sql`select 1 as ok`;
    return { ok: rows?.[0]?.ok === 1, error: null };
  } catch (error) {
    return { ok: false, error: error.code || error.message };
  }
}
