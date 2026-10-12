// Approval records must be loaded from an authorized server-side store.
// The callback must atomically consume an unused record; never trust request fields.
export async function verifyStoredApproval({
  approvalId, principal, operation, scope, publicationDigest, now = Date.now(), consume
} = {}) {
  const deny = reason => ({verified:false,reason});
  if (!approvalId || !principal || !operation || !scope || !/^[a-f0-9]{64}$/.test(publicationDigest || "")) return deny("missing_context");
  if (typeof consume !== "function") return deny("trusted_store_unavailable");
  let record;
  try {
    record = await consume({approvalId,principal,operation,scope,publicationDigest,now});
  } catch {
    return deny("trusted_store_error");
  }
  if (!record || record.consumed !== true || record.atomic !== true) return deny("not_atomically_consumed");
  if (record.id !== approvalId || record.principal !== principal || record.operation !== operation || record.scope !== scope) return deny("approval_scope_mismatch");
  if (record.publicationDigest !== publicationDigest) return deny("publication_mismatch");
  if (record.revoked === true) return deny("approval_revoked");
  const expiry = Date.parse(record.expiresAt || "");
  if (!Number.isFinite(expiry) || expiry <= now) return deny("approval_expired");
  if (!record.approvedBy || record.approvedBy === principal || record.assurance !== "HUMAN_VERIFIED") return deny("independent_human_approval_required");
  return {verified:true,reason:"trusted_approval_consumed",approvalId};
}
