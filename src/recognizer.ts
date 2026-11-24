import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { findMatch, validateGestures } from "./gestures";

declare const chrome: {
  runtime: { getURL(path: string): string };
  storage: { local: { get(key: string): Promise<Record<string, unknown>> }; onChanged: { addListener(fn: (changes: Record<string, { newValue: unknown }>) => void): void } };
};
const MEET = "https://meet.google.com";
let gestures = validateGestures([]);
let landmarker: HandLandmarker | null = null;
function send(message: object) { parent.postMessage(message, MEET); }
function report() {
  send({ type: "LIBRARY", names: gestures.map(g => g.name) });
  if (landmarker && gestures.length) send({ type: "READY" });
  else if (landmarker) send({ type: "ERROR", message: "No saved signs. Open handsign-kappa.vercel.app in this browser profile to sync your library." });
}
chrome.storage.onChanged.addListener(changes => {
  if (changes.gestures) { gestures = validateGestures(changes.gestures.newValue); report(); }
});
async function init() {
  gestures = validateGestures((await chrome.storage.local.get("gestures")).gestures);
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("vendor/wasm"));
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: chrome.runtime.getURL("vendor/hand_landmarker.task"), delegate: "CPU" },
    runningMode: "VIDEO", numHands: 2
  });
  report();
}
void init().catch(error => send({ type: "ERROR", message: String(error) }));
window.addEventListener("message", event => {
  if (event.source !== parent || event.origin !== MEET || event.data?.type !== "FRAME") return;
  const image = event.data.image;
  if (!(image instanceof ImageBitmap)) return;
  try {
    const result = landmarker?.detectForVideo(image, performance.now());
    const match = findMatch(result?.landmarks || [], gestures);
    send({ type: "RESULT", id: match?.gesture.id || null, generation: event.data.generation });
  } catch (error) { send({ type: "ERROR", message: String(error) }); }
  finally { image.close(); }
});
window.addEventListener("pagehide", () => landmarker?.close());
