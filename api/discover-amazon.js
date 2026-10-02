import { amazonAgentUserAgent } from "../lib/amazon-compliance.js";
import { mergeVerifiedAmazonData } from "../lib/amazon-verification-broker.js";
import { agentOsEvent } from "../lib/agentos-adapter.js";
import { offerDagTemplate, dagSummary } from "../lib/agentos-dag.js";
import { extractAsinFromUrl } from "../lib/verification-orchestrator.js";
import { sourceReputationKeys, applySourceOutcome } from "../lib/source-reputation.js";
import { providerHealthDefaults, providerCanAttempt, recordProviderSuccessState, recordProviderFailureState } from "../lib/provider-health.js";
import crypto from "node:crypto";
import { startRuntimeObservation, runtimeSuccess, runtimeFailure } from "../lib/runtime-observability.js";

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

function paConfig() {
  const accessKey = process.env.AMAZON_PAAPI_ACCESS_KEY;
  const secretKey = process.env.AMAZON_PAAPI_SECRET_KEY;
  const partnerTag = process.env.AMAZON_PARTNER_TAG;
  if (!accessKey || !secretKey || !partnerTag) return null;
  return {
    accessKey,
    secretKey,
    partnerTag,
    host:process.env.AMAZON_PAAPI_HOST || "webservices.amazon.it",
    region:process.env.AMAZON_PAAPI_REGION || "eu-west-1",
    service:"ProductAdvertisingAPI"
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function amzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function paGetItem(cfg, asin) {
  const path = "/paapi5/getitems";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";
  const now = new Date();
  const date = amzDate(now);
  const dateStamp = date.slice(0, 8);
  const payload = JSON.stringify({
    ItemIds:[asin],
    Resources:[
      "Images.Primary.Medium",
      "ItemInfo.Title",
      "Offers.Listings.Availability.Message",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis"
    ],
    PartnerTag:cfg.partnerTag,
    PartnerType:"Associates",
    Marketplace:MARKETPLACE
  });
  const headers = {
    "content-encoding":"amz-1.0",
    "content-type":"application/json; charset=utf-8",
    host:cfg.host,
    "x-amz-date":date,
    "x-amz-target":target
  };
  const sorted = Object.keys(headers).sort();
  const canonicalHeaders = sorted.map(k => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sorted.join(";");
  const canonicalRequest = ["POST", path, "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");
  const scope = `${dateStamp}/${cfg.region}/${cfg.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(Buffer.from(`AWS4${cfg.secretKey}`, "utf8"), dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, cfg.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${cfg.host}${path}`, {
    method:"POST",
    headers:{ ...headers, Authorization:authorization },
    body:payload
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.Errors?.[0]?.Message || data?.message || `http_${response.status}`;
    throw new Error(`paapi_getitems_failed:${detail}`);
  }
  return data?.ItemsResult?.Items || [];
}

function paItemToDeal(item) {
  const listing = item?.Offers?.Listings?.[0];
  const price = listing?.Price;
  const basis = listing?.SavingBasis;
  const title = item?.ItemInfo?.Title?.DisplayValue;
  const imageUrl = item?.Images?.Primary?.Medium?.URL || null;
  const pct = Number(price?.Savings?.Percentage || 0);
  const now = new Date().toISOString();
  if (!item?.ASIN || !title || !price?.DisplayAmount || !item?.DetailPageURL) return null;

  return {
    title,
    price:price.DisplayAmount,
    oldPrice:basis?.DisplayAmount || null,
    effectivePrice:price.DisplayAmount,
    discount:pct > 0 ? `-${Math.round(pct)}%` : null,
    category:"Amazon",
    reason:"Verificata tramite Amazon Product Advertising API",
    amazonUrl:item.DetailPageURL,
    imageUrl,
    imageSource:imageUrl ? "pa_api" : null,
    imageVerifiedByAmazon:Boolean(imageUrl),
    amazonProgramContent:true,
    aiTrainingAllowed:false,
    dataUsagePolicy:"OPERATIONAL_ONLY_NO_TRAINING",
    asin:item.ASIN,
    dealScore:Math.max(60, Math.min(100, Math.round(60 + pct * 1.2))),
    reliabilityScore:96,
    dealType:"deal",
    stock:listing?.Availability?.Message
      ? !/unavailable|non disponibile/i.test(listing.Availability.Message)
      : true,
    priceVerified:true,
    priceSource:"pa_api",
    amazonDataSource:"pa_api",
    priceVerifiedByAmazon:true,
    promotionVerifiedByAmazon:false,
    couponVerifiedByAmazon:false,
    lastVerifiedAt:now,
    source:"amazon_pa_api"
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

async function readProviderHealth(provider) {
  if (!redisConfig()) return providerHealthDefaults(provider);
  try {
    const rr = await redisCommand("GET", `affareradar:provider-health:${provider}`);
    if (!rr.result) return providerHealthDefaults(provider);
    return { ...providerHealthDefaults(provider), ...JSON.parse(rr.result) };
  } catch {
    return providerHealthDefaults(provider);
  }
}

async function writeProviderHealth(provider, health) {
  if (!redisConfig()) return;
  try {
    await redisCommand("SET", `affareradar:provider-health:${provider}`, JSON.stringify(health), "EX", 604800);
  } catch {}
}

async function providerSuccess(provider) {
  const current = await readProviderHealth(provider);
  const next = recordProviderSuccessState(current, provider);
  await writeProviderHealth(provider, next);
  return next;
}

async function providerFailure(provider, error) {
  const current = await readProviderHealth(provider);
  const next = recordProviderFailureState(current, provider, error);
  await writeProviderHealth(provider, next);
  return next;
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
    imageSource:imageUrl ? "creators_api" : null,
    imageVerifiedByAmazon:Boolean(imageUrl),
    amazonProgramContent:true,
    aiTrainingAllowed:false,
    dataUsagePolicy:"OPERATIONAL_ONLY_NO_TRAINING",
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

async function recordAgentOsEvent(event) {
  if (!redisConfig()) return;
  try {
    await redisCommand("LPUSH", "affareradar:agentos:events", JSON.stringify(event));
    await redisCommand("LTRIM", "affareradar:agentos:events", 0, 499);
  } catch {}
}

async function createAgentOsDagForVerifiedDeal(deal) {
  if (!redisConfig()) return null;
  try {
    const dag = offerDagTemplate(deal, {
      requirePublishApproval:false,
      recheckDelaySeconds:Number(process.env.AGENTOS_DAG_RECHECK_SECONDS || 1800)
    });
    const verifyNode = dag.nodes.find(node => node.name === "verify");
    if (verifyNode) {
      verifyNode.status = "COMPLETED";
      verifyNode.attempts = 1;
      verifyNode.completedAt = new Date().toISOString();
      verifyNode.result = { verified:true, source:"creators_api" };
    }
    dag.updatedAt = new Date().toISOString();
    await redisCommand("SET", `affareradar:agentos:dag:${dag.dagId}`, JSON.stringify(dag), "EX", 604800);
    await redisCommand("ZADD", "affareradar:agentos:dags", String(Date.parse(dag.updatedAt) || Date.now()), dag.dagId);
    await recordAgentOsEvent(agentOsEvent("AFFARERADAR_DAG_CREATED", deal, {
      lifecycle:"RUNNING",
      knowledgeStatus:"VERIFIED",
      payload:{ dagId:dag.dagId, summary:dagSummary(dag), trigger:"amazon_verified_discovery" }
    }));
    return dag;
  } catch {
    return null;
  }
}

async function advanceAgentOsDag(req, dagId, merged) {
  if (!dagId || !redisConfig()) return null;
  try {
    const dr = await redisCommand("GET", `affareradar:agentos:dag:${dagId}`);
    if (!dr.result) return null;
    const dag = JSON.parse(dr.result);
    dag.offer = merged;
    const verifyNode = (dag.nodes || []).find(node => node.name === "verify");
    if (verifyNode) {
      verifyNode.status = "COMPLETED";
      verifyNode.attempts = Math.max(1, Number(verifyNode.attempts || 0));
      verifyNode.completedAt = new Date().toISOString();
      verifyNode.result = {
        verified:true,
        provider:merged.verificationProvider || merged.amazonDataSource || merged.priceSource || "creators_api"
      };
      verifyNode.lastError = null;
    }
    dag.updatedAt = new Date().toISOString();
    await redisCommand("SET", `affareradar:agentos:dag:${dagId}`, JSON.stringify(dag), "EX", 604800);
    await redisCommand("ZADD", "affareradar:agentos:dags", String(Date.now()), dagId);

    const host = req.headers.host;
    const secret = process.env.PUBLISH_SECRET;
    if (!host || !secret) return { dagId, advanced:false, reason:"host_or_secret_missing" };
    const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const endpoint = `${protocol}://${host}/api/dashboard`;
    const headers = { "Content-Type":"application/json", "x-affareradar-secret":secret };
    const steps = [];

    for (let i = 0; i < 6; i++) {
      const dagRes = await fetch(endpoint, {
        method:"POST",
        headers,
        body:JSON.stringify({ action:"process_dag", dagId })
      });
      const dagData = await dagRes.json().catch(() => ({}));
      steps.push({ action:"process_dag", ok:dagRes.ok, status:dagData?.dag?.status || dagData?.summary?.status || null });
      if (!dagRes.ok || ["COMPLETED","FAILED","WAIT_APPROVAL"].includes(String(dagData?.dag?.status || ""))) break;

      const taskRes = await fetch(endpoint, {
        method:"POST",
        headers,
        body:JSON.stringify({ action:"process_tasks", limit:4 })
      });
      const taskData = await taskRes.json().catch(() => ({}));
      steps.push({ action:"process_tasks", ok:taskRes.ok, processed:Number(taskData?.processed || 0) });
      if (!taskRes.ok || Number(taskData?.processed || 0) === 0) break;
    }

    return { dagId, advanced:true, steps };
  } catch (error) {
    return { dagId, advanced:false, error:String(error?.message || error) };
  }
}

async function updateSourceVerificationOutcome(body, outcome = {}) {
  if (!redisConfig() || !body?.source) return;
  try {
    for (const dimension of sourceReputationKeys(body)) {
      const key = `affareradar:source:stats:${dimension.suffix}`;
      const rr = await redisCommand("GET", key);
      let stats = {};
      if (rr.result) {
        try { stats = JSON.parse(rr.result); } catch {}
      }
      const next = applySourceOutcome(stats, outcome);
      await redisCommand("SET", key, JSON.stringify(next), "EX", 7776000);
    }
  } catch {}
}

async function processVerificationQueue(req, token, cfg, paCfg) {
  if (!redisConfig()) return { processed:0, verified:0, results:[] };

  const rr = await redisCommand("ZRANGE", "affareradar:verification:queue", 0, 2);
  const ids = Array.isArray(rr.result) ? rr.result : [];
  const results = [];
  let verified = 0;

  for (const dealId of ids) {
    const itemResult = await redisCommand("GET", `affareradar:verification:item:${dealId}`);
    if (!itemResult.result) {
      await redisCommand("ZREM", "affareradar:verification:queue", dealId);
      continue;
    }

    let queued;
    try { queued = JSON.parse(itemResult.result); } catch { queued = null; }
    if (!queued?.body) {
      await redisCommand("ZREM", "affareradar:verification:queue", dealId);
      await redisCommand("DEL", `affareradar:verification:item:${dealId}`);
      continue;
    }

    const asin = String(
      queued.plan?.asin ||
      queued.body.asin ||
      queued.body.signalClaims?.asinCandidate ||
      extractAsinFromUrl(queued.body.amazonUrl || "") ||
      ""
    ).trim().toUpperCase();
    if (!asin) {
      results.push({ dealId, ok:false, error:"asin_missing" });
      continue;
    }

    try {
      const attempts = [];
      let verifiedDeal = null;
      let provider = null;

      if (cfg && token) {
        const health = await readProviderHealth("creators_api");
        if (!providerCanAttempt(health)) {
          attempts.push({ provider:"creators_api", ok:false, skipped:true, reason:"circuit_open", retryAfter:health.retryAfter || null });
        } else {
          try {
            const items = await searchItems(token, cfg, asin);
            const exact = items.find(item => String(item?.asin || "").toUpperCase() === asin);
            verifiedDeal = exact ? toDeal(exact, `verify:${asin}`) : null;
            attempts.push({ provider:"creators_api", ok:Boolean(verifiedDeal) });
            if (verifiedDeal) {
              provider = "creators_api";
              await providerSuccess("creators_api");
            }
          } catch (error) {
            const nextHealth = await providerFailure("creators_api", error);
            attempts.push({ provider:"creators_api", ok:false, error:String(error?.message || error), providerHealth:nextHealth.state });
          }
        }
      }

      if (!verifiedDeal && paCfg) {
        const health = await readProviderHealth("pa_api");
        if (!providerCanAttempt(health)) {
          attempts.push({ provider:"pa_api", ok:false, skipped:true, reason:"circuit_open", retryAfter:health.retryAfter || null });
        } else {
          try {
            const items = await paGetItem(paCfg, asin);
            const exact = items.find(item => String(item?.ASIN || "").toUpperCase() === asin);
            verifiedDeal = exact ? paItemToDeal(exact) : null;
            attempts.push({ provider:"pa_api", ok:Boolean(verifiedDeal) });
            if (verifiedDeal) {
              provider = "pa_api";
              await providerSuccess("pa_api");
            }
          } catch (error) {
            const nextHealth = await providerFailure("pa_api", error);
            attempts.push({ provider:"pa_api", ok:false, error:String(error?.message || error), providerHealth:nextHealth.state });
          }
        }
      }

      if (!verifiedDeal) {
        await updateSourceVerificationOutcome(queued.body, {
          rejected:1,
          falsePositive:1,
          provider:attempts.at(-1)?.provider || null,
          label:"verification_miss"
        });
        results.push({ dealId, asin, ok:false, error:"amazon_exact_match_not_found", attempts });
        await recordAgentOsEvent(agentOsEvent("AFFARERADAR_VERIFICATION_MISS", queued.body, {
          knowledgeStatus:"PARSED",
          payload:{ dealId, asin, attempts }
        }));
        continue;
      }

      const merged = mergeVerifiedAmazonData(queued.body, verifiedDeal);
      merged.verificationQueueDealId = dealId;
      merged.verificationResolvedAt = new Date().toISOString();
      merged.verificationProvider = provider;

      let publish;
      let dagAdvance = null;
      if (queued.dagId) {
        dagAdvance = await advanceAgentOsDag(req, queued.dagId, merged);
        publish = {
          ok:Boolean(dagAdvance?.advanced),
          status:dagAdvance?.advanced ? 200 : 502,
          data:{ ok:Boolean(dagAdvance?.advanced), decision:"dag_advanced", dagAdvance }
        };
      } else {
        publish = await publishDeal(req, merged);
      }
      const resolved = publish.ok && publish.data?.decision !== "verify";

      if (resolved) {
        verified += 1;
        await updateSourceVerificationOutcome(queued.body, {
          confirmed:1,
          provider,
          label:"verified"
        });
        await redisCommand("ZREM", "affareradar:verification:queue", dealId);
        await redisCommand("DEL", `affareradar:verification:item:${dealId}`);
        await redisCommand("INCR", "affareradar:metrics:verification_resolved");
        if (queued.quarantineId) {
          await redisCommand("ZREM", "affareradar:quarantine:queue", queued.quarantineId);
          await redisCommand("DEL", `affareradar:quarantine:${queued.quarantineId}`);
        }
      }

      await recordAgentOsEvent(agentOsEvent(
        resolved ? "AFFARERADAR_VERIFIED" : "AFFARERADAR_VERIFICATION_RETRY",
        merged,
        {
          knowledgeStatus:resolved ? "VERIFIED" : "PARSED",
          payload:{ dealId, asin, provider, attempts, publishDecision:publish.data?.decision || null }
        }
      ));

      results.push({ dealId, asin, ok:resolved, provider, attempts, publish });
    } catch (error) {
      results.push({ dealId, asin, ok:false, error:String(error?.message || error) });
    }
  }

  return { processed:ids.length, verified, results };
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
  const __obs = startRuntimeObservation(req, "/api/discover-amazon");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const cfg = creatorsConfig();
  const paCfg = paConfig();
  if (!cfg && !paCfg) {
    return res.status(503).json({
      ok:false,
      error:"amazon_verification_provider_not_configured",
      required:[
        "AMAZON_CREATORS_CREDENTIAL_ID + AMAZON_CREATORS_CREDENTIAL_SECRET",
        "or AMAZON_PAAPI_ACCESS_KEY + AMAZON_PAAPI_SECRET_KEY",
        "AMAZON_PARTNER_TAG"
      ]
    });
  }

  try {
    const token = cfg ? await getAccessToken(cfg) : null;
    const verificationQueue = await processVerificationQueue(req, token, cfg, paCfg);
    const providerHealth = {
      creators:cfg ? await readProviderHealth("creators_api") : null,
      paApi:paCfg ? await readProviderHealth("pa_api") : null
    };
    if (req.body?.verificationOnly === true) {
      return res.status(200).json({
        ok:true,
        mode:"verification_only",
        providers:{ creators:Boolean(cfg), paApi:Boolean(paCfg) },
        providerHealth,
        verificationQueue
      });
    }
    const queries = cfg ? searchTerms() : [];
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
      const dag = await createAgentOsDagForVerifiedDeal(deal);
      const publish = await publishDeal(req, deal);
      results.push({
        asin:deal.asin,
        title:deal.title,
        dealScore:deal.dealScore,
        discount:deal.discount,
        dag:dag ? { dagId:dag.dagId, status:dag.status } : null,
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

    runtimeSuccess(__obs, { discovered:unique.length, submitted:results.length, verificationProcessed:verificationQueue.processed || 0 });
    runtimeSuccess(__obs, { discovered:unique.length, submitted:results.length, verificationProcessed:Number(verificationQueue?.processed || 0) });
    return res.status(200).json({
      ok:true,
      source:cfg ? "amazon_creators_api" : "amazon_verification_only",
      marketplace:MARKETPLACE,
      queries,
      discovered:unique.length,
      submitted:results.length,
      verificationQueue,
      providerHealth,
      results
    });
  } catch (error) {
    runtimeFailure(__obs, error);
    return res.status(502).json({
      ok:false,
      error:"amazon_discovery_failed",
      detail:String(error?.message || error)
    });
  }
}
