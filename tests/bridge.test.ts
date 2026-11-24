import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const content = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const sign = { id: 'id', name: 'Vanish', samples: [Array(63).fill(0)], createdAt: 1 };

test('deployed site syncs saved signs even when startup message was missed', async () => {
  let raw = JSON.stringify([sign]);
  const messages: unknown[] = [];
  let poll: () => Promise<void>;
  const window = { addEventListener() {}, postMessage() {} };
  vm.runInNewContext(content, {
    location: { origin: 'https://handsign-kappa.vercel.app' }, window,
    localStorage: { getItem: () => raw },
    chrome: { runtime: { sendMessage: async (m: unknown) => { messages.push(m); return { ok: true }; } } },
    setInterval: (fn: () => Promise<void>) => { poll = fn; }, clearInterval() {}
  });
  await new Promise(r => setImmediate(r));
  assert.equal((messages[0] as { gestures: typeof sign[] }).gestures[0].name, 'Vanish');
  raw = JSON.stringify([{ ...sign, name: 'New sign' }]);
  await poll!();
  assert.equal((messages[1] as { gestures: typeof sign[] }).gestures[0].name, 'New sign');
  await poll!();
  assert.equal(messages.length, 2);
});
test('background accepts trusted site samples and rejects untrusted or malformed data', async () => {
  let listener: (message: unknown, sender: unknown, respond: (v: unknown) => void) => unknown;
  let stored: unknown;
  vm.runInNewContext(background, { URL, chrome: {
    runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    storage: { local: { set: async (value: unknown) => { stored = value; } } }
  } });
  listener!({ type: 'SYNC_GESTURES', gestures: [sign] }, { url: 'https://evil.example' }, () => {});
  assert.equal(stored, undefined);
  let response: unknown;
  listener!({ type: 'SYNC_GESTURES', gestures: [{}] }, { url: 'https://handsign-kappa.vercel.app/' }, value => { response = value; });
  assert.equal((response as { ok: boolean }).ok, false);
  listener!({ type: 'SYNC_GESTURES', gestures: [sign] }, { url: 'https://handsign-kappa.vercel.app/' }, value => { response = value; });
  await new Promise(r => setImmediate(r));
  assert.equal((stored as unknown as { gestures: typeof sign[] }).gestures[0].name, 'Vanish');
  assert.equal((response as { ok: boolean }).ok, true);
});
