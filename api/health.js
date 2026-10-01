export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const publishSecret = process.env.PUBLISH_SECRET;

  const result = {
    ok: true,
    service: "AffareRadar Telegram Publisher",
    telegramConfigured: Boolean(token && chatId),
    publishSecretConfigured: Boolean(publishSecret),
    botTokenValid: false,
    chatReachable: false
  };

  if (!token || !chatId) {
    return res.status(200).json(result);
  }

  try {
    const [botRes, chatRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`),
      fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`)
    ]);

    const [botData, chatData] = await Promise.all([botRes.json(), chatRes.json()]);
    result.botTokenValid = Boolean(botRes.ok && botData?.ok);
    result.chatReachable = Boolean(chatRes.ok && chatData?.ok);
  } catch {
    result.ok = false;
  }

  return res.status(200).json(result);
}
