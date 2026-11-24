import { build } from "esbuild";
import { mkdir, cp, access, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "extension");
await mkdir(path.join(out, "vendor"), { recursive: true });
await build({ entryPoints: [path.join(root, "src/meet.ts")], bundle: true, outfile: path.join(out, "meet.js"), format: "iife", target: "chrome111" });
await build({ entryPoints: [path.join(root, "src/recognizer.ts")], bundle: true, outfile: path.join(out, "recognizer.js"), format: "iife", target: "chrome111" });
await cp(path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"), path.join(out, "vendor/wasm"), { recursive: true });
const model = path.join(out, "vendor/hand_landmarker.task");
try { await access(model); } catch {
  const response = await fetch("https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task");
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  await writeFile(model, Buffer.from(await response.arrayBuffer()));
}
console.log("Extension built in extension/. Load or reload it in chrome://extensions, then reload Meet and Handsign.");
