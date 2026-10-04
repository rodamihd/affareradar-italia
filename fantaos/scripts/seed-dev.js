import { db } from "../lib/db.js";

const email = process.env.FANTAOS_SEED_EMAIL || "dev@fantaos.local";
const tenantName = process.env.FANTAOS_SEED_TENANT || "FantaOS Dev";

const sql = db();

const result = await sql.begin(async (tx) => {
  const tenantRows = await tx`
    insert into tenants (name)
    values (${tenantName})
    returning id, name
  `;

  const userRows = await tx`
    insert into users (tenant_id, email, display_name, plan)
    values (${tenantRows[0].id}, ${email}, 'FantaOS Dev', 'PRO_MULTI')
    returning id, tenant_id, email, display_name, plan
  `;

  return { tenant: tenantRows[0], user: userRows[0] };
});

console.log(JSON.stringify(result, null, 2));
await sql.end();
