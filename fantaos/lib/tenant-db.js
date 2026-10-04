import { db } from "./db.js";

export async function withTenant(context, fn) {
  if (!context?.tenantId) {
    const error = new Error("Tenant scope required");
    error.code = "FANTAOS_TENANT_REQUIRED";
    error.status = 400;
    throw error;
  }

  const sql = db();
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${context.tenantId}, true)`;
    return fn(tx);
  });
}
