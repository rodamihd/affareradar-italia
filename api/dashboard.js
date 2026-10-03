import {
  normalizeAgentOsTask,
  validateAgentOsTask,
  evaluateTaskAuthority,
  taskPriorityScore,
  configuredAutonomyLevel,
  taskRegistry
} from "../lib/agentos-control-plane.js";
import { universalEntityId, agentOsEvent } from "../lib/agentos-adapter.js";
import { outcomeDimensions, learnedOutcomeProfile, mergeOutcomeStats } from "../lib/outcome-learning.js";
import { sourceReputationKeys, computeSourceReputation, initialSourceReputation } from "../lib/source-reputation.js";
import { evaluateOfferDeterministic } from "../lib/domain-evaluator.js";
import { optimizePortfolio } from "../lib/portfolio-optimizer.js";
import {
  offerDagTemplate,
  readyDagNodes,
  scheduleNodeRetry,
  refreshDagStatus,
  dagSummary
} from "../lib/agentos-dag.js";
import { startRuntimeObservation, runtimeSuccess, runtimeFailure } from "../lib/runtime-observability.js";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";
import { missionControlSnapshot, recordOutcomeRegistryEvent } from "../lib/decision-outcome-registry.js";

function authorized(req) {
  const secret = process.env.PUBLISH_SECRET;
  return Boolean(secret && req.headers["x-affareradar-secret"] === secret);
}

