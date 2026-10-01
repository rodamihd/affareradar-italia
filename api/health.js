export default function handler(req, res) {
  res.status(200).json({
    ok:true,
    service:"AffareRadar Telegram Publisher",
    telegramConfigured:Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    publishSecretConfigured:Boolean(process.env.PUBLISH_SECRET)
  });
}
