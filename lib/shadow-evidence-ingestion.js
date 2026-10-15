const VALID_MODES = new Set(["shadow","contract_only","live_real","oos","backtest","replay"]);

function isHex64(value){
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function keyFor(record){
  return [record.vertical, record.mode, record.decision_id, record.outcome_id ?? ""].join("|");
}

export function validateEvidenceRecord(input = {}){
  const errors = [];
  const vertical = String(input.vertical || "").trim().toLowerCase();
  const mode = String(input.mode || "").trim().toLowerCase();
  const decisionId = String(input.decision_id || "").trim();
  const outcomeId = input.outcome_id == null ? null : String(input.outcome_id).trim();

  if (!vertical) errors.push("VERTICAL_REQUIRED");
  if (!VALID_MODES.has(mode)) errors.push("MODE_INVALID");
  if (!decisionId) errors.push("DECISION_ID_REQUIRED");
  if (input.evidence_contract !== "agentos.verified_evidence.v1") errors.push("EVIDENCE_CONTRACT_INVALID");
  if (String(input.evidence_hash_version || "") !== "2") errors.push("EVIDENCE_HASH_VERSION_INVALID");
  if (!isHex64(input.evidence_hash)) errors.push("EVIDENCE_HASH_INVALID");
  if (!input.baseline_decision) errors.push("BASELINE_DECISION_REQUIRED");
  if (!input.shadow_decision && !input.backport_decision) errors.push("SHADOW_DECISION_REQUIRED");

  const normalized = {
    ...input,
    vertical,
    mode,
    decision_id:decisionId,
    outcome_id:outcomeId,
    shadow_decision:input.shadow_decision ?? input.backport_decision,
    outcome:input.outcome ?? "UNKNOWN"
  };

  return {
    valid:errors.length === 0,
    errors,
    record:normalized
  };
}

export function ingestEvidenceRecords(inputs = []){
  const accepted = [];
  const rejected = [];
  const duplicateKeys = new Set();
  const seen = new Map();

  for (const input of inputs){
    const result = validateEvidenceRecord(input);
    if (!result.valid){
      rejected.push({ record:result.record, errors:result.errors });
      continue;
    }

    const k = keyFor(result.record);
    const previous = seen.get(k);
    if (!previous){
      seen.set(k, result.record);
      accepted.push(result.record);
      continue;
    }

    const sameHash = previous.evidence_hash === result.record.evidence_hash;
    const sameOutcome = String(previous.outcome ?? "UNKNOWN") === String(result.record.outcome ?? "UNKNOWN");
    if (sameHash && sameOutcome){
      duplicateKeys.add(k);
      continue;
    }

    rejected.push({
      record:result.record,
      errors:["CONFLICTING_DUPLICATE"]
    });
  }

  return {
    accepted,
    rejected,
    duplicate_count:duplicateKeys.size,
    accepted_count:accepted.length,
    rejected_count:rejected.length
  };
}
