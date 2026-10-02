import crypto from "node:crypto";

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9à-ÿ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value = "") {
  return new Set(normalizeText(value).split(" ").filter(x => x.length > 2));
}

export function textSimilarity(a = "", b = "") {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection += 1;
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

export function evaluateRepetition(current = {}, recent = []) {
  const currentText = [current.title, current.reason, current.category].filter(Boolean).join(" ");
  let highest = 0;
  let matched = null;

  for (const item of recent || []) {
    const otherText = [item.title, item.reason, item.category].filter(Boolean).join(" ");
    const similarity = textSimilarity(currentText, otherText);
    if (similarity > highest) {
      highest = similarity;
      matched = item;
    }
  }

  const threshold = Number(process.env.CONTENT_REPETITION_MAX_SIMILARITY || 0.82);
  const materiallyChanged =
    current.priceChanged === true ||
    current.newVerifiedPrice === true ||
    current.promotionChanged === true ||
    current.availabilityChanged === true ||
    current.editorialUpdate === true;

  return {
    passed:highest < threshold || materiallyChanged,
    similarity:Number(highest.toFixed(3)),
    threshold,
    materiallyChanged,
    matchedDealId:matched?.dealId || null,
    reason:highest < threshold
      ? "sufficiently_distinct"
      : materiallyChanged
        ? "material_change_override"
        : "too_similar_to_recent_content"
  };
}

export function authorizedTrafficSources() {
  const raw = String(process.env.AMAZON_ASSOCIATES_APPROVED_CHANNELS || "");
  return raw.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

export function evaluateTrafficSource(channel = "telegram") {
  const normalized = String(channel || "").trim().toLowerCase();
  const allowed = authorizedTrafficSources();
  const configured = allowed.length > 0;
  const authorized = configured && allowed.includes(normalized);
  const mode = String(process.env.AMAZON_CHANNEL_COMPLIANCE_MODE || "warn").toLowerCase();

  return {
    channel:normalized,
    configured,
    authorized,
    mode,
    passed:authorized || mode !== "strict",
    status:authorized ? "AUTHORIZED" : configured ? "NOT_AUTHORIZED" : "UNVERIFIED"
  };
}

export function policyState() {
  const version = process.env.AMAZON_POLICY_VERSION || "2026-04-14";
  const lastVerified = process.env.AMAZON_POLICY_LAST_VERIFIED || null;
  const reviewDays = Math.max(1, Number(process.env.AMAZON_POLICY_REVIEW_DAYS || 30));
  const lastTs = lastVerified ? Date.parse(lastVerified) : null;
  const ageDays = Number.isFinite(lastTs) ? (Date.now() - lastTs) / 86400000 : null;

  return {
    version,
    lastVerified,
    reviewDays,
    status:ageDays == null ? "POLICY_REVIEW_DUE" : ageDays > reviewDays ? "POLICY_REVIEW_DUE" : "POLICY_CURRENT"
  };
}

export function evidenceRecord(body = {}, extra = {}) {
  const raw = JSON.stringify({
    title:body.title || null,
    reason:body.reason || null,
    amazonUrl:body.amazonUrl || null,
    asin:body.asin || null,
    category:body.category || null,
    dealType:body.dealType || null,
    source:body.source || null,
    priceSource:body.priceSource || body.amazonDataSource || null,
    rewardProgram:body.rewardProgram || null
  });

  return {
    evidenceId:crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24),
    createdAt:new Date().toISOString(),
    channel:extra.channel || "telegram",
    storeId:process.env.AMAZON_PARTNER_TAG || null,
    source:body.source || null,
    sourceUrl:body.sourceUrl || null,
    title:body.title || null,
    reason:body.reason || null,
    amazonUrl:body.amazonUrl || null,
    asin:body.asin || null,
    category:body.category || null,
    dealType:body.dealType || null,
    priceSource:body.priceSource || body.amazonDataSource || null,
    publicationCompliance:extra.publicationCompliance || null,
    repetition:extra.repetition || null,
    trafficSource:extra.trafficSource || null,
    policy:policyState(),
    telegramMessageId:extra.telegramMessageId || null
  };
}
