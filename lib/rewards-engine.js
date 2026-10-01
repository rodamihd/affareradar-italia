const CATALOG = {
  prime:{
    label:"Prime",
    defaultRewardEUR:3,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:true
  },
  prime_young_adults:{
    label:"Prime for Young Adults",
    defaultRewardEUR:10,
    sourceStatus:"provided_material",
    timeLimited:true,
    storefrontSupported:true
  },
  prime_video:{
    label:"Prime Video",
    defaultRewardEUR:null,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:true
  },
  audible_trial:{
    label:"Audible prova gratuita",
    defaultRewardEUR:5,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:true
  },
  audible_paid:{
    label:"Audible abbonamento a pagamento",
    defaultRewardEUR:8,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:true
  },
  baby_registry:{
    label:"Lista Nascita Amazon",
    defaultRewardEUR:null,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:false
  },
  wedding_registry:{
    label:"Lista Nozze Amazon",
    defaultRewardEUR:null,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:false
  },
  amazon_music_unlimited:{
    label:"Amazon Music Unlimited",
    defaultRewardEUR:null,
    sourceStatus:"provided_material",
    timeLimited:false,
    storefrontSupported:true
  },
  kindle_unlimited:{
    label:"Kindle Unlimited",
    defaultRewardEUR:null,
    sourceStatus:"provided_material",
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
    music_unlimited:"amazon_music_unlimited"
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
  const validUntil = body.rewardValidUntil ? Date.parse(body.rewardValidUntil) : null;
  const expired = Number.isFinite(validUntil) && validUntil < now;
  const amount = Number.isFinite(Number(body.rewardAmountEUR))
    ? Number(body.rewardAmountEUR)
    : config?.defaultRewardEUR ?? null;

  const issues = [];
  if (!config) issues.push("unsupported_reward_program");
  if (!verified) issues.push("reward_terms_not_verified");
  if (expired) issues.push("reward_offer_expired");
  if (!body.amazonUrl) issues.push("missing_reward_landing_page");

  return {
    isReward:Boolean(program),
    program,
    label:config?.label || body.rewardProgram || null,
    rewardAmountEUR:amount,
    sourceStatus:config?.sourceStatus || null,
    timeLimited:Boolean(config?.timeLimited),
    storefrontSupported:Boolean(config?.storefrontSupported),
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
