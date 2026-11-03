// Manual staging-only smoke test. Never use production Redis or Telegram credentials.
// Run only after independently verifying a separate Upstash resource and its zero-cost plan.
// Node 22+: node --experimental-default-type=module scripts/upstash-staging-smoke.mjs --confirm-isolated-staging
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ENQUEUE_LUA } from '../lib/queue-enqueue.mjs';
import { CLAIM_LUA, FINALIZE_LUA, validateCandidate } from '../lib/queue-delivery.mjs';

const vars = process.env;
const stagingUrl = vars.AFFARERADAR_UPSTASH_STAGING_REST_URL;
const productionUrl = vars.AFFARERADAR_UPSTASH_PRODUCTION_REST_URL;
const stagingToken = vars.AFFARERADAR_UPSTASH_STAGING_REST_TOKEN;
const stagingId = vars.AFFARERADAR_UPSTASH_STAGING_RESOURCE_ID;
const productionId = vars.AFFARERADAR_UPSTASH_PRODUCTION_RESOURCE_ID;

function safeEndpoint(raw) {
  try {
    const value = new URL(raw);
    if (value.protocol !== 'https:' || value.username || value.password ||
        value.pathname !== '/' || value.search || value.hash ||
        !value.hostname.endsWith('.upstash.io')) return null;
    return value;
  } catch { return null; }
}

const staging = safeEndpoint(stagingUrl);
const production = safeEndpoint(productionUrl);
if (process.argv.length !== 3 || process.argv[2] !== '--confirm-isolated-staging' ||
    !staging || !production || staging.host === production.host ||
    !stagingToken || stagingToken.trim().length < 16 ||
    !stagingId || !productionId || stagingId === productionId) {
  process.stderr.write('BLOCKED: a verified, distinct staging Upstash resource is required. No requests made.\n');
  process.exit(2);
}

async function redis(...args) {
  const response = await fetch(staging.origin, {
    method:'POST',
    headers:{ Authorization:'Bearer ' + stagingToken, 'Content-Type':'application/json' },
    body:JSON.stringify(args),
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Error('staging_redis_http_failure');
  const data = await response.json();
  if (data.error || !Object.prototype.hasOwnProperty.call(data,'result')) throw Error('staging_redis_command_failure');
  return data.result;
}

const run = crypto.randomUUID();
const prefix = 'affareradar:staging-smoke:' + run + ':';
const id = 'synthetic-' + run;
const keys = [
  prefix + 'queue', prefix + 'item:' + id, prefix + 'lease:' + id,
  prefix + 'journal:' + id, prefix + 'review', prefix + 'dead_letter',
  prefix + 'review:item:' + id, prefix + 'dead:item:' + id
];
async function cleanup() {
  // Explicit generated keys only; NEVER KEYS, FLUSHDB, or wildcard deletion.
  await redis('DEL', ...keys);
}

let result = 'FAIL';
try {
  assert.equal(await redis('PING'), 'PONG');
  const now = Date.now();
  const body = {
    asin:'B012345678', amazonUrl:'https://www.amazon.it/dp/B012345678',
    price:'20.00', priceVerified:true, verifiedAt:new Date(now - 30_000).toISOString(),
    stock:true
  };
  const original = JSON.stringify({body,dealId:id,attempts:0,dueAt:now+60_000});
  const enqueueArgs=[id, now+60_000, original, 600, now].map(String);
  const enqKeys=[keys[0],keys[1],keys[2],keys[3],keys[4],keys[5]];
  assert.deepEqual(await redis('EVAL',ENQUEUE_LUA,enqKeys.length,...enqKeys,...enqueueArgs),['QUEUED']);
  assert.deepEqual(await redis('EVAL',ENQUEUE_LUA,enqKeys.length,...enqKeys,...enqueueArgs),['ALREADY_QUEUED']);
  assert.ok(Number(await redis('TTL',keys[1])) > 0);

  const token = crypto.randomUUID();
  const claimKeys=[keys[0],keys[1],keys[2],keys[3],keys[4],keys[6]];
  const claim = await redis('EVAL',CLAIM_LUA,claimKeys.length,...claimKeys,
    id,now+60_000,token,180,600);
  assert.equal(claim[0],'CLAIMED');
  assert.equal(claim[1],original);
  // Local validator refuses stale prices; never calls any publishing endpoint.
  assert.equal(validateCandidate(body,now+20*60_000).passed,false);

  const nextDue=now+120_000;
  const updated = JSON.stringify({body,dealId:id,attempts:1,dueAt:nextDue});
  const finalized = await redis('EVAL',FINALIZE_LUA,keys.length,...keys,
    id,token,original,'RETRY',now+60_000,nextDue,updated,600,'synthetic_retry');
  assert.equal(finalized,'REQUEUED');
  assert.equal(Number(await redis('ZSCORE',keys[0],id)),nextDue);
  assert.equal(await redis('GET',keys[3]),null);

  const claim2 = await redis('EVAL',CLAIM_LUA,claimKeys.length,...claimKeys,
    id,nextDue,crypto.randomUUID(),180,600);
  assert.equal(claim2[0],'CLAIMED');
  // Simulate lease expiry after a worker crash. The durable journal blocks replay.
  await redis('DEL',keys[2]);
  const uncertain = await redis('EVAL',CLAIM_LUA,claimKeys.length,...claimKeys,
    id,nextDue,crypto.randomUUID(),180,600);
  assert.equal(uncertain[0],'UNCERTAIN_REVIEW');
  assert.equal(await redis('ZSCORE',keys[0],id),null);
  assert.ok(await redis('GET',keys[6]));
  result = 'PASS';
} catch {
  result = 'FAIL';
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch { result='FAIL_CLEANUP'; process.exitCode = 1; }
  process.stdout.write(result + ': isolated staging-only Redis REST/EVAL smoke; Telegram never contacted.\n');
}
