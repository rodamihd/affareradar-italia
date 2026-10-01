export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const secret = process.env.PUBLISH_SECRET;
  const auth = req.headers["x-affareradar-secret"];
  if (!secret || auth !== secret) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME;

  if (!token || !channelId) {
    return res.status(500).json({ ok:false, error:"telegram_channel_not_configured" });
  }

  const imageBase64 = req.body?.imageBase64;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ ok:false, error:"missing_image_base64" });
  }

  try {
    const clean = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    const bytes = Buffer.from(clean, "base64");

    if (!bytes.length) {
      return res.status(400).json({ ok:false, error:"invalid_image" });
    }

    const form = new FormData();
    form.append("chat_id", channelId);
    form.append("photo", new Blob([bytes], { type:"image/png" }), "affareradar-logo.png");

    const r = await fetch(`https://api.telegram.org/bot${token}/setChatPhoto`, {
      method:"POST",
      body:form
    });

    const data = await r.json();

    if (!r.ok || !data.ok) {
      return res.status(502).json({
        ok:false,
        error:"telegram_set_chat_photo_failed",
        telegram:data
      });
    }

    return res.status(200).json({
      ok:true,
      channel:channelId,
      photoUpdated:true
    });
  } catch (error) {
    return res.status(500).json({
      ok:false,
      error:"set_channel_photo_failed",
      detail:String(error?.message || error)
    });
  }
}
