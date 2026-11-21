import crypto from 'node:crypto';
import { redisConfig, redisCommand } from '../lib/redis-rest.js';
import { processQueueBatch } from '../lib/queue-delivery.mjs';

async function verifyGithubQueueOidc(req) {
  const token = String(req.headers['x-github-oidc-token'] || '').trim();
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid) return false;
    if (payload.iss !== 'https://token.actions.githubusercontent.com') return false;
    if (payload.repository !== 'rodamihd/affareradar-italia') return false;
    if (payload.ref !== 'refs/heads/main') return false;
    if (!['schedule','workflow_dispatch'].includes(payload.event_name)) return false;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) return false;
    const response = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
    if (!response.ok) return false;
    const jwks = await response.json();
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(k => k.kid === header.kid) : null;
    if (!jwk) return false;
    const key = crypto.createPublicKey({ key:jwk, format:'jwk' });
    return crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),key,Buffer.from(parts[2], 'base64url'));
  } catch { return false; }
}

async function authorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  const publishSecret = process.env.PUBLISH_SECRET;
  const bearer = req.headers.authorization;
  const publisher = req.headers['x-affareradar-secret'];
  if ((cronSecret && bearer === `Bearer ${cronSecret}`) || (publishSecret && publisher === publishSecret)) return true;
  return verifyGithubQueueOidc(req);
}

export default async function handler(req,res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  if (!(await authorized(req))) return res.status(401).json({ok:false,error:'unauthorized'});
  if (!redisConfig()) return res.status(503).json({ok:false,error:'persistent_queue_unavailable',reason:'upstash_redis_not_configured'});
  const secret=process.env.PUBLISH_SECRET;
  if (!secret) return res.status(500).json({ok:false,error:'publish_secret_missing'});
  const host=req.headers.host;
  if (!host) return res.status(500).json({ok:false,error:'host_missing'});
  const protocol=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
  const target=`${protocol}://${host}/api/auto-publish`;
  const publish=async(body)=>{
    const r=await fetch(target,{
      method:'POST',headers:{'Content-Type':'application/json','x-affareradar-secret':secret},
      body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
    });
    let data;
    try { data=await r.json(); } catch { return {status:r.status,data:null}; }
    return {status:r.status,data};
  };
  try {
    const report=await processQueueBatch({
      redisCommand,publish,
      batchSize:Math.min(3,Math.max(1,Number(process.env.QUEUE_BATCH_SIZE||3))),
      maxAttempts:Number(process.env.QUEUE_MAX_ATTEMPTS||5),
      maxAgeMinutes:Number(process.env.QUEUE_REVALIDATION_MAX_AGE_MINUTES||10)
    });
    return res.status(report.ok?200:503).json(report);
  } catch {
    return res.status(503).json({ok:false,error:'queue_processor_unavailable'});
  }
}
