import {makeTrustedReviewerAuthenticator} from "./agentos-trusted-reviewer-adapter.js";
import {makeSupabaseSessionVerifier} from "./agentos-supabase-session-verifier.js";

// Compose the existing security checks. All privileged callbacks are injected
// by a trusted SERVER, not accepted from HTTP input or user metadata.
// Intentionally no exposed HTTP approval issuance endpoint.
export function makeSupabaseReviewerAuthenticator({
  supabaseUrl,publishableKey,fetchImpl,checkActiveSession,
  queryPrivateReviewerGrant,verifyExplicitApproval
}={}) {
  if (typeof queryPrivateReviewerGrant!=="function" ||
      typeof verifyExplicitApproval!=="function" ||
      typeof checkActiveSession!=="function") {
    throw new TypeError("trusted_reviewer_backend_required");
  }
  const verifySession=makeSupabaseSessionVerifier({
    supabaseUrl,publishableKey,fetchImpl,checkActiveSession
  });
  async function lookupReviewerGrant(userId,{operation,scope}) {
    if (operation!=="PUBLISH_OFFER" || scope!=="affareradar" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
      return null;
    try {
      // Must query agentos_private.reviewer_grants with server-only credentials,
      // using exact reviewer_id and scope, never caller-supplied role claims.
      const rows=await queryPrivateReviewerGrant({reviewerId:userId,scope});
      if (!Array.isArray(rows) || rows.length!==1) return null;
      const grant=rows[0];
      if (grant?.reviewer_id!==userId || grant.scope!==scope ||
          grant.active!==true || grant.can_approve_publish!==true) return null;
      return {active:true,canApprove:true};
    } catch { return null; }
  }
  return makeTrustedReviewerAuthenticator({verifySession,lookupReviewerGrant,verifyExplicitApproval});
}
