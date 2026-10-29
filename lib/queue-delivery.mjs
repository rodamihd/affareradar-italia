import crypto from 'node:crypto';
import { prePublishValidate } from './pre-publish-validator.js';

const QUEUE_KEY = 'affareradar:queue';
const REVIEW_KEY = 'affareradar:queue:review';
const DLQ_KEY = 'affareradar:queue:dead_letter';
const ITEM_PREFIX = 'affareradar:queue:item:';
const LEASE_PREFIX = 'affareradar:queue:lease:';
const JOURNAL_PREFIX = 'affareradar:queue:journal:';
const REVIEW_ITEM_PREFIX = 'affareradar:queue:review:item:';
const DLQ_ITEM_PREFIX = 'affareradar:queue:dead:item:';
const JOURNAL_TTL_SECONDS = 14 * 86400;
const ITEM_TTL_SECONDS = 14 * 86400;
const LEASE_SECONDS = 180;

// The entire claim, including durable dispatch journal creation, is atomic.
// A crash after claim is treated as delivery-uncertain, never automatically replayed.
export const CLAIM_LUA = `-- affareradar_queue_claim_v1
local queue, item, lease, journal, review, review_item = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6]
local deal, now, token = ARGV[1], tonumber(ARGV[2]), ARGV[3]
local score = redis.call('ZSCORE', queue, deal)
if not score or tonumber(score) > now then return {'NOT_DUE'} end
local raw = redis.call('GET', item)
if not raw then
  redis.call('ZADD', review, now, deal)
  redis.call('ZREM', queue, deal)
  return {'ORPHAN_REVIEW'}
end
if redis.call('GET', lease) then return {'LOCKED'} end
if redis.call('GET', journal) then
  redis.call('SET', review_item, raw, 'EX', tonumber(ARGV[5]))
  redis.call('ZADD', review, now, deal)
  redis.call('ZREM', queue, deal)
  redis.call('DEL', item)
  return {'UNCERTAIN_REVIEW'}
end
if not redis.call('SET', lease, token, 'NX', 'EX', tonumber(ARGV[4])) then
  return {'LOCKED'}
end
redis.call('SET', journal, token, 'EX', tonumber(ARGV[5]))
return {'CLAIMED', raw}
`;

// Acknowledgement and all other queue mutations are single atomic Redis EVAL calls.
// The lock token and original item payload act as an optimistic concurrency guard.
export const FINALIZE_LUA = `-- affareradar_queue_finalize_v1
local queue, item, lease, journal, review, dlq = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6]
local review_item, dlq_item = KEYS[7], KEYS[8]
local deal, token, previous, action, now = ARGV[1], ARGV[2], ARGV[3], ARGV[4], tonumber(ARGV[5])
if redis.call('GET', lease) ~= token or redis.call('GET', journal) ~= token then
  return 'STALE_LEASE'
end
local current = redis.call('GET', item)
if action == 'UPSTREAM_QUEUED' and current and current ~= previous then
  redis.call('DEL', journal)
  redis.call('DEL', lease)
  return 'REQUEUED_BY_UPSTREAM'
end
if not current or current ~= previous then
  redis.call('SET', review_item, cjson.encode({previous=previous,current=current,reason='payload_changed_or_missing'}), 'EX', tonumber(ARGV[8]))
  redis.call('ZADD', review, now, deal)
  redis.call('ZREM', queue, deal)
  redis.call('DEL', item)
  redis.call('SET', journal, 'review:payload_changed_or_missing', 'EX', tonumber(ARGV[8]))
  redis.call('DEL', lease)
  return 'CONFLICT_REVIEW'
end
if action == 'ACK' then
  redis.call('ZREM', queue, deal)
  redis.call('DEL', item)
  redis.call('DEL', journal)
  redis.call('DEL', lease)
  return 'ACKED'
elseif action == 'RETRY' then
  redis.call('SET', item, ARGV[7], 'EX', tonumber(ARGV[8]))
  redis.call('ZADD', queue, tonumber(ARGV[6]), deal)
  redis.call('DEL', journal)
  redis.call('DEL', lease)
  return 'REQUEUED'
elseif action == 'DLQ' then
  redis.call('SET', dlq_item, ARGV[7], 'EX', tonumber(ARGV[8]))
  redis.call('ZADD', dlq, now, deal)
  redis.call('ZREM', queue, deal)
  redis.call('DEL', item)
  redis.call('DEL', journal)
  redis.call('DEL', lease)
  return 'DEAD_LETTER'
else
  redis.call('SET', review_item, current, 'EX', tonumber(ARGV[8]))
  redis.call('ZADD', review, now, deal)
  redis.call('ZREM', queue, deal)
  redis.call('DEL', item)
  redis.call('SET', journal, 'review:' .. tostring(ARGV[9]), 'EX', tonumber(ARGV[8]))
  redis.call('DEL', lease)
  return 'MANUAL_REVIEW'
end
`;

