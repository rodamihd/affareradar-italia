import { amazonAgentUserAgent } from "../lib/amazon-compliance.js";

const MARKETPLACE = "www.amazon.it";
const TOKEN_ENDPOINT = "https://api.amazon.co.uk/auth/o2/token";
const API_BASE = "https://creatorsapi.amazon/catalog/v1";

function authorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  const publishSecret = process.env.PUBLISH_SECRET;
  return Boolean(
    (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) ||
    (publishSecret && req.headers["x-affareradar-secret"] === publishSecret)
  );
}

function creatorsConfig() {
  const credentialId = process.env.AMAZON_CREATORS_CREDENTIAL_ID;
  const credentialSecret = process.env.AMAZON_CREATORS_CREDENTIAL_SECRET;
  const partnerTag = process.env.AMAZON_PARTNER_TAG;
  if (!credentialId || !credentialSecret || !partnerTag) return null;
  return {
    credentialId,
    credentialSecret,
    partnerTag,
    version:process.env.AMAZON_CREATORS_CREDENTIAL_VERSION || "3.2"
  };
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url:url.replace(/\/$/, ""), token } : null;
}

async function redisCommand(command, ...args) {
  const cfg = redisConfig();
  if (!cfg) return { configured:false, result:null };
  const r = await fetch(cfg.url, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${cfg.token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify([command, ...args])
  });
  if (!r.ok) throw new Error(`redis_${String(command).toLowerCase()}_${r.status}`);
  const data = await r.json();
  return { configured:true, result:data.result ?? null };
}

