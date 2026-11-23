const REQUIRED_PRODUCTION_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET"
];

export function runtimeEnvironment() {
  return process.env.FANTAOS_ENV || process.env.VERCEL_ENV || "development";
}

export function validateEnvironment() {
  const environment = runtimeEnvironment();
  const isProduction = environment === "production";
  const missing = isProduction
    ? REQUIRED_PRODUCTION_ENV.filter((key) => !process.env[key])
    : [];

  return {
    ok: missing.length === 0,
    environment,
    missing
  };
}
