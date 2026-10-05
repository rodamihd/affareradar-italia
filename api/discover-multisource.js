// PRIME_EVENT_ENV_REFRESH_V1
import crypto from "node:crypto";
import { amazonAgentUserAgent, evaluateProductEligibility } from "../lib/amazon-compliance.js";
import { agentOsEvent, universalEntityId } from "../lib/agentos-adapter.js";
import { buildSignalQuarantine, extractAsinFromAmazonUrl } from "../lib/signal-quarantine.js";
import { offerDagTemplate, dagSummary } from "../lib/agentos-dag.js";
import { startRuntimeObservation, runtimeSuccess, runtimeFailure } from "../lib/runtime-observability.js";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";
import { runAgentOsSelfTest } from "../lib/agentos-selftest.js";
import { sourceReputationKeys, applySourceOutcome } from "../lib/source-reputation.js";
// PREAPI_RUNTIME_CONFIG_V2
// DEAL_SOURCE_SET_V1

async function verifyGithubFallback(req) {
  const token = String(req.headers["x-github-oidc-token"] || "").trim();
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || !header.kid) return false;
    if (payload.iss !== "https://token.actions.githubusercontent.com") return false;
    if (payload.repository !== "rodamihd/affareradar-italia") return false;
    if (payload.ref !== "refs/heads/main") return false;
    if (!["schedule","workflow_dispatch"].includes(payload.event_name)) return false;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) return false;

    const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");
    if (!response.ok) return false;
    const jwks = await response.json();
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(k => k.kid === header.kid) : null;
    if (!jwk) return false;
    const key = crypto.createPublicKey({ key:jwk, format:"jwk" });
    return crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url")
    );
  } catch {
    return false;
  }
}

async function authorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  const publishSecret = process.env.PUBLISH_SECRET;
  const schedulerSecret = process.env.AFFARERADAR_SCHEDULER_SECRET;
  if (
    (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) ||
    (publishSecret && req.headers["x-affareradar-secret"] === publishSecret) ||
    (schedulerSecret && req.headers["x-affareradar-scheduler"] === schedulerSecret)
  ) return { ok:true, trigger:req.headers["x-vercel-cron-schedule"] ? "vercel_cron" : "secret" };
  if (await verifyGithubFallback(req)) return { ok:true, trigger:"github_oidc_fallback" };
  return { ok:false, trigger:null };
}

function sourceUrls() {
  const configured = String(process.env.DEAL_SOURCE_URLS || "")
    .split("|")
    .map(x => x.trim())
    .filter(Boolean);

  const defaults = [
    "https://t.me/s/scontierrati"
  ];

  return [...new Set([...(configured.length ? configured : defaults)])].slice(0, 12);
}


function sourceIdentity(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host === "t.me" || host === "telegram.me") {
      const parts = u.pathname.split("/").filter(Boolean);
      const channel = parts[0] === "s" ? parts[1] : parts[0];
      return channel ? `telegram:${channel.toLowerCase()}` : "telegram:unknown";
    }
    return host;
  } catch {
    return "unknown";
  }
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAmazonUrl(text) {
  const m = String(text || "").match(
    /https?:\/\/(?:www\.)?amazon\.it\/[^\s"'<>]+|https?:\/\/amzn\.eu\/[^\s"'<>]+|https?:\/\/amzlink\.to\/[^\s"'<>]+|https?:\/\/link\.amazon\/[^\s"'<>]+/i
  );
  return m ? m[0].replace(/&amp;/g, "&") : null;
}

function normalizeAmazonUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();

    if (host === "amzn.eu" || host === "amzlink.to" || host === "link.amazon") {
      return u.toString();
    }

    if (!(host === "amazon.it" || host.endsWith(".amazon.it"))) return null;

    const tag = process.env.AMAZON_PARTNER_TAG;
    if (tag) u.searchParams.set("tag", tag);

    return u.toString();
  } catch {
    return null;
  }
}

async function resolveAmazonUrl(raw) {
  if (!raw) return null;

  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();

    if (host === "amazon.it" || host.endsWith(".amazon.it")) {
      return normalizeAmazonUrl(raw);
    }

    if (host !== "amzn.eu" && host !== "amzlink.to" && host !== "link.amazon") return null;

    let r;
    try {
      r = await fetch(raw, {
        method:"HEAD",
        redirect:"follow",
        headers:{ "User-Agent":amazonAgentUserAgent("AffareRadarMultiSource") }
      });
    } catch {}

    if (!r?.url || r.url === raw) {
      r = await fetch(raw, {
        method:"GET",
        redirect:"follow",
        headers:{ "User-Agent":amazonAgentUserAgent("AffareRadarMultiSource") }
      });
    }

    return normalizeAmazonUrl(r?.url || null);
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const size = Math.max(1, Number(limit) || 1);
  const out = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch {
        out[i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length:Math.min(size, items.length) }, () => run()));
  return out;
}

function euroValues(text) {
  const s = String(text || "");
  return [...s.matchAll(/(?:€\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)|([0-9]{1,5}(?:[.,][0-9]{1,2})?)\s*€)/g)]
    .map(m => (m[1] || m[2] || "").replace(".", ","))
    .filter(Boolean);
}

