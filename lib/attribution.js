import crypto from "node:crypto";

function secret() {
  return process.env.ATTRIBUTION_SIGNING_SECRET || process.env.PUBLISH_SECRET || "";
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function buildTrackedRedirect(origin, {
  destination,
  channel = "telegram",
  contentType = "deal",
  action = "amazon_click",
  dealId = ""
}) {
  if (!origin || !destination || !secret()) return destination;

  const payload = Buffer.from(JSON.stringify({
    destination,
    channel,
    contentType,
    action,
    dealId,
    createdAt:Date.now()
  }), "utf8").toString("base64url");

  const sig = sign(payload);
  return `${origin.replace(/\/$/, "")}/api/click?p=${encodeURIComponent(payload)}&s=${encodeURIComponent(sig)}`;
}

export function verifyTrackedPayload(payload, signature) {
  if (!payload || !signature || !secret()) return null;

  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.destination) return null;
    return data;
  } catch {
    return null;
  }
}
