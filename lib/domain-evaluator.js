import { transformExternalEditorial, evaluateOriginality, evaluateRepetition, evaluateTrafficSource } from "./creator-compliance.js";
import { sanitizeForAmazonPublication } from "./amazon-compliance.js";
import { evaluateAmazonVerification } from "./amazon-verification-broker.js";
import { creatorQualityScore } from "./creator-quality.js";
import { evaluatePolicies } from "./policy-engine.js";
import { opportunityScoreV2 } from "./opportunity-engine-v2.js";
import { expectedRevenue } from "./expected-revenue-engine.js";
import { initialSourceReputation } from "./source-reputation.js";
import { learnedOutcomeProfile } from "./outcome-learning.js";
import { resolveSignalIntent, freshnessSla, egressGuard } from "./agentos-17_5-profile.js";

export function evaluateOfferDeterministic(rawBody = {}, ctx = {}, now = Date.now()) {
  const editorial = transformExternalEditorial(rawBody);
  const publication = sanitizeForAmazonPublication(editorial.body, now);
  const body = publication.body;
  const verification = evaluateAmazonVerification(body, now);
  const originality = evaluateOriginality(body);
  const repetition = ctx.repetition || evaluateRepetition(body, []);
  const trafficSource = ctx.trafficSource || evaluateTrafficSource("telegram");
  const creatorQuality = creatorQualityScore(body);
  const sourceReputation = ctx.sourceReputation || initialSourceReputation(body);
  const outcomeProfile = ctx.outcomeProfile || learnedOutcomeProfile({}, body);
  const policy = evaluatePolicies(body, {
    verification,
    publication,
    originality,
    repetition,
    trafficSource,
    promotionExpired:false,
    disclosurePresent:true
  });
  const revenue = expectedRevenue(body, { reward:ctx.reward || null, outcomeProfile });
  const scoredBody = {
    ...body,
    commissionPotentialScore:Number.isFinite(Number(body.commissionPotentialScore))
      ? Number(body.commissionPotentialScore)
      : revenue.commissionPotentialScore
  };
  const opportunity = opportunityScoreV2(scoredBody, {
    verification,
    sourceReputation,
    creatorQuality,
    policy,
    trafficSource,
    originality,
    repetition,
    revenue,
    outcomeProfile
  }, now);
  const intent = resolveSignalIntent(scoredBody);
  const freshness = freshnessSla(scoredBody, verification, now);
  const egress = egressGuard(scoredBody, {
    policy,
    verification,
    freshness,
    intent,
    publication
  });

  const action =
    !egress.passed ? "BLOCK" :
    policy.blocking.length ? "BLOCK" :
    opportunity.action;

  return {
    version:"1.0",
    evaluatedAt:new Date(now).toISOString(),
    action,
    body:scoredBody,
    verification,
    publication:{
      priceDisplayAllowed:publication.priceDisplayAllowed,
      promotionDisplayAllowed:publication.promotionDisplayAllowed,
      sanitized:publication.sanitized,
      imageProvenance:publication.imageProvenance,
      productEligibility:publication.productEligibility
    },
    originality,
    repetition,
    trafficSource,
    creatorQuality,
    sourceReputation,
    outcomeProfile,
    policy,
    revenue,
    opportunity,
    intent,
    freshness,
    egress
  };
}