async function recordOutcomeEvent(input = {}) {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_outcomes" };

  const externalEventId = String(input.externalEventId || "").trim();
  if (externalEventId) {
    const idempotencyKey = `affareradar:outcome:idempotency:${Buffer.from(externalEventId).toString("base64url").slice(0, 120)}`;
    const lock = await redisCommand("SET", idempotencyKey, "1", "NX", "EX", 31536000);
    if (lock.result !== "OK") {
      return { ok:true, duplicate:true, externalEventId };
    }
  }

  const body = input.body && typeof input.body === "object" ? input.body : input;
  const occurredAt = input.occurredAt ? Date.parse(input.occurredAt) : Date.now();
  const increments = {
    impressions:Math.max(0, Number(input.impressions || 0)),
    clicks:Math.max(0, Number(input.clicks || 0)),
    conversions:Math.max(0, Number(input.conversions || 0)),
    engagements:Math.max(0, Number(input.engagements || 0)),
    revenueEUR:Math.max(0, Number(input.revenueEUR || 0))
  };
  const touched = [];
  for (const dimension of outcomeDimensions(body, Number.isFinite(occurredAt) ? occurredAt : Date.now())) {
    const key = `affareradar:outcome:${dimension}`;
    const rr = await redisCommand("GET", key);
    let stats = {
      impressions:0, clicks:0, conversions:0, engagements:0,
      publishes:0, successfulPublishes:0, revenueEUR:0
    };
    if (rr.result) {
      try { stats = { ...stats, ...JSON.parse(rr.result) }; } catch {}
    }
    for (const [name, value] of Object.entries(increments)) stats[name] = Number(stats[name] || 0) + value;
    stats.lastUpdatedAt = new Date().toISOString();
    await redisCommand("SET", key, JSON.stringify(stats), "EX", 7776000);
    touched.push(dimension);
  }
  const ledger = {
    eventId:externalEventId || `outcome_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    externalEventId:externalEventId || null,
    occurredAt:input.occurredAt || new Date().toISOString(),
    dealId:input.dealId || null,
    asin:body.asin || input.asin || null,
    category:body.category || null,
    source:body.source || null,
    dealType:body.dealType || null,
    reportSource:input.reportSource || null,
    ...increments
  };
  await redisCommand("LPUSH", "affareradar:outcome:ledger", JSON.stringify(ledger));
  await redisCommand("LTRIM", "affareradar:outcome:ledger", 0, 999);
  if (increments.conversions > 0) {
    await redisCommand("INCRBYFLOAT", "affareradar:metrics:tracked_conversion", String(increments.conversions));
  }
  if (increments.revenueEUR > 0) {
    await redisCommand("INCRBYFLOAT", "affareradar:metrics:tracked_revenue_eur", String(increments.revenueEUR));
  }
  await recordOutcomeRegistryEvent({ ...input, body, dealId:ledger.dealId, occurredAt:ledger.occurredAt });
  return { ok:true, touched, ledger };
}

async function recordOutcomeBatch(items = []) {
  if (!Array.isArray(items)) return { ok:false, error:"outcomes_array_required" };
  const rows = items.slice(0, 250);
  const results = [];
  let recorded = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of rows) {
    try {
      const result = await recordOutcomeEvent(item || {});
      if (result.duplicate) duplicates += 1;
      else if (result.ok) recorded += 1;
      else failed += 1;
      results.push({
        ok:result.ok === true,
        duplicate:result.duplicate === true,
        eventId:result.ledger?.eventId || result.externalEventId || null,
        error:result.error || null
      });
    } catch (error) {
      failed += 1;
      results.push({ ok:false, duplicate:false, eventId:null, error:String(error?.message || error) });
    }
  }

  return {
    ok:failed === 0,
    received:rows.length,
    recorded,
    duplicates,
    failed,
    results
  };
}

async function taskLearningContext(body = {}) {
  let outcomeProfile = learnedOutcomeProfile({}, body);
  let sourceReputation = initialSourceReputation(body);

  if (!redisConfig()) return { outcomeProfile, sourceReputation };

  try {
    const rows = [];
    for (const dimension of outcomeDimensions(body)) {
      const rr = await redisCommand("GET", `affareradar:outcome:${dimension}`);
      if (!rr.result) continue;
      try { rows.push(JSON.parse(rr.result)); } catch {}
    }
    outcomeProfile = learnedOutcomeProfile(mergeOutcomeStats(rows), body);
  } catch {}

  try {
    const rows = [];
    for (const dimension of sourceReputationKeys(body)) {
      const rr = await redisCommand("GET", `affareradar:source:stats:${dimension.suffix}`);
      if (!rr.result) continue;
      try { rows.push({ dimension:dimension.dimension, stats:JSON.parse(rr.result) }); } catch {}
    }
    if (rows.length) sourceReputation = computeSourceReputation(rows, body);
  } catch {}

  return { outcomeProfile, sourceReputation };
}

async function emitAgentOsEvent(event) {
  if (!redisConfig()) return;
  try {
    await redisCommand("LPUSH", "affareradar:agentos:events", JSON.stringify(event));
    await redisCommand("LTRIM", "affareradar:agentos:events", 0, 499);
  } catch {}
}

function effectiveSystemMode() {
  const forced = String(process.env.AFFARERADAR_SYSTEM_MODE || "").trim().toUpperCase();
  return ["NORMAL","DEGRADED","SAFE_MODE"].includes(forced) ? forced : "NORMAL";
}

async function queueAgentOsTask(input) {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_agentos_control" };

  const task = normalizeAgentOsTask(input || {});
  const validation = validateAgentOsTask(task);
  if (!validation.valid) {
    return { ok:false, error:"invalid_agentos_task", task, validation };
  }

  const idempotencyKey = `affareradar:agentos:idempotency:${task.idempotencyKey}`;
  const lock = await redisCommand("SET", idempotencyKey, task.taskId, "NX", "EX", 86400);
  if (lock.result !== "OK") {
    return { ok:true, accepted:false, duplicate:true, taskId:task.taskId };
  }

  const authority = evaluateTaskAuthority(task, {
    autonomyLevel:configuredAutonomyLevel(),
    systemMode:effectiveSystemMode(),
    hardPolicyBlocked:false
  });

  const taskKey = `affareradar:agentos:task:${task.taskId}`;
  const record = {
    ...task,
    authority,
    status:authority.action === "EXECUTE" ? "QUEUED" :
      authority.action === "WAIT_APPROVAL" ? "WAIT_APPROVAL" : "REJECTED",
    updatedAt:new Date().toISOString()
  };
  await redisCommand("SET", taskKey, JSON.stringify(record), "EX", 604800);

  if (authority.action === "EXECUTE") {
    await redisCommand("ZADD", "affareradar:agentos:tasks", String(taskPriorityScore(task)), task.taskId);
  } else if (authority.action === "WAIT_APPROVAL") {
    await redisCommand("ZADD", "affareradar:agentos:approvals", String(Date.now()), task.taskId);
  }

  await emitAgentOsEvent(agentOsEvent("AFFARERADAR_AGENTOS_TASK_ACCEPTED", task.payload?.offer || task.input || {}, {
    lifecycle:record.status,
    knowledgeStatus:"ACTIVE",
    approvalRequired:record.status === "WAIT_APPROVAL",
    payload:{
      taskId:task.taskId,
      taskType:task.taskType,
      priority:task.priority,
      authority,
      status:record.status
    }
  }));

  return {
    ok:true,
    accepted:authority.action !== "REJECT",
    taskId:task.taskId,
    status:record.status,
    authority
  };
}

async function executeAgentOsTask(req, record) {
  const task = record;
  const body = task.payload?.offer || {};
  const entityId = task.entityId || universalEntityId(body.asin || body.amazonUrl ? body : task.input || {});
  const controlKey = `affareradar:agentos:entity:${entityId}:control`;

  if (task.taskType === "HOLD_OFFER") {
    await redisCommand("SET", controlKey, JSON.stringify({ state:"HOLD", taskId:task.taskId, at:new Date().toISOString() }), "EX", 2592000);
    return { ok:true, action:"HOLD_APPLIED", entityId };
  }

  if (task.taskType === "RELEASE_OFFER") {
    await redisCommand("DEL", controlKey);
    return { ok:true, action:"HOLD_RELEASED", entityId };
  }

  if (task.taskType === "ARCHIVE_OFFER") {
    await redisCommand("SET", controlKey, JSON.stringify({ state:"ARCHIVED", taskId:task.taskId, at:new Date().toISOString() }), "EX", 7776000);
    return { ok:true, action:"ARCHIVED", entityId };
  }

  if (["VERIFY_OFFER","RECHECK_OFFER"].includes(task.taskType)) {
    const target = task.payload?.offer || { ...task.input };
    const dealId = target.asin || entityId;
    const plan = {
      asin:target.asin || null,
      currentState:"SIGNAL_ONLY",
      attempts:["creators_api","pa_api","amazon_link_tool_manual"],
      requestedBy:"AgentOS",
      taskId:task.taskId
    };
    await redisCommand("SET", `affareradar:verification:item:${dealId}`, JSON.stringify({
      body:target,
      dealId,
      plan,
      queuedAt:new Date().toISOString(),
      agentOsTaskId:task.taskId
    }), "EX", 86400);
    await redisCommand("ZADD", "affareradar:verification:queue", String(Date.now()), dealId);
    return { ok:true, action:"VERIFICATION_QUEUED", dealId, asynchronous:true };
  }

  if (task.taskType === "PUBLISH_OFFER") {
    const host = req.headers.host;
    if (!host) return { ok:false, error:"host_missing" };
    const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const secret = process.env.PUBLISH_SECRET;
    const response = await fetch(`${protocol}://${host}/api/auto-publish`, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":secret
      },
      body:JSON.stringify({ ...body, agentOsTaskId:task.taskId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      return { ok:false, action:"PUBLISH_PIPELINE_FAILED", error:data.error || `http_${response.status}`, result:data };
    }
    if (data.published === true) {
      return { ok:true, action:"PUBLISHED", result:data };
    }
    if (["verify","queued"].includes(String(data.decision || "").toLowerCase())) {
      return { ok:true, asynchronous:true, action:"PUBLISH_WAITING", result:data };
    }
    return {
      ok:false,
      action:"PUBLISH_NOT_COMPLETED",
      error:`publish_not_completed:${String(data.decision || "unknown")}`,
      result:data
    };
  }

  if (task.taskType === "RUN_DISCOVERY") {
    await redisCommand("SET", "affareradar:agentos:discovery_requested_at", new Date().toISOString(), "EX", 86400);
    return { ok:true, action:"DISCOVERY_REQUESTED_FOR_NEXT_CYCLE" };
  }

  if (task.taskType === "EVALUATE_OFFER") {
    const learning = await taskLearningContext(body);
    const evaluation = evaluateOfferDeterministic(body, learning);
    const record = {
      entityId,
      taskId:task.taskId,
      evaluatedAt:new Date().toISOString(),
      offer:body,
      evaluation
    };
    await redisCommand("SET", `affareradar:agentos:evaluate:${entityId}`, JSON.stringify(record), "EX", 86400);
    await redisCommand("ZADD", "affareradar:agentos:evaluated", String(Date.now()), entityId);
    return {
      ok:true,
      action:"EVALUATED",
      entityId,
      decision:evaluation.action,
      opportunity:evaluation.opportunity,
      revenue:evaluation.revenue,
      policyDecision:evaluation.policy.decision,
      egress:evaluation.egress
    };
  }

  if (task.taskType === "OPTIMIZE_PORTFOLIO") {
    const rr = await redisCommand("ZREVRANGE", "affareradar:agentos:evaluated", 0, 19);
    const ids = Array.isArray(rr.result) ? rr.result : [];
    const candidates = [];
    for (const id of ids) {
      const er = await redisCommand("GET", `affareradar:agentos:evaluate:${id}`);
      if (!er.result) continue;
      try {
        const row = JSON.parse(er.result);
        if (!row?.offer || !row?.evaluation) continue;
        if (!["PUBLISH","OBSERVE"].includes(String(row.evaluation.action || ""))) continue;
        candidates.push({
          ...row.offer,
          entityId:row.entityId,
          opportunity:row.evaluation.opportunity,
          revenue:row.evaluation.revenue
        });
      } catch {}
    }
    const currentEvaluationResult = await redisCommand("GET", `affareradar:agentos:evaluate:${entityId}`);
    if (currentEvaluationResult.result && !candidates.some(x => x.entityId === entityId)) {
      try {
        const row = JSON.parse(currentEvaluationResult.result);
        candidates.push({
          ...body,
          entityId,
          opportunity:row.evaluation?.opportunity,
          revenue:row.evaluation?.revenue
        });
      } catch {}
    }
    const optimized = optimizePortfolio(candidates, {
      maxItems:Number(process.env.AGENTOS_PORTFOLIO_WINDOW_MAX || 5),
      maxPerCategory:Number(process.env.AGENTOS_PORTFOLIO_MAX_PER_CATEGORY || 2),
      maxRewards:Number(process.env.AGENTOS_PORTFOLIO_MAX_REWARDS || 1)
    });
    const selected = optimized.selected.some(x => x.entityId === entityId);
    const record = {
      entityId,
      taskId:task.taskId,
      optimizedAt:new Date().toISOString(),
      selected,
      diagnostics:optimized.diagnostics,
      selectedEntities:optimized.selected.map(x => x.entityId).filter(Boolean)
    };
    await redisCommand("SET", `affareradar:agentos:portfolio:${entityId}`, JSON.stringify(record), "EX", 86400);
    return { ok:true, action:selected ? "PORTFOLIO_SELECTED" : "PORTFOLIO_SKIPPED", entityId, selected, diagnostics:optimized.diagnostics };
  }

  if (task.taskType === "LEARN_OUTCOME") {
    const learning = await taskLearningContext(body);
    const snapshot = {
      learnedAt:new Date().toISOString(),
      taskId:task.taskId,
      entityId,
      outcomeProfile:learning.outcomeProfile,
      sourceReputation:learning.sourceReputation
    };
    await redisCommand("SET", `affareradar:agentos:learn:${entityId}`, JSON.stringify(snapshot), "EX", 604800);
    return { ok:true, action:"OUTCOME_LEARNED", entityId, outcomeProfile:learning.outcomeProfile, sourceReputation:learning.sourceReputation };
  }

  if (task.taskType === "CAPTURE_SIGNAL") {
    return { ok:true, action:"CAPTURE_ALREADY_COMPLETED", entityId };
  }

  return { ok:false, error:"unsupported_task_execution" };
}