function parsePrice(text) {
  const values = euroValues(text);
  return values.length ? `${values[0]} €` : null;
}

function parseOldPrice(text) {
  const s = String(text || "");
  const explicit =
    s.match(/(?:invece\s+di|anzich[eé]|prima|prezzo\s+(?:originale|di\s+listino)|listino|da)\s*[:\-]?\s*(?:€\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)|([0-9]{1,5}(?:[.,][0-9]{1,2})?)\s*€)/i);
  if (explicit) {
    const raw = explicit[1] || explicit[2];
    return `${raw.replace(".", ",")} €`;
  }

  const values = euroValues(text);
  if (values.length < 2) return null;
  const current = Number(values[0].replace(",", "."));
  const candidates = values.slice(1)
    .map(v => ({ raw:v, n:Number(v.replace(",", ".")) }))
    .filter(x => Number.isFinite(x.n) && x.n > current);
  if (!candidates.length) return null;
  candidates.sort((a,b) => b.n - a.n);
  return `${candidates[0].raw} €`;
}

function parseCoupon(text) {
  const s = decodeHtml(String(text || ""));
  if (!/coupon|codice\s+sconto|buono|applica\s+coupon|stack/i.test(s)) return null;

  const code = s.match(/(?:codice\s+sconto|coupon|codice)\s*[:\-]?\s*([A-Z0-9_-]{4,24})\b/i);
  if (code && !/^(SCONTO|AMAZON|PRIME|DISPONIBILE)$/i.test(code[1])) {
    return `Codice ${code[1].toUpperCase()}`;
  }

  const pct = s.match(/(?:coupon|buono|sconto)\s*(?:del|di)?\s*([1-9][0-9]?)\s*%/i);
  if (pct) return `Coupon -${pct[1]}%`;

  const amount = s.match(/(?:coupon|buono|sconto)\s*(?:da|di)?\s*(?:€\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)|([0-9]{1,4}(?:[.,][0-9]{1,2})?)\s*€)/i);
  if (amount) {
    const raw = amount[1] || amount[2];
    return `Coupon ${raw.replace(".", ",")} €`;
  }

  return "Coupon disponibile";
}

function parseDiscount(text) {
  const m = String(text || "").match(/(?:-|−)?\s*([1-9][0-9]?)\s*%/);
  return m ? `-${m[1]}%` : null;
}

function scoreCandidate(text, discount, coupon, dealType) {
  let score = 58;
  const pct = Number(String(discount || "").replace(/[^0-9]/g, ""));
  if (Number.isFinite(pct) && pct > 0) score += Math.min(34, pct * 1.1);
  if (coupon) score += 8;
  const s = String(text || "").toLowerCase();
  if (/minimo storico|prezzo minimo|lowest price/.test(s)) score += 10;
  if (dealType === "price_error") score += 16;
  if (/prime|coupon|codice sconto/.test(s)) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function detectType(text) {
  const s = String(text || "").toLowerCase();
  if (/errore(?: di)? prezzo|price error/.test(s)) return "price_error";
  if (/coupon|codice sconto|stack/.test(s)) return "coupon_stack";
  return "deal";
}

function itemFromText(text, source, imageUrl = null, publishedAt = null) {
  if (/TERMINATA|SCADUTA|NON PIÙ DISPONIBILE/i.test(text)) return null;

  const amazonUrl = normalizeAmazonUrl(extractAmazonUrl(text));
  const price = parsePrice(text);
  if (!amazonUrl || !price) return null;

  const oldPrice = parseOldPrice(text);
  const discount = parseDiscount(text);
  const dealType = detectType(text);
  const coupon = parseCoupon(text);
  const title = decodeHtml(text)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "Offerta Amazon";

  return {
    title,
    price,
    oldPrice,
    effectivePrice:price,
    discount,
    coupon,
    category:"Amazon",
    reason:`Rilevata automaticamente da ${source}`,
    amazonUrl,
    imageUrl,
    imageSource:imageUrl ? "external_signal" : null,
    imageVerifiedByAmazon:false,
    dealScore:scoreCandidate(text, discount, coupon, dealType),
    reliabilityScore:82,
    dealType,
    historicalLow:/minimo storico|prezzo minimo|lowest price/i.test(text),
    stock:true,
    lastVerifiedAt:publishedAt || new Date().toISOString(),
    source,
    sourceVerified:true,
    priceSource:"external_signal",
    priceVerifiedByAmazon:false,
    promotionVerifiedByAmazon:false,
    couponVerifiedByAmazon:false
  };
}

function parseTelegram(html, source) {
  const out = [];
  const raw = String(html || "");
  const chunks = raw.split(/<div class="tgme_widget_message_wrap\b[^>]*>/i).slice(1);

  for (const chunk of chunks) {
    if (out.length >= 30) break;

    const nextWrap = chunk.search(/<div class="tgme_widget_message_wrap\b[^>]*>/i);
    const block = nextWrap >= 0 ? chunk.slice(0, nextWrap) : chunk;

    const textMatch =
      block.match(/<div class="tgme_widget_message_text\b[^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<div class="tgme_widget_message_caption\b[^>]*>([\s\S]*?)<\/div>/i);

    if (!textMatch) continue;

    const text = textMatch[1];
    const image =
      block.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1] ||
      block.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
      null;
    const datetime = block.match(/datetime=["']([^"']+)["']/i)?.[1] || null;

    const item = itemFromText(text, source, image, datetime);
    if (item) out.push(item);
  }

  if (!out.length) {
    const messageBlocks = raw.match(/<div class="tgme_widget_message\b[\s\S]*?(?=<div class="tgme_widget_message_wrap\b|$)/gi) || [];
    for (const block of messageBlocks) {
      if (out.length >= 30) break;
      const textMatch =
        block.match(/<div class="tgme_widget_message_text\b[^>]*>([\s\S]*?)<\/div>/i) ||
        block.match(/<div class="tgme_widget_message_caption\b[^>]*>([\s\S]*?)<\/div>/i);
      if (!textMatch) continue;
      const image =
        block.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1] ||
        block.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
        null;
      const datetime = block.match(/datetime=["']([^"']+)["']/i)?.[1] || null;
      const item = itemFromText(textMatch[1], source, image, datetime);
      if (item) out.push(item);
    }
  }

  return out;
}

function parseRss(xml, source) {
  const out = [];
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const block of blocks.slice(0, 30)) {
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
    const desc = block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] || "";
    const link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ||
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "";
    const date = block.match(/<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i)?.[1] || null;
    const text = `${title} ${desc} ${link}`;
    const item = itemFromText(text, source, null, date);
    if (item) out.push(item);
  }
  return out;
}

