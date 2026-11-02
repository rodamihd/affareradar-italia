import { redisCommand as defaultRedisCommand, redisConfig } from './redis-rest.js';

export const QUEUE_ITEM_TTL_SECONDS = 14 * 86400;

// One Redis operation handles both payload and due-date; no lost half-enqueues.
// Never replace data for a live or unresolved delivery journal.
export const ENQUEUE_LUA = `-- affareradar_atomic_enqueue_v1
local queue, item, lease, journal, review, dead_letter = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6]
local deal, due_at, raw, ttl, now = ARGV[1], tonumber(ARGV[2]), ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5])
if not ttl or ttl < 60 or not due_at or not now or due_at < now or due_at >= now + ttl * 1000 then
  return {'INVALID_SCHEDULE'}
end
if redis.call('ZSCORE', review, deal) or redis.call('ZSCORE', dead_letter, deal) then
  return {'REVIEW_PENDING'}
end
if redis.call('GET', lease) or redis.call('GET', journal) then
  return {'IN_FLIGHT'}
end
if redis.call('ZSCORE', queue, deal) then
  if redis.call('GET', item) then return {'ALREADY_QUEUED'} end
  return {'ORPHANED_QUEUE_ENTRY'}
end
redis.call('SET', item, raw, 'EX', ttl)
redis.call('ZADD', queue, due_at, deal)
return {'QUEUED'}
`;

export async function enqueuePublicationQueue({
  body, dealId, dueAt, reason, now = Date.now(),
  command = defaultRedisCommand, configured = Boolean(redisConfig())
} = {}) {
  if (!configured) return { queued:false, reason:'persistent_queue_not_configured' };
  const id = String(dealId || '').trim();
  const when = Number(dueAt);
  if (!id || id.length > 100 || !Number.isSafeInteger(when) ||
      when < now || when >= now + QUEUE_ITEM_TTL_SECONDS * 1000 ||
      !body || typeof body !== 'object' || Array.isArray(body)) {
    return { queued:false, reason:'invalid_queue_candidate' };
  }
  const payload = {
    body, dealId:id, dueAt:when,
    queuedAt:new Date(now).toISOString(),
    reason:String(reason || 'anti_spam').slice(0,64),
    attempts:Number(body.__queueAttempts || 0)
  };
  const keys = [
    'affareradar:queue',
    'affareradar:queue:item:' + id,
    'affareradar:queue:lease:' + id,
    'affareradar:queue:journal:' + id,
    'affareradar:queue:review',
    'affareradar:queue:dead_letter'
  ];
  try {
    const response = await command('EVAL', ENQUEUE_LUA, keys.length,
      ...keys, id, when, JSON.stringify(payload), QUEUE_ITEM_TTL_SECONDS, now);
    if (!response?.configured || !Array.isArray(response.result)) throw new Error('enqueue_invalid_redis_response');
    const result = String(response.result[0] || '');
    if (result === 'QUEUED' || result === 'ALREADY_QUEUED') {
      return {queued:true, mode:'persistent_upstash_redis', status:result.toLowerCase(),
        dueAt:new Date(when).toISOString()};
    }
    return {queued:false, reason:result.toLowerCase() || 'queue_claim_refused'};
  } catch {
    // Do not falsely acknowledge a volatile in-memory fallback.
    return {queued:false, reason:'persistent_queue_write_failed'};
  }
}