async function resolveAgentOsApproval(taskId, decision = "APPROVED") {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_agentos_control" };
  const tr = await redisCommand("GET", `affareradar:agentos:task:${taskId}`);
  if (!tr.result) return { ok:false, error:"agentos_task_not_found" };

  let record;
  try { record = JSON.parse(tr.result); } catch { record = null; }
  if (!record) return { ok:false, error:"agentos_task_invalid" };

  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!["APPROVED","REJECTED"].includes(normalizedDecision)) {
    return { ok:false, error:"invalid_approval_decision" };
  }

  await redisCommand("ZREM", "affareradar:agentos:approvals", taskId);

  if (normalizedDecision === "REJECTED") {
    const updated = {
      ...record,
      approvalStatus:"REJECTED",
      status:"REJECTED",
      updatedAt:new Date().toISOString()
    };
    await redisCommand("SET", `affareradar:agentos:task:${taskId}`, JSON.stringify(updated), "EX", 604800);
    await emitAgentOsEvent(agentOsEvent("AFFARERADAR_AGENTOS_TASK_REJECTED", record.payload?.offer || record.input || {}, {
      lifecycle:"REJECTED",
      knowledgeStatus:"ACTIVE",
      payload:{ taskId, taskType:record.taskType }
    }));
    return { ok:true, taskId, status:"REJECTED" };
  }

  const approvedTask = { ...record, approvalStatus:"APPROVED" };
  const authority = evaluateTaskAuthority(approvedTask, {
    autonomyLevel:configuredAutonomyLevel(),
    systemMode:effectiveSystemMode(),
    hardPolicyBlocked:false
  });

  if (authority.action !== "EXECUTE") {
    const updated = {
      ...approvedTask,
      authority,
      status:"REJECTED",
      updatedAt:new Date().toISOString()
    };
    await redisCommand("SET", `affareradar:agentos:task:${taskId}`, JSON.stringify(updated), "EX", 604800);
    return { ok:false, error:"approval_cannot_override_hard_guard", taskId, authority };
  }

  const updated = {
    ...approvedTask,
    authority,
    status:"QUEUED",
    updatedAt:new Date().toISOString()
  };
  await redisCommand("SET", `affareradar:agentos:task:${taskId}`, JSON.stringify(updated), "EX", 604800);
  await redisCommand("ZADD", "affareradar:agentos:tasks", String(taskPriorityScore(updated)), taskId);
  await emitAgentOsEvent(agentOsEvent("AFFARERADAR_AGENTOS_TASK_APPROVED", record.payload?.offer || record.input || {}, {
    lifecycle:"QUEUED",
    knowledgeStatus:"ACTIVE",
    payload:{ taskId, taskType:record.taskType, authority }
  }));

  return { ok:true, taskId, status:"QUEUED", authority };
}

