// Fail-closed bridge from a verified server-side identity service to AgentOS.
// This module does not authenticate requests. Both callbacks must be supplied
// by trusted server infrastructure, never sourced from request JSON.
export function makeTrustedReviewerAuthenticator({verifySession,lookupReviewerGrant,verifyExplicitApproval}={}) {
  if (![verifySession,lookupReviewerGrant,verifyExplicitApproval].every(x=>typeof x==="function")) {
    throw new TypeError("trusted_identity_dependencies_required");
  }
  return async function authenticateReviewer(authenticationContext,{operation,scope,publicationDigest}={}) {
    if (operation!=="PUBLISH_OFFER" || scope!=="affareradar" || !/^[a-f0-9]{64}$/.test(publicationDigest||"")) return null;
    try {
      const identity=await verifySession(authenticationContext);
      if (!identity || identity.verified!==true || typeof identity.userId!=="string" ||
          identity.userId.length<2 || identity.mfaLevel!=="aal2" || identity.sessionActive!==true) return null;
      const grant=await lookupReviewerGrant(identity.userId,{operation,scope});
      if (!grant || grant.active!==true || grant.canApprove!==true) return null;
      const confirmed=await verifyExplicitApproval(identity.userId,{operation,scope,publicationDigest,authenticationContext});
      if (confirmed !== true) return null;
      return {id:identity.userId,verified:true,canApprove:true,authenticationStrength:"STRONG",
        explicitApproval:true,approvedDigest:publicationDigest};
    } catch { return null; }
  };
}
