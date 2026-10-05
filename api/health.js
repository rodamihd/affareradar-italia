import { runAgentOsSelfTest } from "../lib/agentos-selftest.js";
import { externalDescriptor, executeExternalOperation } from "../lib/agentos-external-runtime.js";
import { buildAffareRadarVerifiedShadowTelemetry } from "../lib/affareradar-verified-shadow-telemetry.js";
import { joinAffareRadarRealOutcomes } from "../lib/affareradar-real-outcome-joiner.js";
import { buildShadowValidationDashboard } from "../lib/shadow-validation-dashboard.js";

function externalAuthorized(req) {
  const secret = process.env.AGENTOS_EXTERNAL_SECRET || process.env.PUBLISH_SECRET;
  if (!secret) return false;
  return req.headers["x-agentos-secret"] === secret ||
    req.headers["x-affareradar-secret"] === secret;
}

export default async function handler(req, res) {
  const externalMode = req.query?.agentos === "external";
  const shadowE2E = req.query?.shadow_e2e === "1";
  const shadowBatch = req.query?.shadow_batch === "1";

  if (shadowBatch) {
    if (req.method !== "GET") {
      return res.status(405).json({ ok:false, error:"method_not_allowed" });
    }

    const shadowRecords = [];
    const productionRecords = [];
    const outcomeRecords = [];

    for (let i = 0; i < 50; i += 1) {
      const n = i + 1;
      const decisionId = `preview_batch_decision_${String(n).padStart(3, "0")}`;
      const productionRecord = {
        decisionId,
        dealId:`PREVIEW-BATCH-${String(n).padStart(3, "0")}`,
        action:"PUBLISHED",
        reason:"preview_batch_controlled",
        opportunityScore:90,
        predictionScore:86,
        sourceReputation:89
      };

      const wouldBlock = i < 20;
      const shadow = buildAffareRadarVerifiedShadowTelemetry(
        productionRecord,
        "published",
        { dealId:productionRecord.dealId },
        {
          verification:{state:"VERIFIED"},
          policy:{blocking:[]},
          egress:{passed:true},
          runtimeIntegrity:{status:wouldBlock ? "TAMPERED" : "VALID"},
          workloadIdentity:{grantPresent:true}
        }
      );

      productionRecords.push(productionRecord);
      shadowRecords.push(shadow);
      outcomeRecords.push({
        decisionId,
        outcomeId:`preview_batch_outcome_${String(n).padStart(3, "0")}`,
        qualityOutcome:wouldBlock ? (i === 0 ? "GOOD" : "BAD") : "GOOD",
        impressions:100 + i,
        clicks:10 + (i % 5),
        conversions:i % 3,
        revenueEUR:Number((2.5 + i * 0.1).toFixed(2))
      });
    }

    const joined = joinAffareRadarRealOutcomes({
      shadowRecords,
      recentDecisions:productionRecords,
      recentOutcomes:outcomeRecords
    });

    const replaySafeRecords = joined.joined.map(record => ({
      ...record,
      mode:"replay"
    }));
    const nonPromotionalDashboard = buildShadowValidationDashboard(replaySafeRecords, {
      ci:{affareradar:true}
    });

    const checkpointSizes = [10, 25, 49, 50];
    const simulatedCheckpoints = checkpointSizes.map(size => {
      const dashboard = buildShadowValidationDashboard(joined.joined.slice(0, size), {
        ci:{affareradar:true}
      });
      const v = dashboard.verticals?.affareradar || {};
      return {
        records:size,
        status:v.status || null,
        known_outcomes:v.known_outcomes ?? null,
        known_outcomes_target:v.known_outcomes_target ?? null,
        known_would_block:v.known_would_block ?? null,
        known_would_block_target:v.known_would_block_target ?? null,
        false_blocks:v.false_blocks ?? null,
        false_block_rate_pct:v.false_block_rate_pct ?? null,
        false_block_rate_limit_pct:v.false_block_rate_limit_pct ?? null,
        safety_catches:v.safety_catches ?? null,
        risk_relaxations:v.risk_relaxations ?? null,
        blockers:v.blockers || []
      };
    });

    const finalSimulation = simulatedCheckpoints[simulatedCheckpoints.length - 1];

    return res.status(200).json({
      ok:true,
      environment:"preview",
      batch_type:"synthetic_controlled",
      records_generated:50,
      external_io:false,
      production_mutation:false,
      telegram_called:false,
      redis_called:false,
      persisted:false,
      counts_as_real_evidence:false,
      automatic_promotion:false,
      non_promotional_replay_view:{
        promotion_eligible_records:nonPromotionalDashboard.verticals?.affareradar?.promotion_eligible_records ?? 0,
        status:nonPromotionalDashboard.verticals?.affareradar?.status || null
      },
      simulated_threshold_progress:simulatedCheckpoints,
      final_simulation:{
        ...finalSimulation,
        expected_threshold_result:
          finalSimulation.known_outcomes === 50 &&
          finalSimulation.known_would_block === 20 &&
          finalSimulation.false_block_rate_pct === 5 &&
          finalSimulation.risk_relaxations === 0
            ? "THRESHOLDS_MET_IN_SIMULATION"
            : "THRESHOLDS_NOT_MET"
      }
    });
  }

  if (shadowE2E) {
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

  if (externalMode) {
    if (!externalAuthorized(req)) {
      return res.status(401).json({ ok:false, error:"unauthorized" });
    }
    if (req.method === "GET") {
      return res.status(200).json(externalDescriptor());
    }
    if (req.method === "POST") {
      const result = executeExternalOperation(req.body || {});
      return res.status(result.status || 200).json(result);
    }
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelTarget = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME;
  const fallbackChatId = process.env.TELEGRAM_CHAT_ID;
  const target = channelTarget || fallbackChatId;
  const publishSecret = process.env.PUBLISH_SECRET;
  const amazonPartnerTag = process.env.AMAZON_PARTNER_TAG;
  const expectedAmazonPartnerTag = "affareradar-21";

  const result = {
    ok:true,
    service:"AffareRadar Telegram Publisher",
    telegramConfigured:Boolean(token && target),
    publishSecretConfigured:Boolean(publishSecret),
    amazonPartnerTagConfigured:Boolean(amazonPartnerTag),
    amazonPartnerTagMatchesExpected:amazonPartnerTag === expectedAmazonPartnerTag,
    targetType:channelTarget ? "channel" : "fallback_chat",
    target:channelTarget || null,
    botTokenValid:false,
    targetReachable:false,
    botCanPost:false,
    botMembershipStatus:null,
    agentOsSelfTest:req.query?.selftest === "1" ? runAgentOsSelfTest() : null
  };

  if (!token || !target) {
    return res.status(200).json(result);
  }

  try {
    const botRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const botData = await botRes.json();
    result.botTokenValid = Boolean(botRes.ok && botData?.ok);

    const chatRes = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(target)}`
    );
    const chatData = await chatRes.json();
    result.targetReachable = Boolean(chatRes.ok && chatData?.ok);

    if (result.botTokenValid && result.targetReachable && botData?.result?.id) {
      const memberRes = await fetch(
        `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(target)}&user_id=${encodeURIComponent(botData.result.id)}`
      );
      const memberData = await memberRes.json();

      if (memberRes.ok && memberData?.ok) {
        const member = memberData.result || {};
        result.botMembershipStatus = member.status || null;
        result.botCanPost =
          member.status === "creator" ||
          (member.status === "administrator" && member.can_post_messages !== false);
      }
    }
  } catch {
    result.ok = false;
  }

  return res.status(200).json(result);
}