async function saveDag(dag) {
  await redisCommand("SET", `affareradar:agentos:dag:${dag.dagId}`, JSON.stringify(dag), "EX", 604800);
  await redisCommand("ZADD", "affareradar:agentos:dags", String(Date.parse(dag.updatedAt || new Date().toISOString()) || Date.now()), dag.dagId);
}

async function loadDag(dagId) {
  const rr = await redisCommand("GET", `affareradar:agentos:dag:${dagId}`);
  if (!rr.result) return null;
  try { return JSON.parse(rr.result); } catch { return null; }
}

async function createAgentOsDag(input = {}) {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_agentos_dag" };
  const offer = input.offer || input.payload?.offer || {};
  if (!offer.asin && !offer.amazonUrl && !offer.title) {
    return { ok:false, error:"offer_required_for_dag" };
  }
  const dag = offerDagTemplate(offer, {
    recheckDelaySeconds:input.recheckDelaySeconds,
    requirePublishApproval:input.requirePublishApproval
  });
  await saveDag(dag);
  await emitAgentOsEvent(agentOsEvent("AFFARERADAR_DAG_CREATED", offer, {
    lifecycle:"RUNNING",
    knowledgeStatus:"ACTIVE",
    payload:{ dagId:dag.dagId, summary:dagSummary(dag) }
  }));
  return { ok:true, dag };
}

async function reconcileDagNode(dag, node, now = Date.now()) {
  if (!node.taskId) return node;
  const rr = await redisCommand("GET", `affareradar:agentos:task:${node.taskId}`);
  if (!rr.result) return node;

  let task;
  try { task = JSON.parse(rr.result); } catch { return node; }

  const next = { ...node };
  const startedAt = Date.parse(next.startedAt || task.updatedAt || task.createdAt || "");
  const ageSeconds = Number.isFinite(startedAt) ? Math.max(0, (now - startedAt) / 1000) : 0;
  const executionTimedOut = ["QUEUED","RUNNING"].includes(task.status) && ageSeconds > Number(next.timeoutSeconds || 30);
  const externalTimedOut = task.status === "WAITING_EXTERNAL" && ageSeconds > Number(next.externalTimeoutSeconds || 900);

  if (executionTimedOut || externalTimedOut) {
    return scheduleNodeRetry(
      { ...next, taskId:null },
      now,
      executionTimedOut ? "task_timeout" : "external_wait_timeout"
    );
  }

  if (task.status === "COMPLETED") {
    next.status = "COMPLETED";
    next.result = task.result || null;
    next.completedAt = task.completedAt || new Date(now).toISOString();
    next.lastError = null;
    return next;
  }

  if (task.status === "WAIT_APPROVAL") {
    next.status = "WAIT_APPROVAL";
    return next;
  }

  if (task.status === "REJECTED") {
    next.status = "REJECTED";
    next.lastError = "task_rejected";
    next.completedAt = task.updatedAt || new Date(now).toISOString();
    return next;
  }

  if (task.status === "FAILED") {
    return scheduleNodeRetry(
      { ...next, attempts:Math.max(Number(next.attempts || 0), 1), taskId:null },
      now,
      task.result?.error || "task_failed"
    );
  }

  if (task.status === "QUEUED" || task.status === "WAITING_EXTERNAL") {
    next.status = "RUNNING";
  }
  return next;
}

