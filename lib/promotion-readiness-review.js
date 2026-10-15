export const PROMOTION_READINESS_REVIEW_CONTRACT = "agentos.promotion_readiness_review.v1";

const STATISTICALLY_SUPPORTED = new Set([
  "FALSE_BLOCK_BOUND_SUPPORTED"
]);

const STATISTICAL_HARD_FAILURE = new Set([
  "FALSE_BLOCK_RATE_TOO_HIGH"
]);

function add(blockers, code, detail = null, hard = false){
  blockers.push({code, detail, hard});
}

export function assessPromotionReadinessReview({
  vertical,
  mode = "shadow",
  promotionEligible = true,
  readiness = {},
  statistical = {},
  consistency = {},
  ciGreen = false,
  evidenceVerified = false,
  riskRelaxations = 0
} = {}){
  const v = String(vertical || "unknown").toLowerCase();
  const normalizedMode = String(mode || "shadow").toLowerCase();

  if (normalizedMode === "contract_only" || promotionEligible === false){
    return {
      contract:PROMOTION_READINESS_REVIEW_CONTRACT,
      vertical:v,
      mode:normalizedMode,
      status:"CONTRACT_ONLY_EVIDENCE",
      promotion_candidate:false,
      automatic_promotion:false,
      human_review_required:true,
      blockers:[{
        code:"CONTRACT_ONLY_NOT_PROMOTION_ELIGIBLE",
        detail:null,
        hard:false
      }],
      hard_blockers:[],
      gates:{
        readiness:false,
        statistical:false,
        consistency:Boolean(consistency?.consistent),
        ci_green:Boolean(ciGreen),
        evidence_verified:Boolean(evidenceVerified),
        zero_risk_relaxations:Number(riskRelaxations || 0) === 0
      }
    };
  }

  const blockers = [];
  const readinessPass = readiness?.status === "READY_FOR_HUMAN_REVIEW";
  const statisticalPass = STATISTICALLY_SUPPORTED.has(
    String(statistical?.status || "").toUpperCase()
  );
  const consistencyPass = consistency?.consistent === true ||
    String(consistency?.status || "").toUpperCase() === "CONSISTENT";
  const ciPass = ciGreen === true;
  const evidencePass = evidenceVerified === true;
  const zeroRelaxations = Number(riskRelaxations || 0) === 0;

  if (!readinessPass){
    add(
      blockers,
      "PROMOTION_GATE_NOT_READY",
      {status:readiness?.status || null},
      readiness?.status === "NOT_READY"
    );
  }

  if (!statisticalPass){
    const statStatus = String(statistical?.status || "MISSING").toUpperCase();
    add(
      blockers,
      statStatus === "MISSING" ? "STATISTICAL_VALIDATION_MISSING" : "STATISTICAL_VALIDATION_NOT_SUPPORTED",
      {status:statistical?.status || null},
      STATISTICAL_HARD_FAILURE.has(statStatus)
    );
  }

  if (!consistencyPass){
    add(
      blockers,
      "CROSS_VERTICAL_INCONSISTENT",
      {status:consistency?.status || null, issues:consistency?.issues || []},
      true
    );
  }

  if (!ciPass){
    add(blockers, "CI_NOT_GREEN", null, true);
  }

  if (!evidencePass){
    add(blockers, "EVIDENCE_NOT_VERIFIED", null, true);
  }

  if (!zeroRelaxations){
    add(
      blockers,
      "RISK_RELAXATION_PRESENT",
      {count:Number(riskRelaxations || 0)},
      true
    );
  }

  if (readiness?.automatic_promotion !== false){
    add(blockers, "AUTOMATIC_PROMOTION_NOT_DISABLED", null, true);
  }

  if (readiness?.human_review_required !== true){
    add(blockers, "HUMAN_REVIEW_NOT_REQUIRED", null, true);
  }

  const hardBlockers = blockers.filter(x => x.hard);
  const status = blockers.length === 0
    ? "READY_FOR_HUMAN_REVIEW"
    : hardBlockers.length
      ? "NOT_READY"
      : "REVIEW";

  return {
    contract:PROMOTION_READINESS_REVIEW_CONTRACT,
    vertical:v,
    mode:normalizedMode,
    status,
    promotion_candidate:status === "READY_FOR_HUMAN_REVIEW",
    automatic_promotion:false,
    human_review_required:true,
    blockers,
    hard_blockers:hardBlockers,
    gates:{
      readiness:readinessPass,
      statistical:statisticalPass,
      consistency:consistencyPass,
      ci_green:ciPass,
      evidence_verified:evidencePass,
      zero_risk_relaxations:zeroRelaxations
    },
    sources:{
      readiness_status:readiness?.status || null,
      statistical_status:statistical?.status || null,
      consistency_status:consistency?.status || null
    }
  };
}

export function assessCrossVerticalPromotionReview({
  verticals = {}
} = {}){
  const results = {};
  for (const [vertical, input] of Object.entries(verticals)){
    results[vertical] = assessPromotionReadinessReview({
      vertical,
      ...input
    });
  }

  const eligible = Object.values(results).filter(
    x => x.status !== "CONTRACT_ONLY_EVIDENCE"
  );

  let status = "REVIEW";
  if (!eligible.length){
    status = "NO_PROMOTION_ELIGIBLE_VERTICALS";
  } else if (eligible.some(x => x.status === "NOT_READY")){
    status = "NOT_READY";
  } else if (eligible.every(x => x.status === "READY_FOR_HUMAN_REVIEW")){
    status = "READY_FOR_HUMAN_REVIEW";
  }

  return {
    contract:"agentos.cross_vertical_promotion_review.v1",
    status,
    automatic_promotion:false,
    human_review_required:true,
    promotion_candidate:status === "READY_FOR_HUMAN_REVIEW",
    verticals:results
  };
}
