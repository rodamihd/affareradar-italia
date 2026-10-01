export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const secret = process.env.PUBLISH_SECRET;
  const auth = req.headers["x-affareradar-secret"];
  if (!secret || auth !== secret) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const body = req.body || {};
  const dealScore = Number(body.dealScore);
  const reliabilityScore = Number(body.reliabilityScore);
  const dealType = String(body.dealType || "").toLowerCase();
  const stock = body.stock;

  const minDealScore = Number(process.env.AUTO_PUBLISH_MIN_DEAL_SCORE || 90);
  const minReliability = Number(process.env.AUTO_PUBLISH_MIN_RELIABILITY || 85);

  const scorePass = Number.isFinite(dealScore) && dealScore >= minDealScore;
  const specialType = dealType === "price_error" || dealType === "coupon_stack";
  const reliabilityPass =
    specialType &&
    Number.isFinite(reliabilityScore) &&
    reliabilityScore >= minReliability;

  const outOfStock = stock === false || String(stock).toLowerCase() === "out_of_stock";

  if (outOfStock) {
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"out_of_stock"
    });
  }

  if (!scorePass && !reliabilityPass) {
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"below_threshold",
      thresholds:{
        minDealScore,
        minReliability
      },
      received:{
        dealScore:Number.isFinite(dealScore) ? dealScore : null,
        reliabilityScore:Number.isFinite(reliabilityScore) ? reliabilityScore : null,
        dealType:dealType || null
      }
    });
  }

  const host = req.headers.host;
  if (!host) {
    return res.status(500).json({ ok:false, error:"host_missing" });
  }

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const target = `${protocol}://${host}/api/telegram`;

  const publishResponse = await fetch(target, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":secret
    },
    body:JSON.stringify(body)
  });

  const publishData = await publishResponse.json().catch(() => ({}));

  if (!publishResponse.ok || !publishData.ok) {
    return res.status(502).json({
      ok:false,
      published:false,
      error:"telegram_publish_failed",
      telegram:publishData
    });
  }

  return res.status(200).json({
    ok:true,
    published:true,
    decision:scorePass ? "deal_score_threshold" : "high_reliability_special",
    telegram_message_id:publishData.telegram_message_id,
    badge:publishData.badge,
    thresholds:{
      minDealScore,
      minReliability
    }
  });
}
