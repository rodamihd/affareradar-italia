import crypto from "node:crypto";
import { AGENTOS_PROFILE_VERSION, mixedModeForTask, routingPlan } from "./agentos-17_5-profile.js";

function id(prefix, raw) {
  return `${prefix}_${crypto.createHash("sha256").update(String(raw || "")).digest("hex").slice(0, 20)}`;
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function offerDagTemplate(offer = {}, options = {}, now = Date.now()) {
  const seed = offer.asin || offer.amazonUrl || offer.title || JSON.stringify(offer);
  const dagId = options.dagId || id("dag", `${seed}|${now}`);
  const recheckDelaySeconds = Math.max(60, Number(options.recheckDelaySeconds || 1800));

  const node = (name, taskType, dependsOn = [], extra = {}) => ({
    nodeId:`${dagId}:${name}`,
    name,
    taskType,
    dependsOn,
    status:extra.status || "WAITING",
    attempts:0,
    maxAttempts:Math.max(1, Number(extra.maxAttempts || 3)),
    timeoutSeconds:Math.max(2, Math.min(300, Number(extra.timeoutSeconds || 30))),
    externalTimeoutSeconds:Math.max(30, Math.min(3600, Number(extra.externalTimeoutSeconds || 900))),
    retryBaseSeconds:Math.max(15, Number(extra.retryBaseSeconds || 60)),
    delaySeconds:Math.max(0, Number(extra.delaySeconds || 0)),
    notBefore:extra.notBefore || null,
    taskId:null,
    result:null,
    lastError:null,
    startedAt:null,
    completedAt:null,
    executionMode:mixedModeForTask(taskType),
    routing:routingPlan(taskType, {
      creatorsConfigured:Boolean(process.env.AMAZON_CREATORS_CREDENTIAL_ID && process.env.AMAZON_CREATORS_CREDENTIAL_SECRET),
      paApiConfigured:Boolean(process.env.AMAZON_PAAPI_ACCESS_KEY && process.env.AMAZON_PAAPI_SECRET_KEY)
    })
  });

  const capture = node("capture", "CAPTURE_SIGNAL", [], { status:"COMPLETED", maxAttempts:1 });
  capture.completedAt = nowIso(now);
  capture.result = { captured:true };

  const nodes = [
    capture,
    node("verify", "VERIFY_OFFER", [capture.nodeId], { maxAttempts:3, retryBaseSeconds:90, timeoutSeconds:45, externalTimeoutSeconds:900 }),
    node("evaluate", "EVALUATE_OFFER", [`${dagId}:verify`], { maxAttempts:2, timeoutSeconds:30 }),
    node("portfolio", "OPTIMIZE_PORTFOLIO", [`${dagId}:evaluate`], { maxAttempts:2, timeoutSeconds:30 }),
    node("publish", "PUBLISH_OFFER", [`${dagId}:portfolio`], { maxAttempts:2, timeoutSeconds:60, externalTimeoutSeconds:300 }),
    node("recheck", "RECHECK_OFFER", [`${dagId}:publish`], {
      maxAttempts:3,
      retryBaseSeconds:180,
      timeoutSeconds:60,
      externalTimeoutSeconds:900,
      delaySeconds:recheckDelaySeconds
    }),
    node("learn", "LEARN_OUTCOME", [`${dagId}:recheck`], { maxAttempts:2, timeoutSeconds:30 })
  ];

  return {
    dagId,
    domain:"affareradar",
    agentOsVersion:AGENTOS_PROFILE_VERSION,
    entitySeed:seed,
    status:"RUNNING",
    createdAt:nowIso(now),
    updatedAt:nowIso(now),
    completedAt:null,
    offer,
    options:{
      recheckDelaySeconds,
      requirePublishApproval:options.requirePublishApproval !== false
    },
    nodes,
    recovery:{
      retries:0,
      lastRecoveredAt:null
    }
  };
}

export function dependenciesSatisfied(dag, node) {
  const byId = new Map((dag.nodes || []).map(n => [n.nodeId, n]));
  return (node.dependsOn || []).every(id => byId.get(id)?.status === "COMPLETED");
}

export function retryDelaySeconds(node = {}) {
  const attempts = Math.max(1, Number(node.attempts || 1));
  const base = Math.max(15, Number(node.retryBaseSeconds || 60));
  return Math.min(3600, base * Math.pow(2, Math.max(0, attempts - 1)));
}

export function scheduleNodeRetry(node = {}, now = Date.now(), error = "task_failed") {
  const next = { ...node };
  next.lastError = String(error || "task_failed");
  if (Number(next.attempts || 0) >= Number(next.maxAttempts || 1)) {
    next.status = "FAILED";
    next.completedAt = nowIso(now);
    return next;
  }
  const delay = retryDelaySeconds(next);
  next.status = "RETRY_WAIT";
  next.notBefore = nowIso(now + delay * 1000);
  next.taskId = null;
  return next;
}

export function refreshDagStatus(dag = {}, now = Date.now()) {
  const nodes = dag.nodes || [];
  const failed = nodes.some(n => n.status === "FAILED" || n.status === "REJECTED");
  const waitingApproval = nodes.some(n => n.status === "WAIT_APPROVAL");
  const allCompleted = nodes.length > 0 && nodes.every(n => ["COMPLETED","SKIPPED"].includes(n.status));

  let status = "RUNNING";
  if (failed) status = "FAILED";
  else if (allCompleted) status = "COMPLETED";
  else if (waitingApproval) status = "WAIT_APPROVAL";

  return {
    ...dag,
    status,
    updatedAt:nowIso(now),
    completedAt:allCompleted ? (dag.completedAt || nowIso(now)) : null
  };
}

export function readyDagNodes(dag = {}, now = Date.now()) {
  const nodes = dag.nodes || [];
  return nodes.filter(node => {
    if (!["WAITING","RETRY_WAIT"].includes(node.status)) return false;
    if (!dependenciesSatisfied(dag, node)) return false;
    if (node.notBefore && Date.parse(node.notBefore) > now) return false;

    if (node.delaySeconds > 0 && node.dependsOn?.length) {
      const dep = nodes.find(n => n.nodeId === node.dependsOn[0]);
      const depTs = dep?.completedAt ? Date.parse(dep.completedAt) : null;
      if (Number.isFinite(depTs) && depTs + node.delaySeconds * 1000 > now) return false;
    }
    return true;
  });
}

export function dagSummary(dag = {}) {
  const counts = {};
  for (const node of dag.nodes || []) {
    counts[node.status] = (counts[node.status] || 0) + 1;
  }
  return {
    dagId:dag.dagId,
    status:dag.status,
    createdAt:dag.createdAt,
    updatedAt:dag.updatedAt,
    counts,
    totalNodes:(dag.nodes || []).length
  };
}
