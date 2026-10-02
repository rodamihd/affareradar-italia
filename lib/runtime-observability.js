function requestId(req) {
  return String(req?.headers?.["x-vercel-id"] || req?.headers?.["x-request-id"] || "").trim() || null;
}

function safeExtra(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (/token|secret|credential|authorization|password/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function startRuntimeObservation(req, route) {
  const observation = {
    route,
    requestId:requestId(req),
    startedAt:Date.now()
  };
  console.log(JSON.stringify({
    level:"info",
    msg:"request_start",
    route,
    requestId:observation.requestId
  }));
  return observation;
}

export function runtimeSuccess(observation, extra = {}) {
  console.log(JSON.stringify({
    level:"info",
    msg:"request_done",
    route:observation?.route || null,
    requestId:observation?.requestId || null,
    durationMs:Math.max(0, Date.now() - Number(observation?.startedAt || Date.now())),
    ...safeExtra(extra)
  }));
}

export function runtimeFailure(observation, error, extra = {}) {
  console.error(JSON.stringify({
    level:"error",
    msg:"request_failed",
    route:observation?.route || null,
    requestId:observation?.requestId || null,
    durationMs:Math.max(0, Date.now() - Number(observation?.startedAt || Date.now())),
    error:String(error?.message || error || "unknown_error").slice(0, 500),
    ...safeExtra(extra)
  }));
}
