// Explicit, read-only readiness probe for a STAGING PostgreSQL connection.
// The server supplies a trusted pg-compatible db client; no secrets are read here.
export async function checkAgentosStagingDb({db,expectedDatabase}={}) {
  if (!db || typeof db.query!=="function" || typeof expectedDatabase!=="string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(expectedDatabase)) return {ready:false,reason:"invalid_configuration"};
  try {
    const identity=await db.query("select current_database() as database_name, current_user as role_name");
    const row=identity?.rows?.[0];
    if (identity?.rows?.length!==1 || row?.database_name!==expectedDatabase ||
        typeof row.role_name!=="string" || !row.role_name) return {ready:false,reason:"database_identity_mismatch"};
    const rights=await db.query(
      "select has_schema_privilege(current_user,'agentos_private','USAGE') as schema_usage, "+
      "has_table_privilege(current_user,'agentos_private.reviewer_grants','SELECT') as can_read, "+
      "has_table_privilege(current_user,'agentos_private.reviewer_grants','INSERT,UPDATE,DELETE') as can_mutate");
    const access=rights?.rows?.[0];
    if (rights?.rows?.length!==1 || access?.schema_usage!==true || access?.can_read!==true || access?.can_mutate!==false)
      return {ready:false,reason:"privilege_gate_failed"};
    return {ready:true,reason:"read_only_role_verified"};
  } catch { return {ready:false,reason:"database_unreachable_or_denied"}; }
}
