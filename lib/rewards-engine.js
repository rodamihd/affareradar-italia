const CATALOG = {
  prime:{
    label:"Prime",
    defaultRewardEUR:3,
    sourceStatus:"secondary_2026_corroborated",
    confidence:"medium_high",
    requiresFreshVerification:false,
    timeLimited:false,
    storefrontSupported:true
  },
  prime_young_adults:{
    label:"Prime for Young Adults",
    defaultRewardEUR:10,
    sourceStatus:"provided_material_time_limited",
    confidence:"medium",
    requiresFreshVerification:true,
    timeLimited:true,
    storefrontSupported:true
  },
  prime_video:{
    label:"Prime Video",
    defaultRewardEUR:3,
    sourceStatus:"secondary_2026_corroborated",
    confidence:"medium",
    requiresFreshVerification:false,
    timeLimited:false,
    storefrontSupported:true
  },
  prime_video_channels_trial:{
    label:"Prime Video Channels - prova gratuita",
    defaultRewardEUR:3,
    sourceStatus:"official_material_provided",
    confidence:"high",
    requiresFreshVerification:true,
    timeLimited:false,
    storefrontSupported:true,
    qualifyingAction:"free_channel_trial",
    rewardMultiplicity:"per_eligible_channel",
    paidRenewalRewardEUR:0,
    landingTypes:["channel_specific","storefront_channels"]
  },
  audible_trial:{
    label:"Audible prova gratuita",
    defaultRewardEUR:5,
    sourceStatus:"conflicting_sources",
    confidence:"low",
    requiresFreshVerification:true,
    timeLimited:false,
    storefrontSupported:true
  },
  audible_paid:{
    label:"Audible abbonamento a pagamento",
    defaultRewardEUR:8,
    sourceStatus:"conflicting_sources",
    confidence:"low",
    requiresFreshVerification:true,
    timeLimited:false,
    storefrontSupported:true
  },
  baby_registry:{
    label:"Lista Nascita Amazon",
    defaultRewardEUR:1.5,
    sourceStatus:"secondary_2026_corroborated",
    confidence:"medium",
    requiresFreshVerification:false,
    timeLimited:false,
    storefrontSupported:false
  },
  wedding_registry:{
    label:"Lista Nozze Amazon",
    defaultRewardEUR:3.5,
    sourceStatus:"secondary_2026_corroborated",
    confidence:"medium",
    requiresFreshVerification:false,
    timeLimited:false,
    storefrontSupported:false
  },
  amazon_music_unlimited:{
    label:"Amazon Music Unlimited",
    defaultRewardEUR:4.5,
    sourceStatus:"secondary_2026_corroborated",
    confidence:"medium",
    requiresFreshVerification:false,
    timeLimited:false,
    storefrontSupported:true
  },
  kindle_unlimited:{
    label:"Kindle Unlimited",
    defaultRewardEUR:3,
    sourceStatus:"secondary_2026_corroborated",
    confidence:"medium",
    requiresFreshVerification:false,
    timeLimited:false,
    storefrontSupported:false
  }
};

export function normalizeRewardProgram(value = "") {
  const key = String(value).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,"_")
    .replace(/^_|_$/g,"");
  const aliases = {
    prime_for_young_adults:"prime_young_adults",
    young_adults_prime:"prime_young_adults",
    audible_free_trial:"audible_trial",
    audible_subscription:"audible_paid",
    music_unlimited:"amazon_music_unlimited",
    prime_video_channels:"prime_video_channels_trial",
    prime_video_channel:"prime_video_channels_trial",
    pvc_trial:"prime_video_channels_trial"
  };
  return aliases[key] || key;
}

export function rewardCatalog() {
  return CATALOG;
}

export function evaluateAmazonReward(body = {}, now = Date.now()) {
  const program = normalizeRewardProgram(body.rewardProgram || body.program || "");
  const config = CATALOG[program] || null;
  const verified = body.rewardTermsVerified === true;
  const freshVerificationRequired = Boolean(config?.requiresFreshVerification);
  const validUntil = body.rewardValidUntil ? Date.parse(body.rewardValidUntil) : null;
  const expired = Number.isFinite(validUntil) && validUntil < now;
  const hasExplicitAmount = body.rewardAmountEUR !== null &&
    body.rewardAmountEUR !== undefined &&
    String(body.rewardAmountEUR).trim() !== "";
  const amount = hasExplicitAmount && Number.isFinite(Number(body.rewardAmountEUR))
    ? Number(body.rewardAmountEUR)
    : config?.defaultRewardEUR ?? null;

  const issues = [];
  if (!config) issues.push("unsupported_reward_program");
  if (!verified && freshVerificationRequired) issues.push("reward_terms_not_verified");
  if (expired) issues.push("reward_offer_expired");
  if (!body.amazonUrl) issues.push("missing_reward_landing_page");

  if (program === "prime_video_channels_trial" && body.amazonUrl) {
    try {
      const u = new URL(body.amazonUrl);
      const hostOk = u.hostname === "www.primevideo.com" || u.hostname === "primevideo.com";
      const isStorefront = u.pathname.includes("/storefront/channels");
      const benefitId = u.searchParams.get("benefitId");
      const isChannelLanding = u.pathname.includes("/offers/") && Boolean(benefitId);
      const tag = u.searchParams.get("tag");
      if (!hostOk) issues.push("invalid_prime_video_channels_host");
      if (!isStorefront && !isChannelLanding) issues.push("invalid_prime_video_channels_landing");
      if (tag !== process.env.AMAZON_PARTNER_TAG) issues.push("reward_tracking_tag_mismatch");
    } catch {
      issues.push("invalid_reward_landing_page");
    }
  }

  return {
    isReward:Boolean(program),
    program,
    label:config?.label || body.rewardProgram || null,
    rewardAmountEUR:amount,
    sourceStatus:config?.sourceStatus || null,
    confidence:config?.confidence || null,
    requiresFreshVerification:freshVerificationRequired,
    timeLimited:Boolean(config?.timeLimited),
    storefrontSupported:Boolean(config?.storefrontSupported),
    qualifyingAction:config?.qualifyingAction || null,
    rewardMultiplicity:config?.rewardMultiplicity || null,
    paidRenewalRewardEUR:config?.paidRenewalRewardEUR ?? null,
    verified,
    validUntil:Number.isFinite(validUntil) ? new Date(validUntil).toISOString() : null,
    eligible:issues.length === 0,
    issues
  };
}

export function rewardContent(body = {}, evaluation = {}) {
  const label = evaluation.label || "Programma Amazon";
  const rewardText = evaluation.rewardAmountEUR != null
    ? `Ricompensa indicativa da materiale fornito: €${evaluation.rewardAmountEUR}`
    : "Ricompensa secondo il listino Amazon vigente";

  return {
    title:body.title || label,
    category:"Amazon Rewards",
    badge:"🎁 AMAZON REWARD",
    reason:body.reason || `${label} · ${rewardText}`,
    rewardProgram:evaluation.program,
    rewardAmountEUR:evaluation.rewardAmountEUR,
    storefrontSupported:evaluation.storefrontSupported
  };
}
