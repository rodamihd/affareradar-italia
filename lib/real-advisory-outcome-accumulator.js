export const REAL_ADVISORY_ACCUMULATION_CONTRACT = "agentos.real_advisory_accumulation.v1";

function isReal(row){
  return String(row?.source || row?.evidence_source || "").toLowerCase() === "real";
}

function keyOf(row){
  return String(row?.decision_id || row?.decisionId || "").trim();
}

export function accumulateRealAdvisoryOutcomes({
  advisoryRows = [],
  outcomeRows = []
} = {}){
  const outcomes = new Map();
  for (const row of outcomeRows){
    const id = keyOf(row);
    if (id && isReal(row)) outcomes.set(id, row);
  }

  const accepted = [];
  const rejected = [];

  for (const advisory of advisoryRows){
    const id = keyOf(advisory);
    if (!id){
      rejected.push({reason:"DECISION_ID_MISSING", row:advisory});
      continue;
    }
    if (!isReal(advisory)){
      rejected.push({decision_id:id, reason:"NON_REAL_ADVISORY_SOURCE"});
      continue;
    }

    const outcome = outcomes.get(id) || null;
    if (!outcome){
      accepted.push({
        decision_id:id,
        known_outcome:false,
        advisory,
        outcome:null
      });
      continue;
    }

    accepted.push({
      decision_id:id,
      known_outcome:true,
      advisory,
      outcome
    });
  }

  const known = accepted.filter(x => x.known_outcome);

  return {
    contract:REAL_ADVISORY_ACCUMULATION_CONTRACT,
    source_requirement:"real",
    total_real_advisory:accepted.length,
    known_real_outcomes:known.length,
    pending_real_outcomes:accepted.length - known.length,
    rejected_non_real:rejected.filter(x => x.reason === "NON_REAL_ADVISORY_SOURCE").length,
    promotion_eligible_real_evidence:known.length,
    automatic_promotion:false,
    records:accepted,
    rejected
  };
}
