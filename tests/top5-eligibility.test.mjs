import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleForFreshTopFive } from '../api/daily-top5.js';

const now=Date.parse('2026-11-22T17:00:00Z');
const base={
  event:'published',
  verification:{state:'VERIFIED',verifiedAt:'2026-11-22T16:56:00Z'},
  amazonUrl:'https://www.amazon.it/dp/B012345678?tag=example-21',
  asin:'B012345678',title:'Synthetic offer',
  agentLifecycle:{status:'PUBLISHED',validUntil:'2026-11-22T18:00:00Z'},
  stock:true
};

test('fresh verified, in stock, live offer passes',()=>assert.equal(eligibleForFreshTopFive(base,now),true));
test('expired promotion does not pass',()=>assert.equal(eligibleForFreshTopFive({...base,promotionValidUntil:'2026-11-22T16:59:59Z'},now),false));
test('stale verification does not pass',()=>assert.equal(eligibleForFreshTopFive({...base,verification:{state:'VERIFIED',verifiedAt:'2026-11-22T16:40:00Z'}},now),false));
test('missing verification does not pass',()=>assert.equal(eligibleForFreshTopFive({...base,verification:null},now),false));
test('out of stock does not pass',()=>assert.equal(eligibleForFreshTopFive({...base,stock:false},now),false));
test('phishing host does not pass',()=>assert.equal(eligibleForFreshTopFive({...base,amazonUrl:'https://amazon.it.attacker.example/dp/B012345678'},now),false));
test('expired lifecycle object must be blocked',()=>assert.equal(eligibleForFreshTopFive({...base,agentLifecycle:{status:'EXPIRED'}},now),false));
test('stale lifecycle object must be blocked',()=>assert.equal(eligibleForFreshTopFive({...base,agentLifecycle:{status:'STALE'}},now),false));
test('absent stock for physical goods must not count as verified',()=>assert.equal(eligibleForFreshTopFive({...base,stock:undefined},now),false));