async function processAgentOsDag(req, dagId) {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_agentos_dag" };
  let dag = await loadDag(dagId);
  if (!dag) return { ok:false, error:"dag_not_found" };

  const now = Date.now();
  const reconciled = [];
  for (const node of dag.nodes || []) {
    reconciled.push(await reconcileDagNode(dag, node, now));
  }
  dag = { ...dag, nodes:reconciled };

  const portfolioNode = (dag.nodes || []).find(n => n.name === "portfolio");
  if (portfolioNode?.status === "COMPLETED" && portfolioNode?.result?.selected === false) {
    for (const name of ["publish","recheck","learn"]) {
      const node = dag.nodes.find(n => n.name === name);
      if (!node || ["COMPLETED","SKIPPED"].includes(node.status)) continue;
      node.status = "SKIPPED";
      node.completedAt = new Date(now).toISOString();
      node.result = { skipped:true, reason:"portfolio_not_selected" };
      node.lastError = null;
      node.taskId = null;
    }
  }

  if (dag.status === "FAILED" || dag.status === "COMPLETED") {
    dag = refreshDagStatus(dag, now);
    await saveDag(dag);
    return { ok:true, dag, summary:dagSummary(dag) };
  }

  const ready = readyDagNodes(dag, now);
  const submitted = [];

  for (const node of ready.slice(0, 4)) {
    const approvalRequired =
      node.taskType === "PUBLISH_OFFER" &&
      dag.options?.requirePublishApproval !== false;

    const queued = await queueAgentOsTask({
      taskType:node.taskType,
      priority:node.taskType === "PUBLISH_OFFER" ? "high" : "normal",
      approvalRequired,
      idempotencyKey:`${dag.dagId}:${node.nodeId}:${Number(node.attempts || 0) + 1}`,
      payload:{ offer:dag.offer, dagId:dag.dagId, nodeId:node.nodeId },
      context:{ dagId:dag.dagId, nodeId:node.nodeId }
    });

    const updatedNode = dag.nodes.find(n => n.nodeId === node.nodeId);
    if (!updatedNode) continue;

    updatedNode.attempts = Number(updatedNode.attempts || 0) + 1;
    updatedNode.taskId = queued.taskId || null;
    updatedNode.startedAt = updatedNode.startedAt || new Date(now).toISOString();

    if (!queued.ok || queued.accepted === false) {
      const retried = scheduleNodeRetry(updatedNode, now, queued.error || "task_not_accepted");
      Object.assign(updatedNode, retried);
    } else if (queued.status === "WAIT_APPROVAL") {
      updatedNode.status = "WAIT_APPROVAL";
    } else {
      updatedNode.status = "RUNNING";
    }

    submitted.push({ nodeId:node.nodeId, taskType:node.taskType, queued });
  }

  dag = refreshDagStatus(dag, now);
  dag.recovery = {
    ...(dag.recovery || {}),
    retries:(dag.nodes || []).reduce((sum, n) => sum + Math.max(0, Number(n.attempts || 0) - 1), 0),
    lastRecoveredAt:new Date(now).toISOString()
  };
  await saveDag(dag);

  await emitAgentOsEvent(agentOsEvent("AFFARERADAR_DAG_TICK", dag.offer || {}, {
    lifecycle:dag.status,
    knowledgeStatus:"ACTIVE",
    payload:{ dagId:dag.dagId, summary:dagSummary(dag), submitted }
  }));

  return { ok:true, dag, summary:dagSummary(dag), submitted };
}

async function recoverAgentOsDags(req, limit = 5) {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_agentos_dag" };
  const rr = await redisCommand("ZREVRANGE", "affareradar:agentos:dags", 0, Math.max(0, Math.min(19, Number(limit || 5) - 1)));
  const ids = Array.isArray(rr.result) ? rr.result : [];
  const results = [];
  for (const dagId of ids) {
    const dag = await loadDag(dagId);
    if (!dag || ["COMPLETED","FAILED"].includes(dag.status)) continue;
    results.push(await processAgentOsDag(req, dagId));
  }
  return { ok:true, processed:results.length, results };
}

