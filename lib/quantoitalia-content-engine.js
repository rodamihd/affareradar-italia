function clean(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pct(value) {
  const n = Number(String(value || "").replace(/[^0-9.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function badge(body = {}) {
  const type = String(body.dealType || "").toLowerCase();
  const score = Number(body.dealScore || 0);
  if (body.historicalLow) return "MINIMO STORICO";
  if (type === "price_error") return "PRICE ERROR";
  if (type === "coupon_stack" || body.coupon || body.stack) return "COUPON / PROMO";
  if (score >= 90) return "TOP DEAL";
  return "OFFERTA";
}

function commercialLine(body = {}) {
  const verified = body.priceVerified === true || body.priceVerifiedByAmazon === true;
  if (!verified) return null;
  const price = clean(body.effectivePrice || body.price, 80);
  const discount = clean(body.discount, 40);
  if (!price) return null;
  return discount ? `${price} • ${discount}` : price;
}

function baseFacts(body = {}) {
  return {
    title:clean(body.title || "Offerta", 180),
    category:clean(body.category || "Amazon", 80),
    reason:clean(body.reason, 220),
    badge:badge(body),
    commercial:commercialLine(body),
    score:Number.isFinite(Number(body.dealScore)) ? Number(body.dealScore) : null,
    amazonUrl:body.amazonUrl || null,
    imageUrl:body.imageUrl || null
  };
}

export function buildQuantoItaliaContent(body = {}, options = {}) {
  const f = baseFacts(body);
  const suffix = "Prezzo e disponibilita possono cambiare. Link affiliato.";
  const shortHook = [f.badge, f.title, f.commercial].filter(Boolean).join(" • ");
  const explanation = [
    f.reason || "Selezionata da AffareRadar dopo i controlli previsti.",
    f.score != null ? `Deal Score ${Math.round(f.score)}/100.` : null
  ].filter(Boolean).join(" ");

  return {
    version:"quantoitalia-v1",
    dealId:options.dealId || body.asin || null,
    generatedAt:new Date().toISOString(),
    source:"affareradar",
    canonical:{
      title:f.title,
      badge:f.badge,
      category:f.category,
      imageUrl:f.imageUrl,
      amazonUrl:f.amazonUrl,
      commercial:f.commercial
    },
    channels:{
      telegram:{
        format:"deal_card",
        text:[shortHook, explanation, suffix].filter(Boolean).join("\n")
      },
      instagram:{
        format:"caption",
        text:[`🔥 ${shortHook}`, explanation, "Salva il post e controlla il link prima che l'offerta cambi.", suffix].filter(Boolean).join("\n\n")
      },
      facebook:{
        format:"feed",
        text:[`📡 ${shortHook}`, explanation, "AffareRadar monitora segnali e opportunita prima della pubblicazione.", suffix].filter(Boolean).join("\n\n")
      },
      tiktok:{
        format:"short_script",
        hook:`Fermati un secondo: ${f.badge.toLowerCase()}.`,
        script:[f.title, f.commercial, explanation, "Controlla il link: le condizioni possono cambiare."].filter(Boolean).join(" ")
      },
      youtube:{
        format:"short_script",
        hook:`${f.badge}: vale la pena controllarla?`,
        script:[f.title, f.commercial, explanation, "Link e condizioni aggiornate nella descrizione."].filter(Boolean).join(" ")
      },
      website:{
        format:"deal_page",
        title:`${f.badge}: ${f.title}`,
        summary:[f.commercial, explanation].filter(Boolean).join(" — ")
      },
      newsletter:{
        format:"digest_item",
        subject:f.badge,
        text:[f.title, f.commercial, explanation].filter(Boolean).join(" — ")
      }
    }
  };
}
