import { identityFromRequest } from "../lib/auth.js";
import { buildRequestContext, requireIdentity } from "../lib/request-context.js";
import { db } from "../lib/db.js";
import { sendError, methodNotAllowed } from "../lib/http.js";

const VALID_MODES = new Set(["CLASSIC", "MANTRA"]);

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  try {
    const identity = identityFromRequest(req);
    const context = requireIdentity(buildRequestContext(req, identity));
    const sql = db();

    if (req.method === "GET") {
      const rows = await sql`
        select id, tenant_id, owner_user_id, name, platform, mode, season, status, created_at, updated_at
        from leagues
        where tenant_id = ${context.tenantId}
          and owner_user_id = ${context.userId}
        order by created_at desc
      `;

      return res.status(200).json({ ok: true, leagues: rows, requestId: context.requestId });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const mode = typeof body.mode === "string" ? body.mode.toUpperCase() : "";
    const season = typeof body.season === "string" ? body.season.trim() : "";
    const platform = typeof body.platform === "string" && body.platform.trim()
      ? body.platform.trim().toLowerCase()
      : "manual";

    if (!name || !season || !VALID_MODES.has(mode)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_LEAGUE_INPUT",
        required: ["name", "season", "mode=CLASSIC|MANTRA"]
      });
    }

    const rows = await sql.begin(async (tx) => {
      const inserted = await tx`
        insert into leagues (tenant_id, owner_user_id, name, platform, mode, season)
        values (${context.tenantId}, ${context.userId}, ${name}, ${platform}, ${mode}, ${season})
        returning id, tenant_id, owner_user_id, name, platform, mode, season, status, created_at, updated_at
      `;

      await tx`
        insert into league_members (tenant_id, league_id, user_id, role)
        values (${context.tenantId}, ${inserted[0].id}, ${context.userId}, 'OWNER')
      `;

      return inserted;
    });

    return res.status(201).json({ ok: true, league: rows[0], requestId: context.requestId });
  } catch (error) {
    return sendError(res, error);
  }
}
