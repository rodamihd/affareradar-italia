import assert from "node:assert/strict";
import { canonicalRejectionReason, isKnownRejectionReason } from "./rejection-reason-taxonomy.js";

assert.equal(canonicalRejectionReason("system_safe_mode"), "SAFE_MODE_BLOCKED");
assert.equal(canonicalRejectionReason("agentos_33_10_egress_guard"), "AGENTOS_EGRESS_BLOCKED");
assert.equal(canonicalRejectionReason("duplicate"), "DUPLICATE_COOLDOWN");
assert.equal(canonicalRejectionReason("minimum gap"), "MINIMUM_GAP");
assert.equal(isKnownRejectionReason("price_not_verified"), true);
assert.equal(isKnownRejectionReason("made_up_reason"), false);

console.log("rejection-reason-taxonomy selftest passed");
