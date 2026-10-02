import crypto from "node:crypto";

const TASK_TYPES = new Set([
  "VERIFY_OFFER",
  "RECHECK_OFFER",
  "PUBLISH_OFFER",
  "HOLD_OFFER",
  "RELEASE_OFFER",
  "ARCHIVE_OFFER",
  "RUN_DISCOVERY",
  "OPTIMIZE_PORTFOLIO",
  "CAPTURE_SIGNAL",
  "EVALUATE_OFFER",
  "LEARN_OUTCOME"
]);

const PRIORITY_RANK = {
  critical:0,
  high:1,
  normal:2,
  low:3
};

const AUTONOMY_RANK = {
  OBSERVE:0,
  ASSISTED:1,
  SUPERVISED:2,
  AUTONOMOUS:3
};

function stableId(raw = "") {
  return crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 24);
}

function normalizePriority(value = "normal") {
  const p = String(value || "normal").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, p) ? p : "normal";
}

export function configuredAutonomyLevel() {
  const raw = String(process.env.AFFARERADAR_AGENTOS_AUTONOMY || "SUPERVISED").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(AUTONOMY_RANK, raw) ? raw : "SUPERVISED";
}

export function normalizeAgentOsTask(input = {}, now = Date.now()) {
  const taskType = String(input.taskType || input.type || "").trim().toUpperCase();
  const priority = normalizePriority(input.priority);
  const createdAt = input.createdAt && Number.isFinite(Date.parse(input.createdAt))
    ? new Date(input.createdAt).toISOString()
    : new Date(now).toISOString();
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const inputData = input.input && typeof input.input === "object" ? input.input : {};
  const entitySeed =
    input.entityId ||
    inputData.asin ||
    inputData.amazonUrl ||
    payload?.offer?.asin ||
    payload?.offer?.amazonUrl ||
    payload?.dealId ||
    taskType ||
    createdAt;
  const taskId = String(input.taskId || "").trim() ||
    `agtask_${stableId(`${taskType}|${entitySeed}|${createdAt}`)}`;
  const expiresAt = input.expiresAt && Number.isFinite(Date.parse(input.expiresAt))
    ? new Date(input.expiresAt).toISOString()
    : null;

  return {
    taskId,
    taskType,
    domain:"affareradar",
    entityId:input.entityId || null,
    priority,
    createdAt,
    expiresAt,
    approvalRequired:input.approvalRequired === true,
    approvalStatus:String(input.approvalStatus || "NONE").trim().toUpperCase(),
    requestedAutonomy:String(input.requestedAutonomy || "").trim().toUpperCase() || null,
    idempotencyKey:String(input.idempotencyKey || taskId).trim(),
    dependsOn:Array.isArray(input.dependsOn) ? input.dependsOn.filter(Boolean) : [],
    input:inputData,
    payload,
    context:input.context && typeof input.context === "object" ? input.context : null,
    issuedBy:String(input.issuedBy || "AgentOS")
  };
}

export function validateAgentOsTask(task = {}, now = Date.now()) {
  const errors = [];
  if (task.domain !== "affareradar") errors.push("invalid_domain");
  if (!TASK_TYPES.has(task.taskType)) errors.push("unsupported_task_type");
  if (!task.taskId) errors.push("missing_task_id");
  if (task.expiresAt && Date.parse(task.expiresAt) < now) errors.push("task_expired");

  if (task.taskType === "PUBLISH_OFFER" && !task.payload?.offer) {
    errors.push("publish_offer_payload_missing");
  }

  if (["VERIFY_OFFER","RECHECK_OFFER"].includes(task.taskType)) {
    const hasEntity = Boolean(
      task.input?.asin ||
      task.input?.amazonUrl ||
      task.payload?.offer?.asin ||
      task.payload?.offer?.amazonUrl
    );
    if (!hasEntity) errors.push("verification_target_missing");
  }

  if (["HOLD_OFFER","RELEASE_OFFER","ARCHIVE_OFFER"].includes(task.taskType)) {
    const hasTarget = Boolean(
      task.entityId ||
      task.payload?.dealId ||
      task.input?.asin ||
      task.payload?.offer?.asin
    );
    if (!hasTarget) errors.push("task_target_missing");
  }

  return {
    valid:errors.length === 0,
    errors
  };
}

function minimumAutonomy(taskType) {
  if (["RUN_DISCOVERY","VERIFY_OFFER","RECHECK_OFFER","OPTIMIZE_PORTFOLIO","CAPTURE_SIGNAL","EVALUATE_OFFER","LEARN_OUTCOME"].includes(taskType)) {
    return "OBSERVE";
  }
  if (["HOLD_OFFER","RELEASE_OFFER"].includes(taskType)) {
    return "ASSISTED";
  }
  if (taskType === "ARCHIVE_OFFER") return "SUPERVISED";
  if (taskType === "PUBLISH_OFFER") return "AUTONOMOUS";
  return "AUTONOMOUS";
}

export function evaluateTaskAuthority(task = {}, ctx = {}) {
  const autonomy = String(ctx.autonomyLevel || configuredAutonomyLevel()).toUpperCase();
  const minimum = minimumAutonomy(task.taskType);
  const currentRank = AUTONOMY_RANK[autonomy] ?? AUTONOMY_RANK.SUPERVISED;
  const requiredRank = AUTONOMY_RANK[minimum] ?? AUTONOMY_RANK.AUTONOMOUS;
  const explicitlyApproved = task.approvalStatus === "APPROVED";
  const hardStop =
    ctx.systemMode === "SAFE_MODE" ||
    ctx.hardPolicyBlocked === true;

  if (hardStop && task.taskType === "PUBLISH_OFFER") {
    return {
      action:"REJECT",
      autonomyLevel:autonomy,
      minimumAutonomy:minimum,
      reason:ctx.systemMode === "SAFE_MODE" ? "safe_mode" : "hard_policy_block"
    };
  }

  if (task.approvalRequired && !explicitlyApproved) {
    return {
      action:"WAIT_APPROVAL",
      autonomyLevel:autonomy,
      minimumAutonomy:minimum,
      reason:"explicit_approval_required"
    };
  }

  if (currentRank < requiredRank && !explicitlyApproved) {
    return {
      action:"WAIT_APPROVAL",
      autonomyLevel:autonomy,
      minimumAutonomy:minimum,
      reason:"autonomy_below_task_requirement"
    };
  }

  return {
    action:"EXECUTE",
    autonomyLevel:autonomy,
    minimumAutonomy:minimum,
    reason:explicitlyApproved ? "approved_override_within_hard_guards" : "autonomy_allows"
  };
}

export function taskPriorityScore(task = {}) {
  const rank = PRIORITY_RANK[normalizePriority(task.priority)] ?? PRIORITY_RANK.normal;
  const created = Number.isFinite(Date.parse(task.createdAt)) ? Date.parse(task.createdAt) : Date.now();
  return rank * 10000000000000 + created;
}

export function taskRisk(task = {}) {
  if (task.taskType === "PUBLISH_OFFER") return "HIGH";
  if (["ARCHIVE_OFFER","RELEASE_OFFER"].includes(task.taskType)) return "MEDIUM";
  if (task.taskType === "HOLD_OFFER") return "LOW";
  return "LOW";
}

export function taskRegistry() {
  return [...TASK_TYPES];
}
