import { validateEnvironment } from "../lib/env.js";

export default function handler(req, res) {
  const env = validateEnvironment();

  const payload = {
    ok: env.ok,
    service: "fantaos",
    component: "foundation",
    version: "0.1.0",
    environment: env.environment,
    checks: {
      environment: env.ok ? "PASS" : "FAIL"
    },
    missingConfiguration: env.missing
  };

  res.status(env.ok ? 200 : 503).json(payload);
}