export function retryDelayMs(attempts) {
  return Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));
}

export function classifyPublishResponse(response) {
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') {
    return { kind:'REVIEW', reason:'invalid_response' };
  }
  const {status, data} = response;
  if (status >= 200 && status < 300 && data.ok === true && data.published === true) {
    if (data.telegram_message_id != null) return { kind:'ACK', status:'published' };
    return { kind:'REVIEW', reason:'published_without_message_id' };
  }
  if (status >= 200 && status < 300 && data.ok === true && data.published === false) {
    const decision = String(data.decision || '').toLowerCase();
    if (decision === 'queued') return { kind:'UPSTREAM_QUEUED', status:'upstream_queued' };
    if (['rejected','blocked','safe_mode','discard','observe'].includes(decision)) {
      return { kind:'ACK', status:`terminal_${decision}` };
    }
    return { kind:'REVIEW', reason:`nonterminal_${decision || 'unknown'}` };
  }
  // Only errors returned before the downstream Telegram send are safe to retry.
  // 5xx from an intermediary and 'telegram_publish_failed' are delivery-uncertain.
  if ((status === 401 && data.error === 'unauthorized') || (status === 500 && data.error === 'host_missing')) {
    return { kind:'RETRY', reason:`presend_${data.error}` };
  }
  return { kind:'REVIEW', reason:`uncertain_http_${status}` };
}

export function validateCandidate(body, now, ageMinutes = 10) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { passed:false, blockingCodes:['INVALID_PAYLOAD'] };
  // Strict is intentional: no stale/unverified price or coupon is replayed.
  const boundedAge = Number.isFinite(Number(ageMinutes)) ? Math.max(1,Math.min(10,Number(ageMinutes))) : 10;
  return prePublishValidate(body, now, { mode:'strict', maxAgeMinutes:boundedAge });
}

function keys(dealId) {
  return [QUEUE_KEY, ITEM_PREFIX+dealId, LEASE_PREFIX+dealId, JOURNAL_PREFIX+dealId, REVIEW_KEY, DLQ_KEY, REVIEW_ITEM_PREFIX+dealId, DLQ_ITEM_PREFIX+dealId];
}

function safeReason(reason) {
  return String(reason || 'unknown').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0,100);
}

async function evaluate(redisCommand, lua, redisKeys, args) {
  const response = await redisCommand('EVAL', lua, redisKeys.length, ...redisKeys, ...args.map(String));
  if (!response?.configured || response.result == null) throw new Error('queue_redis_eval_missing_result');
  return response.result;
}

