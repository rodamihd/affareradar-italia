function safeUrl(value) {
  try { return new URL(value); } catch { return null; }
}

export function trackingTag(channel = "telegram", contentType = "deal") {
  const key = `AMAZON_PARTNER_TAG_${String(channel).toUpperCase()}_${String(contentType).toUpperCase()}`;
  const channelKey = `AMAZON_PARTNER_TAG_${String(channel).toUpperCase()}`;
  return process.env[key] || process.env[channelKey] || process.env.AMAZON_PARTNER_TAG || null;
}

export function amazonTrackedUrl(rawUrl, channel = "telegram", contentType = "deal") {
  const u = safeUrl(rawUrl);
  if (!u) return rawUrl;

  const host = u.hostname.toLowerCase();
  if (!(host === "amazon.it" || host.endsWith(".amazon.it"))) return rawUrl;

  const tag = trackingTag(channel, contentType);
  if (tag) u.searchParams.set("tag", tag);

  return u.toString();
}

export function deepLinkUrl(rawUrl, channel = "telegram", contentType = "deal") {
  const tracked = amazonTrackedUrl(rawUrl, channel, contentType);
  const template = process.env.DEEPLINK_URL_TEMPLATE;

  if (!template) return tracked;

  const tag = trackingTag(channel, contentType) || "";
  return template
    .replaceAll("{url}", encodeURIComponent(tracked))
    .replaceAll("{tag}", encodeURIComponent(tag))
    .replaceAll("{channel}", encodeURIComponent(channel))
    .replaceAll("{contentType}", encodeURIComponent(contentType));
}

export function attributionMeta(channel = "telegram", contentType = "deal") {
  return {
    channel,
    contentType,
    trackingTag:trackingTag(channel, contentType),
    deepLinkEnabled:Boolean(process.env.DEEPLINK_URL_TEMPLATE)
  };
}
