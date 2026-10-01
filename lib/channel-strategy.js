export function classifyContent(body = {}) {
  const score = Number(body.dealScore || 0);
  const type = String(body.dealType || "").toLowerCase();

  if (body.historicalLow) return "historical_low";
  if (type === "price_error") return "price_error";
  if (type === "coupon_stack" || body.coupon || body.stack) return "coupon_stack";
  if (score >= 90) return "top_deal";
  return "deal";
}

export function channelPlan(body = {}) {
  const contentType = classifyContent(body);
  const score = Number(body.dealScore || 0);
  const reliability = Number(body.reliabilityScore || 0);

  const plan = {
    telegram:{ enabled:true, priority:"normal", format:"deal_card" },
    instagram:{ enabled:false, priority:"future", format:"story_or_reel" },
    facebook:{ enabled:false, priority:"future", format:"feed_or_reel" },
    youtube:{ enabled:false, priority:"future", format:"community_or_short" },
    newsletter:{ enabled:false, priority:"future", format:"digest" },
    website:{ enabled:false, priority:"future", format:"deal_page" }
  };

  if (contentType === "price_error" || score >= 98) {
    plan.telegram.priority = "critical";
  }

  if (contentType === "top_deal" || contentType === "historical_low") {
    plan.instagram.priority = "high";
    plan.facebook.priority = "high";
    plan.youtube.priority = "high";
    plan.newsletter.priority = "high";
    plan.website.priority = "high";
  }

  return {
    contentType,
    score,
    reliability,
    plan
  };
}