async function processAgentOsTasks(req, limit = 5) {
  if (!redisConfig()) return { ok:false, error:"redis_required_for_agentos_control" };
  const rr = await redisCommand("ZRANGE", "affareradar:agentos:tasks", 0, Math.max(0, Math.min(19, Number(limit || 5) - 1)));
  const ids = Array.isArray(rr.result) ? rr.result : [];
  const results = [];

  for (const taskId of ids) {
    const tr = await redisCommand("GET", `affareradar:agentos:task:${taskId}`);
    if (!tr.result) {
      await redisCommand("ZREM", "affareradar:agentos:tasks", taskId);
      continue;
    }

    let record;
    try { record = JSON.parse(tr.result); } catch { record = null; }
    if (!record) {
      await redisCommand("ZREM", "affareradar:agentos:tasks", taskId);
      continue;
    }

    let result;
    try {
      result = await executeAgentOsTask(req, record);
    } catch (error) {
      result = { ok:false, error:String(error?.message || error) };
    }

    const status = result.ok
      ? (result.asynchronous === true ? "WAITING_EXTERNAL" : "COMPLETED")
      : "FAILED";
    const updated = {
      ...record,
      status,
      result,
      completedAt:status === "COMPLETED" ? new Date().toISOString() : null,
      updatedAt:new Date().toISOString()
    };
    await redisCommand("SET", `affareradar:agentos:task:${taskId}`, JSON.stringify(updated), "EX", 604800);
    await redisCommand("ZREM", "affareradar:agentos:tasks", taskId);
    await redisCommand("INCR", `affareradar:metrics:agentos_task_${status.toLowerCase()}`);

    const eventType =
      status === "COMPLETED" ? "AFFARERADAR_AGENTOS_TASK_COMPLETED" :
      status === "WAITING_EXTERNAL" ? "AFFARERADAR_AGENTOS_TASK_WAITING_EXTERNAL" :
      "AFFARERADAR_AGENTOS_TASK_FAILED";
    await emitAgentOsEvent(agentOsEvent(
      eventType,
      record.payload?.offer || record.input || {},
      {
        lifecycle:status,
        knowledgeStatus:"ACTIVE",
        payload:{ taskId, taskType:record.taskType, result }
      }
    ));

    results.push({ taskId, taskType:record.taskType, status, result });
  }

  return { ok:true, processed:results.length, results };
}

