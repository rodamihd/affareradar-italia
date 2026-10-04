function safeUrl(value) {
  try { return new URL(value); } catch { return null; }
}

export function trackingTag(channel = "telegram", contentType = "deal", campaign = null) {
  const channelName = String(channel).toUpperCase();
  const contentName = String(contentType).toUpperCase();
  const campaignName = campaign ? String(campaign).toUpperCase().replace(/[^A-Z0-9]+/g, "_") : null;
  const campaignKey = campaignName ? `AMAZON_PARTNER_TAG_${channelName}_${campaignName}` : null;
  const key = `AMAZON_PARTNER_TAG_${channelName}_${contentName}`;
  const channelKey = `AMAZON_PARTNER_TAG_${channelName}`;
  return (campaignKey ? process.env[campaignKey] : null) || process.env[key] || process.env[channelKey] || process.env.AMAZON_PARTNER_TAG || null;
}

export function amazonTrackedUrl(rawUrl, channel = "telegram", contentType = "deal", campaign = null) {
  const u = safeUrl(rawUrl);
  if (!u) return rawUrl;

  const host = u.hostname.toLowerCase();
  if (!(host === "amazon.it" || host.endsWith(".amazon.it"))) return rawUrl;

  const tag = trackingTag(channel, contentType, campaign);
  if (tag) u.searchParams.set("tag", tag);

  return u.toString();
}

export function deepLinkUrl(rawUrl, channel = "telegram", contentType = "deal", campaign = null) {
  const tracked = amazonTrackedUrl(rawUrl, channel, contentType, campaign);
  const template = process.env.DEEPLINK_URL_TEMPLATE;

  if (!template) return tracked;

  const tag = trackingTag(channel, contentType, campaign) || "";
  return template
    .replaceAll("{url}", encodeURIComponent(tracked))
    .replaceAll("{tag}", encodeURIComponent(tag))
    .replaceAll("{channel}", encodeURIComponent(channel))
    .replaceAll("{contentType}", encodeURIComponent(contentType));
}

export function attributionMeta(channel = "telegram", contentType = "deal", campaign = null) {
  return {
    channel,
    contentType,
    campaign:campaign || null,
    trackingTag:trackingTag(channel, contentType, campaign),
    deepLinkEnabled:Boolean(process.env.DEEPLINK_URL_TEMPLATE)
  };
}


export function validateAffiliateLink(rawUrl, channel = "telegram", contentType = "deal", campaign = null) {
  const u = safeUrl(rawUrl);
  if (!u) return { valid:false, reason:"invalid_url", trackedUrl:rawUrl };

  const host = u.hostname.toLowerCase();
  if (!(host === "amazon.it" || host.endsWith(".amazon.it"))) {
    return { valid:false, reason:"non_amazon_url", trackedUrl:rawUrl };
  }

  const expectedTag = trackingTag(channel, contentType, campaign);
  const currentTag = u.searchParams.get("tag");
  const trackedUrl = amazonTrackedUrl(rawUrl, channel, contentType, campaign);

  return {
    valid:Boolean(expectedTag),
    reason:expectedTag ? (currentTag === expectedTag ? "tag_ok" : "tag_added_or_corrected") : "tracking_tag_missing",
    expectedTag,
    currentTag,
    trackedUrl
  };
}
