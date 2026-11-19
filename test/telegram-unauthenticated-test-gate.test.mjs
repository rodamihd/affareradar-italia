import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');
const fromHandler = code.slice(code.indexOf('export default async function handler('));

test('no unauthenticated test-message gate remains in telegram handler', () => {
  assert.ok(fromHandler.startsWith('export default async function handler('));
  assert.doesNotMatch(fromHandler, /AFFARERADAR_TEST_MESSAGE_ENABLED|systemTest|TEST SISTEMA AFFARERADAR/);
});

test('all non-POST requests are rejected before side effects', () => {
  const deny = fromHandler.indexOf('if (req.method !== "POST")');
  const guard = fromHandler.indexOf('auth !== secret');
  const token = fromHandler.indexOf('const token = process.env.TELEGRAM_BOT_TOKEN');
  const send = fromHandler.indexOf('await fetch(endpoint');
  assert.ok(deny >= 0 && guard > deny && token > guard && send > token);
  assert.match(fromHandler.slice(deny, guard), /return res\.status\(405\)/);
  assert.match(fromHandler.slice(guard, token), /return res\.status\(401\)/);
});

test('authorized POST still uses publish secret and verified Telegram endpoint', () => {
  assert.match(fromHandler, /const secret = process\.env\.PUBLISH_SECRET/);
  assert.match(fromHandler, /const auth = req\.headers\["x-affareradar-secret"\]/);
  assert.match(fromHandler, /return res\.status\(401\)/);
  assert.match(fromHandler, /https:\/\/api\.telegram\.org\/bot/);
  assert.match(fromHandler, /await fetch\(endpoint/);
});
