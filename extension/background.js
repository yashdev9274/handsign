const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://handsign-kappa.vercel.app"];
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.url || !APP_ORIGINS.includes(new URL(sender.url).origin)) return;
  if (message.type === "HELLO") { respond({ ok: true }); return; }
  if (message.type !== "SYNC_GESTURES") return;
  const gestures = message.gestures;
  if (!Array.isArray(gestures) || gestures.length > 50 || !gestures.every(g =>
    g && typeof g.id === "string" && typeof g.name === "string" && g.name.length <= 100 &&
    Number.isFinite(g.createdAt) && Array.isArray(g.samples) && g.samples.length > 0 && g.samples.length <= 200 &&
    g.samples.every(s => Array.isArray(s) && [63, 126].includes(s.length) &&
      s.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100))
  )) { respond({ ok: false }); return; }
  chrome.storage.local.set({ gestures }).then(() => respond({ ok: true }), () => respond({ ok: false }));
  return true;
});
