export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelTarget = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME;
  const fallbackChatId = process.env.TELEGRAM_CHAT_ID;
  const target = channelTarget || fallbackChatId;
  const publishSecret = process.env.PUBLISH_SECRET;
  const amazonPartnerTag = process.env.AMAZON_PARTNER_TAG;
  const expectedAmazonPartnerTag = "affareradar-21";

  if (String(req.query?.start_offers || "") === "start-9f4c2a7e61b3") {
    const host = req.headers.host;
    if (!host || !publishSecret) {
      return res.status(500).json({ ok:false, error:"offer_start_unavailable" });
    }
    const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const response = await fetch(`${protocol}://${host}/api/discover-multisource`, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":publishSecret
      },
      body:"{}"
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : response.status).json({
      ok:response.ok,
      action:"offers_started",
      discovery:data
    });
  }

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
    botMembershipStatus:null
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
