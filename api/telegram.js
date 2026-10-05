import { attributionMeta, validateAffiliateLink } from "../lib/affiliate-links.js";
import { sanitizeForAmazonPublication } from "../lib/amazon-compliance.js";
import { buildTrackedRedirect } from "../lib/attribution.js";
import { evaluateAmazonReward } from "../lib/rewards-engine.js";

function currentCampaignSlot() {
  const offset = Number(process.env.AFFARERADAR_LOCAL_UTC_OFFSET_HOURS || 2);
  const hour = (new Date().getUTCHours() + offset + 24) % 24;
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 24) return "evening";
  return "off_window";
}

export default async function handler(req, res) {
  if (req.method === "GET" && process.env.AFFARERADAR_TEST_MESSAGE_ENABLED === "true" && String(req.query?.systemTest || "") === "1") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const channelId = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME || process.env.TELEGRAM_CHAT_ID;
    if (!token || !channelId) {
      return res.status(500).json({ ok:false, error:"telegram_env_missing" });
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({
        chat_id:channelId,
        text:"✅ TEST SISTEMA AFFARERADAR\n\nScheduler, Vercel, Redis e Telegram risultano collegati correttamente.",
        disable_web_page_preview:true
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return res.status(502).json({ ok:false, error:"telegram_test_failed" });
    }

    return res.status(200).json({ ok:true, systemTest:true, message_id:data.result?.message_id || null });
  }

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

  const rawBody = req.body || {};
  const publication = sanitizeForAmazonPublication(rawBody, Date.now());
  const body = publication.body;
  const {
    title, price, oldPrice, effectivePrice, discount, coupon, category,
    reason, amazonUrl, imageUrl, asin, dealScore, dealType, prime,
    historicalLow, stack, channelUrl: bodyChannelUrl, appUrl,
    rewardProgram, rewardAmountEUR, rewardTermsVerified, rewardValidUntil
  } = body;

  const reward = evaluateAmazonReward(body, Date.now());
  const isReward = reward.isReward;

  if (!title || !amazonUrl) {
    return res.status(400).json({ ok:false, error:"missing_required_fields" });
  }

  if (!isReward) {
    const completePricing = Boolean(price && oldPrice && discount);
    if (!publication.priceDisplayAllowed || !completePricing) {
      return res.status(422).json({
        ok:false,
        error:"verified_complete_pricing_required",
        priceDisplayAllowed:publication.priceDisplayAllowed,
        hasPrice:Boolean(price),
        hasOldPrice:Boolean(oldPrice),
        hasDiscount:Boolean(discount)
      });
    }
    if ((coupon || stack) && !publication.promotionDisplayAllowed) {
      return res.status(422).json({
        ok:false,
        error:"verified_promotion_required",
        promotionDisplayAllowed:publication.promotionDisplayAllowed
      });
    }
  }

  const esc = s => String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");

  const scoreNum = Number(dealScore);
  const autoBadge =
    isReward ? "🎁 AMAZON REWARD" :
    historicalLow ? "🏆 MINIMO STORICO" :
    dealType === "price_error" ? "⚡ PRICE ERROR" :
    coupon || stack ? "🏷 COUPON STACK" :
    Number.isFinite(scoreNum) && scoreNum >= 90 ? "🔥 TOP DEAL" :
    "📡 AFFARERADAR";

  const shortReason = reason ? String(reason).slice(0, 180) : null;
  const channelUrl = bodyChannelUrl || process.env.TELEGRAM_CHANNEL_URL || "";
  const contentType =
    isReward ? "reward" :
    historicalLow ? "historical_low" :
    dealType === "price_error" ? "price_error" :
    (coupon || stack) ? "coupon_stack" :
    (Number.isFinite(scoreNum) && scoreNum >= 90 ? "top_deal" : "deal");

  const campaign = rawBody.publicationSlot || body.publicationSlot || currentCampaignSlot();
  const affiliateValidation = validateAffiliateLink(amazonUrl, "telegram", contentType, campaign);
  if (!affiliateValidation.valid) {
    return res.status(400).json({
      ok:false,
      error:"affiliate_link_validation_failed",
      affiliateValidation
    });
  }

  const finalAmazonUrl = affiliateValidation.trackedUrl;
  const attribution = attributionMeta("telegram", contentType, campaign);
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = req.headers.host ? `${protocol}://${req.headers.host}` : "";
  const dealId = asin || String(title).slice(0, 80);

  const trackedAmazonUrl = buildTrackedRedirect(origin, {
    destination:finalAmazonUrl,
    channel:"telegram",
    contentType,
    action:"amazon_click",
    dealId,
    category:category || null,
    source:body.source || rawBody.source || null,
    dealType:dealType || contentType
  });

  const shareOfferText = [
    "🔥 Guarda questa offerta trovata da AffareRadar Italia",
    title,
    isReward ? (reward.label || "Programma Amazon") : (effectivePrice ? `Prezzo attuale: ${effectivePrice}` : `Prezzo attuale: ${price}`),
    !isReward && oldPrice ? `Prezzo originale: ${oldPrice}` : null,
    !isReward && discount ? `Sconto: ${discount}` : null,
    !isReward && coupon ? `Coupon: ${coupon}` : null,
    isReward && reward.rewardAmountEUR != null ? `Ricompensa indicata: €${reward.rewardAmountEUR}` : null
  ].filter(Boolean).join("\n");

  const shareOfferUrl =
    `https://t.me/share/url?url=${encodeURIComponent(finalAmazonUrl)}&text=${encodeURIComponent(shareOfferText)}`;
  const trackedTelegramShareUrl = buildTrackedRedirect(origin, {
    destination:shareOfferUrl,
    channel:"telegram",
    contentType,
    action:"telegram_share",
    dealId,
    category:category || null,
    source:body.source || rawBody.source || null,
    dealType:dealType || contentType
  });

  const whatsappShareText = [
    "🔥 Guarda questa offerta trovata da AffareRadar Italia",
    title,
    isReward ? (reward.label || "Programma Amazon") : (effectivePrice ? `Prezzo attuale: ${effectivePrice}` : `Prezzo attuale: ${price}`),
    !isReward && oldPrice ? `Prezzo originale: ${oldPrice}` : null,
    !isReward && discount ? `Sconto: ${discount}` : null,
    !isReward && coupon ? `Coupon: ${coupon}` : null,
    isReward && reward.rewardAmountEUR != null ? `Ricompensa indicata: €${reward.rewardAmountEUR}` : null,
    finalAmazonUrl
  ].filter(Boolean).join("\n");

  const whatsappShareUrl =
    `https://wa.me/?text=${encodeURIComponent(whatsappShareText)}`;
  const trackedWhatsappShareUrl = buildTrackedRedirect(origin, {
    destination:whatsappShareUrl,
    channel:"telegram",
    contentType,
    action:"whatsapp_share",
    dealId,
    category:category || null,
    source:body.source || rawBody.source || null,
    dealType:dealType || contentType
  });

  const inviteUrl = channelUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(channelUrl)}&text=${encodeURIComponent("📡 Unisciti al canale AffareRadar Italia per ricevere le migliori offerte Amazon")}`
    : null;

  const trackedInviteUrl = inviteUrl ? buildTrackedRedirect(origin, {
    destination:inviteUrl,
    channel:"telegram",
    contentType,
    action:"channel_invite",
    dealId,
    category:category || null,
    source:body.source || rawBody.source || null,
    dealType:dealType || contentType
  }) : null;

  const lines = [
    `<b>${autoBadge}</b>`,
    category ? `📂 ${esc(category)}` : null,
    "",
    `<b>${esc(title)}</b>`,
    "",
    !isReward && price ? `💶 Prezzo attuale: <b>${esc(price)}</b>` : null,
    !isReward && oldPrice ? `🏷 Prezzo originale: <s>${esc(oldPrice)}</s>` : null,
    !isReward && price && !oldPrice ? `🏷 Prezzo originale: <i>non disponibile</i>` : null,
    !isReward && effectivePrice && effectivePrice !== price ? `✅ Prezzo effettivo: <b>${esc(effectivePrice)}</b>` : null,
    !isReward && discount ? `📉 Sconto: <b>${esc(discount)}</b>` : null,
    isReward && reward.label ? `🎯 Programma: <b>${esc(reward.label)}</b>` : null,
    isReward && reward.rewardAmountEUR != null ? `💰 Ricompensa indicata: <b>€${esc(reward.rewardAmountEUR)}</b>` : null,
    isReward && reward.validUntil ? `⏳ Valida fino a: ${esc(reward.validUntil)}` : null,
    coupon ? `🏷 Coupon: <b>${esc(coupon)}</b>` : null,
    stack ? `🧩 Stack promo: ${esc(stack)}` : null,
    Number.isFinite(scoreNum) ? `🎯 Deal Score: <b>${Math.max(0, Math.min(100, Math.round(scoreNum)))}/100</b>` : null,
    prime === true ? "⭐ Prime" : null,
    shortReason ? `💡 ${esc(shortReason)}` : null,
    asin ? `🔎 ASIN: <code>${esc(asin)}</code>` : null,
    "",
    isReward ? "ℹ️ Requisiti e ricompense possono cambiare: verifica sempre i termini Amazon aggiornati." : "ℹ️ Prezzo, coupon e disponibilità possono cambiare su Amazon.",
    "👍 Utile   🔥 Affare forte   ❌ Non più valido",
    publication.sanitized ? "ℹ️ Prezzo/promozione non mostrati perché non verificati tramite strumenti Amazon consentiti." : null,
    "📢 Pubblicità — Link affiliato Amazon. Per te nessun costo aggiuntivo."
  ].filter(Boolean);

  let caption = lines.join("\n");
  if (caption.length > 1000) caption = caption.slice(0, 997) + "...";

  const inlineKeyboard = [
    [{ text:isReward ? "🎁 Scopri il programma su Amazon" : "🛒 Vedi offerta su Amazon", url:trackedAmazonUrl }],
    [{ text:"📤 Invia l'offerta ad un amico", url:trackedTelegramShareUrl }],
    [{ text:"🟢 Condividi su WhatsApp", url:trackedWhatsappShareUrl }]
  ];

  if (trackedInviteUrl) {
    inlineKeyboard.push([
      { text:"👥 Invita nel canale un amico", url:trackedInviteUrl }
    ]);
  }

  const keyboard = { inline_keyboard:inlineKeyboard };

  const apiBase = `https://api.telegram.org/bot${token}`;
  const endpoint = imageUrl ? `${apiBase}/sendPhoto` : `${apiBase}/sendMessage`;

  const payload = imageUrl ? {
    chat_id: chatId, photo: imageUrl, caption, parse_mode:"HTML", reply_markup: keyboard
  } : {
    chat_id: chatId,
    text: caption,
    parse_mode:"HTML",
    link_preview_options:{
      is_disabled:false,
      url:finalAmazonUrl,
      prefer_large_media:true,
      show_above_text:true
    },
    reply_markup: keyboard
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
    target:channelId ? "channel" : "fallback_chat",
    attribution,
    affiliateValidation,
    reward:isReward ? reward : null,
    publicationCompliance:{
      directAmazonLink:true,
      priceDisplayAllowed:publication.priceDisplayAllowed,
      promotionDisplayAllowed:publication.promotionDisplayAllowed,
      sanitized:publication.sanitized
    }
  });
}
