import { createSessionToken } from "../lib/auth.js";
import { runtimeEnvironment } from "../lib/env.js";
import { methodNotAllowed, sendError } from "../lib/http.js";

export default function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    if (runtimeEnvironment() === "production") {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!body.userId || !body.tenantId) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_DEV_IDENTITY",
        required: ["userId", "tenantId"]
      });
    }

    const token = createSessionToken({
      userId: String(body.userId),
      tenantId: String(body.tenantId),
      email: body.email ? String(body.email) : null
    }, { ttlSeconds: 3600 });

    return res.status(200).json({ ok: true, token, expiresIn: 3600 });
  } catch (error) {
    return sendError(res, error);
  }
}
