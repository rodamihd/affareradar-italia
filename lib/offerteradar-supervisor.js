import crypto from "node:crypto";
import { validateOpportunityEvent } from "./opportunity-event-contract.js";

function stableId(raw = "") {
  return crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 20);
}

function number(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceDropPct(previous, current) {
  const prev = parseMoney(previous);
  const curr = parseMoney(current);
  if (!(prev > 0) || !(curr >= 0)) return null;
  return ((prev - curr) / prev) * 100;
}

function hoursSince(timestamp, now) {
  const ts = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(ts) ? Math.max(0, (now - ts) / 3600000) : null;
}

function decision(status, reason, event, policy, extra = {}, now = Date.now()) {
  return {
    decisionId:`decision_${stableId(`${event.eventId}|${status}|${reason}`)}`,
    agentOsVersion:"26.0",
    supervisor:"offerteradar-supervisor-v1",
    decidedAt:new Date(now).toISOString(),
    status,
    reason,
    publishAllowed:status === "APPROVED_AUTO_PUBLISH",
    requiresHuman:status === "HUMAN_REVIEW",
    policy,
    ...extra
  };
}

export function offerteradarSupervisorPolicy() {
  return {
    minDealScore:Math.max(0, number(process.env.AGENTOS_MIN_DEAL_SCORE, 80)),
    priceErrorAutoReliability:Math.max(0, number(process.env.AGENTOS_PRICE_ERROR_AUTO_RELIABILITY, 92)),
    priceFreshnessMinutes:Math.max(1, number(process.env.AGENTOS_PRICE_FRESHNESS_MINUTES, 5)),
    asinCooldownHours:Math.max(1, number(process.env.AGENTOS_ASIN_COOLDOWN_HOURS, 12)),
    republishDropPct:Math.max(0, number(process.env.AGENTOS_REPUBLISH_PRICE_DROP_PCT, 10))
  };
}

export function superviseOpportunity(event = {}, ctx = {}, now = Date.now()) {
  const policy = offerteradarSupervisorPolicy();
  const validation = validateOpportunityEvent(event);
  if (!validation.valid) {
    return decision("REJECT", "invalid_opportunity_contract", event, policy, { validation }, now);
  }

  const rewardEligible = ctx.reward?.eligible === true;
  const commercial = Boolean(
    event.pricing?.price ||
    event.pricing?.effectivePrice ||
    event.promotion?.coupon ||
    event.promotion?.stack
  );
  const dealScore = number(event.scores?.deal);
  const reliability = number(event.scores?.reliability);
  const dealType = String(event.promotion?.dealType || "").toLowerCase();

  if (!rewardEligible && (dealScore === null || dealScore < policy.minDealScore)) {
    return decision("REJECT", "deal_score_below_80", event, policy, { dealScore }, now);
  }

  const stock = String(event.inventory?.stock ?? "").toLowerCase();
  if (event.inventory?.stock === false || ["out_of_stock","unavailable","sold_out"].includes(stock)) {
    return decision("REJECT", "out_of_stock", event, policy, {}, now);
  }

  if (event.governance?.blocking?.length || event.governance?.policyDecision === "BLOCK") {
    return decision("REJECT", "policy_blocked", event, policy, {
      blocking:event.governance?.blocking || []
    }, now);
  }

  if (String(event.governance?.systemMode || "").toUpperCase() === "SAFE_MODE") {
    return decision("REJECT", "system_safe_mode", event, policy, {}, now);
  }

  if (commercial && !rewardEligible) {
    const ageMinutes = number(event.verification?.ageMinutes);
    const stale = event.verification?.refreshRequired === true ||
      event.verification?.freshnessState === "STALE" ||
      ageMinutes === null ||
      ageMinutes > policy.priceFreshnessMinutes;

    if (stale) {
      return decision("RECHECK", "price_data_older_than_5_minutes", event, policy, {
        ageMinutes,
        maxAgeMinutes:policy.priceFreshnessMinutes
      }, now);
    }
  }

  const lastPublishedAt = event.lifecycle?.lastPublishedAt;
  const elapsedHours = hoursSince(lastPublishedAt, now);
  if (elapsedHours !== null && elapsedHours < policy.asinCooldownHours) {
    const dropPct = priceDropPct(
      event.pricing?.previousEffectivePrice,
      event.pricing?.effectivePrice
    );
    if (dropPct === null || dropPct < policy.republishDropPct) {
      return decision("REJECT", "asin_cooldown_12h", event, policy, {
        elapsedHours:Number(elapsedHours.toFixed(2)),
        priceDropPct:dropPct === null ? null : Number(dropPct.toFixed(2))
      }, now);
    }
  }

  if (dealType === "price_error" && !rewardEligible) {
    if (reliability === null || reliability < policy.priceErrorAutoReliability) {
      return decision("HUMAN_REVIEW", "price_error_reliability_below_92", event, policy, {
        reliability
      }, now);
    }
  }

  const verificationState = String(event.verification?.state || "").toUpperCase();
  const opportunityAction = String(event.governance?.opportunityAction || "").toUpperCase();

  if (!rewardEligible && commercial && verificationState !== "VERIFIED") {
    return decision("RECHECK", "amazon_verification_required", event, policy, {
      verificationState
    }, now);
  }

  if (opportunityAction === "VERIFY") {
    return decision("RECHECK", "opportunity_engine_requested_verification", event, policy, {}, now);
  }

  if (["BLOCK","DISCARD"].includes(opportunityAction)) {
    return decision("REJECT", "opportunity_engine_rejected", event, policy, {
      opportunityAction
    }, now);
  }

  if (opportunityAction === "OBSERVE") {
    return decision("HUMAN_REVIEW", "opportunity_requires_review", event, policy, {}, now);
  }

  if (rewardEligible || opportunityAction === "PUBLISH") {
    return decision("APPROVED_AUTO_PUBLISH", "agentos_26_policy_passed", event, policy, {
      opportunityAction:rewardEligible ? "REWARD_ELIGIBLE" : opportunityAction
    }, now);
  }

  return decision("HUMAN_REVIEW", "insufficient_autonomous_evidence", event, policy, {}, now);
}
