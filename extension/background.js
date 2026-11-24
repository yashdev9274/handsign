const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://handsign-kappa.vercel.app", "https://handsigns.vercel.app"];
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.url) return;
  const origin = new URL(sender.url).origin;
  if (origin === "https://meet.google.com" && message.type === "SET_ARMED" && sender.tab?.id !== undefined) {
    chrome.storage.session.get("armedTabId").then(async state => {
      if (message.armed) await chrome.storage.session.set({ armedTabId: sender.tab.id });
      else if (state.armedTabId === sender.tab.id) await chrome.storage.session.remove("armedTabId");
      respond({ ok: true });
    }).catch(() => respond({ ok: false }));
    return true;
  }
  if (!APP_ORIGINS.includes(origin)) return;
  if (message.type === "GESTURE_DETECTED") {
    if (typeof message.gesture !== "string") return;
    chrome.storage.session.get("armedTabId").then(async state => {
      if (state.armedTabId === undefined) { respond({ ok: false }); return; }
      const result = await chrome.tabs.sendMessage(state.armedTabId, { type: "WEBSITE_GESTURE", gesture: message.gesture });
      respond({ ok: result?.ok === true });
    }).catch(() => respond({ ok: false }));
    return true;
  }
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
