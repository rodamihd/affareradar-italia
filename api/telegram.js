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
  const fallbackChatId = process.env.TELEGRAM_CHAT_ID;
  const chatId = channelId || fallbackChatId;
  if (!token || !chatId) {
    return res.status(500).json({ ok:false, error:"telegram_env_missing" });
  }

  const body = req.body || {};
  const {
    title, price, oldPrice, effectivePrice, discount, coupon, category,
    reason, amazonUrl, imageUrl, asin, dealScore, dealType, prime,
    historicalLow, stack, channelUrl: bodyChannelUrl, appUrl
  } = body;

  if (!title || !price || !amazonUrl) {
    return res.status(400).json({ ok:false, error:"missing_required_fields" });
  }

  const esc = s => String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");

  const scoreNum = Number(dealScore);
  const autoBadge =
    historicalLow ? "🏆 MINIMO STORICO" :
    dealType === "price_error" ? "⚡ PRICE ERROR" :
    coupon || stack ? "🏷 COUPON STACK" :
    Number.isFinite(scoreNum) && scoreNum >= 90 ? "🔥 TOP DEAL" :
    "📡 AFFARERADAR";

  const shortReason = reason ? String(reason).slice(0, 180) : null;
  const channelUrl = bodyChannelUrl || process.env.TELEGRAM_CHANNEL_URL || "";
  const amazonAppUrl = appUrl || amazonUrl;

  const shareOfferText = [
    "🔥 Guarda questa offerta trovata da AffareRadar Italia",
    title,
    effectivePrice ? `Prezzo effettivo: ${effectivePrice}` : `Prezzo: ${price}`,
    discount ? `Sconto: ${discount}` : null
  ].filter(Boolean).join("\n");

  const shareOfferUrl =
    `https://t.me/share/url?url=${encodeURIComponent(amazonUrl)}&text=${encodeURIComponent(shareOfferText)}`;

  const whatsappShareText = [
    "🔥 Guarda questa offerta trovata da AffareRadar Italia",
    title,
    effectivePrice ? `Prezzo effettivo: ${effectivePrice}` : `Prezzo: ${price}`,
    discount ? `Sconto: ${discount}` : null,
    amazonUrl
  ].filter(Boolean).join("\n");

  const whatsappShareUrl =
    `https://wa.me/?text=${encodeURIComponent(whatsappShareText)}`;

  const inviteUrl = channelUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(channelUrl)}&text=${encodeURIComponent("📡 Unisciti al canale AffareRadar Italia per ricevere le migliori offerte Amazon")}`
    : null;

  const lines = [
    `<b>${autoBadge}</b>`,
    category ? `📂 ${esc(category)}` : null,
    "",
    `<b>${esc(title)}</b>`,
    "",
    oldPrice ? `💶 <s>${esc(oldPrice)}</s> → <b>${esc(price)}</b>` : `💶 <b>${esc(price)}</b>`,
    effectivePrice && effectivePrice !== price ? `✅ Prezzo effettivo: <b>${esc(effectivePrice)}</b>` : null,
    discount ? `📉 Sconto: <b>${esc(discount)}</b>` : null,
    coupon ? `🏷 Coupon: <b>${esc(coupon)}</b>` : null,
    stack ? `🧩 Stack promo: ${esc(stack)}` : null,
    Number.isFinite(scoreNum) ? `🎯 Deal Score: <b>${Math.max(0, Math.min(100, Math.round(scoreNum)))}/100</b>` : null,
    prime === true ? "⭐ Prime" : null,
    shortReason ? `💡 ${esc(shortReason)}` : null,
    asin ? `🔎 ASIN: <code>${esc(asin)}</code>` : null,
    "",
    "ℹ️ Prezzo, coupon e disponibilità possono cambiare su Amazon.",
    "👍 Utile   🔥 Affare forte   ❌ Non più valido",
    "🔗 Link affiliato Amazon"
  ].filter(Boolean);

  let caption = lines.join("\n");
  if (caption.length > 1000) caption = caption.slice(0, 997) + "...";

  const inlineKeyboard = [
    [{ text:"🛒 Vedi offerta su Amazon", url:amazonUrl }],
    [{ text:"📤 Invia l'offerta ad un amico", url:shareOfferUrl }],
    [{ text:"🟢 Condividi su WhatsApp", url:whatsappShareUrl }]
  ];

  if (inviteUrl) {
    inlineKeyboard.push([
      { text:"👥 Invita nel canale un amico", url:inviteUrl }
    ]);
  }

  const keyboard = { inline_keyboard:inlineKeyboard };

  const apiBase = `https://api.telegram.org/bot${token}`;
  const endpoint = imageUrl ? `${apiBase}/sendPhoto` : `${apiBase}/sendMessage`;

  const payload = imageUrl ? {
    chat_id: chatId, photo: imageUrl, caption, parse_mode:"HTML", reply_markup: keyboard
  } : {
    chat_id: chatId, text: caption, parse_mode:"HTML", disable_web_page_preview:false, reply_markup: keyboard
  };

  const r = await fetch(endpoint, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(payload)
  });
  const data = await r.json();

  if (!r.ok || !data.ok) {
    return res.status(502).json({ ok:false, telegram:data });
  }

  return res.status(200).json({
    ok:true,
    telegram_message_id:data.result?.message_id,
    badge:autoBadge,
    target:channelId ? "channel" : "fallback_chat"
  });
}