function parseJson(data, source) {
  const rows = Array.isArray(data) ? data :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.deals) ? data.deals :
    Array.isArray(data?.results) ? data.results : [];

  const out = [];
  for (const row of rows.slice(0, 50)) {
    const rawText = [
      row.title, row.name, row.description, row.text,
      row.amazonUrl, row.url, row.link,
      row.price, row.oldPrice, row.discount, row.coupon
    ].filter(Boolean).join(" ");

    const amazonUrl = normalizeAmazonUrl(row.amazonUrl || extractAmazonUrl(rawText));
    const price = row.price ? String(row.price) : parsePrice(rawText);
    if (!amazonUrl || !price) continue;

    const discount = row.discount ? String(row.discount) : parseDiscount(rawText);
    const dealType = row.dealType || detectType(rawText);
    const coupon = row.coupon || (/coupon|codice sconto|stack/i.test(rawText) ? "Promo rilevata dalla fonte" : null);

    out.push({
      title:String(row.title || row.name || "Offerta Amazon").slice(0, 180),
      price,
      oldPrice:row.oldPrice || null,
      effectivePrice:row.effectivePrice || price,
      discount,
      coupon,
      category:row.category || "Amazon",
      reason:row.reason || `Rilevata automaticamente da ${source}`,
      amazonUrl,
      imageUrl:row.imageUrl || row.image || null,
      imageSource:(row.imageUrl || row.image) ? "external_signal" : null,
      imageVerifiedByAmazon:false,
      asin:row.asin || null,
      dealScore:Number.isFinite(Number(row.dealScore)) ? Number(row.dealScore) : scoreCandidate(rawText, discount, coupon, dealType),
      reliabilityScore:Number.isFinite(Number(row.reliabilityScore)) ? Number(row.reliabilityScore) : 88,
      dealType,
      prime:row.prime === true,
      historicalLow:row.historicalLow === true || /minimo storico|prezzo minimo|lowest price/i.test(rawText),
      stock:row.stock === false ? false : true,
      lastVerifiedAt:row.lastVerifiedAt || row.publishedAt || new Date().toISOString(),
      source,
      sourceVerified:true,
      priceSource:"external_signal",
      priceVerifiedByAmazon:false,
      promotionVerifiedByAmazon:false,
      couponVerifiedByAmazon:false
    });
  }
  return out;
}