async function getAccessToken(cfg) {
  const cacheKey = "affareradar:amazon:creators:access_token";
  try {
    const cached = await redisCommand("GET", cacheKey);
    if (cached.configured && cached.result) return cached.result;
  } catch {}

  const r = await fetch(TOKEN_ENDPOINT, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "User-Agent":amazonAgentUserAgent("AffareRadarCreators") },
    body:JSON.stringify({
      grant_type:"client_credentials",
      client_id:cfg.credentialId,
      client_secret:cfg.credentialSecret,
      scope:"creatorsapi::default"
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const detail = data?.error_description || data?.error || `http_${r.status}`;
    throw new Error(`creators_token_failed:${detail}`);
  }

  try {
    if (redisConfig()) {
      const ttl = Math.max(60, Number(data.expires_in || 3600) - 120);
      await redisCommand("SET", cacheKey, data.access_token, "EX", ttl);
    }
  } catch {}

  return data.access_token;
}

function searchTerms() {
  const raw = process.env.AMAZON_DISCOVERY_QUERIES;
  if (raw) {
    return raw.split("|").map(x => x.trim()).filter(Boolean).slice(0, 3);
  }
  return [
    "offerta elettronica",
    "offerta casa",
    "offerta informatica"
  ];
}

async function searchItems(token, cfg, keywords) {
  const minSavingPercent = Math.max(1, Math.min(95, Number(process.env.AMAZON_DISCOVERY_MIN_SAVING_PERCENT || 25)));
  const r = await fetch(`${API_BASE}/searchItems`, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json",
      "x-marketplace":MARKETPLACE,
      "User-Agent":amazonAgentUserAgent("AffareRadarCreators")
    },
    body:JSON.stringify({
      marketplace:MARKETPLACE,
      partnerTag:cfg.partnerTag,
      searchIndex:"All",
      keywords,
      minSavingPercent,
      itemCount:10,
      resources:[
        "images.primary.medium",
        "itemInfo.title",
        "offersV2.listings.availability",
        "offersV2.listings.dealDetails",
        "offersV2.listings.price",
        "offersV2.listings.type"
      ]
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.errors?.[0]?.message || data?.message || `http_${r.status}`;
    throw new Error(`creators_search_failed:${msg}`);
  }
  return data?.searchResult?.items || [];
}

function fmtPercent(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? `-${Math.round(n)}%` : null;
}

function dealScore(item) {
  const listing = item?.offersV2?.listings?.[0];
  const savings = Number(listing?.price?.savings?.percentage || 0);
  const badge = listing?.dealDetails?.badge;
  const lightning = String(listing?.type || "").toUpperCase().includes("LIGHTNING");
  let score = 60 + Math.min(36, savings * 1.2);
  if (badge) score += 4;
  if (lightning) score += 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function toDeal(item, query) {
  const listing = item?.offersV2?.listings?.[0];
  const price = listing?.price;
  const money = price?.money;
  const oldMoney = price?.savingBasis?.money;
  const savingsPct = Number(price?.savings?.percentage || 0);
  const availability = listing?.availability?.type;
  const title = item?.itemInfo?.title?.displayValue;
  const imageUrl = item?.images?.primary?.medium?.url || item?.images?.primary?.large?.url || null;
  const badge = listing?.dealDetails?.badge || null;
  const dealType = String(listing?.type || "").toUpperCase().includes("LIGHTNING") ? "lightning_deal" : "deal";
  const now = new Date().toISOString();

  if (!item?.asin || !title || !money?.displayAmount || !item?.detailPageURL) return null;

  return {
    title,
    price:money.displayAmount,
    oldPrice:oldMoney?.displayAmount || null,
    effectivePrice:money.displayAmount,
    discount:fmtPercent(savingsPct),
    category:"Amazon",
    reason:[
      `Rilevata tramite Amazon Creators API`,
      savingsPct ? `risparmio ${Math.round(savingsPct)}%` : null,
      badge
    ].filter(Boolean).join(" · "),
    amazonUrl:item.detailPageURL,
    imageUrl,
    asin:item.asin,
    dealScore:dealScore(item),
    reliabilityScore:97,
    dealType,
    prime:listing?.dealDetails?.accessType === "PRIME_EXCLUSIVE" || listing?.dealDetails?.accessType === "PRIMEEARLYACCESS",
    historicalLow:false,
    stock:availability ? availability !== "OUT_OF_STOCK" : true,
    priceVerified:true,
    couponVerified:Boolean(badge),
    priceSource:"creators_api",
    amazonDataSource:"creators_api",
    priceVerifiedByAmazon:true,
    promotionVerifiedByAmazon:Boolean(badge),
    couponVerifiedByAmazon:Boolean(badge),
    lastVerifiedAt:now,
    source:"amazon_creators_api",
    discoveryQuery:query
  };
}

async function publishDeal(req, deal) {
  const host = req.headers.host;
  if (!host) throw new Error("host_missing");
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const secret = process.env.PUBLISH_SECRET;
  if (!secret) throw new Error("publish_secret_missing");

  const r = await fetch(`${protocol}://${host}/api/auto-publish`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":secret
    },
    body:JSON.stringify(deal)
  });
  const data = await r.json().catch(() => ({}));
  return { status:r.status, ok:r.ok, data };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const cfg = creatorsConfig();
  if (!cfg) {
    return res.status(503).json({
      ok:false,
      error:"amazon_creators_not_configured",
      required:[
        "AMAZON_CREATORS_CREDENTIAL_ID",
        "AMAZON_CREATORS_CREDENTIAL_SECRET",
        "AMAZON_PARTNER_TAG"
      ]
    });
  }

  try {
    const token = await getAccessToken(cfg);
    const queries = searchTerms();
    const discovered = [];
    const results = [];

    for (let i = 0; i < queries.length; i++) {
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 1100));
      const items = await searchItems(token, cfg, queries[i]);
      for (const item of items) {
        const deal = toDeal(item, queries[i]);
        if (!deal) continue;
        discovered.push(deal);
      }
    }

    const unique = [];
    const seen = new Set();
    for (const deal of discovered.sort((a,b) => b.dealScore - a.dealScore)) {
      if (seen.has(deal.asin)) continue;
      seen.add(deal.asin);
      unique.push(deal);
    }

    const maxCandidates = Math.max(1, Math.min(10, Number(process.env.AMAZON_DISCOVERY_MAX_CANDIDATES || 5)));
    for (const deal of unique.slice(0, maxCandidates)) {
      const publish = await publishDeal(req, deal);
      results.push({
        asin:deal.asin,
        title:deal.title,
        dealScore:deal.dealScore,
        discount:deal.discount,
        publish
      });
    }

    try {
      if (redisConfig()) {
        await Promise.all([
          redisCommand("SET", "affareradar:amazon:last_discovery_at", new Date().toISOString(), "EX", 172800),
          redisCommand("SET", "affareradar:amazon:last_discovery_count", String(unique.length), "EX", 172800)
        ]);
      }
    } catch {}

    return res.status(200).json({
      ok:true,
      source:"amazon_creators_api",
      marketplace:MARKETPLACE,
      queries,
      discovered:unique.length,
      submitted:results.length,
      results
    });
  } catch (error) {
    return res.status(502).json({
      ok:false,
      error:"amazon_discovery_failed",
      detail:String(error?.message || error)
    });
  }
}
