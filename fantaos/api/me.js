import { identityFromRequest } from "../lib/auth.js";
import { buildRequestContext, requireIdentity } from "../lib/request-context.js";
import { db } from "../lib/db.js";
import { sendError, methodNotAllowed } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const identity = identityFromRequest(req);
    const context = requireIdentity(buildRequestContext(req, identity));
    const sql = db();

    const rows = await sql`
      select id, tenant_id, email, display_name, plan, created_at, updated_at
      from users
      where id = ${context.userId}
        and tenant_id = ${context.tenantId}
      limit 1
    `;

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    return res.status(200).json({ ok: true, user: rows[0], requestId: context.requestId });
  } catch (error) {
    return sendError(res, error);
  }
}
