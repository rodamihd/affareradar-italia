function compact(value, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function repurposeDeal(body = {}, strategy = {}) {
  const title = compact(body.title, 140);
  const price = body.effectivePrice || body.price || "";
  const discount = body.discount || "";
  const reason = compact(body.reason, 160);
  const url = body.amazonUrl || "";
  const contentType = strategy.contentType || "deal";

  return {
    telegram:{
      headline:title,
      cta:"Vedi offerta su Amazon",
      format:"deal_card"
    },
    instagram:{
      story:`🔥 ${title}\n${price}${discount ? ` · ${discount}` : ""}\nLink in evidenza`,
      reelCaption:`${title} — ${price}${discount ? ` (${discount})` : ""}. ${reason}`.trim(),
      cta:"Scopri l'offerta"
    },
    facebook:{
      text:`🔥 ${title}\nPrezzo: ${price}${discount ? ` · Sconto: ${discount}` : ""}\n${reason}`.trim(),
      cta:"Vedi offerta"
    },
    youtube:{
      community:`🔥 ${title}\n${price}${discount ? ` · ${discount}` : ""}\n${reason}`.trim(),
      cta:"Link affiliato in descrizione/commento"
    },
    newsletter:{
      subject:contentType === "price_error" ? `⚡ Price Error: ${title}` : `🔥 AffareRadar: ${title}`,
      teaser:`${title} a ${price}${discount ? ` (${discount})` : ""}`,
      url
    },
    website:{
      slug:title.toLowerCase().replace(/[^a-z0-9àèéìòù]+/gi, "-").replace(/^-|-$/g, "").slice(0,80),
      title,
      summary:`${price}${discount ? ` · ${discount}` : ""} — ${reason}`.trim(),
      url
    }
  };
}
