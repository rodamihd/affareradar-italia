import { buildOpportunityEvent, validateOpportunityEvent } from "../lib/opportunity-event-contract.js";
import { superviseOpportunity } from "../lib/offerteradar-supervisor.js";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";

function authorized(req) {
  const secret = process.env.PUBLISH_SECRET;
  return Boolean(secret && req.headers["x-affareradar-secret"] === secret);
}

async function persistDecision(event, decision) {
  if (!redisConfig()) return { persisted:false, reason:"redis_not_configured" };
  try {
    const payload = {
      event,
      decision,
      storedAt:new Date().toISOString()
    };
    await Promise.all([
      redisCommand("SET", `affareradar:decision:${decision.decisionId}`, JSON.stringify(payload), "EX", 7776000),
      redisCommand("LPUSH", "affareradar:decisions", JSON.stringify({
        decisionId:decision.decisionId,
        eventId:event.eventId,
        entityId:event.entity?.id || null,
        asin:event.entity?.asin || null,
        status:decision.status,
        reason:decision.reason,
        decidedAt:decision.decidedAt
      }))
    ]);
    await redisCommand("LTRIM", "affareradar:decisions", 0, 499);
    return { persisted:true };
  } catch (error) {
    return { persisted:false, reason:String(error?.message || error) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const input = req.body || {};
  const now = Date.now();
  const event = input.event?.schema === "affareradar.opportunity.v1"
    ? input.event
    : buildOpportunityEvent(input.offer || input.body || input, input.context || {}, now);

  const validation = validateOpportunityEvent(event);
  if (!validation.valid) {
    return res.status(400).json({
      ok:false,
      error:"invalid_opportunity_event",
      validation
    });
  }

  const decision = superviseOpportunity(event, {
    reward:input.reward || input.context?.reward || null
  }, now);
  const persistence = await persistDecision(event, decision);

  return res.status(200).json({
    ok:true,
    agentOsVersion:"26.0",
    contract:"affareradar.opportunity.v1",
    event,
    decision,
    persistence
  });
}
