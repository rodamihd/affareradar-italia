// Strict offline-only parser for separately captured GetItems/OffersV2 JSON.
// No HTTP, OAuth, signing, Redis, partner-tag rewriting or publication.
// Passing checks DOES NOT prove Amazon sent this data or grant display rights.
const ASIN = /^[A-Z0-9]{10}$/;
const REF = /^[a-zA-Z0-9:_-]{8,120}$/;
const AGE_MS = 5 * 60 * 1000;
const REQUIRED = Object.freeze([
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
  "offersV2.listings.isBuyBoxWinner",
  "offersV2.listings.merchantInfo"
]);
const blocked = (reason) => ({ ok:false, decision:"BLOCKED", reason, publication_allowed:false, signing_allowed:false });

function instant(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

function exactCents(value) {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return null;
  const raw = String(value);
  const m = /^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000 ? cents : null;
}

function productUrl(link, asin) {
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" || u.username || u.password || u.port ||
        !["amazon.it", "www.amazon.it"].includes(u.hostname.toLowerCase())) return false;
    const id = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    return id === asin;
  } catch { return false; }
}

export function inspectCreatorsCapture(envelope, now = Date.now()) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return blocked("invalid_envelope");
  // Avoid accidentally processing huge account exports or logs.
  let size;
  try { size = Buffer.byteLength(JSON.stringify(envelope), "utf8"); } catch { return blocked("invalid_envelope"); }
  if (size > 128 * 1024) return blocked("capture_too_large");

  if (envelope.schema !== "affareradar.creators.getitems.capture.v1" ||
      envelope.source !== "amazon_creators_api_export_claim" ||
      envelope.http_status !== 200 || envelope.marketplace !== "www.amazon.it") {
    return blocked("capture_contract_mismatch");
  }
  if (!REF.test(envelope.retrieval_reference || "") ||
      !REF.test(envelope.license_review_reference || "")) return blocked("review_references_missing");

  const at = instant(envelope.observed_at);
  if (!Number.isFinite(at) || at > now || now - at > AGE_MS) return blocked("capture_timestamp_invalid");
  const request = envelope.request;
  const ids = request?.itemIds;
  if (!Array.isArray(ids) || ids.length !== 1 || !ASIN.test(ids[0] || "") ||
      !Array.isArray(request.resources) || REQUIRED.some(x => !request.resources.includes(x))) {
    return blocked("request_identity_or_resources_invalid");
  }

  const raw = envelope.response;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      (raw.errors !== undefined && (!Array.isArray(raw.errors) || raw.errors.length > 0)) ||
      (raw.itemsResult?.errors !== undefined &&
       (!Array.isArray(raw.itemsResult.errors) || raw.itemsResult.errors.length > 0))) {
    return blocked("response_errors_or_invalid_shape");
  }
  const items = raw.itemsResult?.items;
  if (!Array.isArray(items) || items.length !== 1) return blocked("missing_or_partial_items");
  const item = items[0];
  if (!item || item.asin !== ids[0] || !productUrl(item.detailPageURL, ids[0])) {
    return blocked("asin_or_detail_url_mismatch");
  }

  const listings = item.offersV2?.listings;
  // Explicitly refuse ambiguous prices/merchant selection; no guesses.
  if (!Array.isArray(listings) || listings.length !== 1) return blocked("listing_ambiguous_or_missing");
  const listing = listings[0];
  if (!listing || listing.isBuyBoxWinner !== true || listing.condition?.value !== "New") {
    return blocked("featured_new_offer_required");
  }
  if (listing.availability?.type !== "IN_STOCK") return blocked("stock_not_confirmed");
  if (listing.violatesMAP === true) return blocked("price_display_restricted");

  const merchant = listing.merchantInfo;
  if (typeof merchant?.id !== "string" || !/^[A-Za-z0-9]{5,40}$/.test(merchant.id) ||
      typeof merchant.name !== "string" || merchant.name.trim().length < 2 ||
      merchant.name.length > 120) return blocked("merchant_identity_missing");
  if (listing.price?.money?.currency !== "EUR") return blocked("wrong_currency");

  const cents = exactCents(listing.price.money.amount);
  if (cents === null) return blocked("price_precision_or_range_invalid");

  const deal = listing.dealDetails;
  if (deal !== undefined) {
    if (!deal || typeof deal !== "object" || Array.isArray(deal) ||
        (deal.accessType !== undefined && deal.accessType !== "ALL")) return blocked("deal_access_restricted");
    for (const [field,reason,cmp] of [
      ["endTime","deal_ended",t => t <= now],
      ["startTime","deal_not_started",t => t > now]
    ]) {
      if (deal[field] !== undefined) {
        const ts = instant(deal[field]);
        if (!Number.isFinite(ts) || cmp(ts)) return blocked(reason);
      }
    }
  }

  return {
    ok:true, decision:"SCHEMA_OK_SHADOW_ONLY",
    publication_allowed:false, signing_allowed:false, provider_origin_verified:false,
    licensing_verified:false, shipping_verified:false, coupon_verified:false,
    observed:{
      asin:ids[0], marketplace:"www.amazon.it",
      price_cents:cents, currency:"EUR", stock:"IN_STOCK",
      seller_id:merchant.id, seller_name:merchant.name.trim(),
      product_url:item.detailPageURL,
      observed_at:new Date(at).toISOString(),
      retrieval_reference:envelope.retrieval_reference,
      license_review_reference:envelope.license_review_reference
    },
    requires:["independent_capture_authentication","account_eligibility","license_and_display_rights_review",
      "shipping_and_coupon_validation","independent_editorial_approval"]
  };
}
