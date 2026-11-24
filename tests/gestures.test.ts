import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatch, makeVector, validateGestures, GestureGate } from '../src/gestures';
const hand = Array.from({ length: 21 }, (_, i) => ({ x: .1 + i * .01, y: .2 + i * .02, z: i * .001 }));
const second = hand.map(p => ({ ...p, x: p.x + .4 }));
const gesture = { id: 'saved', name: 'Vanish', samples: [makeVector([hand])!], createdAt: 1 };
test('preserves and matches existing saved samples', () => {
  assert.equal(validateGestures([gesture]).length, 1);
  assert.equal(findMatch([hand], [gesture])?.gesture.id, 'saved');
});
test('matches two hands regardless of detection order', () => {
  const pair = { ...gesture, samples: [makeVector([hand, second])!] };
  assert.equal(findMatch([second, hand], [pair])?.confidence, 1);
});
test('rejects malformed or nonfinite stored samples', () => {
  assert.deepEqual(validateGestures([{}, { ...gesture, samples: [[NaN]] }]), []);
  assert.equal(findMatch([], [gesture]), null);
});
test('requires stable hold and release before triggering again', () => {
  const gate = new GestureGate();
  assert.equal(gate.update('saved', 0), false);
  assert.equal(gate.update('saved', 500), true);
  assert.equal(gate.update('saved', 5000), false);
  gate.update(null, 5100); gate.update(null, 5500);
  assert.equal(gate.update('saved', 5600), false);
  assert.equal(gate.update('saved', 6100), true);
});
