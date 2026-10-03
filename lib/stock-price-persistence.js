function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function numericStock(body = {}) {
  for (const value of [body.stock, body.stockCount, body.availableQuantity]) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function evaluateStockPricePersistence(body = {}, ctx = {}, now = Date.now()) {
  const stock = numericStock(body);
  const stockStatus = String(body.stockStatus || body.availability || "").toLowerCase();
  const lowStock = body.lowStock === true || (stock !== null && stock <= 5) || /only|few|limited|low/.test(stockStatus);
  const verified = ctx.verification?.state === "VERIFIED";
  const age = Number(ctx.freshness?.ageMinutes);
  const fresh = Number.isFinite(age) && age <= Number(ctx.freshness?.maxAgeMinutes || 30);
  const priceStable = body.priceStable === true || Number(body.priceObservations || 0) >= 3;
  const promoLimited = body.promotionTimeLimited === true;

  let persistenceScore = 55;
  if (verified) persistenceScore += 15;
  if (fresh) persistenceScore += 10;
  if (priceStable) persistenceScore += 12;
  if (lowStock) persistenceScore -= 22;
  if (promoLimited) persistenceScore -= 10;
  if (body.dealType === "price_error") persistenceScore -= 18;
  persistenceScore = clamp(persistenceScore);

  const urgencyScore = clamp(
    (lowStock ? 35 : 0) +
    (promoLimited ? 25 : 0) +
    (body.dealType === "price_error" ? 30 : 0) +
    (body.historicalLow ? 10 : 0)
  );

  return {
    version:"1.0",
    evaluatedAt:new Date(now).toISOString(),
    stockKnown:stock !== null || Boolean(stockStatus),
    stock,
    lowStock,
    priceStable,
    persistenceScore:Number(persistenceScore.toFixed(1)),
    urgencyScore:Number(urgencyScore.toFixed(1)),
    class:urgencyScore >= 70 ? "EPHEMERAL" : persistenceScore >= 75 ? "STABLE" : "NORMAL",
    recheckMinutes:urgencyScore >= 70 ? 3 : persistenceScore < 50 ? 5 : persistenceScore < 75 ? 10 : 20
  };
}
