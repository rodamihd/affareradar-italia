function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }

export function creatorQualityScore(body = {}) {
  const dealScore = num(body.dealScore);
  const reliability = num(body.reliabilityScore);
  const rating = num(body.rating || body.stars);
  const discount = num(String(body.discount || "").replace(/[^0-9.,]/g,"").replace(",","."));
  const prime = body.prime === true;
  const historicalLow = body.historicalLow === true;
  const trustedBrand = body.trustedBrand === true || body.brandTrusted === true;
  const everyday = body.everydayUtility !== false;
  const goodValue = body.goodValue !== false;

  let score =
    dealScore * 0.45 +
    reliability * 0.30 +
    Math.min(discount, 60) * 0.15 +
    (prime ? 4 : 0) +
    (historicalLow ? 6 : 0) +
    (trustedBrand ? 4 : 0) +
    (everyday ? 3 : 0) +
    (goodValue ? 3 : 0);

  if (rating >= 4) score += Math.min(6, (rating - 4) * 6);
  if (rating > 0 && rating < 4) score -= 10;

  return {
    score:Math.max(0, Math.min(100, Math.round(score))),
    factors:{
      dealScore,
      reliability,
      discount,
      prime,
      historicalLow,
      rating:rating || null,
      trustedBrand,
      everydayUtility:everyday,
      goodValue
    },
    passed:score >= Number(process.env.CREATOR_QUALITY_MIN_SCORE || 78)
  };
}

export function publishingWindow(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("it-IT", {
    timeZone:"Europe/Rome",
    hour:"2-digit",
    hour12:false
  }).format(now));

  if (hour >= 6 && hour < 10) return { name:"morning", priority:"high" };
  if (hour >= 18 && hour < 22) return { name:"evening", priority:"high" };
  if (hour >= 10 && hour < 18) return { name:"daytime", priority:"normal" };
  return { name:"off_peak", priority:"low" };
}

export function nextPreferredSlot(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Rome",
    year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false
  }).formatToParts(now).reduce((a,p)=>{a[p.type]=p.value;return a;},{});

  const y=Number(parts.year), m=Number(parts.month)-1, d=Number(parts.day), h=Number(parts.hour);
  const targetHour = h < 7 ? 7 : h < 19 ? 19 : 7;
  const addDay = h >= 19 ? 1 : 0;

  const utcGuess = Date.UTC(y,m,d+addDay,targetHour,0,0);
  return utcGuess;
}
