"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Landmark = { x: number; y: number; z?: number };

type Gesture = {
  id: string;
  name: string;
  samples: number[][];
  createdAt: number;
};

type Match = {
  gesture: Gesture;
  confidence: number;
} | null;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";

const STORAGE_KEY = "handsign.gestures";
const SAMPLE_TARGET = 12;

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<{
    detectForVideo: (
      video: HTMLVideoElement,
      timestamp: number
    ) => {
      landmarks?: Landmark[][];
    };
  } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number>(0);
  const lastVideoTime = useRef(-1);
  const vanishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [samples, setSamples] = useState<number[][]>([]);
  const [gestureName, setGestureName] = useState("Vanish");
  const [latestLandmarks, setLatestLandmarks] = useState<
    Landmark[][] | null
  >(null);
  const [match, setMatch] = useState<Match>(null);
  const [isVanishing, setIsVanishing] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [visionStatus, setVisionStatus] = useState("loading vision");
  const [message, setMessage] = useState(
    "Vision is loading. Turn on your camera to begin."
  );

  /*
   * Load saved gestures and initialize MediaPipe.
   */
  useEffect(() => {
    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      const isKnownDelegateNotice = args.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes(
            "Created TensorFlow Lite XNNPACK delegate for CPU"
          )
      );

      if (!isKnownDelegateNotice) {
        originalConsoleError(...args);
      }
    };

    try {
      const savedGestures = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "[]"
      );

      setGestures(savedGestures);
    } catch {
      setGestures([]);
    }

    let cancelled = false;

    void import("@mediapipe/tasks-vision")
      .then(async ({ FilesetResolver, HandLandmarker }) => {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

        const landmarker =
          await HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 2
          });

        if (!cancelled) {
          landmarkerRef.current = landmarker;
          setVisionStatus("vision ready");
          setMessage(
            "Vision is ready. Turn on your camera to begin."
          );
        }
      })
      .catch((error) => {
        console.error(error);
        setVisionStatus("vision unavailable");
        setMessage(
          "The local vision model could not load. Check your connection and reload."
        );
      });

    return () => {
      cancelled = true;
      console.error = originalConsoleError;
    };
  }, []);

  /*
   * Lines 71–78:
   * Send saved gestures to the Chrome extension.
   */
  useEffect(() => {
    window.postMessage(
      {
        source: "handsign-app",
        type: "HANDSIGN_GESTURES_UPDATED",
        gestures
      },
      "*"
    );
  }, [gestures]);

  /*
   * Detect gestures from the camera feed.
   */
  const processFrame = useCallback(
    (timestamp: number) => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (
        video &&
        landmarker &&
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime.current
      ) {
        try {
          const result = landmarker.detectForVideo(
            video,
            timestamp
          );

          lastVideoTime.current = video.currentTime;

          const hands = result.landmarks?.length
            ? result.landmarks
            : null;

          setLatestLandmarks(hands);
          drawLandmarks(canvasRef.current, hands);

          if (hands && gestures.length) {
            const vector = makeVector(hands);

            if (vector) {
              const best = gestures.reduce<Match>(
                (current, gesture) => {
                  const distance = Math.min(
                    ...gesture.samples.map((sample) =>
                      euclidean(vector, sample)
                    )
                  );

                  const confidence = Math.max(
                    0,
                    1 - distance / 0.65
                  );

                  return !current ||
                    confidence > current.confidence
                    ? { gesture, confidence }
                    : current;
                },
                null
              );

              const nextMatch =
                best && best.confidence >= 0.78
                  ? best
                  : null;

              setMatch(nextMatch);

              if (nextMatch && !isVanishing) {
                setIsVanishing(true);

                /*
                 * Lines 108–116:
                 * Send the detected gesture to the Chrome extension.
                 */
                window.postMessage(
                  {
                    source: "handsign-app",
                    type: "HANDSIGN_GESTURE_DETECTED",
                    gesture: nextMatch.gesture.name,
                    durationMs: 3500
                  },
                  "*"
                );

                if (vanishTimer.current) {
                  clearTimeout(vanishTimer.current);
                }

                vanishTimer.current = setTimeout(() => {
                  setIsVanishing(false);
                }, 3500);
              }
            }
          } else {
            setMatch(null);
          }
        } catch (error) {
          console.error(
            "Hand landmark detection failed",
            error
          );

          setVisionStatus("vision unavailable");
          setMessage(
            "Hand detection stopped unexpectedly. Reload the page to try again."
          );
          setCameraOn(false);
        }
      }

      frameRef.current =
        requestAnimationFrame(processFrame);
    },
    [gestures, isVanishing]
  );

  useEffect(() => {
    if (cameraOn) {
      frameRef.current =
        requestAnimationFrame(processFrame);
    }

    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [cameraOn, processFrame]);

  async function startCamera() {
    if (!landmarkerRef.current || !navigator.mediaDevices) {
      setMessage(
        "Vision is still loading or camera access is unavailable."
      );
      return;
    }

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            width: 1280,
            height: 720,
            facingMode: "user"
          },
          audio: false
        });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
      setMessage(
        "Hold your gesture steady, then record 12 samples."
      );
    } catch (error) {
      console.error(error);
      setMessage(
        "Camera access was not granted. Allow it in your browser to continue."
      );
    }
  }

  function recordSample() {
    const vector =
      latestLandmarks && makeVector(latestLandmarks);

    if (!vector) {
      setMessage(
        "Show one or two hands clearly inside the frame first."
      );
      return;
    }

    setSamples((current) => [...current, vector]);

    setMessage(
      samples.length + 1 >= SAMPLE_TARGET
        ? "Great. Save this gesture or record more samples."
        : "Sample captured. Change your angle slightly and record again."
    );
  }

  function saveGesture() {
    if (samples.length < 4) {
      return;
    }

    const gesture: Gesture = {
      id: crypto.randomUUID(),
      name: gestureName.trim() || "Untitled gesture",
      samples,
      createdAt: Date.now()
    };

    const next = [...gestures, gesture];

    setGestures(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSamples([]);

    setMessage(
      `“${gesture.name}” saved locally. Make it to preview vanish.`
    );
  }

  function deleteGesture(id: string) {
    const next = gestures.filter(
      (gesture) => gesture.id !== id
    );

    setGestures(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return (
    <main className="mx-auto w-[min(1180px,calc(100%-48px))] py-7 max-md:w-[calc(100%-28px)]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-lg font-extrabold tracking-[-.04em]">
          <span className="grid size-[26px] place-items-center rounded-lg bg-[var(--gold)] text-[var(--panel)]">
            ✦
          </span>
          handsign
        </div>

        <div className="mono text-[10px] text-[var(--muted)]">
          <i className="mr-2 inline-block size-1.5 rounded-full bg-[#73d5a0] shadow-[0_0_12px_#73d5a0]" />
          local processing
        </div>
      </header>

      <section className="flex items-end justify-between gap-8 py-[110px] max-md:block max-md:py-[75px]">
        <div>
          <p className="mono mb-4 text-[10px] text-[var(--gold)]">
            Gesture-controlled presence
          </p>

          <h1 className="mb-6 text-[clamp(48px,7vw,88px)] font-extrabold leading-[.94] tracking-[-.075em]">
            Make your own
            <br />
            <em className="not-italic text-[var(--purple)]">
              vanish
            </em>{" "}
            sign.
          </h1>

          <p className="max-w-[500px] text-[15px] leading-7 text-[#a8a9b2]">
            Train a private hand gesture in seconds. Handsign
            recognizes it on your device and turns the camera
            feed into a playful disappearance.
          </p>
        </div>

        <div className="flex max-w-[210px] gap-3.5 pb-1 text-sm leading-6 text-[var(--muted)] max-md:mt-7">
          <span className="mono text-[11px] text-[var(--gold)]">
            01
          </span>
          Camera frames never leave this browser.
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)] gap-[18px] max-md:grid-cols-1">
        <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(18,21,30,.84)] p-[22px] shadow-[0_18px_60px_rgba(0,0,0,.16)]">
          <div className="flex items-start justify-between">
            <div>
              <p className="mono mb-3.5 text-[10px] text-[var(--gold)]">
                Live preview
              </p>

              <h2 className="text-xl font-bold tracking-[-.04em]">
                Your camera
              </h2>
            </div>

            <span
              className={`mono rounded-full border px-2.5 py-2 text-[10px] ${
                visionStatus === "vision ready"
                  ? "border-[#73d5a0]/30 text-[#73d5a0]"
                  : "border-[var(--line)] text-[var(--muted)]"
              }`}
            >
              {visionStatus}
            </span>
          </div>

          <div
            className={`relative mt-5 min-h-[440px] overflow-hidden rounded-xl bg-[#080a10] ${
              isVanishing
                ? "ring-2 ring-[var(--purple)]"
                : ""
            }`}
          >
            <video
              ref={videoRef}
              className={`h-[440px] w-full object-cover [transform:scaleX(-1)] ${
                cameraOn ? "opacity-100" : "opacity-0"
              }`}
              autoPlay
              playsInline
              muted
            />

            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 h-full w-full [transform:scaleX(-1)]"
            />

            {!cameraOn && (
              <div className="absolute inset-0 grid place-content-center justify-items-center bg-[radial-gradient(circle_at_50%_50%,#24213c,#0b0d14_60%)] text-center text-[#aaabb4]">
                <div className="mb-[18px] grid size-[62px] place-items-center rounded-full border border-[var(--purple)]/50 text-3xl text-[var(--purple)]">
                  ◎
                </div>

                <p className="mb-5">
                  Turn on your camera
                  <br />
                  to begin training
                </p>

                <button
                  onClick={startCamera}
                  className="rounded-lg bg-[var(--gold)] px-4 py-3 text-xs font-extrabold text-[#0e0d12]"
                >
                  Start camera
                </button>
              </div>
            )}

            <div className="mono absolute left-4 top-4 rounded-md bg-[rgba(9,11,18,.62)] px-2.5 py-2 text-[10px] text-[var(--muted)]">
              <i className="mr-2 inline-block size-1.5 rounded-full bg-[#73d5a0]" />
              live / local
            </div>

            {isVanishing && (
              <div className="absolute inset-0 grid place-content-center overflow-hidden bg-[rgba(9,11,18,.35)]">
                <div className="smoke smoke-a" />
                <div className="smoke smoke-b" />
                <div className="smoke smoke-c" />
                <span className="relative z-10 mono text-xs">
                  vanished
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-[18px]">
            <div>
              <span className="mono mb-1.5 block text-[9px] text-[var(--muted)]">
                Detected gesture
              </span>

              <strong className="text-[15px]">
                {match?.gesture.name ||
                  (latestLandmarks
                    ? "No saved sign matched"
                    : "Waiting for a hand")}
              </strong>
            </div>

            <div className="text-right">
              <span className="mono mb-1.5 block text-[9px] text-[var(--muted)]">
                Confidence
              </span>

              <strong className="text-[15px] text-[var(--gold)]">
                {match
                  ? `${Math.round(match.confidence * 100)}%`
                  : "—"}
              </strong>
            </div>
          </div>
        </div>

        <aside className="grid content-start gap-[18px]">
          <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(18,21,30,.84)] p-[22px] shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="mono mb-3.5 text-[10px] text-[var(--gold)]">
                  Gesture studio
                </p>

                <h2 className="text-xl font-bold tracking-[-.04em]">
                  Train a sign
                </h2>
              </div>

              <span className="mono text-[10px] text-[var(--purple)]">
                02
              </span>
            </div>

            <label
              htmlFor="gesture-name"
              className="mt-7 block text-xs font-bold text-[#e2deda]"
            >
              Name your gesture
            </label>

            <input
              id="gesture-name"
              value={gestureName}
              onChange={(event) =>
                setGestureName(event.target.value)
              }
              maxLength={28}
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[#0b0e16] p-3.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--purple)]"
            />

            <p className="my-3 text-[11px] leading-4 text-[var(--muted)]">
              Hold your sign in frame. We’ll keep landmark
              coordinates, never video.
            </p>

            <div className="mb-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-[#272a35]">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-[var(--purple)] to-[var(--gold)] transition-[width]"
                  style={{
                    width: `${
                      Math.min(
                        samples.length / SAMPLE_TARGET,
                        1
                      ) * 100
                    }%`
                  }}
                />
              </div>

              <span className="mono mt-2 block text-[10px] text-[var(--muted)]">
                {samples.length} / {SAMPLE_TARGET} samples
              </span>
            </div>

            <button
              disabled={!cameraOn}
              onClick={recordSample}
              className="mt-2 w-full rounded-lg bg-[var(--gold)] px-4 py-3 text-xs font-extrabold text-[#0e0d12] disabled:cursor-not-allowed disabled:opacity-35"
            >
              Record sample
            </button>

            <button
              disabled={samples.length < 4}
              onClick={saveGesture}
              className="mt-2 w-full rounded-lg border border-[var(--line)] px-4 py-3 text-xs font-extrabold text-[#efedf3] disabled:cursor-not-allowed disabled:opacity-35"
            >
              Save gesture
            </button>

            <p className="mt-4 min-h-8 text-[11px] leading-4 text-[var(--muted)]">
              {message}
            </p>
          </div>

          <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(18,21,30,.84)] p-[22px] shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="mono mb-3.5 text-[10px] text-[var(--gold)]">
                  Your library
                </p>

                <h2 className="text-xl font-bold tracking-[-.04em]">
                  Saved gestures
                </h2>
              </div>

              <span className="mono text-[10px] text-[var(--gold)]">
                {gestures.length}
              </span>
            </div>

            <div className="mt-5">
              {gestures.length ? (
                gestures.map((gesture) => (
                  <div
                    key={gesture.id}
                    className="flex items-center gap-3 border-t border-[var(--line)] py-3"
                  >
                    <div className="grid size-7 place-items-center rounded-lg bg-[var(--purple)] text-[#101018]">
                      ✦
                    </div>

                    <div className="grid flex-1 gap-1">
                      <strong className="text-xs">
                        {gesture.name}
                      </strong>

                      <span className="text-[9px] text-[var(--muted)]">
                        {gesture.samples.length} local samples
                      </span>
                    </div>

                    <button
                      onClick={() => deleteGesture(gesture.id)}
                      className="bg-transparent text-xl text-[var(--muted)]"
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="border-t border-[var(--line)] py-4 text-[11px] text-[var(--muted)]">
                  Your saved signs will appear here.
                </p>
              )}
            </div>
          </div>
        </aside>
      </section>

      <footer className="flex justify-between pt-[55px] mono text-[10px] text-[var(--muted)]">
        <span>Built for playful calls.</span>
        <span>Meet + Zoom adapters coming next.</span>
      </footer>
    </main>
  );
}

function makeVector(
  hands: Landmark[][]
): number[] | null {
  if (!hands.length) {
    return null;
  }

  const points = hands.flat();
  const wrist = points[0];

  const scale = Math.max(
    Math.hypot(
      points[9].x - wrist.x,
      points[9].y - wrist.y
    ),
    0.01
  );

  return points.flatMap((point) => [
    (point.x - wrist.x) / scale,
    (point.y - wrist.y) / scale,
    (point.z || 0) / scale
  ]);
}

function euclidean(a: number[], b: number[]) {
  if (a.length !== b.length) {
    return 1;
  }

  return Math.sqrt(
    a.reduce(
      (sum, value, index) =>
        sum + (value - b[index]) ** 2,
      0
    ) / a.length
  );
}

function drawLandmarks(
  canvas: HTMLCanvasElement | null,
  hands: Landmark[][] | null
) {
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  context.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  if (!hands) {
    return;
  }

  context.fillStyle = "rgba(243, 182, 92, .95)";

  for (const hand of hands) {
    for (const point of hand) {
      context.beginPath();
      context.arc(
        point.x * canvas.width,
        point.y * canvas.height,
        3,
        0,
        Math.PI * 2
      );
      context.fill();
    }
  }
}