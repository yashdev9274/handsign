export type Landmark = { x: number; y: number; z?: number };
export type Gesture = { id: string; name: string; samples: number[][]; createdAt: number };
export type Match = { gesture: Gesture; confidence: number } | null;

export function validateGestures(value: unknown): Gesture[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).filter((g): g is Gesture =>
    !!g && typeof g.id === "string" && typeof g.name === "string" &&
    g.name.length <= 100 && Number.isFinite(g.createdAt) &&
    Array.isArray(g.samples) && g.samples.length > 0 && g.samples.length <= 200 &&
    g.samples.every((s: unknown) => Array.isArray(s) && [63, 126].includes(s.length) &&
      s.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100))
  );
}

// Keep the original coordinate format so previously trained signs still work.
export function makeVector(hands: Landmark[][]): number[] | null {
  if (!hands.length || hands.some(h => h.length !== 21)) return null;
  const points = hands.flat();
  const wrist = points[0];
  const scale = Math.max(Math.hypot(points[9].x - wrist.x, points[9].y - wrist.y), .01);
  return points.flatMap(p => [(p.x - wrist.x) / scale, (p.y - wrist.y) / scale, (p.z || 0) / scale]);
}

export function findMatch(hands: Landmark[][], gestures: Gesture[]): Match {
  const vectors = [makeVector(hands)];
  if (hands.length === 2) vectors.push(makeVector([...hands].reverse()));
  let best: Match = null;
  for (const gesture of gestures) {
    let distance = Infinity;
    for (const vector of vectors) for (const sample of gesture.samples) {
      if (!vector || sample.length !== vector.length) continue;
      const rms = Math.sqrt(vector.reduce((sum, v, i) => sum + (v - sample[i]) ** 2, 0) / vector.length);
      distance = Math.min(distance, rms);
    }
    const confidence = Math.max(0, 1 - distance / .65);
    if (confidence >= .78 && (!best || confidence > best.confidence)) best = { gesture, confidence };
  }
  return best;
}

export class GestureGate {
  private candidate = "";
  private since = 0;
  private latched = false;
  private releaseSince: number | null = null;
  update(id: string | null, now: number): boolean {
    if (!id) {
      this.candidate = "";
      this.releaseSince ??= now;
      if (now - this.releaseSince >= 400) this.latched = false;
      return false;
    }
    this.releaseSince = null;
    if (this.latched) return false;
    if (id !== this.candidate) { this.candidate = id; this.since = now; return false; }
    if (now - this.since < 500) return false;
    this.latched = true;
    return true;
  }
}
