import { evaluateStorefrontCandidate, storefrontContent, rankFeatured } from "../lib/storefront-intelligence.js";

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
  const items = Array.isArray(body.items) ? body.items : [body];

  const evaluated = items
    .filter(x => x && x.title)
    .map(item => {
      const decision = evaluateStorefrontCandidate(item, item.signals || {});
      return { body:item, decision, content:storefrontContent(item, decision) };
    });

  return res.status(200).json({
    ok:true,
    evaluated,
    featured:rankFeatured(evaluated, 8)
  });
}