async function fetchSource(url) {
  const r = await fetch(url, {
    headers:{
      "User-Agent":"AffareRadar/1.0 (+https://affareradar-italia.vercel.app)"
    },
    redirect:"follow"
  });
  if (!r.ok) throw new Error(`source_http_${r.status}`);

  const type = String(r.headers.get("content-type") || "").toLowerCase();
  const text = await r.text();
  const source = sourceIdentity(url);

  if (type.includes("application/json") || /^[\s\n]*[\[{]/.test(text)) {
    const data = JSON.parse(text);
    return parseJson(data, source);
  }
  if (url.includes("t.me/") || /tgme_widget_message/.test(text)) {
    return parseTelegram(text, source);
  }
  return parseRss(text, source);
}

async function recordAgentOsEvent(event) {
  if (!redisConfig()) return;
  try {
    await redisCommand("LPUSH", "affareradar:agentos:events", JSON.stringify(event));
    await redisCommand("LTRIM", "affareradar:agentos:events", 0, 499);
  } catch {}
}

async function persistQuarantine(deal) {
  if (!redisConfig() || !deal.signalClaims) return { stored:false };
  try {
    const entityId = universalEntityId(deal);
    const record = {
      entityId,
      status:"PARSED",
      quarantineId:deal.signalClaims.quarantineId,
      signalClaims:deal.signalClaims,
      title:deal.title || null,
      amazonUrl:deal.amazonUrl || null,
      asin:deal.asin || null,
      source:deal.source || null,
      createdAt:new Date().toISOString()
    };
    await redisCommand("SET", `affareradar:quarantine:${deal.signalClaims.quarantineId}`, JSON.stringify(record), "EX", 172800);
    await redisCommand("ZADD", "affareradar:quarantine:queue", String(Date.now()), deal.signalClaims.quarantineId);
    return { stored:true, entityId, quarantineId:deal.signalClaims.quarantineId };
  } catch {
    return { stored:false };
  }
}

async function createAgentOsDagForSignal(deal) {
  if (!redisConfig()) return null;
  try {
    const dag = offerDagTemplate(deal, {
      requirePublishApproval:false,
      recheckDelaySeconds:Number(process.env.AGENTOS_DAG_RECHECK_SECONDS || 1800)
    });
    await redisCommand("SET", `affareradar:agentos:dag:${dag.dagId}`, JSON.stringify(dag), "EX", 604800);
    await redisCommand("ZADD", "affareradar:agentos:dags", String(Date.parse(dag.updatedAt) || Date.now()), dag.dagId);
    await recordAgentOsEvent(agentOsEvent("AFFARERADAR_DAG_CREATED", deal, {
      lifecycle:"RUNNING",
      knowledgeStatus:"PARSED",
      payload:{ dagId:dag.dagId, summary:dagSummary(dag), trigger:"multisource_signal" }
    }));
    return dag;
  } catch {
    return null;
  }
}

async function updateSourceStats(deal, publish) {
  if (!redisConfig() || !deal?.source) return;
  try {
    const decision = String(publish?.data?.decision || "").toLowerCase();
    const verificationState = String(publish?.data?.verification?.state || "").toUpperCase();
    const outcome = {
      total:1,
      confirmed:verificationState === "VERIFIED" ? 1 : 0,
      rejected:(decision === "rejected" || publish?.ok === false) ? 1 : 0,
      published:publish?.data?.published === true ? 1 : 0,
      verificationRequired:decision === "verify" ? 1 : 0,
      falsePositive:0,
      provider:null,
      label:decision || "captured"
    };
    for (const dimension of sourceReputationKeys(deal)) {
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

async function enqueueSignalVerification(deal, dag) {
  if (!redisConfig()) return { queued:false, error:"redis_required" };
  const dealId = deal.asin || deal.signalClaims?.asinCandidate || universalEntityId(deal);
  const plan = {
    asin:deal.asin || deal.signalClaims?.asinCandidate || null,
    currentState:"SIGNAL_ONLY",
    attempts:["creators_api","pa_api","amazon_link_tool_manual"],
    requestedBy:"SignalQuarantine2",
    quarantineId:deal.signalClaims?.quarantineId || null
  };
  const payload = {
    body:deal,
    dealId,
    plan,
    queuedAt:new Date().toISOString(),
    dagId:dag?.dagId || null,
    quarantineId:deal.signalClaims?.quarantineId || null
  };
  await redisCommand("SET", `affareradar:verification:item:${dealId}`, JSON.stringify(payload), "EX", 86400);
  await redisCommand("ZADD", "affareradar:verification:queue", String(Date.now()), dealId);
  return { queued:true, dealId, dagId:dag?.dagId || null, plan };
}

function amazonVerificationProviderConfigured() {
  const creators = Boolean(
    process.env.AMAZON_CREATORS_CREDENTIAL_ID &&
    process.env.AMAZON_CREATORS_CREDENTIAL_SECRET
  );
  const paapi = Boolean(
    process.env.AMAZON_PAAPI_ACCESS_KEY &&
    process.env.AMAZON_PAAPI_SECRET_KEY
  );
  return creators || paapi;
}

async function wakeVerificationWorker(req) {
  if (String(process.env.AFFARERADAR_PRE_API_MODE || "").trim() === "1" && !amazonVerificationProviderConfigured()) {
    return { triggered:false, reason:"preapi_no_amazon_provider" };
  }
  const host = req.headers.host;
  const secret = process.env.PUBLISH_SECRET;
  if (!host || !secret) return { triggered:false, reason:"host_or_secret_missing" };
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${protocol}://${host}/api/discover-amazon`, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":secret
      },
      body:JSON.stringify({ verificationOnly:true }),
      signal:controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return {
      triggered:true,
      ok:response.ok && data.ok !== false,
      status:response.status,
      processed:Number(data?.verificationQueue?.processed || 0),
      verified:Number(data?.verificationQueue?.verified || 0),
      providers:data?.providers || null
    };
  } catch (error) {
    return { triggered:true, ok:false, error:String(error?.name === "AbortError" ? "verification_worker_timeout" : error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function submit(req, deal) {
  const host = req.headers.host;
  if (!host) throw new Error("host_missing");
  const secret = process.env.PUBLISH_SECRET;
  if (!secret) throw new Error("publish_secret_missing");
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();

  const r = await fetch(`${protocol}://${host}/api/auto-publish`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":secret
    },
    body:JSON.stringify(deal)
  });
  const data = await r.json().catch(() => ({}));
  return { ok:r.ok, status:r.status, data };
}

async function submitPreApi(req, deal) {
  if (String(process.env.AFFARERADAR_PRE_API_MODE || "").trim() !== "1") {
    return { attempted:false, ok:true, status:0, data:{ published:false, reason:"preapi_mode_disabled" } };
  }

  const signalScore = Number(deal.dealScore);
  const minSignalScore = Math.max(80, Math.min(100, Number(process.env.PREAPI_MIN_SIGNAL_SCORE || 92)));
  const asin = String(deal.asin || "").trim().toUpperCase();
  let amazonUrl = null;
  try {
    const u = new URL(deal.amazonUrl || "");
    const host = u.hostname.toLowerCase();
    if (host === "amazon.it" || host.endsWith(".amazon.it")) amazonUrl = u.toString();
  } catch {}

  if (!amazonUrl || !/^[A-Z0-9]{10}$/.test(asin)) {
    return { attempted:true, ok:true, status:200, data:{ published:false, decision:"rejected", reason:"amazon_product_identity_required" } };
  }
  if (deal.sourceVerified !== true) {
    return { attempted:true, ok:true, status:200, data:{ published:false, decision:"rejected", reason:"source_not_verified" } };
  }
  if (!Number.isFinite(signalScore) || signalScore < minSignalScore) {
    return { attempted:true, ok:true, status:200, data:{ published:false, decision:"rejected", reason:"preapi_signal_score_below_threshold", threshold:minSignalScore, signalScore:Number.isFinite(signalScore) ? signalScore : null } };
  }
  if (!redisConfig()) {
    return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"redis_required" } };
  }

  const clean = value => String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:EUR|€)\s*\d{1,5}(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\d{1,5}(?:[.,]\d{1,2})?\s*(?:EUR|€)/gi, " ")
    .replace(/(?:-|−)?\s*\d{1,3}\s*%/g, " ")
    .replace(/\b(?:minimo storico|prezzo minimo|price error|errore(?: di)? prezzo|coupon|codice sconto|stack promo|offerta imperdibile|affare pazzesco)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const candidate = {
    title:clean(deal.title).slice(0, 140) || `Prodotto Amazon ${asin}`,
    category:clean(deal.category).slice(0, 60) || "Amazon",
    reason:"Segnalazione prodotto selezionata da AffareRadar. Prezzo e disponibilità vanno verificati direttamente su Amazon.",
    amazonUrl,
    asin,
    dealType:"preapi_pick",
    source:deal.source || "external_signal",
    sourceVerified:true,
    price:null,
    oldPrice:null,
    effectivePrice:null,
    discount:null,
    coupon:null,
    stack:null,
    historicalLow:false,
    prime:false,
    imageUrl:null,
    imageSource:null,
    imageSuppressed:true,
    suppressPriceDisplay:true,
    preApiMode:true,
    commercialClaimsSuppressed:true,
    signalScore,
    dealScore:null,
    reliabilityScore:null
  };

  const eligibility = evaluateProductEligibility(candidate);
  if (!eligibility.passed) {
    return { attempted:true, ok:true, status:200, data:{ published:false, decision:"rejected", reason:"product_not_eligible", productEligibility:eligibility } };
  }

  const now = new Date();
  const localOffsetHours = Number(process.env.AFFARERADAR_LOCAL_UTC_OFFSET_HOURS || 2);
  const localNowMs = now.getTime() + localOffsetHours * 60 * 60 * 1000;
  const localNow = new Date(localNowMs);
  const localDay = localNow.toISOString().slice(0, 10);
  const localHour = localNow.getUTCHours();

  const eventStart = String(process.env.AFFARERADAR_EVENT_START_DATE || "").trim();
  const eventEnd = String(process.env.AFFARERADAR_EVENT_END_DATE || "").trim();
  const eventActive = Boolean(eventStart && eventEnd && localDay >= eventStart && localDay <= eventEnd);

  const defaultMaxPerDay = Math.max(1, Math.min(3, Number(process.env.PREAPI_MAX_PER_DAY || 1)));
  const eventMaxPerDay = Math.max(defaultMaxPerDay, Math.min(12, Number(process.env.PREAPI_EVENT_MAX_PER_DAY || 9)));
  const maxPerDay = eventActive ? eventMaxPerDay : defaultMaxPerDay;

  const eventSlotHours = String(process.env.PREAPI_EVENT_SLOT_HOURS || "8,10,12,14,16,18,20,22")
    .split(",")
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v >= 0 && v <= 23);

  const slot =
    eventActive
      ? (eventSlotHours.includes(localHour) ? `event_${String(localHour).padStart(2, "0")}` : null)
      : (
          localHour >= 6 && localHour < 12 ? "morning" :
          localHour >= 12 && localHour < 18 ? "afternoon" :
          localHour >= 18 && localHour < 24 ? "evening" :
          null
        );

  if (!slot) {
    return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"outside_publication_window", localHour, eventActive } };
  }

  const day = localDay;
  const dayKey = `affareradar:preapi:day:${day}`;
  const slotKey = `affareradar:preapi:slot:${day}:${slot}`;
  const asinKey = `affareradar:preapi:asin:${asin}`;
  try {
    const [count, seen, slotSeen] = await Promise.all([
      redisCommand("GET", dayKey),
      redisCommand("GET", asinKey),
      redisCommand("GET", slotKey)
    ]);
    if (seen.result) return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"duplicate_asin_24h" } };
    if (slotSeen.result) return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"slot_already_used", slot } };
    if (Number(count.result || 0) >= maxPerDay) return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"daily_limit", maxPerDay } };

    const slotLock = await redisCommand("SET", slotKey, asin, "NX", "EX", 172800);
    if (slotLock.result !== "OK") return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"slot_already_used", slot } };

    const lock = await redisCommand("SET", asinKey, now.toISOString(), "NX", "EX", 86400);
    if (lock.result !== "OK") {
      await redisCommand("DEL", slotKey);
      return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"duplicate_asin_24h" } };
    }

    const inc = await redisCommand("INCR", dayKey);
    await redisCommand("EXPIRE", dayKey, 172800);
    if (Number(inc.result || 0) > maxPerDay) {
      await redisCommand("DEL", asinKey);
      await redisCommand("DEL", slotKey);
      return { attempted:true, ok:true, status:200, data:{ published:false, decision:"held", reason:"daily_limit", maxPerDay } };
    }

    const host = req.headers.host;
    const secret = process.env.PUBLISH_SECRET;
    if (!host || !secret) {
      await redisCommand("DEL", asinKey);
      await redisCommand("DEL", slotKey);
      await redisCommand("DECR", dayKey);
      return { attempted:true, ok:false, status:0, data:{ published:false, reason:"host_or_secret_missing" } };
    }

    const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const response = await fetch(`${protocol}://${host}/api/telegram`, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":secret
      },
      body:JSON.stringify(candidate)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok !== true) {
      await redisCommand("DEL", asinKey);
      await redisCommand("DEL", slotKey);
      await redisCommand("DECR", dayKey);
      return { attempted:true, ok:true, status:200, data:{ published:false, decision:"failed", reason:"telegram_publish_failed", status:response.status } };
    }

    await redisCommand("SET", "affareradar:preapi:last_publish_at", new Date().toISOString(), "EX", 172800);
    await redisCommand("SET", "affareradar:preapi:last_asin", asin, "EX", 172800);

    return {
      attempted:true,
      ok:true,
      status:200,
      data:{
        ok:true,
        published:true,
        decision:"preapi_published",
        asin,
        telegramMessageId:data.telegram_message_id || null,
        signalScore,
        safeguards:{
          priceSuppressed:true,
          promotionSuppressed:true,
          imageSuppressed:true,
          sourceVerified:true,
          productEligibility:eligibility.status,
          dailyLimit:maxPerDay,
          publicationSlot:slot,
          localHour,
          eventActive,
          eventWindow:eventActive ? { start:eventStart, end:eventEnd, slotHours:eventSlotHours } : null
        }
      }
    };
  } catch (error) {
    return { attempted:true, ok:false, status:0, data:{ published:false, reason:String(error?.message || error) } };
  }
}

