// Privileged server-only database adapter. No REST Data API exposure is needed.
// Provide a server-side PostgreSQL driver with parameterized query support.
export function makePrivateReviewerGrantLookup({db}={}) {
  if (!db || typeof db.query!=="function") throw new TypeError("server_db_required");
  return async function queryPrivateReviewerGrant({reviewerId,scope}={}) {
    if (typeof reviewerId!=="string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reviewerId) ||
        scope!=="affareradar") return [];
    try {
      const result=await db.query(
        "select reviewer_id::text, scope, active, can_approve_publish "+
        "from agentos_private.reviewer_grants where reviewer_id = $1::uuid and scope = $2 limit 2",
        [reviewerId,scope]);
      return Array.isArray(result?.rows)?result.rows:[];
    } catch { return []; } // fail closed, no privileged errors returned to client
  };
}
