export function autonomyPromotionGate(input = {}) {
  const edge = input.edgeValidation || {};
  const experiment = input.championChallenger || {};
  const profit = input.profitLearning || {};

  const blockers = [];
  if (edge.evidence !== "high") blockers.push("edge_evidence_not_high");
  if (edge.verdict !== "EDGE_SUPPORTED") blockers.push("edge_not_supported");
  if (experiment.verdict !== "CHALLENGER_PROMOTION_CANDIDATE" && experiment.verdict !== "NO_MATERIAL_DIFFERENCE") {
    blockers.push("experiment_not_stable");
  }
  if (!["BOOST_CANDIDATE","NEUTRAL"].includes(profit.recommendation)) {
    blockers.push("profit_learning_not_positive");
  }

  const eligible = blockers.length === 0;

  return {
    version:"1.0",
    eligible,
    action:eligible ? "PROMOTION_CANDIDATE" : "KEEP_CURRENT_AUTONOMY",
    approvalRequired:true,
    automaticPromotion:false,
    blockers
  };
}
