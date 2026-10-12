// Conservative authorization evaluation. Never accept a caller's self-reported
// human approval as proof of a privileged action.
const sensitive = new Set(["PUBLISH_OFFER","RELEASE_OFFER","ARCHIVE_OFFER","DEPLOY","DELETE","TRANSFER_DATA"]);
export function evaluateAgentAuthorization(input = {}) {
  const operation = String(input.operation || "").trim().toUpperCase();
  const principal = String(input.principal || "").trim();
  const permissions = Array.isArray(input.grantedPermissions) ? input.grantedPermissions : [];
  const revoked = input.revoked === true;
  const delegatedUntil = input.delegatedUntil ? Date.parse(input.delegatedUntil) : null;
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const validDelegation = !input.delegatedUntil || (Number.isFinite(delegatedUntil) && delegatedUntil > now);
  const scope = String(input.scope || "").trim();
  const grantScope = String(input.grantScope || "").trim();
  const permissionGranted = permissions.includes(operation) && scope && grantScope === scope;
  let decision = "DENY", reason = "missing_permission_or_scope";
  if (!principal || !operation) reason = "missing_identity_or_operation";
  else if (revoked) reason = "revoked";
  else if (!validDelegation) reason = "delegation_expired";
  else if (!permissionGranted) reason = "missing_permission_or_scope";
  else if (sensitive.has(operation) && input.trustedApproval !== true) {
    decision = "REQUIRE_HUMAN_APPROVAL"; reason = "verified_approval_required";
  } else { decision = "ALLOW"; reason = "authorized"; }
  return {version:"33.10",decision,reason,principal:principal || null,operation,scope:scope || null};
}
