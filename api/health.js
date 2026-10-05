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
