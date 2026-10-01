function priceNumber(value){
  const m=String(value || "").replace(/\./g,"").replace(",",".").match(/[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : null;
}

export function evaluateRepublish(previous = null, body = {}, now = Date.now()) {
  if (!previous) return { allowed:true, reason:"first_publish", priority:"normal" };

  const prevPrice = priceNumber(previous.effectivePrice);
  const newPrice = priceNumber(body.effectivePrice || body.price);
  const lastPublished = previous.lastPublishedAt ? Date.parse(previous.lastPublishedAt) : null;
  const hoursSince = lastPublished ? (now - lastPublished) / 3600000 : Infinity;
  const minHours = Number(process.env.REPUBLISH_MIN_HOURS || 24);

  if (prevPrice && newPrice && newPrice < prevPrice) {
    const dropPct = ((prevPrice - newPrice) / prevPrice) * 100;
    return {
      allowed:true,
      reason:"price_improved",
      priority:dropPct >= 10 ? "high" : "normal",
      previousPrice:prevPrice,
      newPrice,
      dropPct:Number(dropPct.toFixed(1))
    };
  }

  if ((body.historicalLow === true || Number(body.dealScore) >= 97) && hoursSince >= Math.max(6, minHours / 2)) {
    return { allowed:true, reason:"strong_deal_refresh", priority:"high", hoursSince:Number(hoursSince.toFixed(1)) };
  }

  if (hoursSince >= minHours) {
    return { allowed:true, reason:"cooldown_elapsed", priority:"normal", hoursSince:Number(hoursSince.toFixed(1)) };
  }

  return { allowed:false, reason:"republish_too_soon", priority:"low", hoursSince:Number(hoursSince.toFixed(1)), minHours };
}
