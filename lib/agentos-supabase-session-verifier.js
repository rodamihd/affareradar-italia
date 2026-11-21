// Staging-only Supabase Auth verifier for an existing authenticated session.
// A /user success establishes token validity; token claims are only read AFTER
// verifying that exact token with Supabase Auth. No passwords or secrets logged.
export function makeSupabaseSessionVerifier({supabaseUrl,publishableKey,fetchImpl=fetch,checkActiveSession}={}) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl||"") ||
      typeof publishableKey!=="string" || !publishableKey ||
      typeof fetchImpl!=="function" || typeof checkActiveSession!=="function") {
    throw new TypeError("supabase_verifier_dependencies_required");
  }
  const base=supabaseUrl.replace(/\/$/,"");
  return async function verifySession(context) {
    const token=context?.accessToken;
    if (typeof token!=="string" || token.length>8192 || token.split(".").length!==3) return null;
    try {
      const res=await fetchImpl(base+"/auth/v1/user",{headers:{
        apikey:publishableKey,Authorization:"Bearer "+token
      },signal:AbortSignal.timeout(5000)});
      if (!res?.ok) return null;
      const user=await res.json();
      if (!user || typeof user.id!=="string" || !user.id) return null;
      const part=token.split(".")[1];
      const claims=JSON.parse(Buffer.from(part,"base64url").toString("utf8"));
      if (claims.sub!==user.id || claims.aal!=="aal2" ||
          typeof claims.session_id!=="string" || !claims.session_id ||
          typeof claims.exp!=="number" || claims.exp*1000<=Date.now() ||
          typeof claims.iat!=="number" || claims.iat*1000>Date.now()+60000 ||
          claims.is_anonymous===true) return null;
      // Must query a privileged, server-only session status mechanism:
      // no Auth token may bypass session revocation / user disablement.
      if (await checkActiveSession({userId:user.id,sessionId:claims.session_id})!==true) return null;
      return {verified:true,userId:user.id,mfaLevel:"aal2",sessionActive:true};
    } catch { return null; }
  };
}
