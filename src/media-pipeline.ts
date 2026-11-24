export async function processCamera(stream: MediaStream, onClose: () => void = () => {}) {
  const source = stream.getVideoTracks()[0];
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true;
  video.srcObject = new MediaStream([source]);
  const canvas = document.createElement("canvas");
  const background = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas processing unavailable");
  let ready = false, closed = false, until = 0, timer: ReturnType<typeof setInterval>;
  const consumers = new Map<MediaStreamTrack, () => void>();
  const pipeline = {
    video, canvas,
    get closed() { return closed; },
    get hasBackground() { return ready; },
    get vanished() { return ready && performance.now() < until; },
    capture() {
      if (closed || video.readyState < 2) throw new Error("Camera is not ready");
      background.width = canvas.width; background.height = canvas.height;
      background.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      ready = true; until = 0;
    },
    vanish() { if (!ready || closed) return false; until = performance.now() + 3500; draw(); return true; },
    restore() { until = 0; if (!closed) draw(); },
    close() {
      if (closed) return;
      closed = true; clearInterval(timer);
      source.stop();
      for (const stop of consumers.values()) stop();
      consumers.clear(); video.pause(); video.srcObject = null;
      onClose();
    },
    stream: null as MediaStream | null
  };
  function draw() {
    if (closed || video.readyState < 2) return;
    try {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ready = false; until = 0;
      }
      ctx!.drawImage(pipeline.vanished ? background : video, 0, 0, canvas.width, canvas.height);
    } catch { pipeline.close(); }
  }
  function decorate(track: MediaStreamTrack): MediaStreamTrack {
    const stop = track.stop.bind(track), clone = track.clone.bind(track);
    consumers.set(track, stop);
    track.stop = () => {
      stop(); consumers.delete(track);
      if (!consumers.size) pipeline.close();
    };
    track.clone = () => decorate(clone());
    track.getSettings = () => ({ ...source.getSettings(), ...{ width: canvas.width, height: canvas.height } });
    track.getConstraints = source.getConstraints.bind(source);
    track.getCapabilities = source.getCapabilities.bind(source);
    track.applyConstraints = async constraints => {
      await source.applyConstraints(constraints);
      ready = false; until = 0;
    };
    Object.defineProperty(track, "label", { get: () => source.label });
    return track;
  }
  try {
    await Promise.race([video.play(), new Promise<never>((_, reject) => {
      const timeout = setTimeout(() => reject(new Error("Camera playback timed out")), 10000);
      video.addEventListener("playing", () => clearTimeout(timeout), { once: true });
    })]);
    if (source.readyState === "ended") throw new Error("Camera ended during setup");
    draw();
    const output = decorate(canvas.captureStream(30).getVideoTracks()[0]);
    pipeline.stream = new MediaStream([...stream.getAudioTracks(), output]);
    timer = setInterval(draw, 1000 / 30);
    source.addEventListener("ended", () => pipeline.close(), { once: true });
    return pipeline;
  } catch (error) {
    pipeline.close();
    stream.getTracks().forEach(t => t.stop());
    throw error;
  }
}
export type CameraPipeline = Awaited<ReturnType<typeof processCamera>>;
