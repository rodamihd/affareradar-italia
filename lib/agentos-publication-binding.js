import { createHash } from "node:crypto";
// Deterministic digest of a complete JSON publication request.
// Reject non-JSON data and non-finite numbers; no selective field hashing.
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("not_plain_json");
  const keys=Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k)+":"+canonical(value[k])).join(",") + "}";
}
export function publicationRequestDigest(body) {
  if (!body || Array.isArray(body) || typeof body !== "object") throw new TypeError("invalid_publication_body");
  const serialized=canonical(body);
  if (Buffer.byteLength(serialized,"utf8")>256000) throw new RangeError("publication_too_large");
  return createHash("sha256").update("agentos:publication:v1\n"+serialized).digest("hex");
}
export function approvalMatchesPublication(record, digest) {
  return typeof digest==="string" && /^[a-f0-9]{64}$/.test(digest) &&
    record?.publicationDigest===digest;
}
