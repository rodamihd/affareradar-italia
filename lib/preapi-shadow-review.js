// AffareRadar PRE-API Shadow Review. Pure functions: no network, publication or storage.
const VALID_MARKETS = new Set(["IT"]);
const CLAIM_WORDS = /(?:\\b(?:price error|errore(?: di)? prezzo|coupon|sconto|offerta imperdibile|minimo storico|risparmi|promozione)\\b|\\d+(?:[.,]\\d+)?\\s*%|[€$£]\\s*\\d+|\\d+\\s*(?:euro|eur))/gi;
function cleanText(value, limit = 180) {
  return String(value ?? "").replace(/https?:\\/\\/\\S+/gi, "")
    .replace(CLAIM_WORDS, "").replace(/\\s+/g, " ").trim().slice(0, limit);
}
function safeAmazonProductUrl(value, asin) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !/(?:^|\\.)amazon\\.it$/i.test(url.hostname)) return null;
    const found = url.pathname.match(/\\/(?:dp|gp\\/product|product)\\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase();
    return found === asin ? `https://www.amazon.it/dp/${asin}` : null;
  } catch { return null; }
}
export function buildShadowReview(signal = {}, now = new Date()) {
  const asin = String(signal.asin || "").trim().toUpperCase();
  const market = String(signal.market || "IT").trim().toUpperCase();
  const validAsin = /^[A-Z0-9]{10}$/.test(asin);
  const url = validAsin ? safeAmazonProductUrl(signal.amazonUrl, asin) : null;
  const reason = !VALID_MARKETS.has(market) ? "unsupported_market"
    : !validAsin || !url ? "unverified_product_identity" : "no_authorized_amazon_price_provider";
  const source = String(signal.source || "").slice(0, 60);
  return {
    schemaVersion:1, market, asin:validAsin ? asin : null,
    title:cleanText(signal.title, 140) || "Prodotto da verificare",
    category:cleanText(signal.category, 60) || null,
    productUrl:url, source,
    observedAt:new Date(now).toISOString(),
    claims:{ currentPriceVerified:false, referencePriceVerified:false, couponTermsVerified:false },
    gate:"HOLD", reason, mode:"SHADOW_ONLY", autoPublishAllowed:false,
    editorialDraft:"Segnalazione interna da verificare. Nessun prezzo, sconto o coupon confermato.",
    // Original source claims deliberately not propagated into display/publish fields.
    reviewRequired:true
  };
}
