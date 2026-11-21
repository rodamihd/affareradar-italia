// Discovery-only ranking: external prices remain UNVERIFIED until publication gate.
// Parse one price FIELD only, not arbitrary product copy containing multiple figures.
export function parseEuroPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/\u00a0/g, ' ');
  if (!text || (text.startsWith('€') && text.endsWith('€'))) return null;
  text = text.replace(/^€\s*/, '').replace(/\s*€$/, '').trim();
  let normalized;
  // Italian and space-grouped thousands, optionally followed by comma cents.
  if (/^\d{1,3}(?:[. ]\d{3})+(?:,\d{1,2})?$/.test(text)) {
    normalized = text.replace(/[. ]/g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text)) {
    // Standard machine-formatted thousands are accepted as well.
    normalized = text.replace(/,/g, '');
  } else if (/^\d+(?:[.,]\d{1,2})?$/.test(text)) {
    normalized = text.replace(',', '.');
  } else {
    return null;
  }
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function underTenPriority(deal) {
  const price = parseEuroPrice(deal?.effectivePrice ?? deal?.price);
  return price !== null && price < 10 ? (price <= 5 ? 2 : 1) : 0;
}
export function compareDealsUnderTen(a, b) {
  const priority = underTenPriority(b) - underTenPriority(a);
  if (priority) return priority;
  const score = value => {
    const n = Number(value?.dealScore);
    return Number.isFinite(n) ? n : 0;
  };
  return score(b) - score(a);
}
