import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
test('production detection routes only to the armed tab and survives worker restart', async () => {
  type Listener = (m: unknown, s: unknown, r: (v: unknown) => void) => unknown;
  let listener: Listener;
  const state: Record<string, unknown> = {};
  const sent: { id: number; message: { gesture: string } }[] = [];
  function boot() {
    vm.runInNewContext(code, { URL, chrome: {
      runtime: { onMessage: { addListener: (fn: Listener) => { listener = fn; } } },
      storage: { session: {
        get: async () => state,
        set: async (value: object) => Object.assign(state, value),
        remove: async (key: string) => { delete state[key]; }
      } },
      tabs: { sendMessage: async (id: number, message: { gesture: string }) => { sent.push({ id, message }); return { ok: true }; } }
    } });
  }
  const flush = () => new Promise(r => setImmediate(r));
  boot();
  listener!({ type: 'SET_ARMED', armed: true }, { url: 'https://meet.google.com/abc', tab: { id: 7 } }, () => {});
  await flush(); boot();
  listener!({ type: 'GESTURE_DETECTED', gesture: 'Vanish' }, { url: 'https://handsigns.vercel.app/' }, () => {});
  await flush();
  assert.equal(sent.length, 1); assert.equal(sent[0].id, 7); assert.equal(sent[0].message.gesture, 'Vanish');
  listener!({ type: 'SET_ARMED', armed: false }, { url: 'https://meet.google.com/abc', tab: { id: 7 } }, () => {});
  await flush();
  listener!({ type: 'GESTURE_DETECTED', gesture: 'Vanish' }, { url: 'https://handsigns.vercel.app/' }, () => {});
  await flush(); assert.equal(sent.length, 1);
});
