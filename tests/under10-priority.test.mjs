import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEuroPrice, underTenPriority, compareDealsUnderTen} from '../lib/under10-priority.js';

const cases = [
  [9.99,9.99], ['9,99 €',9.99], ['€ 4,50',4.5],
  ['1.299,00 €',1299], ['€ 1.299,00',1299],
  ['1.299',1299], ['1 299,00 €',1299],
  ['€ 1,299.00',1299], ['1.234.567,89 €',1234567.89],
  ['0,00 €',0], ['10,00 €',10], ['20.00',20],
  ['9,99 € invece di 19,99 €',null], ['-9,99 €',null],
  ['coupon 20% prezzo 9,99 €',null], ['99,999 €',99999],
  ['non disponibile',null], [null,null], [Infinity,null]
];
for (const [input,expected] of cases) {
  test(`parseEuroPrice ${String(input)} -> ${String(expected)}`,()=> {
    assert.equal(parseEuroPrice(input), expected);
  });
}
test('no thousand-euro false positive in under-10 tier', () => {
  assert.equal(underTenPriority({price:'1.299,00 €'}),0);
  assert.equal(underTenPriority({price:'4,99 €'}),2);
  assert.equal(underTenPriority({price:'9,99 €'}),1);
  assert.equal(underTenPriority({price:'10,00 €'}),0);
});
test('rank keeps lower verified-looking price before expensive, but never publishes', () => {
  const deals=[
    {price:'1.299,00 €',dealScore:100},
    {price:'9,99 €',dealScore:50},
    {price:'4,99 €',dealScore:60},
    {price:'no price',dealScore:80}
  ].sort(compareDealsUnderTen);
  assert.deepEqual(deals.map(x=>x.price),['4,99 €','9,99 €','1.299,00 €','no price']);
});
test('nonfinite scores cannot destabilize ordering',()=>{
  const deals=[{price:'7,00',dealScore:Infinity},{price:'8,00',dealScore:90}].sort(compareDealsUnderTen);
  assert.equal(deals[0].dealScore,90);
});
test('invalid effective price cannot be hidden by old visible price',()=>{
  assert.equal(underTenPriority({price:'4,99 €',effectivePrice:'not verified'}),0);
});