export default async function handler(req, res) {
  console.log("[AffareRadar][discover] start", JSON.stringify({ method:req.method, schedule:req.headers["x-vercel-cron-schedule"] || null, at:new Date().toISOString() }));
  const __obs = startRuntimeObservation(req, "/api/discover-multisource");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  const auth = await authorized(req);
  if (!auth.ok) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  // GitHub runs 15 minutes after each expected primary slot. It only takes
  // over when the primary cycle did not complete recently.
  if (auth.trigger === "github_oidc_fallback" && redisConfig()) {
    try {
      const rr = await redisCommand("GET", "affareradar:multisource:last_run_at");
      const lastRunAt = rr.result || null;
      const lastMs = Date.parse(lastRunAt || "");
      const ageMinutes = Number.isFinite(lastMs) ? Math.round((Date.now() - lastMs) / 60000) : null;
      const freshnessMinutes = Math.max(10, Math.min(60, Number(process.env.AFFARERADAR_FALLBACK_FRESH_MINUTES || 30)));
      if (ageMinutes != null && ageMinutes <= freshnessMinutes) {
        await redisCommand("SET", "affareradar:fallback:last_check", JSON.stringify({
          at:new Date().toISOString(), action:"skip", lastRunAt, ageMinutes
        }), "EX", 172800);
        return res.status(200).json({ ok:true, fallback:true, skipped:true, reason:"primary_recent", lastRunAt, ageMinutes });
      }
      await redisCommand("SET", "affareradar:fallback:last_check", JSON.stringify({
        at:new Date().toISOString(), action:"takeover", lastRunAt, ageMinutes
      }), "EX", 172800);
    } catch (error) {
      console.warn("[AffareRadar][fallback] freshness_check_failed", String(error?.message || error));
    }
  }

  const preflight = runAgentOsSelfTest();
  if (!preflight.passed) {
    runtimeFailure(__obs, new Error("agentos_preflight_failed"), { failedTests:preflight.failedCount });
    return res.status(503).json({
      ok:false,
      error:"agentos_preflight_failed",
      selfTest:{ total:preflight.total, failedCount:preflight.failedCount, failed:preflight.failed }
    });
  }

  // Cross-scheduler lock: Vercel Cron and the independent GitHub fallback
  // may occasionally overlap. Only one discovery cycle is allowed to enter
  // the production pipeline during this short window.
  if (redisConfig()) {
    try {
      const lock = await redisCommand(
        "SET",
        "affareradar:multisource:cycle_lock",
        JSON.stringify({
          at:new Date().toISOString(),
          trigger:auth.trigger || "direct"
        }),
        "NX",
        "EX",
        180
      );
      if (lock.result !== "OK") {
        return res.status(200).json({
          ok:true,
          skipped:true,
          reason:"discovery_cycle_already_running"
        });
      }
    } catch (error) {
      console.warn("[AffareRadar][discover] lock_unavailable", String(error?.message || error));
    }
  }

  const sources = sourceUrls();
  if (!sources.length) {
    return res.status(503).json({
      ok:false,
      error:"deal_sources_not_configured",
      required:["DEAL_SOURCE_URLS"],
      example:"https://example.com/feed.xml|https://t.me/s/examplechannel"
    });
  }

  const sourceResults = [];
  const candidates = [];

  for (const url of sources) {
    try {
      const items = await fetchSource(url);
      sourceResults.push({ url, ok:true, found:items.length });
      candidates.push(...items);
    } catch (error) {
      sourceResults.push({ url, ok:false, error:String(error?.message || error) });
    }
  }

  console.log("[AffareRadar][discover] sources", JSON.stringify({ sourceResults, rawCandidates:candidates.length }));

  const consensusGroups = new Map();
  const resolutionLimit = Math.max(12, Math.min(60, Number(process.env.MULTISOURCE_RESOLUTION_LIMIT || 40)));

  const resolutionCandidates = candidates
    .sort((a,b) => Number(b.dealScore || 0) - Number(a.dealScore || 0))
    .slice(0, resolutionLimit);
  const resolutionConcurrency = Math.max(2, Math.min(8, Number(process.env.MULTISOURCE_RESOLUTION_CONCURRENCY || 5)));
  const resolvedCandidates = await mapWithConcurrency(
    resolutionCandidates,
    resolutionConcurrency,
    async candidate => {
      const resolvedUrl = await resolveAmazonUrl(candidate.amazonUrl);
      if (!resolvedUrl) return null;
      const asin = candidate.asin || extractAsinFromAmazonUrl(resolvedUrl);
      return { candidate, resolvedUrl, asin:asin || null };
    }
  );

  for (const row of resolvedCandidates.filter(Boolean)) {
    const { candidate, resolvedUrl, asin } = row;
    const key = asin || resolvedUrl.split("?")[0];
    if (!key) continue;

    const source = String(candidate.source || "unknown");
    const existing = consensusGroups.get(key);
    if (!existing) {
      consensusGroups.set(key, {
        ...candidate,
        amazonUrl:resolvedUrl,
        asin:asin || null,
        consensusSources:[source],
        consensusSourceCount:1,
        consensusObservations:[{
          source,
          observedAt:candidate.lastVerifiedAt || candidate.publishedAt || null,
          dealScore:Number(candidate.dealScore || 0)
        }],
        rawDealScore:Number(candidate.dealScore || 0)
      });
      continue;
    }

    if (!existing.consensusSources.includes(source)) {
      existing.consensusSources.push(source);
      existing.consensusSourceCount = existing.consensusSources.length;
      existing.consensusObservations = Array.isArray(existing.consensusObservations) ? existing.consensusObservations : [];
      existing.consensusObservations.push({
        source,
        observedAt:candidate.lastVerifiedAt || candidate.publishedAt || null,
        dealScore:Number(candidate.dealScore || 0)
      });
    }
    if (Number(candidate.dealScore || 0) > Number(existing.rawDealScore || 0)) {
      existing.title = candidate.title || existing.title;
      existing.category = candidate.category || existing.category;
      existing.reason = candidate.reason || existing.reason;
      existing.rawDealScore = Number(candidate.dealScore || 0);
      existing.dealType = candidate.dealType || existing.dealType;
      existing.historicalLow = candidate.historicalLow === true || existing.historicalLow === true;
    }
  }

  const unique = [...consensusGroups.values()].map(deal => {
    const count = Math.max(1, Number(deal.consensusSourceCount || 1));
    const raw = Number(deal.rawDealScore || deal.dealScore || 0);
    const observations = Array.isArray(deal.consensusObservations) ? deal.consensusObservations : [];
    const timestamps = observations
      .map(x => Date.parse(x?.observedAt || ""))
      .filter(Number.isFinite);
    const freshnessSpanMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
    const freshnessAligned = timestamps.length < 2 || freshnessSpanMs <= 6 * 60 * 60 * 1000;
    const observedScores = observations
      .map(x => Number(x?.dealScore))
      .filter(Number.isFinite);
    const scoreSpread = observedScores.length >= 2 ? Math.max(...observedScores) - Math.min(...observedScores) : 0;
    const scoreAgreement = observedScores.length < 2 || scoreSpread <= 25;
    const exactProductIdentity = /^[A-Z0-9]{10}$/.test(String(deal.asin || ""));
    const corroborated = count >= 2 && exactProductIdentity && freshnessAligned && scoreAgreement;
    const boost = corroborated ? (count >= 4 ? 6 : count === 3 ? 4 : 2) : 0;
    const consensusScore = Math.max(0, Math.min(100, Math.round(raw + boost)));

    return {
      ...deal,
      dealScore:consensusScore,
      crossSourceConsensus:{
        sourceCount:count,
        sources:deal.consensusSources,
        rawDealScore:raw,
        boost,
        consensusScore,
        exactProductIdentity,
        freshnessAligned,
        freshnessSpanMinutes:Math.round(freshnessSpanMs / 60000),
        scoreAgreement,
        scoreSpread,
        corroborated,
        level:corroborated
          ? (count >= 4 ? "STRONG" : count === 3 ? "HIGH" : "MEDIUM")
          : (count >= 2 ? "UNCONFIRMED_MULTI_SOURCE" : "SINGLE_SOURCE")
      }
    };
  }).sort((a,b) =>
    Number(b.crossSourceConsensus?.corroborated === true) - Number(a.crossSourceConsensus?.corroborated === true) ||
    Number(b.crossSourceConsensus?.sourceCount || 1) - Number(a.crossSourceConsensus?.sourceCount || 1) ||
    Number(b.dealScore || 0) - Number(a.dealScore || 0)
  );

  const maxCandidates = Math.max(1, Math.min(12, Number(process.env.MULTISOURCE_MAX_CANDIDATES || 6)));
  const results = [];

  for (const deal of unique.slice(0, maxCandidates)) {
    deal.signalObservedAt = deal.lastVerifiedAt || new Date().toISOString();
    deal.signalClaims = buildSignalQuarantine(deal, Date.now());
    deal.quarantineState = "PARSED";
    deal.requiresAmazonVerification = deal.signalClaims.requiresAmazonVerification;
    deal.lastVerifiedAt = null;
    deal.priceVerified = false;
    deal.priceSource = "external_signal";
    deal.priceVerifiedByAmazon = false;
    deal.promotionVerifiedByAmazon = false;
    deal.couponVerifiedByAmazon = false;

    const quarantine = await persistQuarantine(deal);
    await recordAgentOsEvent(agentOsEvent("AFFARERADAR_SIGNAL_CAPTURED", deal, {
      lifecycle:"PARSED",
      knowledgeStatus:"PARSED",
      freshness:deal.lastVerifiedAt || null,
      payload:{
        verificationRequired:true,
        sourceVerified:deal.sourceVerified === true,
        quarantineId:deal.signalClaims?.quarantineId || null,
        quarantineStored:quarantine.stored === true,
        crossSourceConsensus:deal.crossSourceConsensus || null
      }
    }));
    const dag = await createAgentOsDagForSignal(deal);
    const verificationQueue = await enqueueSignalVerification(deal, dag);
    const publish = {
      ok:true,
      status:202,
      data:{
        ok:true,
        published:false,
        decision:"verify",
        reason:"signal_quarantine_verification_required",
        verificationQueue
      }
    };
    const preApi = await submitPreApi(req, deal);
    await updateSourceStats(deal, preApi?.data?.published === true ? {
      ok:true,
      status:200,
      data:{ ...preApi.data, decision:"preapi_published" }
    } : publish);
    results.push({
      title:deal.title,
      dealScore:deal.dealScore,
      source:deal.source,
      consensus:deal.crossSourceConsensus || null,
      quarantine:deal.signalClaims ? {
        quarantineId:deal.signalClaims.quarantineId,
        state:deal.signalClaims.state,
        asinCandidate:deal.signalClaims.asinCandidate
      } : null,
      dag:dag ? { dagId:dag.dagId, status:dag.status } : null,
      publish,
      preApi
    });
  }

  const verificationWakeup = results.some(row => row?.publish?.data?.decision === "verify")
    ? await wakeVerificationWorker(req)
    : { triggered:false, reason:"no_verification_work" };

  try {
    if (redisConfig()) {
      await Promise.all([
        redisCommand("SET", "affareradar:multisource:last_run_at", new Date().toISOString(), "EX", 172800),
        redisCommand("SET", "affareradar:multisource:last_candidate_count", String(unique.length), "EX", 172800),
        redisCommand("SET", "affareradar:multisource:last_source_count", String(sources.length), "EX", 172800),
        redisCommand(
          "SET",
          "affareradar:multisource:last_trigger",
          String(req.headers["x-affareradar-trigger"] || (req.headers["x-vercel-cron-schedule"] ? "vercel_cron" : "direct")),
          "EX",
          172800
        )
      ]);
    }
  } catch {}

  console.log("[AffareRadar][discover] completed", JSON.stringify({ sources:sources.length, rawCandidates:candidates.length, submitted:results.length }));
  runtimeSuccess(__obs, {
    sources:sources.length,
    rawCandidates:candidates.length,
    consensusCandidates:unique.length,
    multiSourceCandidates:unique.filter(x => Number(x.crossSourceConsensus?.sourceCount || 1) >= 2).length,
    submitted:results.length
  });
  return res.status(200).json({
    ok:true,
    sources:sourceResults,
    candidates:unique.length,
    rawCandidates:candidates.length,
    multiSourceCandidates:unique.filter(x => Number(x.crossSourceConsensus?.sourceCount || 1) >= 2).length,
    submitted:results.length,
    verificationWakeup,
    results
  });
}
