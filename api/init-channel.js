function authorized(req) {
  const secret = process.env.PUBLISH_SECRET;
  return Boolean(secret && req.headers["x-affareradar-secret"] === secret);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME;
  const channelUrl = process.env.TELEGRAM_CHANNEL_URL || "";

  if (!token || !channelId) {
    return res.status(500).json({ ok:false, error:"telegram_channel_not_configured" });
  }

  const text = [
    "<b>📡 BENVENUTO SU AFFARERADAR ITALIA</b>",
    "",
    "Qui pubblichiamo solo offerte Amazon che superano i controlli del nostro motore.",
    "",
    "<b>Legenda segnali</b>",
    "🔥 TOP DEAL — occasione con Deal Score elevato",
    "⚡ PRICE ERROR — possibile anomalia di prezzo da verificare rapidamente",
    "🏷 COUPON STACK — più promozioni combinabili",
    "🏆 MINIMO STORICO — prezzo tra i più bassi rilevati",
    "",
    "<b>Come leggere i post</b>",
    "🎯 Deal Score = qualità complessiva dell'opportunità",
    "💶 Prezzo effettivo = prezzo dopo coupon/promo rilevati",
    "⭐ Prime = vantaggio disponibile per clienti Prime quando indicato",
    "",
    "👍 Utile   🔥 Affare forte   ❌ Non più valido",
    "",
    "ℹ️ Prezzi, coupon e disponibilità possono cambiare rapidamente.",
    "🔗 I link Amazon possono essere affiliati.",
    channelUrl ? `\n👥 Invita un amico: ${esc(channelUrl)}` : null
  ].filter(Boolean).join("\n");

  const apiBase = `https://api.telegram.org/bot${token}`;

  const send = await fetch(`${apiBase}/sendMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({
      chat_id:channelId,
      text,
      parse_mode:"HTML",
      disable_web_page_preview:true
    })
  });

  const sendData = await send.json();
  if (!send.ok || !sendData.ok) {
    return res.status(502).json({ ok:false, error:"welcome_send_failed", telegram:sendData });
  }

  const messageId = sendData.result?.message_id;

  const pin = await fetch(`${apiBase}/pinChatMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({
      chat_id:channelId,
      message_id:messageId,
      disable_notification:true
    })
  });

  const pinData = await pin.json();

  return res.status(pin.ok && pinData.ok ? 200 : 207).json({
    ok:true,
    message_id:messageId,
    pinned:Boolean(pin.ok && pinData.ok),
    pinResult:pin.ok && pinData.ok ? "ok" : pinData
  });
}
