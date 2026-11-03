// Prioritize affordable deals without treating external price claims as verified.
// This helper only changes discovery order; publication verification remains mandatory.
export function parseEuroPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const match = String(value ?? "").match(/(?:€\s*)?(\d{1,6}(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const number = Number(match[1].replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function underTenPriority(deal) {
  const price = parseEuroPrice(deal?.effectivePrice ?? deal?.price);
  return price !== null && price < 10 ? (price <= 5 ? 2 : 1) : 0;
}
export function compareDealsUnderTen(a, b) {
  const priority = underTenPriority(b) - underTenPriority(a);
  return priority || Number(b?.dealScore || 0) - Number(a?.dealScore || 0);
}
