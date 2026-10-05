import crypto from "node:crypto";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";

const EXPECTED_REPOSITORY = "rodamihd/affareradar-italia";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

function b64urlJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function verifyGithubOidc(req) {
  const token = String(req.headers["x-github-oidc-token"] || "").trim();
  if (!token) return { ok:false, reason:"missing_oidc_token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok:false, reason:"invalid_oidc_format" };

  let header, payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { ok:false, reason:"invalid_oidc_payload" };
  }

  if (header.alg !== "RS256" || !header.kid) return { ok:false, reason:"unsupported_oidc_key" };
  if (payload.iss !== OIDC_ISSUER) return { ok:false, reason:"invalid_oidc_issuer" };
  if (payload.repository !== EXPECTED_REPOSITORY) return { ok:false, reason:"invalid_oidc_repository" };
  if (payload.ref !== "refs/heads/main") return { ok:false, reason:"invalid_oidc_ref" };
  if (payload.event_name !== "schedule" && payload.event_name !== "workflow_dispatch") {
    return { ok:false, reason:"invalid_oidc_event" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) return { ok:false, reason:"expired_oidc_token" };
  if (Number.isFinite(Number(payload.nbf)) && Number(payload.nbf) > now + 30) return { ok:false, reason:"oidc_not_yet_valid" };

  const response = await fetch(JWKS_URL, { headers:{ "User-Agent":"AffareRadar-Fallback/1.0" } });
  if (!response.ok) return { ok:false, reason:"oidc_jwks_unavailable" };
  const jwks = await response.json();
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(k => k.kid === header.kid) : null;
  if (!jwk) return { ok:false, reason:"oidc_key_not_found" };

  try {
    const key = crypto.createPublicKey({ key:jwk, format:"jwk" });
    const valid = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url")
    );
    return valid ? { ok:true, payload } : { ok:false, reason:"invalid_oidc_signature" };
  } catch {
    return { ok:false, reason:"oidc_verification_failed" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  const oidc = await verifyGithubOidc(req);
  if (!oidc.ok) return res.status(401).json({ ok:false, error:"unauthorized", reason:oidc.reason });
  if (!redisConfig()) return res.status(503).json({ ok:false, error:"redis_not_configured" });

  const freshnessMinutes = Math.max(10, Math.min(60, Number(process.env.AFFARERADAR_FALLBACK_FRESH_MINUTES || 30)));
  const rr = await redisCommand("GET", "affareradar:multisource:last_run_at");
  const lastRunAt = rr.result || null;
  const lastMs = Date.parse(lastRunAt || "");
  const ageMinutes = Number.isFinite(lastMs) ? Math.round((Date.now() - lastMs) / 60000) : null;

  if (ageMinutes != null && ageMinutes <= freshnessMinutes) {
    await redisCommand("SET", "affareradar:fallback:last_check", JSON.stringify({
      at:new Date().toISOString(), action:"skip", lastRunAt, ageMinutes
    }), "EX", 172800);
    return res.status(200).json({ ok:true, fallback:false, action:"skip", reason:"primary_recent", lastRunAt, ageMinutes });
  }

  const lock = await redisCommand("SET", "affareradar:fallback:trigger_lock", new Date().toISOString(), "NX", "EX", 300);
  if (lock.result !== "OK") {
    return res.status(200).json({ ok:true, fallback:false, action:"skip", reason:"fallback_already_triggered" });
  }

  const host = req.headers.host;
  const secret = process.env.PUBLISH_SECRET;
  if (!host || !secret) return res.status(503).json({ ok:false, error:"host_or_secret_missing" });

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const response = await fetch(`${protocol}://${host}/api/discover-multisource`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":secret,
      "x-affareradar-trigger":"github_oidc_fallback"
    },
    body:"{}"
  });
  const data = await response.json().catch(() => ({}));

  await redisCommand("SET", "affareradar:fallback:last_check", JSON.stringify({
    at:new Date().toISOString(), action:"trigger", lastRunAt, ageMinutes,
    responseOk:response.ok && data.ok !== false, status:response.status
  }), "EX", 172800);

  if (!response.ok || data.ok === false) {
    return res.status(502).json({ ok:false, fallback:true, action:"trigger", status:response.status, upstream:data });
  }

  return res.status(200).json({
    ok:true, fallback:true, action:"trigger",
    previousLastRunAt:lastRunAt, previousAgeMinutes:ageMinutes,
    discovery:{
      candidates:data.candidates ?? null, rawCandidates:data.rawCandidates ?? null,
      submitted:data.submitted ?? null, skipped:data.skipped === true, reason:data.reason || null
    }
  });
}
