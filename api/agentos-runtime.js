import { runtimeDescriptor, executeExternalOperation } from "../lib/agentos-external-runtime.js";

function authorized(req) {
  const secret = process.env.AGENTOS_EXTERNAL_SECRET || process.env.PUBLISH_SECRET;
  if (!secret) return true;
  return req.headers["x-agentos-secret"] === secret ||
    req.headers["x-affareradar-secret"] === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  if (req.method === "GET") {
    return res.status(200).json(runtimeDescriptor());
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const result = await executeExternalOperation(req.body || {});
  return res.status(result.status || 200).json(result);
}
