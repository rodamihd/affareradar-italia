export function extractAsinFromUrl(url = "") {
  try {
    const pathname = new URL(url).pathname;
    const patterns = [
      /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
      /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
      /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i
    ];
    for (const pattern of patterns) {
      const match = pathname.match(pattern);
      if (match) return match[1].toUpperCase();
    }
  } catch {}
  return null;
}

export function verificationPlan(body = {}, current = {}) {
  const asin = String(body.asin || extractAsinFromUrl(body.amazonUrl || "") || "").toUpperCase() || null;
  const creatorsConfigured = Boolean(
    process.env.AMAZON_CREATORS_CREDENTIAL_ID &&
    process.env.AMAZON_CREATORS_CREDENTIAL_SECRET &&
    process.env.AMAZON_PARTNER_TAG
  );
  const paConfigured = Boolean(
    process.env.AMAZON_PAAPI_ACCESS_KEY &&
    process.env.AMAZON_PAAPI_SECRET_KEY &&
    process.env.AMAZON_PARTNER_TAG
  );

  const attempts = [];
  if (current.state !== "VERIFIED") {
    if (creatorsConfigured) attempts.push("creators_api");
    if (paConfigured) attempts.push("pa_api");
    attempts.push("amazon_link_tool_manual");
  }
  const providerMode =
    creatorsConfigured && paConfigured ? "MULTI_PROVIDER" :
    creatorsConfigured ? "CREATORS_ONLY" :
    paConfigured ? "PAAPI_ONLY" : "MANUAL_ONLY";

  return {
    asin,
    currentState:current.state || "UNKNOWN",
    creatorsConfigured,
    paConfigured,
    attempts,
    providerMode,
    canAutoVerify:Boolean(asin && (creatorsConfigured || paConfigured)),
    status:current.state === "VERIFIED"
      ? "NO_ACTION"
      : asin
        ? (creatorsConfigured || paConfigured ? "AUTO_VERIFY_AVAILABLE" : "MANUAL_VERIFY_REQUIRED")
        : "ASIN_RESOLUTION_REQUIRED"
  };
}
