import { normalizeServiceTrackingEvent } from "../lib/service-tracking.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"METHOD_NOT_ALLOWED" });
  }

  const event = normalizeServiceTrackingEvent(req.body || {});
  if (!event.valid) {
    return res.status(400).json({ ok:false, error:event.reason, eventType:event.eventType });
  }

  return res.status(200).json({
    ok:true,
    mode:"SHADOW",
    accepted:event,
    persisted:false,
    note:"Persistence/provider callback wiring is intentionally deferred until partner credentials or verified report ingestion are configured."
  });
}
