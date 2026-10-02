const ORDER = [
  "CAPTURED",
  "PARSED",
  "VERIFIED",
  "READY",
  "PUBLISHED",
  "STALE",
  "EXPIRED",
  "ARCHIVED"
];

const TERMINAL = new Set(["EXPIRED","ARCHIVED","BLOCKED"]);

export function normalizeLifecycleState(value = "") {
  const state = String(value || "").trim().toUpperCase();
  return ORDER.includes(state) || state === "BLOCKED" ? state : "CAPTURED";
}

export function nextOfferState(current, event) {
  const state = normalizeLifecycleState(current);
  const e = String(event || "").trim().toUpperCase();

  if (TERMINAL.has(state)) return state;
  if (e === "PARSED") return "PARSED";
  if (e === "VERIFIED") return "VERIFIED";
  if (e === "READY") return "READY";
  if (e === "PUBLISHED") return "PUBLISHED";
  if (e === "STALE") return "STALE";
  if (e === "EXPIRED") return "EXPIRED";
  if (e === "BLOCKED") return "BLOCKED";
  if (e === "ARCHIVED") return "ARCHIVED";
  return state;
}

export function buildOfferLifecycle(body = {}, previous = {}, now = Date.now()) {
  const published = Boolean(previous.lastPublishedAt || body.telegramMessageId);
  const validUntilRaw = body.promotionValidUntil || body.rewardValidUntil || previous.validUntil || null;
  const validUntil = validUntilRaw ? Date.parse(validUntilRaw) : null;
  const expired = Number.isFinite(validUntil) && validUntil < now;
  const verifiedAtRaw = body.lastVerifiedAt || body.verifiedAt || previous.lastVerifiedAt || null;
  const verifiedAt = verifiedAtRaw ? Date.parse(verifiedAtRaw) : null;
  const staleAfterMinutes = Math.max(1, Number(process.env.OFFER_STALE_AFTER_MINUTES || 30));
  const stale = Number.isFinite(verifiedAt) && (now - verifiedAt) > staleAfterMinutes * 60000;

  let status = normalizeLifecycleState(previous.status || "CAPTURED");
  if (expired) status = "EXPIRED";
  else if (published && stale) status = "STALE";
  else if (published) status = "PUBLISHED";
  else if (body.priceVerifiedByAmazon === true || body.rewardTermsVerified === true) status = "VERIFIED";
  else status = nextOfferState(status, "PARSED");

  return {
    ...previous,
    status,
    firstSeenAt:previous.firstSeenAt || new Date(now).toISOString(),
    lastCheckedAt:new Date(now).toISOString(),
    lastVerifiedAt:Number.isFinite(verifiedAt) ? new Date(verifiedAt).toISOString() : previous.lastVerifiedAt || null,
    lastPublishedAt:previous.lastPublishedAt || null,
    telegramMessageId:body.telegramMessageId || previous.telegramMessageId || null,
    validUntil:Number.isFinite(validUntil) ? new Date(validUntil).toISOString() : null,
    staleAfterMinutes,
    expired,
    stale
  };
}

export function lifecycleExpiryTimestamp(body = {}) {
  const raw = body.promotionValidUntil || body.rewardValidUntil || null;
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}
