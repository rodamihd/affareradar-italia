function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }

export function evaluateStorefrontCandidate(body = {}, signals = {}) {
  const score = n(body.dealScore);
  const reliability = n(body.reliabilityScore);
  const clicks = n(signals.amazonClicks);
  const shares = n(signals.shares);
  const type = String(body.dealType || "").toLowerCase();

  let storefrontScore = Math.round(
    Math.min(100,
      score * 0.55 +
      reliability * 0.25 +
      Math.min(10, clicks) * 1.2 +
      Math.min(5, shares) * 1.6 +
      (body.historicalLow ? 8 : 0) +
      (type === "coupon_stack" ? 5 : 0)
    )
  );

  const collection =
    body.historicalLow ? "Minimi storici" :
    type === "price_error" ? "Price Error" :
    type === "coupon_stack" || body.coupon || body.stack ? "Coupon e promo" :
    score >= 95 ? "Top Deal" :
    (body.category || "Selezionati");

  const candidate = storefrontScore >= 82 && reliability >= 85;
  const featured = storefrontScore >= 92 && reliability >= 90;

  return {
    candidate,
    featured,
    storefrontScore,
    collection,
    lifecycle:candidate ? (featured ? "FEATURED_CANDIDATE" : "STOREFRONT_CANDIDATE") : "SKIP",
    reason:candidate
      ? "Buona combinazione di qualita, affidabilita e rilevanza per una vetrina persistente."
      : "Deal adatto alla distribuzione veloce ma non abbastanza forte per la vetrina."
  };
}

export function storefrontContent(body = {}, decision = {}) {
  const title = String(body.title || "Prodotto selezionato").trim().slice(0, 150);
  const price = body.effectivePrice || body.price || "";
  const discount = body.discount || "";
  const category = body.category || "Amazon";

  return {
    collection:decision.collection || category,
    title,
    shortDescription:[
      price ? `Prezzo rilevato: ${price}` : null,
      discount ? `Sconto: ${discount}` : null,
      body.historicalLow ? "Minimo storico rilevato" : null,
      body.prime ? "Prime" : null
    ].filter(Boolean).join(" · "),
    productUrl:body.amazonUrl || null,
    imageUrl:body.imageUrl || null,
    suggestedPin:decision.featured === true,
    archiveRule:"Archivia se offerta scaduta, stock esaurito o verifica prezzo non piu valida."
  };
}

export function rankFeatured(items = [], limit = 8) {
  return [...items]
    .filter(x => x?.decision?.candidate)
    .sort((a,b) =>
      n(b?.decision?.storefrontScore) - n(a?.decision?.storefrontScore) ||
      n(b?.body?.dealScore) - n(a?.body?.dealScore)
    )
    .slice(0, Math.max(1, Math.min(8, limit)));
}
