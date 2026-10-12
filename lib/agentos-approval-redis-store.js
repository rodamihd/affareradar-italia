import { redisConfig, redisCommand } from "./redis-rest.js";

// Atomically validate and consume a previously issued approval in Redis.
// No endpoint here creates approvals; issuance requires separate authenticated review.
const consumeScript = [
  'local raw = redis.call("GET", KEYS[1])',
  'if not raw then return nil end',
  'local ok, r = pcall(cjson.decode, raw)',
  'if not ok or type(r) ~= "table" then return nil end',
  'if r.id ~= ARGV[1] or r.principal ~= ARGV[2] or r.operation ~= ARGV[3] or r.scope ~= ARGV[4] then return nil end',
  'if r.revoked == true or r.assurance ~= "HUMAN_VERIFIED" then return nil end',
  'if type(r.approvedBy) ~= "string" or r.approvedBy == "" or r.approvedBy == ARGV[2] then return nil end',
  'if type(r.expiresAtMs) ~= "number" or r.expiresAtMs <= tonumber(ARGV[5]) then return nil end',
  'redis.call("DEL", KEYS[1])',
  'return raw'
].join("\n");

export async function consumeRedisApproval({ approvalId, principal, operation, scope, now=Date.now(), command=redisCommand }={}) {
  if (!redisConfig() || !approvalId || !principal || !operation || !scope || !Number.isFinite(now)) return null;
  const id=String(approvalId);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) return null;
  const key="agentos:approval:v1:"+id;
  const response=await command("EVAL", consumeScript, 1, key, id, principal, operation, scope, String(now));
  if (!response?.configured || typeof response.result !== "string") return null;
  const record=JSON.parse(response.result);
  return {
    ...record,
    expiresAt:new Date(record.expiresAtMs).toISOString(),
    consumed:true,
    atomic:true
  };
}
