import { channelPlan } from "../lib/channel-strategy.js";
import { repurposeDeal } from "../lib/content-repurpose.js";

function authorized(req) {
  const secret = process.env.PUBLISH_SECRET;
  return Boolean(secret && req.headers["x-affareradar-secret"] === secret);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const body = req.body || {};
  if (!body.title || !body.amazonUrl) {
    return res.status(400).json({ ok:false, error:"missing_required_fields" });
  }

  const strategy = channelPlan(body);
  const content = repurposeDeal(body, strategy);

  return res.status(200).json({
    ok:true,
    strategy,
    content
  });
}
