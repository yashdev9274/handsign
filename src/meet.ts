import { processCamera, type CameraPipeline } from "./media-pipeline";
import { GestureGate } from "./gestures";

(() => {
  if (location.origin !== "https://meet.google.com") return;
  const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const pipelines = new Set<CameraPipeline>();
  let current: CameraPipeline | null = null;
  let armed = false, capturing = false, busy = false, generation = 0;
  let frame: HTMLIFrameElement | null = null, extensionOrigin = "", recognizerReady = false;
  let gate = new GestureGate(), lastSent = 0;
  let libraryNames: string[] = [];
  let recognitionStatus = "Loading local recognition…";
  let status = "Turn your Meet camera on. Reload Meet after installing the extension.";
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = ":host{position:fixed;right:16px;top:64px;z-index:2147483647;width:280px;color:#f4f0e8;font:13px Arial}section{background:#12151ef5;border:1px solid #9b8cff;border-radius:12px;padding:14px;box-shadow:0 8px 32px #0008}button{margin:5px 4px 0 0;padding:8px;border:0;border-radius:6px;cursor:pointer;background:#f3b65c;color:#111}button:disabled{opacity:.4;cursor:default}p{line-height:1.5;margin:10px 0}small{color:#bbb}video{width:100%;max-height:140px;background:#000;border-radius:6px}";
  const panel = document.createElement("section");
  const title = document.createElement("strong"); title.textContent = "Handsign · outgoing camera";
  const text = document.createElement("p"); text.setAttribute("role", "status");
  const preview = document.createElement("video"); preview.muted = true; preview.autoplay = true; preview.playsInline = true;
  const capture = document.createElement("button"); capture.textContent = "Capture background (5s)";
  const arm = document.createElement("button"); arm.textContent = "Arm signs";
  const test = document.createElement("button"); test.textContent = "Test vanish";
  const restore = document.createElement("button"); restore.textContent = "Restore / disarm";
  const note = document.createElement("p"); const small = document.createElement("small");
  small.textContent = "Step out for capture. Keep camera fixed. Disable Meet background effects. Camera stays on. This replaces the whole image with a still photo, not a privacy control.";
  const library = document.createElement("p");
  const recognition = document.createElement("p");
  note.append(small); panel.append(title, text, library, recognition, preview, capture, arm, test, restore, note); root.append(style, panel);
  function mount() { if (document.body && !host.isConnected) document.body.append(host); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
  function update() {
    text.textContent = current?.vanished ? "Vanished: sending captured background. Restoring after 3.5s." : status;
    capture.disabled = !current || current.closed || capturing;
    arm.disabled = !current?.hasBackground || !recognizerReady || capturing;
    test.disabled = !current?.hasBackground || capturing;
    arm.textContent = armed ? "Signs armed" : "Arm signs";
    library.textContent = libraryNames.length ? `Website signs (${libraryNames.length}): ${libraryNames.join(", ")}` : "No website signs synced. Open handsign-kappa.vercel.app in this browser profile.";
    recognition.textContent = recognitionStatus;
  }
  function announceArmed() { window.postMessage({ source: "handsign-meet", type: "ARMED", armed }, location.origin); }
  function disarm() { armed = false; generation++; busy = false; gate = new GestureGate(); announceArmed(); }
  capture.onclick = async () => {
    if (!current || capturing) return;
    disarm(); capturing = true; current.restore();
    const target = current;
    for (let n = 5; n > 0; n--) {
      status = `Step out of frame. Capturing in ${n}…`; update();
      await new Promise(r => setTimeout(r, 1000));
      if (current !== target || target.closed || !capturing) { capturing = false; update(); return; }
    }
    try { target.capture(); status = "Background captured. Return to your seat, test vanish, then arm signs."; }
    catch { status = "Capture failed. Turn your camera off and on, then retry."; }
    capturing = false; update();
  };
  arm.onclick = () => {
    if (!current?.hasBackground || !recognizerReady) return;
    armed = true; generation++; busy = false; gate = new GestureGate(); announceArmed();
    status = "Armed. Hold your saved sign for half a second. Release between signs."; update();
  };
  test.onclick = () => { if (current?.vanish()) update(); };
  restore.onclick = () => {
    disarm(); capturing = false; pipelines.forEach(p => p.restore());
    status = "Live video restored. Recognition disarmed."; update();
  };
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await native(constraints);
    if (!constraints?.video || !stream.getVideoTracks().length ||
      stream.getVideoTracks()[0].getSettings().displaySurface) return stream;
    try {
      // Cleanup may run before processCamera resolves, so use an initialized holder.
      const session: { pipeline?: CameraPipeline } = {};
      const p = await processCamera(stream, () => {
        if (session.pipeline) pipelines.delete(session.pipeline);
        if (session.pipeline && current === session.pipeline) {
          disarm(); capturing = false; current = null; preview.srcObject = null;
          status = "Camera stopped or processing failed. Turn Meet camera off and on to reconnect."; update();
        }
      });
      session.pipeline = p;
      pipelines.add(p); current = p; disarm(); capturing = false;
      // Observe output without stopping tracks owned by Meet or holding a clone alive.
      preview.srcObject = p.stream;
      status = "Camera processing active. Capture an empty-room background before arming signs."; update();
      return p.stream!;
    } catch (error) {
      status = "Camera processor failed. Turn the camera off/on to retry. No vanish effect is active."; update();
      throw error;
    }
  };
  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === "handsign-bridge" && event.data.type === "WEBSITE_GESTURE") {
      if (armed && libraryNames.includes(event.data.gesture) && !current?.vanished) {
        pipelines.forEach(p => { if (p.hasBackground) p.vanish(); });
        recognitionStatus = `Website recognized: ${event.data.gesture}`; update();
      }
      return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === "handsign-bridge" && event.data.type === "INIT") {
      const url = event.data.recognizerUrl;
      if (frame || typeof url !== "string" || !/^chrome-extension:\/\/[a-p]{32}\/recognizer.html$/.test(url)) return;
      extensionOrigin = new URL(url).origin;
      frame = document.createElement("iframe"); frame.src = url; frame.hidden = true;
      (document.body || document.documentElement).append(frame);
    }
    if (!frame || event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
    if (event.data?.type === "LIBRARY") {
      libraryNames = Array.isArray(event.data.names) ? event.data.names.filter((n: unknown) => typeof n === "string").slice(0, 50) : [];
      disarm(); update();
    } else if (event.data?.type === "READY") {
      recognizerReady = true; recognitionStatus = "Recognition ready. Uses your website's saved signs."; update();
    } else if (event.data?.type === "ERROR") {
      disarm(); recognizerReady = false;
      recognitionStatus = "Recognition unavailable: " + String(event.data.message).slice(0, 180); update();
    } else if (event.data?.type === "RESULT" && event.data.generation === generation) {
      busy = false;
      if (!armed || !current?.hasBackground) return;
      recognitionStatus = event.data.id ? `Meet recognized: ${event.data.name} (${Math.round(event.data.confidence * 100)}%)` : `Meet: ${event.data.hands || 0} hand(s), no saved sign matched. Website detection also enabled.`;
      if (gate.update(typeof event.data.id === "string" ? event.data.id : null, performance.now()) && !current.vanished) {
        pipelines.forEach(p => { if (p.hasBackground) p.vanish(); });
      }
      update();
    }
  });
  setInterval(() => {
    update();
    if (armed && !current?.hasBackground) { disarm(); status = "Camera changed. Capture the background again."; }
    if (busy && performance.now() - lastSent > 5000) {
      disarm(); recognitionStatus = "Recognition timed out. Reload Meet to reconnect."; update();
    }
    if (!armed || !recognizerReady || !current || busy || !frame?.contentWindow || performance.now() - lastSent < 100) return;
    const p = current, version = generation;
    busy = true; lastSent = performance.now();
    void createImageBitmap(p.video, { resizeWidth: 640, resizeHeight: Math.round(640 * p.canvas.height / p.canvas.width) })
      .then(image => {
        if (!armed || current !== p || version !== generation) { image.close(); busy = false; return; }
        frame!.contentWindow!.postMessage({ type: "FRAME", image, generation: version }, extensionOrigin, [image]);
      }).catch(() => { busy = false; disarm(); status = "Recognition frame failed. Re-arm to retry."; });
  }, 100);
  window.addEventListener("pagehide", () => { disarm(); pipelines.forEach(p => p.close()); });
})();
