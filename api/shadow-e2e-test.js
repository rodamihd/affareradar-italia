import { buildAffareRadarVerifiedShadowTelemetry } from "../lib/affareradar-verified-shadow-telemetry.js";
import { joinAffareRadarRealOutcomes } from "../lib/affareradar-real-outcome-joiner.js";
import { buildShadowValidationDashboard } from "../lib/shadow-validation-dashboard.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const productionRecord = {
    decisionId:"preview_e2e_decision_001",
    dealId:"PREVIEW-ASIN-001",
    action:"PUBLISHED",
    reason:"preview_e2e_controlled",
    opportunityScore:92,
    predictionScore:87,
    sourceReputation:90
  };

  const shadow = buildAffareRadarVerifiedShadowTelemetry(
    productionRecord,
    "published",
    { dealId:productionRecord.dealId },
    {
      verification:{state:"VERIFIED"},
      policy:{blocking:[]},
      egress:{passed:true},
      runtimeIntegrity:{status:"VALID"},
      workloadIdentity:{grantPresent:false}
    }
  );

  const joined = joinAffareRadarRealOutcomes({
    shadowRecords:[shadow],
    recentDecisions:[productionRecord],
    recentOutcomes:[{
      decisionId:productionRecord.decisionId,
      outcomeId:"preview_e2e_outcome_001",
      qualityOutcome:"GOOD",
      impressions:100,
      clicks:12,
      conversions:2,
      revenueEUR:8.5
    }]
  });

  const dashboard = buildShadowValidationDashboard(joined.joined, {
    ci:{affareradar:true}
  });

  return res.status(200).json({
    ok:true,
    environment:"preview",
    external_io:false,
    production_mutation:false,
    telegram_called:false,
    redis_called:false,
    chain:{
      decision_id:productionRecord.decisionId,
      shadow_contract:shadow.evidence_contract,
      baseline_decision:shadow.baseline_decision,
      shadow_decision:shadow.backport_decision,
      diverged:shadow.diverged,
      joined_count:joined.joined_count,
      known_quality_outcome_count:joined.known_quality_outcome_count,
      dashboard_status:dashboard.verticals?.affareradar?.status || null,
      false_blocks:dashboard.verticals?.affareradar?.false_blocks ?? null,
      safety_catches:dashboard.verticals?.affareradar?.safety_catches ?? null
    }
  });
}
