import test from "node:test";
import assert from "node:assert/strict";
import { parseEuroPrice, underTenPriority, compareDealsUnderTen } from "../lib/under10-priority.js";

test("under-10 ranking handles Italian euro formats", () => {
  assert.equal(parseEuroPrice("9,99 €"), 9.99);
  assert.equal(parseEuroPrice("€ 4,50"), 4.5);
  assert.equal(parseEuroPrice("non disponibile"), null);
  assert.equal(underTenPriority({ price:"9,99 €" }), 1);
  assert.equal(underTenPriority({ price:"4,99 €" }), 2);
  assert.equal(underTenPriority({ price:"10,00 €" }), 0);
});
test("low-price products outrank high-score expensive candidates", () => {
  const rows = [
    { price:"35,00 €", dealScore:100 },
    { price:"8,99 €", dealScore:65 },
    { price:"3,49 €", dealScore:50 },
    { price:null, dealScore:95 }
  ].sort(compareDealsUnderTen);
  assert.deepEqual(rows.map(x => x.price), ["3,49 €","8,99 €","35,00 €",null]);
});
test("within same tier deal score is preserved", () => {
  const rows=[{price:"7,00 €",dealScore:60},{price:"8,00 €",dealScore:90}].sort(compareDealsUnderTen);
  assert.equal(rows[0].dealScore,90);
});
