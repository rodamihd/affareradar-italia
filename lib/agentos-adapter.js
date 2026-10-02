import crypto from "node:crypto";

function id(prefix, raw) {
  const hash = crypto.createHash("sha256").update(String(raw || "")).digest("hex").slice(0, 20);
  return `${prefix}_${hash}`;
}

export function universalEntityId(body = {}) {
  const raw = body.asin || body.amazonUrl || body.title || JSON.stringify(body);
  return id("affareradar", raw);
}

export function agentOsEvent(type, body = {}, extra = {}) {
  const entityId = universalEntityId(body);
  const now = new Date().toISOString();
  return {
    eventId:id("evt", `${type}|${entityId}|${now}`),
    eventType:String(type || "AFFARERADAR_EVENT").toUpperCase(),
    domain:"affareradar",
    entityId,
    occurredAt:now,
    source:body.source || null,
    asin:body.asin || null,
    category:body.category || null,
    dealType:body.dealType || null,
    lifecycle:extra.lifecycle || null,
    knowledge:{
      source:body.source || null,
      timestamp:body.lastVerifiedAt || body.verifiedAt || now,
      freshness:extra.freshness || null,
      confidence:body.reliabilityScore ?? null,
      reliability:extra.sourceReputation?.score ?? body.reliabilityScore ?? null,
      status:extra.knowledgeStatus || "CAPTURED",
      ttl:extra.ttl || null
    },
    governance:{
      policyDecision:extra.policy?.decision || null,
      systemMode:extra.mode?.mode || null,
      approvalRequired:extra.approvalRequired === true
    },
    opportunity:extra.opportunity || null,
    expectedRevenue:extra.revenue || null,
    verification:extra.verification || null,
    payload:extra.payload || null
  };
}

export function agentOsTask(type, body = {}, extra = {}) {
  const entityId = universalEntityId(body);
  return {
    taskId:id("task", `${type}|${entityId}|${Date.now()}`),
    taskType:String(type || "AFFARERADAR_TASK").toUpperCase(),
    domain:"affareradar",
    entityId,
    createdAt:new Date().toISOString(),
    priority:extra.priority || "normal",
    approvalRequired:extra.approvalRequired === true,
    dependsOn:Array.isArray(extra.dependsOn) ? extra.dependsOn : [],
    input:{
      asin:body.asin || null,
      amazonUrl:body.amazonUrl || null,
      category:body.category || null,
      source:body.source || null
    },
    context:extra.context || null
  };
}

export function agentOsRoutingDecision(ctx = {}) {
  if (ctx.mode?.mode === "SAFE_MODE") return { action:"HOLD", reason:"safe_mode" };
  if (ctx.policy?.blocking?.length) return { action:"HOLD", reason:"policy_block" };
  if (ctx.verification?.needsAmazonVerification) return { action:"VERIFY", reason:"verification_required" };
  if (ctx.opportunity?.action === "PUBLISH") return { action:"PUBLISH", reason:"opportunity_publish" };
  if (ctx.opportunity?.action === "OBSERVE") return { action:"OBSERVE", reason:"opportunity_observe" };
  return { action:"DISCARD", reason:"opportunity_discard" };
}