export default async function handler(req, res) {
  const __obs = startRuntimeObservation(req, "/api/dashboard");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const cfg = redisConfig();

  if (req.method === "POST") {
    const action = String(req.body?.action || "submit_task").trim().toLowerCase();

    if (action === "record_outcome") {
      const recorded = await recordOutcomeEvent(req.body?.outcome || req.body || {});
      return res.status(recorded.ok ? 200 : 503).json(recorded);
    }

    if (action === "record_outcomes_batch") {
      const recorded = await recordOutcomeBatch(req.body?.outcomes || []);
      return res.status(recorded.ok ? 200 : 207).json(recorded);
    }

    if (action === "process_tasks") {
      const processed = await processAgentOsTasks(req, req.body?.limit || 5);
      return res.status(processed.ok ? 200 : 503).json(processed);
    }

    if (action === "create_dag") {
      const created = await createAgentOsDag(req.body || {});
      return res.status(created.ok ? 200 : 400).json(created);
    }

    if (action === "process_dag") {
      const dagId = String(req.body?.dagId || "").trim();
      if (!dagId) return res.status(400).json({ ok:false, error:"dag_id_required" });
      const processed = await processAgentOsDag(req, dagId);
      return res.status(processed.ok ? 200 : 400).json(processed);
    }

    if (action === "recover_dags") {
      const recovered = await recoverAgentOsDags(req, req.body?.limit || 5);
      return res.status(recovered.ok ? 200 : 503).json(recovered);
    }

    if (action === "approve_task" || action === "reject_task") {
      const taskId = String(req.body?.taskId || "").trim();
      if (!taskId) return res.status(400).json({ ok:false, error:"task_id_required" });
      const resolved = await resolveAgentOsApproval(taskId, action === "approve_task" ? "APPROVED" : "REJECTED");
      return res.status(resolved.ok ? 200 : 400).json(resolved);
    }

    const queued = await queueAgentOsTask(req.body?.task || req.body || {});
    return res.status(queued.ok ? 200 : 400).json(queued);
  }

  let storefrontCandidates = [];

  let telegramHealth = null;
  try {
    const host = req.headers.host;
    if (host) {
      const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const healthRes = await fetch(`${protocol}://${host}/api/health`);
      telegramHealth = await healthRes.json().catch(() => null);
    }
  } catch {}

  if (!cfg) {
    const storefrontIdsResult = await redisCommand("ZREVRANGE", "affareradar:storefront:candidates", 0, 7, "WITHSCORES");
    const storefrontPairs = Array.isArray(storefrontIdsResult.result) ? storefrontIdsResult.result : [];
    storefrontCandidates = [];
    for (let i = 0; i < storefrontPairs.length; i += 2) {
      const dealId = storefrontPairs[i];
      const score = Number(storefrontPairs[i + 1] || 0);
      const rr = await redisCommand("GET", `affareradar:storefront:candidate:${dealId}`);
      if (!rr.result) continue;
      try {
        const item = JSON.parse(rr.result);
        storefrontCandidates.push({ ...item, score });
      } catch {}
    }

    return res.status(200).json({
      ok:true,
      redisConfigured:false,
      metrics:{},
      queueCount:null,
      events:[],
      telegramHealth
    });
  }

  try {
    const metricNames = [
      "published",
      "queued",
      "revalidation_failed",
      "duplicate_blocked",
      "rejected_below_threshold",
      "publish_failed",
      "attribution_click",
      "tracked_amazon_click",
      "tracked_engagement",
      "tracked_conversion",
      "tracked_revenue_eur",
      "rejected_creator_quality",
      "republish_blocked",
      "reward_validation_failed",
      "traffic_source_blocked",
      "repetition_blocked",
      "originality_blocked",
      "promotion_expired_blocked",
      "product_excluded_blocked",
      "policy_blocked",
      "verification_required",
      "opportunity_not_publishable",
      "safe_mode_blocked",
      "verification_resolved",
      "agentos_control_blocked",
      "agentos_task_completed",
      "agentos_task_failed",
      "agentos_task_waiting_external",
      "agentos_egress_blocked"
    ];

    const metricResults = await Promise.all(
      metricNames.map(name => redisCommand("GET", `affareradar:metrics:${name}`))
    );

    const metrics = {};
    metricNames.forEach((name, i) => {
      metrics[name] = Number(metricResults[i].result || 0);
    });

    const providerHealthSnapshot = {
      creators:null,
      paApi:null
    };

    try {
      const [creatorsHealthResult, paHealthResult] = await Promise.all([
        redisCommand("GET", "affareradar:provider-health:creators_api"),
        redisCommand("GET", "affareradar:provider-health:pa_api")
      ]);
      if (creatorsHealthResult.result) {
        try { providerHealthSnapshot.creators = JSON.parse(creatorsHealthResult.result); } catch {}
      }
      if (paHealthResult.result) {
        try { providerHealthSnapshot.paApi = JSON.parse(paHealthResult.result); } catch {}
      }
    } catch {}

    const [
      queueCountResult,
      eventsResult,
      queueIdsResult,
      lastDiscoveryAtResult,
      lastDiscoveryCountResult,
      multisourceLastRunResult,
      multisourceCandidateCountResult,
      multisourceSourceCountResult,
      verificationQueueCountResult,
      agentOsEventsResult,
      agentOsTaskCountResult,
      agentOsApprovalCountResult,
      agentOsDagCountResult
    ] = await Promise.all([
      redisCommand("ZCARD", "affareradar:queue"),
      redisCommand("LRANGE", "affareradar:events", 0, 49),
      redisCommand("ZRANGE", "affareradar:queue", 0, 19, "WITHSCORES"),
      redisCommand("GET", "affareradar:amazon:last_discovery_at"),
      redisCommand("GET", "affareradar:amazon:last_discovery_count"),
      redisCommand("GET", "affareradar:multisource:last_run_at"),
      redisCommand("GET", "affareradar:multisource:last_candidate_count"),
      redisCommand("GET", "affareradar:multisource:last_source_count"),
      redisCommand("ZCARD", "affareradar:verification:queue"),
      redisCommand("LRANGE", "affareradar:agentos:events", 0, 29),
      redisCommand("ZCARD", "affareradar:agentos:tasks"),
      redisCommand("ZCARD", "affareradar:agentos:approvals"),
      redisCommand("ZCARD", "affareradar:agentos:dags")
    ]);

    const events = Array.isArray(eventsResult.result)
      ? eventsResult.result.map(item => {
          try { return JSON.parse(item); } catch { return { event:"unknown", raw:item }; }
        })
      : [];

    const agentOsEvents = Array.isArray(agentOsEventsResult.result)
      ? agentOsEventsResult.result.map(item => {
          try { return JSON.parse(item); } catch { return { eventType:"UNKNOWN", raw:item }; }
        })
      : [];

    const queuePairs = Array.isArray(queueIdsResult.result) ? queueIdsResult.result : [];
    const queue = [];
    for (let i = 0; i < queuePairs.length; i += 2) {
      const dealId = queuePairs[i];
      const score = Number(queuePairs[i + 1] || 0);
      const itemResult = await redisCommand("GET", `affareradar:queue:item:${dealId}`);
      let item = null;
      try { item = itemResult.result ? JSON.parse(itemResult.result) : null; } catch {}
      queue.push({
        dealId,
        scheduledFor:score ? new Date(score).toISOString() : null,
        reason:item?.reason || null,
        attempts:Number(item?.attempts || 0),
        body:item?.body || null
      });
    }

    const lifecycle = [];
    const seen = new Set();
    for (const e of events) {
      if (!e.dealId || seen.has(e.dealId)) continue;
      seen.add(e.dealId);
      const lr = await redisCommand("GET", `affareradar:lifecycle:${e.dealId}`);
      if (lr.result) {
        try { lifecycle.push(JSON.parse(lr.result)); } catch {}
      }
      if (lifecycle.length >= 20) break;
    }

    const attributionContentTypes = ["deal","top_deal","price_error","coupon_stack","historical_low","reward"];
    const attributionActions = ["amazon_click","telegram_share","whatsapp_share","channel_invite"];
    const attribution = {};

    for (const contentType of attributionContentTypes) {
      attribution[contentType] = {};
      for (const action of attributionActions) {
        const rr = await redisCommand("GET", `affareradar:attribution:telegram:${contentType}:${action}`);
        attribution[contentType][action] = Number(rr.result || 0);
      }
    }

    try {
      const storefrontIdsResult = await redisCommand("ZREVRANGE", "affareradar:storefront:candidates", 0, 7, "WITHSCORES");
      const storefrontPairs = Array.isArray(storefrontIdsResult.result) ? storefrontIdsResult.result : [];
      storefrontCandidates = [];
      for (let i = 0; i < storefrontPairs.length; i += 2) {
        const dealId = storefrontPairs[i];
        const score = Number(storefrontPairs[i + 1] || 0);
        const rr = await redisCommand("GET", `affareradar:storefront:candidate:${dealId}`);
        if (!rr.result) continue;
        try {
          const item = JSON.parse(rr.result);
          storefrontCandidates.push({ ...item, score });
        } catch {}
      }
    } catch {}

    const modules = {
      telegram:Boolean(telegramHealth?.targetReachable && telegramHealth?.botCanPost),
      redis:true,
      queueProcessor:true,
      revalidation:true,
      deduplication:true,
      antiSpam:true,
      lifecycle:true,
      amazonDiscovery:Boolean(process.env.AMAZON_CREATORS_CREDENTIAL_ID && process.env.AMAZON_CREATORS_CREDENTIAL_SECRET && process.env.AMAZON_PARTNER_TAG),
      multiSourceDiscovery:true,
      affiliateTracking:Boolean(process.env.AMAZON_PARTNER_TAG),
      deepLinkEngine:false,
      directAmazonAffiliateLinks:true,
      amazonComplianceGate:true,
      amazonAgentIdentification:true,
      publicPriceTracking:false,
      channelStrategy:true,
      contentRepurposing:true,
      storefrontIntelligence:true,
      creatorQualityScore:true,
      affiliateLinkValidator:true,
      timeSlotOptimizer:true,
      republishIntelligence:true,
      amazonRewardsEngine:true,
      externalPriceSignals:"internal_only",
      contentRepetitionGuard:true,
      originalityTransformationGuard:true,
      imageProvenanceGate:true,
      productExclusionGuard:true,
      promotionExpiryKillSwitch:true,
      amazonDataIsolation:true,
      amazonVerificationBroker:true,
      opportunityEngineV2:true,
      policyAsCodeEngine:true,
      sourceReputationEngine:true,
      sourceReputationV2:true,
      sourceReputationTemporalDecay:true,
      multiProviderVerification:true,
      providerCircuitBreakers:true,
      outcomeLearningEngine:true,
      expectedRevenueEngine:true,
      verificationOrchestrator:true,
      safeModeController:true,
      agentOsDomainAdapter:true,
      agentOsControlPlane:true,
      agentOsTaskAuthority:true,
      agentOsPriorityQueue:true,
      agentOsDagOrchestrator:true,
      agentOsDagRecovery:true,
      agentOsAsyncTaskSemantics:true,
      agentOsTimeoutEnforcement:true,
      agentOsDeterministicEvaluation:true,
      agentOsPortfolioExecution:true,
      agentOsOutcomeLearningExecution:true,
      verificationWorkerWakeup:true,
      agentOsSelfTest:true,
      sharedRedisAdapter:true,
      agentOs33_10Profile:true,
      missionControl:true,
      decisionOutcomeRegistry:true,
      automaticOutcomeRegistry:true,
      dealPerformanceScore:true,
      championChallengerShadow:true,
      continuousEdgeValidation:true,
      profitLearningShadow:true,
      autonomyPromotionGate:true,
      agentOsMixedMode:true,
      agentOsFreshnessSla:true,
      agentOsEgressGuard:true,
      agentOsMemoryProposalValidation:true,
      agentOsReleaseManifest:true,
      agentOsSemanticDecisionCachePolicy:true,
      runtimeObservability:true,
      outcomeLedger:true,
      outcomeBatchIngestion:true,
      outcomeIdempotency:true,
      revenueCalibration:true,
      offerLifecycleManager:true,
      portfolioOptimizer:true,
      verificationQueueWorker:true,
      complianceEvidenceVault:true,
      authorizedTrafficSources:Boolean(process.env.AMAZON_ASSOCIATES_APPROVED_CHANNELS)
    };

    const missionControl = await missionControlSnapshot();

    runtimeSuccess(__obs, { redisConfigured:true, queueCount:Number(queueCountResult.result || 0), verificationQueueCount:Number(verificationQueueCountResult.result || 0) });
    return res.status(200).json({
      ok:true,
      redisConfigured:true,
      metrics,
      queueCount:Number(queueCountResult.result || 0),
      queue,
      lifecycle,
      modules,
      amazonVerificationProviders:{
        creators:Boolean(process.env.AMAZON_CREATORS_CREDENTIAL_ID && process.env.AMAZON_CREATORS_CREDENTIAL_SECRET && process.env.AMAZON_PARTNER_TAG),
        paApi:Boolean(process.env.AMAZON_PAAPI_ACCESS_KEY && process.env.AMAZON_PAAPI_SECRET_KEY && process.env.AMAZON_PARTNER_TAG),
        health:providerHealthSnapshot
      },
      amazonDiscovery:{
        configured:modules.amazonDiscovery,
        lastRunAt:lastDiscoveryAtResult.result || null,
        lastCandidateCount:lastDiscoveryCountResult.result ? Number(lastDiscoveryCountResult.result) : null
      },
      multiSourceDiscovery:{
        configured:true,
        lastRunAt:multisourceLastRunResult.result || null,
        lastCandidateCount:multisourceCandidateCountResult.result ? Number(multisourceCandidateCountResult.result) : null,
        lastSourceCount:multisourceSourceCountResult.result ? Number(multisourceSourceCountResult.result) : null
      },
      verificationQueueCount:Number(verificationQueueCountResult.result || 0),
      agentOsControl:{
        agentOsVersion:"33.10",
        autonomyLevel:configuredAutonomyLevel(),
        supportedTasks:taskRegistry(),
        queuedTasks:Number(agentOsTaskCountResult.result || 0),
        pendingApprovals:Number(agentOsApprovalCountResult.result || 0),
        dags:Number(agentOsDagCountResult.result || 0),
        dagFlow:["CAPTURE","VERIFY","EVALUATE","PORTFOLIO","PUBLISH","RECHECK","LEARN"]
      },
      systemMode:String(process.env.AFFARERADAR_SYSTEM_MODE || "AUTO").toUpperCase(),
      agentOsEvents,
      missionControl,
      storefrontCandidates:typeof storefrontCandidates !== "undefined" ? storefrontCandidates : [],
      events,
      telegramHealth
    });
  } catch (error) {
    runtimeFailure(__obs, error);
    return res.status(502).json({
      ok:false,
      error:"dashboard_read_failed",
      detail:String(error?.message || error)
    });
  }
}
