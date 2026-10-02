function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function providerHealthDefaults(provider) {
  return {
    provider:String(provider || "unknown"),
    state:"CLOSED",
    consecutiveFailures:0,
    successes:0,
    failures:0,
    openedAt:null,
    retryAfter:null,
    lastSuccessAt:null,
    lastFailureAt:null,
    lastError:null,
    updatedAt:new Date().toISOString()
  };
}

export function providerCanAttempt(health = {}, now = Date.now()) {
  if (String(health.state || "CLOSED").toUpperCase() !== "OPEN") return true;
  const retryAt = Date.parse(health.retryAfter || "");
  return Number.isFinite(retryAt) ? retryAt <= now : false;
}

export function recordProviderSuccessState(current = {}, provider, now = Date.now()) {
  const base = { ...providerHealthDefaults(provider), ...current };
  return {
    ...base,
    provider:String(provider || base.provider || "unknown"),
    state:"CLOSED",
    consecutiveFailures:0,
    successes:num(base.successes) + 1,
    lastSuccessAt:new Date(now).toISOString(),
    lastError:null,
    retryAfter:null,
    updatedAt:new Date(now).toISOString()
  };
}

export function recordProviderFailureState(current = {}, provider, error, now = Date.now()) {
  const base = { ...providerHealthDefaults(provider), ...current };
  const threshold = Math.max(1, num(process.env.AMAZON_PROVIDER_FAILURE_THRESHOLD, 3));
  const cooldownMinutes = Math.max(1, num(process.env.AMAZON_PROVIDER_COOLDOWN_MINUTES, 15));
  const consecutiveFailures = num(base.consecutiveFailures) + 1;
  const opened = consecutiveFailures >= threshold;
  return {
    ...base,
    provider:String(provider || base.provider || "unknown"),
    state:opened ? "OPEN" : "CLOSED",
    consecutiveFailures,
    failures:num(base.failures) + 1,
    openedAt:opened ? new Date(now).toISOString() : base.openedAt || null,
    retryAfter:opened ? new Date(now + cooldownMinutes * 60000).toISOString() : null,
    lastFailureAt:new Date(now).toISOString(),
    lastError:String(error?.message || error || "provider_failure").slice(0, 300),
    updatedAt:new Date(now).toISOString()
  };
}
