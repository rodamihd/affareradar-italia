export function sendError(res, error) {
  const status = Number(error?.status || 500);
  res.status(status).json({
    ok: false,
    error: error?.code || "FANTAOS_INTERNAL_ERROR",
    message: status >= 500 ? "Service unavailable" : error?.message || "Request failed"
  });
}

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  return res.status(405).json({
    ok: false,
    error: "METHOD_NOT_ALLOWED",
    allowed
  });
}
