import { amazonAgentUserAgent } from "../lib/amazon-compliance.js";
import { agentOsEvent, universalEntityId } from "../lib/agentos-adapter.js";
import { buildSignalQuarantine, extractAsinFromAmazonUrl } from "../lib/signal-quarantine.js";
import { offerDagTemplate, dagSummary } from "../lib/agentos-dag.js";
import { startRuntimeObservation, runtimeSuccess, runtimeFailure } from "../lib/runtime-observability.js";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";
import { runAgentOsSelfTest } from "../lib/agentos-selftest.js";
import { sourceReputationKeys, applySourceOutcome } from "../lib/source-reputation.js";

function authorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  const publishSecret = process.env.PUBLISH_SECRET;
  return Boolean(
    (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) ||
    (publishSecret && req.headers["x-affareradar-secret"] === publishSecret)
  );
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

function parsePrice(text) {
  const s = String(text || "");
  const matches = [...s.matchAll(/(?:€\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)|([0-9]{1,5}(?:[.,][0-9]{1,2})?)\s*€)/g)];
  if (!matches.length) return null;
  const raw = matches[0][1] || matches[0][2];
  return `${raw.replace(".", ",")} €`;
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

  const discount = parseDiscount(text);
  const dealType = detectType(text);
  const coupon = /coupon|codice sconto|stack/i.test(text) ? "Promo rilevata dalla fonte" : null;
  const title = decodeHtml(text)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "Offerta Amazon";

  return {
    title,
    price,
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
  const re = /<div class="tgme_widget_message[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 30) {
    const block = m[1];
    const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;
    const text = textMatch[1];
    const image = block.match(/background-image:url\('([^']+)'\)/i)?.[1] || null;
    const datetime = block.match(/datetime="([^"]+)"/i)?.[1] || null;
    const item = itemFromText(text, source, image, datetime);
    if (item) out.push(item);
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
  const source = new URL(url).hostname;

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

export default async function handler(req, res) {
  const __obs = startRuntimeObservation(req, "/api/discover-multisource");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
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

  const unique = [];
  const seen = new Set();
  for (const deal of candidates.sort((a,b) => Number(b.dealScore || 0) - Number(a.dealScore || 0))) {
    const key = deal.asin || deal.amazonUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(deal);
  }

  const maxCandidates = Math.max(1, Math.min(12, Number(process.env.MULTISOURCE_MAX_CANDIDATES || 6)));
  const results = [];

  for (const deal of unique.slice(0, maxCandidates)) {
    const resolvedUrl = await resolveAmazonUrl(deal.amazonUrl);

    if (!resolvedUrl) {
      results.push({
        title:deal.title,
        dealScore:deal.dealScore,
        source:deal.source,
        publish:{ ok:false, status:0, data:{ error:"amazon_url_resolution_failed" } }
      });
      continue;
    }

    deal.amazonUrl = resolvedUrl;
    deal.asin = deal.asin || extractAsinFromAmazonUrl(resolvedUrl);
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
        quarantineStored:quarantine.stored === true
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
    await updateSourceStats(deal, publish);
    results.push({
      title:deal.title,
      dealScore:deal.dealScore,
      source:deal.source,
      quarantine:deal.signalClaims ? {
        quarantineId:deal.signalClaims.quarantineId,
        state:deal.signalClaims.state,
        asinCandidate:deal.signalClaims.asinCandidate
      } : null,
      dag:dag ? { dagId:dag.dagId, status:dag.status } : null,
      publish
    });
  }

  try {
    if (redisConfig()) {
      await Promise.all([
        redisCommand("SET", "affareradar:multisource:last_run_at", new Date().toISOString(), "EX", 172800),
        redisCommand("SET", "affareradar:multisource:last_candidate_count", String(unique.length), "EX", 172800),
        redisCommand("SET", "affareradar:multisource:last_source_count", String(sources.length), "EX", 172800)
      ]);
    }
  } catch {}

  runtimeSuccess(__obs, { sources:sources.length, candidates:unique.length, submitted:results.length });
  runtimeSuccess(__obs, { sources:sources.length, candidates:unique.length, submitted:results.length });
  return res.status(200).json({
    ok:true,
    sources:sourceResults,
    candidates:unique.length,
    submitted:results.length,
    results
  });
}