export async function processDueItem({ redisCommand, publish, dealId, now = Date.now(), maxAttempts = 5, maxAgeMinutes = 10 }) {
  const token = crypto.randomUUID();
  const safeMaxAttempts = Number.isFinite(Number(maxAttempts)) ? Math.max(1,Math.min(10,Math.floor(Number(maxAttempts)))) : 5;
  const k = keys(dealId);
  const claim = await evaluate(redisCommand, CLAIM_LUA, [k[0],k[1],k[2],k[3],k[4],k[6]], [dealId,now,token,LEASE_SECONDS,JOURNAL_TTL_SECONDS]);
  const state = Array.isArray(claim) ? claim[0] : String(claim);
  if (state !== 'CLAIMED') return { dealId, status:state.toLowerCase(), dispatched:false };

  const raw = claim[1];
  let item;
  try { item = JSON.parse(raw); } catch { item = null; }
  const attempts = Number(item?.attempts || 0) + 1;
  const boundedAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : safeMaxAttempts + 1;
  const finalize = async(action, reason, updated = item, dueAt = now) => {
    const out = await evaluate(redisCommand, FINALIZE_LUA, k, [
      dealId,token,raw,action,now,dueAt,JSON.stringify(updated),ITEM_TTL_SECONDS,safeReason(reason)
    ]);
    return String(out);
  };
  if (!item || !item.body || typeof item.body !== 'object') {
    const state = await finalize('REVIEW','invalid_queue_payload');
    return { dealId, status:'review', reason:'invalid_queue_payload', finalize:state, dispatched:false };
  }
  if (boundedAttempts > safeMaxAttempts) {
    const state = await finalize('DLQ','attempts_exceeded',{...item,attempts:boundedAttempts,lastError:'attempts_exceeded'});
    return { dealId, status:'dead_letter', attempts:boundedAttempts, finalize:state, dispatched:false };
  }
  const validated = validateCandidate(item.body, now, maxAgeMinutes);
  if (!validated.passed) {
    const state = await finalize('DLQ','revalidation_failed',{
      ...item,attempts:boundedAttempts,lastError:'revalidation_failed',validationCodes:validated.blockingCodes
    });
    return { dealId, status:'dead_letter', reason:'revalidation_failed', blockingCodes:validated.blockingCodes, finalize:state, dispatched:false };
  }

  let classification;
  try {
    const response = await publish({ ...(item.body || {}), __queueAttempts:boundedAttempts, __fromQueue:true });
    classification = classifyPublishResponse(response);
  } catch {
    classification = {kind:'REVIEW',reason:'delivery_outcome_unknown'};
  }
  let action = classification.kind;
  if (action === 'RETRY' && boundedAttempts >= safeMaxAttempts) action = 'DLQ';
  const dueAt = now + retryDelayMs(boundedAttempts);
  const updated = { ...item,attempts:boundedAttempts,lastError:classification.reason || null,dueAt };
  const finalized = await finalize(action,classification.reason || classification.status,updated,dueAt);
  const normalized = {
    ACK:'acked', UPSTREAM_QUEUED:'upstream_queued',RETRY:'retry_scheduled',
    DLQ:'dead_letter',REVIEW:'review'
  };
  const status = finalized==='CONFLICT_REVIEW' ? 'review' :
    finalized==='REQUEUED_BY_UPSTREAM' ? 'upstream_queued' :
    finalized==='STALE_LEASE' ? 'lease_lost' :
    finalized==='MANUAL_REVIEW' ? 'review' :
    finalized==='DEAD_LETTER' ? 'dead_letter' :
    finalized==='REQUEUED' ? 'retry_scheduled' :
    finalized==='ACKED' ? 'acked' : 'processing_error';
  return { dealId, status, reason:classification.reason || null, attempts:boundedAttempts, finalize:finalized, dispatched:true };
}

export async function processQueueBatch({ redisCommand, publish, now = Date.now(), batchSize = 3, maxAttempts = 5, maxAgeMinutes = 10 }) {
  const boundedBatch = Math.max(1,Math.min(10,Number(batchSize) || 3));
  const resp = await redisCommand('ZRANGEBYSCORE', QUEUE_KEY, '-inf', String(now), 'LIMIT', 0, boundedBatch);
  if (!resp?.configured || !Array.isArray(resp.result)) throw new Error('queue_read_unavailable');
  const results = [];
  for (const dealId of resp.result) {
    try {
      results.push(await processDueItem({ redisCommand,publish,dealId,now,maxAttempts,maxAgeMinutes }));
    } catch {
      results.push({dealId,status:'processing_error',reason:'internal_queue_failure'});
    }
  }
  const counts = {};
  for (const entry of results) counts[entry.status] = (counts[entry.status] || 0) + 1;
  const needsAttention = results.some(x => ['review','dead_letter','processing_error','lease_lost','uncertain_review','orphan_review'].includes(x.status));
  return { ok: !needsAttention, processed:results.length, batchSize:boundedBatch, counts, results };
}
