import { runAgentOsSelfTest } from "../lib/agentos-selftest.js";
import { externalDescriptor, executeExternalOperation } from "../lib/agentos-external-runtime.js";

function externalAuthorized(req) {
  const secret = process.env.AGENTOS_EXTERNAL_SECRET || process.env.PUBLISH_SECRET;
  if (!secret) return false;
  return req.headers["x-agentos-secret"] === secret ||
    req.headers["x-affareradar-secret"] === secret;
}

export default async function handler(req, res) {
  const externalMode = req.query?.agentos === "external";

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
