export const AGENTOS_PROFILE_VERSION = "17.5";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value) {
  return String(value || "").trim();
}

export function resolveSignalIntent(body = {}) {
  const corpus = [
    body.title,
    body.reason,
    body.dealType,
    body.rewardProgram,
    body.coupon,
    body.stack
  ].filter(Boolean).join(" ").toLowerCase();

  const signals = [];
  if (body.rewardProgram || /bounty|prova gratuita|reward|prime video channels/.test(corpus)) signals.push("REWARD");
  if (body.coupon || /coupon|codice sconto|stack/.test(corpus)) signals.push("COUPON");
  if (body.dealType === "price_error" || /errore(?: di)? prezzo|price error/.test(corpus)) signals.push("PRICE_ERROR_CANDIDATE");
  if (body.price || body.effectivePrice || /offerta|sconto|deal/.test(corpus)) signals.push("DEAL");

  const unique = [...new Set(signals)];
  let intent = unique[0] || "UNKNOWN";
  if (unique.includes("REWARD")) intent = "REWARD";
  else if (unique.includes("PRICE_ERROR_CANDIDATE")) intent = "PRICE_ERROR_CANDIDATE";
  else if (unique.includes("COUPON")) intent = "COUPON";
  else if (unique.includes("DEAL")) intent = "DEAL";

  const ambiguity = unique.length === 0 ? 1 : unique.length === 1 ? 0.1 : 0.35;
  return {
    version:"17.5",
    intent,
    candidates:unique,
    ambiguity:Number(ambiguity.toFixed(2)),
    requiresClarification:intent === "UNKNOWN" || ambiguity >= 0.8
  };
}

export function mixedModeForTask(taskType = "") {
  const type = text(taskType).toUpperCase();
  const map = {
    CAPTURE_SIGNAL:"FUNCTION",
    VERIFY_OFFER:"FUNCTION",
    RECHECK_OFFER:"FUNCTION",
    EVALUATE_OFFER:"RULE",
    OPTIMIZE_PORTFOLIO:"AUTONOMOUS",
    PUBLISH_OFFER:"HUMAN_OR_AUTONOMOUS",
    LEARN_OUTCOME:"AUTONOMOUS",
    HOLD_OFFER:"RULE",
    RELEASE_OFFER:"HUMAN",
    ARCHIVE_OFFER:"HUMAN"
  };
  return map[type] || "RULE";
}

export function routingPlan(taskType = "", ctx = {}) {
  const type = text(taskType).toUpperCase();
  const creators = ctx.creatorsConfigured === true;
  const paapi = ctx.paApiConfigured === true;

  if (["VERIFY_OFFER","RECHECK_OFFER"].includes(type)) {
    const chain = [];
    if (creators) chain.push("amazon_creators_api");
    if (paapi) chain.push("amazon_pa_api");
    chain.push("manual_amazon_link_tool");
    return { primary:chain[0], fallbacks:chain.slice(1), failClosed:true };
  }

  if (type === "PUBLISH_OFFER") {
    return { primary:"telegram_publisher", fallbacks:["hold_for_retry"], failClosed:true };
  }

  return { primary:"affareradar_domain", fallbacks:[], failClosed:false };
}

export function freshnessSla(body = {}, verification = {}, now = Date.now()) {
  const source = text(body.amazonDataSource || body.priceSource || body.source).toLowerCase();
  const verifiedAtRaw = body.lastVerifiedAt || body.verifiedAt || verification.verifiedAt || null;
  const verifiedAt = verifiedAtRaw ? Date.parse(verifiedAtRaw) : null;

  let maxAgeMinutes = Math.max(1, num(process.env.AGENTOS_FRESHNESS_DEFAULT_MINUTES, 30));
  if (["creators_api","pa_api"].includes(source)) {
    maxAgeMinutes = Math.max(1, num(process.env.AMAZON_VERIFICATION_MAX_AGE_MINUTES, 10));
  } else if (body.rewardProgram) {
    maxAgeMinutes = Math.max(5, num(process.env.AGENTOS_REWARD_FRESHNESS_MINUTES, 1440));
  } else if (source === "external_signal") {
    maxAgeMinutes = Math.max(1, num(process.env.AGENTOS_EXTERNAL_SIGNAL_FRESHNESS_MINUTES, 15));
  }

  const ageMinutes = Number.isFinite(verifiedAt) ? Math.max(0, (now - verifiedAt) / 60000) : null;
  const fresh = ageMinutes !== null && ageMinutes <= maxAgeMinutes;

  return {
    version:"17.5",
    source:source || "unknown",
    verifiedAt:Number.isFinite(verifiedAt) ? new Date(verifiedAt).toISOString() : null,
    ageMinutes:ageMinutes === null ? null : Number(ageMinutes.toFixed(2)),
    maxAgeMinutes,
    state:fresh ? "FRESH" : "STALE",
    refreshRequired:!fresh
  };
}

