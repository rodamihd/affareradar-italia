import crypto from "node:crypto";
import { runAgentOsSelfTest } from "../lib/agentos-selftest.js";
import { externalDescriptor, executeExternalOperation } from "../lib/agentos-external-runtime.js";

function externalAuthorized(req) {
  const secret = process.env.AGENTOS_EXTERNAL_SECRET || process.env.PUBLISH_SECRET;
  if (!secret) return false;
  return req.headers["x-agentos-secret"] === secret ||
    req.headers["x-affareradar-secret"] === secret;
}

function b64urlJson(segment) {
  const normalized = String(segment || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

async function githubOidcAuthorized(req) {
  try {
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ")) return false;
    const token = auth.slice(7).trim();
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return false;

    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== "https://token.actions.githubusercontent.com") return false;
    if (payload.aud !== "affareradar-vercel-cron") return false;
    if (payload.repository !== "rodamihd/affareradar-italia") return false;
    if (payload.ref !== "refs/heads/main") return false;
    if (!payload.exp || payload.exp < now || (payload.nbf && payload.nbf > now + 30)) return false;

    const configRes = await fetch("https://token.actions.githubusercontent.com/.well-known/openid-configuration");
    if (!configRes.ok) return false;
    const config = await configRes.json();

    const jwksRes = await fetch(config.jwks_uri);
    if (!jwksRes.ok) return false;
    const jwks = await jwksRes.json();
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(k => k.kid === header.kid) : null;
    if (!jwk) return false;

    const key = crypto.createPublicKey({ key:jwk, format:"jwk" });
    const signature = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const signed = Buffer.from(parts[0] + "." + parts[1], "utf8");
    return crypto.verify("RSA-SHA256", signed, key, signature);
  } catch {
    return false;
  }
}

function renderCronAuthorized(req) {
  try {
    const ts = String(req.headers["x-affareradar-ts"] || "");
    const signatureB64 = String(req.headers["x-affareradar-signature"] || "");
    const epoch = Number(ts);
    if (!Number.isFinite(epoch) || Math.abs(Date.now() - epoch) > 5 * 60 * 1000) return false;
    if (!signatureB64) return false;

    const publicKey = crypto.createPublicKey({
      key:Buffer.from("MCowBQYDK2VwAyEAcmAfJdUfO9YJSDPcUmaWegK8o82LzKBnBsf5XAV/qb4=", "base64"),
      format:"der",
      type:"spki"
    });
    const message = Buffer.from(`${ts}.POST./api/health?renderCron=discover`, "utf8");
    const signature = Buffer.from(signatureB64, "base64");
    return crypto.verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

async function runRenderCron(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!renderCronAuthorized(req)) {
    return res.status(401).json({ ok:false, error:"render_cron_unauthorized" });
  }

  const host = req.headers.host;
  const publishSecret = process.env.PUBLISH_SECRET;
  if (!host || !publishSecret) {
    return res.status(503).json({ ok:false, error:"render_cron_bridge_not_configured" });
  }

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const upstream = await fetch(`${protocol}://${host}/api/discover-multisource`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":publishSecret
    },
    body:JSON.stringify({ trigger:"render_signed_cron" })
  });
  const data = await upstream.json().catch(() => ({}));
  return res.status(upstream.status).json({ ok:upstream.ok, trigger:"render_signed_cron", discovery:data });
}

async function runGithubCron(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!(await githubOidcAuthorized(req))) {
    return res.status(401).json({ ok:false, error:"github_oidc_unauthorized" });
  }

  const host = req.headers.host;
  const publishSecret = process.env.PUBLISH_SECRET;
  if (!host || !publishSecret) {
    return res.status(503).json({ ok:false, error:"cron_bridge_not_configured" });
  }

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const upstream = await fetch(`${protocol}://${host}/api/discover-multisource`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":publishSecret
    },
    body:JSON.stringify({ trigger:"github_oidc_cron" })
  });
  const data = await upstream.json().catch(() => ({}));
  return res.status(upstream.status).json({ ok:upstream.ok, trigger:"github_oidc_cron", discovery:data });
}

export default async function handler(req, res) {
  if (req.query?.renderCron === "discover") {
    return runRenderCron(req, res);
  }

  if (req.query?.githubCron === "discover") {
    return runGithubCron(req, res);
  }

  const externalMode = req.query?.agentos === "external";

  if (externalMode) {
    if (!externalAuthorized(req)) {
      return res.status(401).json({ ok:false, error:"unauthorized" });
    }
    if (req.method === "GET") {
      return res.status(200).json(externalDescriptor());
    }
    if (req.method === "POST") {
      const result = executeExternalOperation(req.body || {});
      return res.status(result.status || 200).json(result);
    }
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelTarget = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME;
  const fallbackChatId = process.env.TELEGRAM_CHAT_ID;
  const target = channelTarget || fallbackChatId;
  const publishSecret = process.env.PUBLISH_SECRET;
  const amazonPartnerTag = process.env.AMAZON_PARTNER_TAG;
  const expectedAmazonPartnerTag = "affareradar-21";
  const creatorsApiConfigured = Boolean(
    process.env.AMAZON_CREATORS_CREDENTIAL_ID &&
    process.env.AMAZON_CREATORS_CREDENTIAL_SECRET &&
    amazonPartnerTag
  );
  const paApiConfigured = Boolean(
    process.env.AMAZON_PAAPI_ACCESS_KEY &&
    process.env.AMAZON_PAAPI_SECRET_KEY &&
    amazonPartnerTag
  );
  const pricePublicationReady = creatorsApiConfigured || paApiConfigured;

  const result = {
    ok:true,
    service:"AffareRadar Telegram Publisher",
    telegramConfigured:Boolean(token && target),
    publishSecretConfigured:Boolean(publishSecret),
    amazonPartnerTagConfigured:Boolean(amazonPartnerTag),
    amazonPartnerTagMatchesExpected:amazonPartnerTag === expectedAmazonPartnerTag,
    creatorsApiConfigured,
    paApiConfigured,
    pricePublicationReady,
    pricePublicationBlockReason:pricePublicationReady ? null : "amazon_official_price_provider_not_configured",
    targetType:channelTarget ? "channel" : "fallback_chat",
    target:channelTarget || null,
    botTokenValid:false,
    targetReachable:false,
    botCanPost:false,
    botMembershipStatus:null,
    agentOsSelfTest:req.query?.selftest === "1" ? runAgentOsSelfTest() : null
  };

  if (!token || !target) {
    return res.status(200).json(result);
  }

  try {
    const botRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const botData = await botRes.json();
    result.botTokenValid = Boolean(botRes.ok && botData?.ok);

    const chatRes = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(target)}`
    );
    const chatData = await chatRes.json();
    result.targetReachable = Boolean(chatRes.ok && chatData?.ok);

    if (result.botTokenValid && result.targetReachable && botData?.result?.id) {
      const memberRes = await fetch(
        `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(target)}&user_id=${encodeURIComponent(botData.result.id)}`
      );
      const memberData = await memberRes.json();

      if (memberRes.ok && memberData?.ok) {
        const member = memberData.result || {};
        result.botMembershipStatus = member.status || null;
        result.botCanPost =
          member.status === "creator" ||
          (member.status === "administrator" && member.can_post_messages !== false);
      }
    }
  } catch {
    result.ok = false;
  }

  return res.status(200).json(result);
}
