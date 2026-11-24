(() => {
  const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://handsign-kappa.vercel.app"];
  if (APP_ORIGINS.includes(location.origin)) {
    // Also support already deployed versions that emit their library only once.
    // This isolated content script can read this origin's localStorage, not video.
    let lastSynced = null;
    let syncing = false;
    async function syncSavedSigns() {
      if (syncing) return;
      syncing = true;
      try {
        const raw = localStorage.getItem("handsign.gestures");
        if (raw === null || raw === lastSynced) return;
        const gestures = JSON.parse(raw);
        const response = await chrome.runtime.sendMessage({ type: "SYNC_GESTURES", gestures });
        if (response?.ok) lastSynced = raw;
        window.postMessage({ source: "handsign-extension", type: "HANDSIGN_ACK", ok: response?.ok === true, synced: true }, location.origin);
      } catch {
        // Retry after the extension worker wakes up or the site finishes saving.
      } finally { syncing = false; }
    }
    void syncSavedSigns();
    const syncTimer = setInterval(() => void syncSavedSigns(), 1000);
    window.addEventListener("storage", () => void syncSavedSigns());
    window.addEventListener("pagehide", () => clearInterval(syncTimer), { once: true });
    window.addEventListener("message", async event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "handsign-app") return;
      const type = event.data.type;
      if (!["HANDSIGN_HELLO", "HANDSIGN_GESTURES_UPDATED"].includes(type)) return;
      try {
        const response = await chrome.runtime.sendMessage({
          type: type === "HANDSIGN_HELLO" ? "HELLO" : "SYNC_GESTURES",
          gestures: event.data.gestures
        });
        window.postMessage({ source: "handsign-extension", type: "HANDSIGN_ACK", ok: response?.ok === true, synced: type === "HANDSIGN_GESTURES_UPDATED" }, location.origin);
      } catch {
        window.postMessage({ source: "handsign-extension", type: "HANDSIGN_ACK", ok: false }, location.origin);
      }
    });
  }
  if (location.origin === "https://meet.google.com") {
    window.postMessage({ source: "handsign-bridge", type: "INIT", recognizerUrl: chrome.runtime.getURL("recognizer.html") }, location.origin);
  }
})();