function containsSecretLikeValue(value = "") {
  const s = String(value || "");
  return /(?:telegram_bot_token|publish_secret|redis_rest_token|credential_secret|access_key|secret_key)\s*[:=]/i.test(s) ||
    /bot\d{6,}:[A-Za-z0-9_-]{20,}/.test(s);
}

export function egressGuard(body = {}, ctx = {}) {
  const failures = [];
  const warnings = [];
  const commercial = Boolean(body.price || body.oldPrice || body.effectivePrice || body.discount || body.coupon || body.stack);

  if (containsSecretLikeValue(JSON.stringify(body))) failures.push("secret_like_material_detected");
  if (ctx.policy?.blocking?.length) failures.push("blocking_policy");
  if (ctx.intent?.requiresClarification) failures.push("ambiguous_intent");
  if (commercial && ctx.verification?.state !== "VERIFIED" && !body.rewardProgram) failures.push("commercial_data_not_amazon_verified");
  if (commercial && ctx.freshness?.state !== "FRESH") failures.push("commercial_data_stale");
  if (ctx.publication?.imageProvenance?.passed === false && body.imageUrl) warnings.push("image_suppression_required");

  return {
    version:"17.5",
    passed:failures.length === 0,
    failures,
    warnings,
    action:failures.length ? "BLOCK" : warnings.length ? "ALLOW_WITH_SUPPRESSION" : "ALLOW"
  };
}

export function releaseManifest(extra = {}) {
  return {
    agentOsVersion:"17.5",
    domain:"affareradar",
    profile:"affareradar-agentos-17.5",
    policyVersion:process.env.AMAZON_POLICY_VERSION || "2026-04-14",
    deploymentCommit:process.env.VERCEL_GIT_COMMIT_SHA || null,
    environment:process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    generatedAt:new Date().toISOString(),
    ...extra
  };
}

export function knowledgeProposal(body = {}, ctx = {}) {
  const proposalId = `kp_${Buffer.from(String(body.asin || body.amazonUrl || body.title || "unknown")).toString("base64url").slice(0, 24)}`;
  const verified = ctx.verification?.state === "VERIFIED";
  const fresh = ctx.freshness?.state === "FRESH";
  const trusted = Number(ctx.sourceReputation?.score || body.reliabilityScore || 0) >= 70;
  const valid = verified && fresh && trusted;

  return {
    version:"17.5",
    proposalId,
    state:valid ? "VALIDATED" : "PROPOSED",
    commitAllowed:valid,
    reasons:[
      verified ? null : "verification_missing",
      fresh ? null : "freshness_failed",
      trusted ? null : "trust_below_threshold"
    ].filter(Boolean)
  };
}


export function semanticDecisionCachePolicy(body = {}, ctx = {}) {
  const containsProgramContent = body.amazonProgramContent === true;
  const fresh = ctx.freshness?.state === "FRESH";
  const eligible = !containsProgramContent && fresh;
  return {
    version:"17.5",
    eligible,
    ttlSeconds:eligible ? Math.max(30, Math.min(900, num(process.env.AGENTOS_SEMANTIC_CACHE_TTL_SECONDS, 300))) : 0,
    scope:"DERIVED_DECISION_ONLY",
    reason:containsProgramContent ? "amazon_program_content_excluded" : fresh ? "eligible" : "freshness_required"
  };
}
