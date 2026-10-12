import { randomBytes } from "node:crypto";
import { redisConfig, redisCommand } from "./redis-rest.js";
import { publicationRequestDigest } from "./agentos-publication-binding.js";

// Internal issuance service only. Do not expose directly to HTTP handlers.
// authenticateReviewer must independently verify a server-side identity/session
// and reviewer permission; caller-supplied claims or request bodies are not proof.
export async function issueApproval({
  request, authenticationContext, authenticateReviewer, command=redisCommand,
  now=Date.now(), ttlSeconds=300, generateId=()=>randomBytes(24).toString("base64url")
}={}) {
  const deny = reason => ({issued:false,reason});
  if (!redisConfig() || typeof authenticateReviewer !== "function") return deny("trusted_dependencies_unavailable");
  if (!Number.isFinite(now) || !Number.isInteger(ttlSeconds) || ttlSeconds<30 || ttlSeconds>600) return deny("invalid_time_window");
  const {principal,operation,scope,publicationBody}=request || {};
  let publicationDigest;
  try { publicationDigest=publicationRequestDigest(publicationBody); }
  catch { return deny("invalid_publication_body"); }
  if (![principal,operation,scope].every(v=>typeof v==="string" && /^[a-zA-Z0-9_.:-]{2,100}$/.test(v))) return deny("invalid_request");
  if (operation!=="PUBLISH_OFFER" || scope!=="affareradar") return deny("operation_not_enabled");
  let reviewer;
  try { reviewer=await authenticateReviewer(authenticationContext,{operation,scope}); }
  catch { return deny("reviewer_authentication_failed"); }
  if (!reviewer || reviewer.verified !== true || reviewer.canApprove !== true ||
      typeof reviewer.id!=="string" || !reviewer.id.trim() ||
      reviewer.id===principal || reviewer.authenticationStrength!=="STRONG") {
    return deny("independent_authorized_reviewer_required");
  }
  const id=generateId();
  if (typeof id!=="string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(id)) return deny("invalid_identifier");
  const expiresAtMs=now+ttlSeconds*1000;
  const record={id,principal,operation,scope,approvedBy:reviewer.id,
    assurance:"HUMAN_VERIFIED",revoked:false,expiresAtMs,publicationDigest};
  let response;
  try { response=await command("SET","agentos:approval:v1:"+id,JSON.stringify(record),"EX",ttlSeconds,"NX"); }
  catch { return deny("approval_store_error"); }
  if (!response?.configured || response.result!=="OK") return deny("approval_store_rejected");
  return {issued:true,id,expiresAt:new Date(expiresAtMs).toISOString()};
}
