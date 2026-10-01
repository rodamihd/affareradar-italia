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
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(500).json({ ok:false, error:"telegram_env_missing" });
  }

  const body = req.body || {};
  const {
    title,
    price,
    oldPrice,
    discount,
    category,
    reason,
    amazonUrl,
    imageUrl,
    asin
  } = body;

  if (!title || !price || !amazonUrl) {
    return res.status(400).json({ ok:false, error:"missing_required_fields" });
  }

  const esc = s => String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");

  const lines = [
    category ? `🔥 <b>${esc(category)}</b>` : "🔥 <b>AFFARERADAR</b>",
    "",
    `<b>${esc(title)}</b>`,
    "",
    oldPrice ? `💶 <s>${esc(oldPrice)}</s> → <b>${esc(price)}</b>` : `💶 <b>${esc(price)}</b>`,
    discount ? `📉 <b>${esc(discount)}</b>` : null,
    reason ? `🎯 ${esc(reason)}` : null,
    asin ? `🔎 ASIN: <code>${esc(asin)}</code>` : null,
    "",
    "ℹ️ Prezzo e disponibilità possono cambiare su Amazon.",
    "In qualità di Affiliato Amazon ricevo un guadagno dagli acquisti idonei."
  ].filter(Boolean);

  const caption = lines.join("\n");
  const keyboard = {
    inline_keyboard: [[
      { text:"🛒 Apri su Amazon", url:amazonUrl }
    ]]
  };

  const apiBase = `https://api.telegram.org/bot${token}`;
  let endpoint;
  let payload;

  if (imageUrl) {
    endpoint = `${apiBase}/sendPhoto`;
    payload = {
      chat_id: chatId,
      photo: imageUrl,
      caption,
      parse_mode:"HTML",
      reply_markup: keyboard
    };
  } else {
    endpoint = `${apiBase}/sendMessage`;
    payload = {
      chat_id: chatId,
      text: caption,
      parse_mode:"HTML",
      disable_web_page_preview:false,
      reply_markup: keyboard
    };
  }

  const r = await fetch(endpoint, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(payload)
  });
  const data = await r.json();

  if (!r.ok || !data.ok) {
    return res.status(502).json({ ok:false, telegram:data });
  }

  return res.status(200).json({ ok:true, telegram_message_id:data.result?.message_id });
}
